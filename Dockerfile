# Next.js 15 standalone image for a Node host (Cloudflare Containers).
# Build: docker build -t betsy-crm .
# Run:  docker run -p 3000:3000 --env-file .env betsy-crm
# On any copy that shares the live database, set DISABLE_CRONS=1.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
# prisma generate does not connect. These exist only in the builder stage.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV NEXTAUTH_SECRET=build-only-not-a-runtime-secret
ENV NEXTAUTH_URL=http://localhost:3000
ENV RESEND_API_KEY=build-only
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV USE_SPARTICUZ_CHROMIUM=1
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Runtime libs for @sparticuz/chromium and puppeteer-core (glibc, not Alpine).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# File tracing drops Chromium brotli bins and sometimes the Prisma engine.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@sparticuz/chromium ./node_modules/@sparticuz/chromium
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/puppeteer-core ./node_modules/puppeteer-core
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/puppeteer ./node_modules/puppeteer
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# resolveWsdlPath() checks cwd/src/lib/correos/wsdl and cwd/wsdl
# (next.config.js outputFileTracingIncludes for Correos SOAP).
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/correos/wsdl ./src/lib/correos/wsdl
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/correos/wsdl ./wsdl

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
