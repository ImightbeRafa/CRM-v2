# 🚀 **GOOGLE OAUTH & TILOPAY INTEGRATION GUIDE**
**Date:** October 21, 2025  
**Status:** 🚧 **READY TO CONFIGURE**

---

## ✅ **PREREQUISITES COMPLETED:**

- [x] Audit logger bug fixed
- [x] Multi-tenant system working
- [x] Authentication system ready
- [x] User management working
- [x] Database properly configured

---

## 📋 **WHAT WE'LL SET UP:**

1. **Google OAuth** - Social login with Google
2. **TiloPay** - Costa Rica payment provider (will integrate when you provide API info)

---

# 🔐 **PART 1: GOOGLE OAUTH SETUP**

## **Step 1: Create Google OAuth Credentials**

### **1.1 Go to Google Cloud Console**
1. Navigate to: https://console.cloud.google.com/
2. Sign in with your Google account

### **1.2 Create a New Project (or select existing)**
1. Click the project dropdown at the top
2. Click "New Project"
3. Name it: "Betsy CRM"
4. Click "Create"

### **1.3 Enable Google+ API**
1. Go to "APIs & Services" → "Library"
2. Search for "Google+ API"
3. Click on it and click "Enable"

### **1.4 Configure OAuth Consent Screen**
1. Go to "APIs & Services" → "OAuth consent screen"
2. Select **"External"** (unless you have Google Workspace)
3. Click "Create"
4. Fill in:
   - **App name:** Betsy CRM
   - **User support email:** Your email
   - **Developer contact:** Your email
5. Click "Save and Continue"
6. **Scopes:** Click "Add or Remove Scopes"
   - Add: `userinfo.email`
   - Add: `userinfo.profile`
7. Click "Save and Continue"
8. **Test users:** Add your email for testing
9. Click "Save and Continue"

### **1.5 Create OAuth Credentials**
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select **"Web application"**
4. Name it: "Betsy CRM Web"
5. **Authorized JavaScript origins:**
   - For local: `http://localhost:3000`
   - For production: `https://your-domain.com`
6. **Authorized redirect URIs:**
   - For local: `http://localhost:3000/api/auth/callback/google`
   - For production: `https://your-domain.com/api/auth/callback/google`
