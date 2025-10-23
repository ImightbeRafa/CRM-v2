# ✅ Production Deployment Checklist

Complete checklist for deploying Betsy CRM to production on Vercel.

---

## 🔧 Environment Variables (Vercel Dashboard)

Go to: **Project Settings → Environment Variables**

### **Required (Core Functionality):**

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://postgres...pooler.supabase.com:6543/...` | Transaction pooler (IPv4 compatible) |
| `DIRECT_URL` | `postgresql://postgres...pooler.supabase.com:5432/...` | Session pooler for migrations |
| `NEXTAUTH_SECRET` | Random 32-char string | Generate: `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://www.betsycrm.com` | Your production domain |

✅ **Status:** Already configured

---

### **Required for Google Authentication:**

| Variable | Value | Notes |
|----------|-------|-------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | OAuth 2.0 Client Secret |

❗ **Action Required:** Follow `GOOGLE_AUTH_SETUP.md` to get these

---

### **Optional (Stripe Billing):**

| Variable | Value | Notes |
|----------|-------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` | Stripe secret key (live mode) |
| `NEXT_PUBLIC_STRIPE_BASIC_PRICE_ID` | `price_...` | Basic plan price ID |
| `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` | `price_...` | Pro plan price ID |

⚪ **Status:** Optional - only if using billing features

---

## 🌐 Google Cloud Console Setup

**Required for Google Sign-In**

### 1. OAuth Consent Screen
- ✅ App name: `Betsy CRM`
- ✅ Authorized domain: `betsycrm.com`
- ✅ Scopes: `userinfo.email`, `userinfo.profile`, `openid`

### 2. OAuth 2.0 Credentials
- ✅ Type: Web application
- ✅ Authorized JavaScript origins:
  ```
  https://www.betsycrm.com
  ```
- ✅ Authorized redirect URIs:
  ```
  https://www.betsycrm.com/api/auth/callback/google
  ```

📖 **Full Guide:** See `GOOGLE_AUTH_SETUP.md`

---

## 📦 Vercel Project Settings

### Build & Development Settings

| Setting | Value |
|---------|-------|
| Framework Preset | `Next.js` |
| Build Command | `npm run build` |
| Output Directory | `.next` |
| Install Command | `npm install` |
| Development Command | `npm run dev` |
| Root Directory | `Betsy` ⚠️ **Important!** |
| Node.js Version | `18.x` or `20.x` |

### Function Settings

| Setting | Value |
|---------|-------|
| Regions | Closest to database (e.g., `iad1` for US East) |
| Max Duration | 10s (Free) / 60s (Pro) |

---

## 🗃️ Database (Supabase)

### Connection Strings

**Transaction Pooler (for app):**
```
postgresql://postgres.PROJECT:PASSWORD@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Session Pooler (for migrations):**
```
postgresql://postgres.PROJECT:PASSWORD@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

### Required Tables
- ✅ User
- ✅ Tenant
- ✅ Membership
- ✅ Order
- ✅ Client
- ✅ InventoryItem
- ✅ AuditLog
- ✅ BillingTransaction
- ✅ Invoice
- ✅ ProductField
- ✅ ProductOptionSet
- ✅ ShippingMethod
- ✅ Seller

**Migration Status:** All tables created via Prisma

---

## 🔐 Authentication Flows

### Email/Password (Credentials)
- ✅ Sign in: Email + Password
- ✅ Sign up: Creates user + tenant
- ✅ Password: Hashed with bcryptjs (Vercel compatible)
- ✅ Session: JWT (24 hours)

### Google OAuth
- ✅ Sign in: One-click with Google
- ✅ Auto-create: User + tenant for new users
- ✅ Email verified: Automatic via Google

---

## 🚀 Deployment Steps

### 1. Commit Current Changes
```bash
git add .
git commit -m "Production ready: Google auth + bcryptjs fix"
git push origin main
```

### 2. Verify Environment Variables
- [ ] All required variables set in Vercel
- [ ] Google credentials added (if using Google auth)
- [ ] `NEXTAUTH_URL` points to production domain

### 3. Add Google OAuth Credentials
- [ ] Follow `GOOGLE_AUTH_SETUP.md`
- [ ] Add `GOOGLE_CLIENT_ID` to Vercel
- [ ] Add `GOOGLE_CLIENT_SECRET` to Vercel

### 4. Trigger Deployment
Either:
- Push to main branch (automatic)
- Or: Vercel Dashboard → Redeploy

### 5. Wait for Build
- Monitor: Vercel Dashboard → Deployments
- Should complete in 2-3 minutes
- Look for: ✅ "Ready" status

---

## ✅ Post-Deployment Testing

### Test Landing Page
```
https://www.betsycrm.com/landing
```
- [ ] Page loads without errors
- [ ] Interactive demo works
- [ ] "See How It Works" scrolls to demo

### Test Email Sign Up
1. [ ] Click "Get Started"
2. [ ] Switch to "Sign Up" tab
3. [ ] Fill form with test data
4. [ ] Submit
5. [ ] Verify redirect to `/home`
6. [ ] Check new tenant created in DB

### Test Email Sign In
1. [ ] Sign out
2. [ ] Click "Sign In"
3. [ ] Enter credentials
4. [ ] Submit
5. [ ] Verify redirect to `/home`

### Test Google Sign In (if configured)
1. [ ] Click "Get Started"
2. [ ] Click "Continue with Google"
3. [ ] Select Google account
4. [ ] Grant permissions
5. [ ] Verify redirect to `/home`
6. [ ] Check new tenant created (for new users)

### Test Core Features
1. [ ] Dashboard loads (`/home`)
2. [ ] Production panel works (`/produccion`)
3. [ ] Config panel works (`/config`)
4. [ ] Order creation works
5. [ ] Excel import works
6. [ ] Audit logs work

---

## 🐛 Common Issues & Fixes

### Issue: 500 Internal Server Error
**Causes:**
- Missing environment variables
- Database connection failed
- bcrypt native module error

**Fixes:**
- ✅ Verify all env vars in Vercel
- ✅ Check Supabase project is active
- ✅ Ensure using `bcryptjs` (not `bcrypt`)

### Issue: Google Sign-In Doesn't Work
**Causes:**
- Missing Google credentials
- Wrong redirect URI
- OAuth consent screen not configured

**Fixes:**
- ✅ Add Google env vars to Vercel
- ✅ Verify redirect URI: `https://www.betsycrm.com/api/auth/callback/google`
- ✅ Complete OAuth consent screen setup

