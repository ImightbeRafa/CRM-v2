// next.config.js
/** @type {import('next').NextConfig} */
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import { AURORA_ALIAS_REDIRECTS, CONFIG_PATH_REDIRECTS } from './src/components/aurora/config/config-redirects.mjs';

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/logistics/guias/generate-bulk': ['./src/lib/correos/wsdl/**/*'],
    '/api/shipping/generate-guia': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/tracking': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/tarifa': ['./src/lib/correos/wsdl/**/*'],
    '/api/logistics/correos-test': ['./src/lib/correos/wsdl/**/*'],
  },
  compress: true,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Server-side packages that should not be bundled
  serverExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium', 'soap', 'axios'],

  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'recharts', 'framer-motion'],
    // Keep the three webpack targets isolated. The in-process compiler is unstable
    // on the Windows release workstation and can terminate Node without an error.
    webpackBuildWorker: true,
    // Docker image build (Cloudflare deploy): the build worker segfaulted with 32 parallel
    // workers. The Dockerfile sets NEXT_BUILD_CPUS to cap parallelism; local builds unchanged.
    ...(process.env.NEXT_BUILD_CPUS ? { cpus: Math.max(1, Number(process.env.NEXT_BUILD_CPUS) || 4) } : {}),
  },

  // Image configuration
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'laplacelab.xyz' },
    ],
    unoptimized: false,
  },

  // Headers for security
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            // The ONLY Content-Security-Policy (middleware used to send a second, different one;
            // browsers enforce both, so the effective policy was their intersection).
            // challenges.cloudflare.com = Turnstile (only loaded when its keys are configured).
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://app.tilopay.com https://accounts.google.com https://www.googletagmanager.com https://api.tokenex.com https://storage.googleapis.com https://connect.facebook.net https://staticxx.facebook.com https://www.facebook.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://app.tilopay.com https://api.tilopay.com https://api.tokenex.com https://*.vercel-storage.com https://accounts.google.com https://connect.facebook.net https://graph.facebook.com https://www.facebook.com https://static.cloudflareinsights.com https://*.ingest.us.sentry.io https://challenges.cloudflare.com",
              "worker-src 'self' blob:",
              "frame-src 'self' https://app.tilopay.com https://api.tokenex.com https://accounts.google.com https://www.facebook.com https://web.facebook.com https://challenges.cloudflare.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "upgrade-insecure-requests"
            ].join('; ')
          },
          {
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'interest-cohort=()'
            ].join(', ')
          }
        ]
      }
    ];
  },

  async redirects() {
    return [
      ...CONFIG_PATH_REDIRECTS,
      ...AURORA_ALIAS_REDIRECTS,
      { source: '/pedidos', destination: '/ventas', permanent: false },
      { source: '/pedidos/:path*', destination: '/ventas/:path*', permanent: false },
    ];
  },

  webpack: (config, { dev, isServer, webpack }) => {
    // Temporarily disabled webpack configuration to fix build issues
    
    // Production optimizations only
    if (!dev) {
      // Define a server-safe global 'self' to prevent SSR crashes from browser-only libs
      if (isServer) {
        // Ensure UMD wrappers use globalThis instead of self on server
        config.output = {
          ...config.output,
          globalObject: 'globalThis',
        }
        config.plugins.push(
          new webpack.DefinePlugin({
            self: 'globalThis',
          })
        )
      }
      // Client chunking: Next.js defaults (granular per-route chunks). The old override (one
      // chunk per npm package + an enforced "commons" chunk of everything used by 2+ routes)
      // made every page download ~700 KB of JS, most of it for other pages (perf 2026-09-30).
    }

    return config;
  },
};

export default withSentryConfig(bundleAnalyzer(nextConfig), {
  org: "betsy-v0",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // No tunnelRoute: its rewrite forwarded every header (session cookie included) to Sentry.
  // Browser events use our own relay, src/app/monitoring/route.ts (Sentry.init tunnel).
  webpack: {
    automaticVercelMonitors: true,
    treeshake: { removeDebugLogging: true },
  },
});
