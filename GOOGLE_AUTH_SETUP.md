# 🔐 Google Authentication Setup Guide

## ✅ Current Status

Your app is **100% ready** for Google authentication. The code is already configured:
- ✅ Google Provider in NextAuth
- ✅ Google Sign-In button in landing page
- ✅ Auto-tenant creation for new Google users
- ✅ Proper session handling

---

## 🚀 Production Setup (Step-by-Step)

### **Step 1: Create Google OAuth Credentials**

#### 1.1 Go to Google Cloud Console
Visit: https://console.cloud.google.com/

#### 1.2 Create or Select a Project
- Click **"Select a project"** at the top
- Click **"New Project"**
- Name it: `Betsy CRM` (or your app name)
- Click **"Create"**

#### 1.3 Enable Google+ API
- In the left sidebar, go to **"APIs & Services"** → **"Library"**
- Search for: **"Google+ API"**
- Click on it and press **"Enable"**

#### 1.4 Configure OAuth Consent Screen
- Go to **"APIs & Services"** → **"OAuth consent screen"**
- Select **"External"** (for public users)
- Click **"Create"**

**Fill in the form:**
- **App name**: `Betsy CRM`
- **User support email**: Your email
- **App logo**: (Optional) Upload your logo
- **App domain**: `https://www.betsycrm.com`
- **Authorized domains**: Add `betsycrm.com`
- **Developer contact**: Your email
- Click **"Save and Continue"**

**Scopes (Step 2):**
- Click **"Add or Remove Scopes"**
- Select:
  - `userinfo.email`
  - `userinfo.profile`
  - `openid`
- Click **"Update"** → **"Save and Continue"**

**Test Users (Step 3):**
- Add your email for testing
- Click **"Save and Continue"**

#### 1.5 Create OAuth 2.0 Credentials
- Go to **"APIs & Services"** → **"Credentials"**
- Click **"+ Create Credentials"** → **"OAuth client ID"**
- **Application type**: `Web application`
- **Name**: `Betsy CRM Production`

**Authorized JavaScript origins:**
```
https://www.betsycrm.com
```

**Authorized redirect URIs:**
```
https://www.betsycrm.com/api/auth/callback/google
```

- Click **"Create"**

#### 1.6 Copy Your Credentials
You'll see a popup with:
- **Client ID**: `1234567890-abcdefghijklmnop.apps.googleusercontent.com`
- **Client Secret**: `GOCSPX-xxxxxxxxxxxxx`

⚠️ **SAVE THESE!** You'll need them for Vercel.

---

### **Step 2: Add to Vercel Environment Variables**

#### 2.1 Go to Vercel Dashboard
- Visit: https://vercel.com/dashboard
- Select your `Betsy` project

#### 2.2 Go to Settings → Environment Variables

#### 2.3 Add Google Credentials

**Add these 2 new variables:**

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | `1234567890-abc...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-xxxxxxxxxxxxxxx` |

**For both variables:**
- ✅ Check: Production
- ✅ Check: Preview
- ✅ Check: Development

Click **"Save"** for each.

---

### **Step 3: Redeploy**

#### 3.1 Trigger Redeploy
Two options:

**Option A: Push a commit**
```bash
git add .
git commit -m "Add Google OAuth credentials"
git push
```

**Option B: Manual redeploy in Vercel**
- Go to **"Deployments"** tab
- Click on the latest deployment
- Click **"Redeploy"**

#### 3.2 Wait for Deployment
- Should take 1-2 minutes
- Wait for ✅ "Ready" status

---

### **Step 4: Test Google Sign-In**

#### 4.1 Visit Your Landing Page
```
https://www.betsycrm.com/landing
```

#### 4.2 Click "Get Started" or "Sign In"

#### 4.3 Click "Continue with Google"

#### 4.4 Select Your Google Account

#### 4.5 Grant Permissions
- Allow access to email and profile
- Click "Continue"

