# 🔐 Google OAuth Setup Guide

**Date:** October 22, 2025  
**Time Required:** ~15 minutes  
**Status:** ⚠️ **ACTION REQUIRED**

---

## 📋 Current Status

✅ **Google OAuth is configured in code**  
⚠️ **Google credentials are NOT in environment**  

**What's Missing:**
```bash
GOOGLE_CLIENT_ID="not-set"
GOOGLE_CLIENT_SECRET="not-set"
```

---

## 🚀 Setup Steps

### **Step 1: Create Google Cloud Project** (5 minutes)

1. Go to: https://console.cloud.google.com/

2. Click **"Select a project"** → **"New Project"**

3. Project details:
   - **Project name:** `Betsy CRM`
   - **Organization:** (leave default)
   - Click **"Create"**

4. Wait for project creation (30 seconds)

---

### **Step 2: Enable Google+ API** (2 minutes)

1. Make sure "Betsy CRM" project is selected

2. Go to: https://console.cloud.google.com/apis/library

3. Search for: **"Google+ API"**

4. Click **"Google+ API"**

5. Click **"Enable"**

---

### **Step 3: Configure OAuth Consent Screen** (5 minutes)

1. Go to: https://console.cloud.google.com/apis/credentials/consent

2. Choose **"External"** (unless you have a Google Workspace)

3. Click **"Create"**

4. **App information:**
   - **App name:** `Betsy CRM`
   - **User support email:** `your-email@gmail.com`
   - **App logo:** (optional, skip for now)

5. **App domain** (optional for testing):
   - **Application home page:** `http://localhost:3000`
   - **Application privacy policy:** (skip for now)
   - **Application terms of service:** (skip for now)

6. **Developer contact information:**
   - **Email:** `your-email@gmail.com`

7. Click **"Save and Continue"**

8. **Scopes** page:
   - Click **"Add or Remove Scopes"**
   - Select:
     - `userinfo.email`
     - `userinfo.profile`
     - `openid`
   - Click **"Update"**
   - Click **"Save and Continue"**

9. **Test users** page:
   - Click **"Add Users"**
   - Add your email: `your-email@gmail.com`
   - Click **"Add"**
   - Click **"Save and Continue"**

10. **Summary** page:
    - Review everything
    - Click **"Back to Dashboard"**

---

### **Step 4: Create OAuth Credentials** (3 minutes)

1. Go to: https://console.cloud.google.com/apis/credentials

2. Click **"Create Credentials"** → **"OAuth client ID"**

3. **Application type:** `Web application`

4. **Name:** `Betsy CRM Web Client`

5. **Authorized JavaScript origins:**
   - Click **"Add URI"**
   - Add: `http://localhost:3000`
   - (For production, add: `https://your-domain.com`)

6. **Authorized redirect URIs:**
   - Click **"Add URI"**
   - Add: `http://localhost:3000/api/auth/callback/google`
   - (For production, add: `https://your-domain.com/api/auth/callback/google`)

7. Click **"Create"**

8. **📋 IMPORTANT: Copy credentials!**
   - You'll see a popup with:
     - **Client ID** (long string ending in `.apps.googleusercontent.com`)
     - **Client Secret** (shorter string)
   - **Copy both** and save them somewhere safe!

---

### **Step 5: Add Credentials to Environment** (1 minute)

1. Open `Betsy/.env.local`

2. Add these lines at the end:
   ```bash
   # Google OAuth
   GOOGLE_CLIENT_ID="your-client-id-here.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret-here"
   ```

3. Replace with your actual credentials from Step 4

4. Save the file

---

### **Step 6: Test Google OAuth** (2 minutes)

1. **Restart your dev server:**
   ```bash
   # Stop current server (Ctrl+C)
   npm run dev
   ```

2. **Test the flow:**
   - Go to: http://localhost:3000/landing
   - Click **"Get Started"** or **"Sign In"**
   - Click **"Continue with Google"**
   - Choose your Google account
   - Should redirect to `/home`
   - ✅ You're signed in!

3. **Check the database:**
   - Your user should be created automatically
   - A new tenant should be created
   - You should have OWNER role

---

## 🎉 You're Done!

Google OAuth is now working! Users can:
- ✅ Sign up with Google (instant, no password needed)
- ✅ Sign in with Google (one click)
- ✅ Get their own workspace automatically
- ✅ Start using the app immediately