### Issue: User Can't Log In After Sign Up
**Causes:**
- Database connection issue
- Password hashing error
- Session not created

**Fixes:**
- ✅ Check Vercel logs for errors
- ✅ Verify database connection
- ✅ Ensure `NEXTAUTH_SECRET` is set

### Issue: Redirect After Login Fails
**Causes:**
- `NEXTAUTH_URL` not set correctly
- Middleware blocking routes

**Fixes:**
- ✅ Set `NEXTAUTH_URL=https://www.betsycrm.com`
- ✅ Verify `/home` is not in public routes

---

## 📊 Monitoring

### Check Vercel Logs
```
Vercel Dashboard → Project → Logs
```
Monitor for:
- API errors (500, 401, 403)
- Database connection issues
- Authentication failures

### Check Supabase Logs
```
Supabase Dashboard → Project → Logs
```
Monitor for:
- Connection pool exhaustion
- Query errors
- Slow queries

---

## 🎯 Performance Optimization

### Already Optimized:
- ✅ bcryptjs (serverless compatible)
- ✅ Transaction pooler (faster connections)
- ✅ JWT sessions (no DB lookups)
- ✅ Conditional Stripe loading
- ✅ Dynamic route segments

### Future Optimizations:
- [ ] Add Redis caching
- [ ] Implement CDN for static assets
- [ ] Add database indexes
- [ ] Enable edge functions

---

## 📝 Final Checklist

### Before Going Live:
- [ ] All environment variables set
- [ ] Google OAuth configured (if using)
- [ ] Test sign up flow
- [ ] Test sign in flow
- [ ] Test Google sign in (if enabled)
- [ ] Test core features
- [ ] Check Vercel logs for errors
- [ ] Verify database connections
- [ ] Test on mobile devices
- [ ] Check page load speeds

### Launch Day:
- [ ] Monitor Vercel logs
- [ ] Monitor Supabase connections
- [ ] Watch for user sign-ups
- [ ] Test with real users
- [ ] Have rollback plan ready

---

## 🎉 You're Ready!

Your Betsy CRM is production-ready. Just:
1. Add Google OAuth credentials (if needed)
2. Commit and push
3. Test thoroughly
4. Go live!

**Good luck! 🚀**