#### 4.6 You Should Be Redirected
- Automatically logged in
- New tenant created
- Redirected to `/home`

---

## 🧪 Testing Locally (Optional)

### Local Development Setup

#### 1. Create Local OAuth Credentials
- Go back to Google Cloud Console
- **"APIs & Services"** → **"Credentials"**
- Click **"+ Create Credentials"** → **"OAuth client ID"**
- **Application type**: `Web application`
- **Name**: `Betsy CRM Development`

**Authorized JavaScript origins:**
```
http://localhost:3000
```

**Authorized redirect URIs:**
```
http://localhost:3000/api/auth/callback/google
```

#### 2. Add to `.env.local`
```env
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-dev-secret
```

#### 3. Restart Dev Server
```bash
npm run dev
```

#### 4. Test at `http://localhost:3000/landing`

---

## 📋 Complete Environment Variables Checklist

Make sure **ALL** of these are set in Vercel:

### Required for Google Auth:
- ✅ `GOOGLE_CLIENT_ID`
- ✅ `GOOGLE_CLIENT_SECRET`

### Already Set (from previous setup):
- ✅ `DATABASE_URL`
- ✅ `DIRECT_URL`
- ✅ `NEXTAUTH_SECRET`
- ✅ `NEXTAUTH_URL` = `https://www.betsycrm.com`

### Optional (for Stripe billing):
- ⚪ `STRIPE_SECRET_KEY`
- ⚪ `NEXT_PUBLIC_STRIPE_BASIC_PRICE_ID`
- ⚪ `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID`

---

## 🎯 What Happens When Users Sign In with Google?

### For New Users:
1. User clicks "Continue with Google"
2. Google authentication popup appears
3. User grants permissions
4. **Automatic account creation:**
   - New `User` record created
   - Email from Google account
   - Username from Google name
   - Profile picture saved
5. **Automatic tenant creation:**
   - New `Tenant` created: "[Name]'s Workspace"
   - User assigned as `OWNER`
6. User redirected to `/home`

### For Existing Users:
1. User clicks "Continue with Google"
2. Google authentication popup appears
3. User grants permissions
4. **Existing account found** (by email)
5. User logged in with existing tenant
6. User redirected to `/home`

---

## 🔒 Security Notes

### What Google Provides:
- ✅ Email verification (automatic)
- ✅ OAuth 2.0 secure flow
- ✅ No password storage needed
- ✅ Profile picture
- ✅ Display name

### Your App:
- ✅ Creates isolated tenant per user
- ✅ Assigns OWNER role automatically
- ✅ Stores minimal Google data (email, name, picture)
- ✅ GDPR compliant (users control Google account)

---

## ❓ Troubleshooting

### "Error: redirect_uri_mismatch"
**Fix:** Check your authorized redirect URIs in Google Cloud Console.

Must be **exactly**:
```
https://www.betsycrm.com/api/auth/callback/google
```

No trailing slash, match the domain exactly.

### "Error: Access blocked: This app's request is invalid"
**Fix:** Make sure you enabled the Google+ API and configured the OAuth consent screen.

### "Error: invalid_client"
**Fix:** Double-check your Client ID and Client Secret in Vercel environment variables.

### Google Sign-In Button Not Working
**Fix:** Make sure environment variables are set and you redeployed.

### User Created But Not Logged In
**Fix:** Check Vercel logs for errors in the `signIn` callback.

---

## 🎉 Success Checklist

After setup, verify:
- ✅ "Continue with Google" button appears
- ✅ Clicking it opens Google popup
- ✅ After authentication, user is logged in
- ✅ New tenant is created for new users
- ✅ User is redirected to `/home`
- ✅ User can access the CRM dashboard

---

## 📞 Support

If you encounter issues:
1. Check Vercel deployment logs
2. Check Google Cloud Console errors
3. Verify all redirect URIs match exactly
4. Ensure environment variables are saved and deployed

---

**Your app is ready for Google authentication! Just add the credentials to Vercel and redeploy.** 🚀