---

## 📝 What Happens Behind the Scenes?

When a user signs in with Google:

1. **User clicks "Continue with Google"**
   - Redirects to Google's sign-in page

2. **User authenticates with Google**
   - User enters Google password
   - Google verifies identity

3. **Google redirects back to Betsy**
   - With user's email, name, profile picture
   - To: `http://localhost:3000/api/auth/callback/google`

4. **Betsy checks if user exists**
   - Searches database for email

5. **If new user:**
   - Creates Tenant: `{name}'s Workspace`
   - Creates User with Google info
   - Creates Membership: OWNER role
   - Signs them in

6. **If existing user:**
   - Just signs them in
   - Loads their existing workspace

7. **Redirects to /home**
   - User is now logged in
   - Can start using the app

---

## 🔒 Security Notes

### **Is This Secure?**
✅ **YES!** Google OAuth is very secure:
- No passwords stored in your database
- Google handles authentication
- OAuth tokens are short-lived
- Uses industry-standard protocol

### **What Data Do We Get?**
Only what user approves:
- Email address
- Full name
- Profile picture

We DO NOT get:
- Password
- Other Google account data
- Gmail messages
- etc.

---

## 🌐 Production Setup

When deploying to production:

### **1. Add Production URLs to Google Console**

Go back to: https://console.cloud.google.com/apis/credentials

Click your OAuth client, then add:

**Authorized JavaScript origins:**
```
https://your-domain.com
```

**Authorized redirect URIs:**
```
https://your-domain.com/api/auth/callback/google
```

### **2. Update OAuth Consent Screen**

- Change status from "Testing" to "In Production"
- Add your production domain
- Add privacy policy URL
- Add terms of service URL

### **3. Update Environment Variables**

On your production platform (Vercel, etc.):
```bash
GOOGLE_CLIENT_ID="same-as-development"
GOOGLE_CLIENT_SECRET="same-as-development"
NEXTAUTH_URL="https://your-domain.com"
```

**Note:** You can use the SAME Google credentials for both development and production!

---

## 🐛 Troubleshooting

### **Error: "redirect_uri_mismatch"**

**Problem:** Google says redirect URI doesn't match

**Solution:**
1. Check your redirect URI in Google Console
2. Must match EXACTLY: `http://localhost:3000/api/auth/callback/google`
3. No trailing slash!
4. Wait 5 minutes after adding (Google cache)

---

### **Error: "Access blocked: This app's request is invalid"**

**Problem:** OAuth consent screen not configured

**Solution:**
1. Complete Step 3 above
2. Add yourself as a test user
3. Make sure scopes are added

---

### **Error: "Google sign-in failed"**

**Problem:** Credentials not in environment

**Solution:**
1. Check `.env.local` has both variables
2. Restart dev server
3. Check for typos in credentials

---

### **User created but no tenant**

**Problem:** Database error during Google sign-in

**Solution:**
1. Check server logs for errors
2. Check database connection
3. Make sure Prisma schema is up to date:
   ```bash
   npx prisma db push
   ```

---

## 📞 Need Help?

**Can't find Google Console?**
- https://console.cloud.google.com/

**Forgot where to add redirect URI?**
- Console → APIs & Services → Credentials → Your OAuth Client → Edit

**Need to see your credentials again?**
- Console → APIs & Services → Credentials → OAuth 2.0 Client IDs
- Click your client name
- You can see Client ID (but NOT secret again)
- If you lost the secret, create new credentials

---

## ✅ Quick Checklist

Before testing:
- [ ] Google Cloud project created
- [ ] Google+ API enabled
- [ ] OAuth consent screen configured
- [ ] Test user added (your email)
- [ ] OAuth credentials created
- [ ] Redirect URI added: `http://localhost:3000/api/auth/callback/google`
- [ ] Credentials copied to `.env.local`
- [ ] Dev server restarted

---

## 🎯 Expected Result

After setup:
```bash
# Your .env.local should have:
GOOGLE_CLIENT_ID="123456789-abc.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-abcd1234..."
```

Users will see:
- "Continue with Google" button on landing page
- Google sign-in popup
- Automatic account creation
- Redirect to dashboard
- Instant access to their workspace

**Time savings for users:**
- No typing email/password
- No password to remember
- One click sign-in
- Trusted authentication

---

**You're all set! Test it out and watch the magic happen! ✨**