7. Click "Create"
8. **Copy the Client ID and Client Secret** (you'll need these!)

---

## **Step 2: Update Environment Variables**

Add to your `.env.local` file:

```bash
# Google OAuth
GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret-here"

# Make sure these are set too:
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-existing-secret"
```

---

## **Step 3: Update NextAuth Configuration**

The Google provider is already configured in your `auth-options.ts`, but let's verify it's correct:

```typescript
// File: src/lib/auth-options.ts

import GoogleProvider from "next-auth/providers/google";

providers: [
  CredentialsProvider({
    // ... existing credentials provider
  }),
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    authorization: {
      params: {
        prompt: "consent",
        access_type: "offline",
        response_type: "code"
      }
    }
  })
]
```

---

## **Step 4: Test Google OAuth**

1. Restart your dev server:
   ```bash
   npm run dev
   ```

2. Go to: `http://localhost:3000/landing`

3. Click "Sign In" or "Get Started"

4. You should see the Google sign-in button

5. Click it and sign in with your Google account

6. ✅ You should be logged in and redirected to `/home`!

---

## **Step 5: Handle First-Time Google Users**

When a user signs in with Google for the first time, we need to:
1. Create a User record
2. Create a Tenant for them
3. Create a Membership linking them as OWNER

This is handled in the `signIn` callback in `auth-options.ts`. Let me verify it's set up correctly.

---

# 💳 **PART 2: TILOPAY INTEGRATION**

## **Overview:**

TiloPay is a Costa Rican payment gateway. We'll integrate it to handle subscriptions for your SaaS.

---

## **Step 1: Get TiloPay API Credentials**

You mentioned you'll provide these later. When ready, you'll need:

1. **API Key** (or Client ID)
2. **Secret Key**
3. **Merchant ID** (if applicable)
4. **API Endpoint URL**
5. **Webhook URL** (for payment notifications)

---

## **Step 2: Environment Variables (Ready for TiloPay)**

When you have the credentials, add them to `.env.local`:

```bash
# TiloPay Payment Gateway
TILOPAY_API_KEY="your-api-key-here"
TILOPAY_SECRET_KEY="your-secret-key-here"
TILOPAY_MERCHANT_ID="your-merchant-id-here"
TILOPAY_API_URL="https://api.tilopay.com/v1"  # Verify the correct URL
TILOPAY_WEBHOOK_SECRET="your-webhook-secret-here"

# For webhook security
TILOPAY_WEBHOOK_URL="https://your-domain.com/api/tilopay/webhook"
```

---

## **Step 3: TiloPay Integration Structure**

I'll create the following files when you're ready:

```
src/
├── lib/
│   └── tilopay.ts              # TiloPay SDK wrapper
│
├── app/
│   └── api/
│       └── tilopay/
│           ├── create-subscription/
│           │   └── route.ts    # Create subscription
│           ├── webhook/
│           │   └── route.ts    # Handle payment notifications
│           ├── cancel-subscription/
│           │   └── route.ts    # Cancel subscription
│           └── update-subscription/
│               └── route.ts    # Update subscription
```

---

## **Step 4: Payment Flow Design**

### **Subscription Flow:**

```
User signs up (Free)
    ↓
Wants to upgrade
    ↓
Clicks "Upgrade to Pro" in pricing section
    ↓
Redirected to TiloPay checkout
    ↓
User enters payment info
    ↓
TiloPay processes payment
    ↓
Webhook notification received
    ↓
Update Tenant subscription status
    ↓
User now has Pro features!
```

---

## **Step 5: Database Schema (Already Ready!)**

Your `Tenant` model already has subscription fields:

```prisma
model Tenant {
  // ... existing fields
  
  // Payment/Subscription fields
  stripeCustomerId      String?
  stripeSubscriptionId  String?
  subscriptionStatus    String?
  plan                  String    @default("FREE")
  currentPeriodEnd      DateTime?
  
  // We'll rename these to be payment-provider agnostic:
  // paymentCustomerId     String?
  // paymentSubscriptionId String?
}
```

**Note:** We can keep using these fields and just store TiloPay IDs instead of Stripe IDs!

---

## **Step 6: TiloPay Pricing Plans**

Define your pricing in TiloPay dashboard (or via API), then reference them:

```typescript
// In your pricing component
const plans = [
  {
    name: 'Free',
    price: 0,
    tilopayPlanId: null, // No payment needed
    features: [...]
  },
  {
    name: 'Pro',
    price: 15000, // ₡15,000 CRC per month (example)
    tilopayPlanId: 'plan_pro_monthly', // TiloPay plan ID
    features: [...]
  },
  {
    name: 'Enterprise',
    price: 45000, // ₡45,000 CRC per month (example)
    tilopayPlanId: 'plan_enterprise_monthly',
    features: [...]
  }
];
```

---

# 🔧 **CURRENT STATUS:**

## **What's Already Done:**

✅ Auth system ready for Google OAuth  
✅ Database schema supports subscriptions  
✅ Multi-tenant system isolates billing  
✅ User management handles OAuth users  
✅ Landing page has pricing section  
✅ Audit logger fixed  

## **What's Needed:**

### **For Google OAuth:**
- [ ] Get Google OAuth credentials
- [ ] Add credentials to `.env.local`
- [ ] Test sign-in flow
- [ ] Verify new user creation

### **For TiloPay:**
- [ ] Get TiloPay API credentials (waiting on you)
- [ ] Create TiloPay API wrapper
- [ ] Create checkout endpoints
- [ ] Create webhook handler
- [ ] Update pricing section with TiloPay checkout
- [ ] Test payment flow

---

# 📝 **NEXT STEPS:**

## **RIGHT NOW (Google OAuth):**

1. **Get Google OAuth credentials** (follow Step 1 above)
2. **Add to `.env.local`**
3. **Test the login**

## **WHEN READY (TiloPay):**

1. **Provide TiloPay API documentation**
2. **Share your TiloPay credentials** (API keys, etc.)
3. **I'll create the integration**
4. **We'll test with sandbox/test mode first**

---

# 🔐 **SECURITY CHECKLIST:**

Before going live with payments:

- [ ] All API keys in environment variables (not in code)
- [ ] Webhook endpoints verify signatures
- [ ] HTTPS enabled in production
- [ ] Payment data never stored (only references/IDs)
- [ ] Failed payment handling implemented
- [ ] Subscription cancellation flow works
- [ ] Downgrade logic implemented
- [ ] Audit logs track all payment events

---

# 🧪 **TESTING CHECKLIST:**

## **Google OAuth Testing:**
- [ ] Sign in with Google (new user)
- [ ] Verify tenant created
- [ ] Verify user has OWNER role
- [ ] Sign out and sign in again
- [ ] Test with multiple Google accounts

## **TiloPay Testing (when implemented):**
- [ ] Create subscription (sandbox mode)
- [ ] Receive webhook notification
- [ ] Verify tenant upgraded
- [ ] Test failed payment
- [ ] Test subscription cancellation
- [ ] Test subscription renewal
- [ ] Test webhook signature verification

---

# 📞 **WHAT I NEED FROM YOU:**

## **For Google OAuth (NOW):**
✅ Nothing! Just follow the guide above to get your credentials.

## **For TiloPay (LATER):**
Please provide:
1. TiloPay API documentation link
2. Your TiloPay account credentials:
   - API Key
   - Secret Key
   - Merchant ID
   - Any other required credentials
3. Pricing information (amounts in CRC)
4. Sandbox/test mode credentials (if available)

---

# 🎯 **INTEGRATION TIMELINE:**

### **Today:**
- [x] Fix audit logger ✅
- [ ] Set up Google OAuth (30 min)
- [ ] Test Google sign-in

### **When TiloPay Info Provided:**
- [ ] Create TiloPay API wrapper (1 hour)
- [ ] Create checkout endpoints (1 hour)
- [ ] Create webhook handler (1 hour)
- [ ] Update UI for TiloPay (30 min)
- [ ] Test in sandbox mode (1 hour)
- [ ] Deploy to production

**Total time for TiloPay:** ~5 hours once credentials provided

---

# 📚 **REFERENCE:**

## **Useful Links:**

- **Google OAuth Docs:** https://developers.google.com/identity/protocols/oauth2
- **NextAuth.js Google Provider:** https://next-auth.js.org/providers/google
- **TiloPay Docs:** (will add when you provide)

## **Your Current Setup:**

- **Auth Provider:** NextAuth.js ✅
- **Database:** PostgreSQL (Supabase) / SQLite (local) ✅
- **ORM:** Prisma ✅
- **Framework:** Next.js 14 ✅
- **Deployment:** Vercel (ready) ✅

---

# ✅ **READY TO START!**

**Next Action:** Get your Google OAuth credentials and let's test it!

When you're ready with TiloPay info, ping me and I'll create the full integration! 🚀

---

**Questions? Let me know and I'll help!** 💪
