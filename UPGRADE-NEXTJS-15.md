# Next.js 15 Security Upgrade Guide

**Date:** February 5, 2026
**From:** Next.js 14.2.35 → Next.js 15.5.12
**React:** Staying on React 18.2.x (Next.js 15 supports React 18.2.0+)

---

## Why This Upgrade?

Next.js 14.x reached end-of-life on **2025-10-26** and no longer receives security patches.
The security scanner reports the following vulnerabilities that this upgrade resolves:

| CVE / Advisory | Severity | Description |
|---|---|---|
| GHSA-9g9p-9gw9-jx7f | **High** | DoS via Image Optimizer remotePatterns |
| GHSA-h25m-26qc-wcjf | **High** | HTTP request deserialization DoS with insecure RSC |
| undici < 6.23.0 | **High** | Unbounded decompression chain DoS |
| glob 10.2.0-10.4.5 | **High** | Command injection via --cmd |
| AIKIDO-2025-10755 | **High** | @reduxjs/toolkit SSR state leakage |

---

## Package Version Changes

| Package | Before | After | Notes |
|---|---|---|---|
| `next` | 14.2.35 | **15.5.12** | Major upgrade |
| `eslint-config-next` | 14.2.35 | **15.5.12** | Must match Next.js |
| `@next/bundle-analyzer` | 14.2.20 | **15.5.12** | Must match Next.js |
| `react` | ^18.2.0 | ^18.2.0 | **No change** |
| `react-dom` | ^18.2.0 | ^18.2.0 | **No change** |

---

## Breaking Changes & Required Code Fixes

### 1. `next.config.js` — Config Structure Changes

#### 1a. `serverComponentsExternalPackages` moved out of `experimental`

```js
// BEFORE (Next.js 14):
experimental: {
  serverComponentsExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium'],
},

// AFTER (Next.js 15):
serverExternalPackages: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium'],
```

#### 1b. `images.domains` deprecated → use `images.remotePatterns`

```js
// BEFORE (Next.js 14):
images: {
  domains: ['lh3.googleusercontent.com', 'laplacelab.xyz'],
  unoptimized: true,
},

// AFTER (Next.js 15):
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    { protocol: 'https', hostname: 'laplacelab.xyz' },
  ],
  unoptimized: true,
},
```

---

### 2. Route Handler `params` — Now a Promise

In Next.js 15, the `params` argument in dynamic route handlers (`[id]`, `[slug]`, etc.)
is now a **Promise** and must be **awaited**.

**Files affected (5 files, 7 handlers):**

| File | Handlers |
|---|---|
| `src/app/api/users/[id]/route.ts` | PUT, DELETE |
| `src/app/api/invoices/[id]/pdf/route.ts` | GET |
| `src/app/api/invoices/[id]/email/route.ts` | POST |
| `src/app/api/config/api-keys/[id]/route.ts` | DELETE |
| `src/app/api/shipping/guias/download/[id]/route.ts` | GET |

```typescript
// BEFORE (Next.js 14):
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id;
}

// AFTER (Next.js 15):
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
}
```

---

### 3. Middleware — No Changes Required

The middleware in this project uses `Request` + `getToken()` from `next-auth/jwt`.
This pattern is fully compatible with Next.js 15. No changes needed.

---

### 4. `useSearchParams` — Already Fixed

All components using `useSearchParams` are already wrapped in `<Suspense>` boundaries
(fixed in the previous security session). No additional changes needed.

**Already wrapped:**
- `src/app/components/NavigationProgress.tsx`
- `src/app/auth/signin/page.tsx`
- `src/app/auth/verify-email/page.tsx`
- `src/app/config/page.tsx`

---

### 5. `cookies()` / `headers()` from `next/headers` — Not Used

This codebase does **not** import from `next/headers`. Authentication is handled via
`getToken()` from `next-auth/jwt` which reads cookies internally. No changes needed.

---

### 6. NextAuth Compatibility

`next-auth@4.24.13` is compatible with Next.js 15. The `[...nextauth]` route handler
pattern (`export { handler as GET, handler as POST }`) works unchanged.

---

### 7. Caching Behavior Changes

Next.js 15 changes default caching:
- `fetch()` requests are **no longer cached by default** (were cached in 14)
- Route handlers `GET` are **no longer cached by default**

This project already uses `export const dynamic = 'force-dynamic'` on routes that need it,
and the API routes are all dynamic by nature. **No changes needed.**

---

## Files Modified (Complete List)

| # | File | Change |
|---|---|---|
| 1 | `package.json` | Update next, eslint-config-next, @next/bundle-analyzer versions |
| 2 | `next.config.js` | Move serverComponentsExternalPackages, update images config |
| 3 | `src/app/api/users/[id]/route.ts` | Async params (PUT, DELETE) |
| 4 | `src/app/api/invoices/[id]/pdf/route.ts` | Async params (GET) |
| 5 | `src/app/api/invoices/[id]/email/route.ts` | Async params (POST) |
| 6 | `src/app/api/config/api-keys/[id]/route.ts` | Async params (DELETE) |
| 7 | `src/app/api/shipping/guias/download/[id]/route.ts` | Async params (GET) |

**Total: 7 files changed**

---

## Verification

```bash
# 1. Install updated packages
npm install

# 2. Build the project
npm run build

# 3. Check remaining vulnerabilities
npm audit

# 4. Start dev server and test
npm run dev
```

---

## Not Addressed (Require Separate Effort)

| Package | Issue | Why |
|---|---|---|
| `xlsx` 0.18.5 | Prototype Pollution + ReDoS | **No fix available** — v0.19+ is commercial (SheetJS Pro). Consider migrating to `exceljs` if processing untrusted files. |
| `ai` SDK | File upload bypass | Requires major upgrade to v6 with breaking API changes. Separate migration needed. |
