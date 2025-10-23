# 🔴 Google OAuth Error 400: redirect_uri_mismatch

## ❌ Error Message:
```
Error 400: redirect_uri_mismatch
No puedes acceder porque DemoCRM envió una solicitud no válida.
```

---

## ✅ Solution: Update Google Cloud Console

### **Step 1: Go to Google Cloud Console**
Visit: https://console.cloud.google.com

---

### **Step 2: Navigate to Credentials**
1. Click on your project (top left)
2. Go to: **APIs & Services** → **Credentials**
3. Find your OAuth 2.0 Client ID
4. Click the **pencil icon** to edit

---

### **Step 3: Set Authorized Redirect URIs**

Add these **EXACT** URLs (no trailing slash):

#### **For Production (www.betsycrm.com):**
```
https://www.betsycrm.com/api/auth/callback/google
```

#### **For Local Development:**
```
http://localhost:3000/api/auth/callback/google
```

**Screenshot of what it should look like:**
```
Authorized redirect URIs

1. https://www.betsycrm.com/api/auth/callback/google     [X]
2. http://localhost:3000/api/auth/callback/google        [X]

[+ Add URI]
```

---

### **Step 4: Set Authorized JavaScript Origins**

Add these URLs:

#### **For Production:**
```
https://www.betsycrm.com
```

#### **For Local Development:**
```
http://localhost:3000
```

**Screenshot of what it should look like:**
```
Authorized JavaScript origins

1. https://www.betsycrm.com     [X]
2. http://localhost:3000         [X]

[+ Add URI]
```

---

### **Step 5: Save Changes**
Click the **"SAVE"** button at the bottom.

---

## ⚠️ Common Mistakes

### ❌ Wrong:
```
https://www.betsycrm.com/api/auth/callback/google/     (trailing slash)
http://www.betsycrm.com/api/auth/callback/google      (http instead of https)
https://betsycrm.com/api/auth/callback/google         (missing www)
https://www.betsycrm.com/callback/google              (wrong path)
```

### ✅ Correct:
```
https://www.betsycrm.com/api/auth/callback/google     (exact match)
```

---

## 🧪 Testing After Fix

### **Test on Production:**
1. Visit: `https://www.betsycrm.com/landing`
2. Click "Get Started"
3. Click "Continue with Google"
4. Should open Google login popup
5. Should redirect back successfully

### **Test Locally:**
1. Visit: `http://localhost:3000/landing`
2. Click "Get Started"
3. Click "Continue with Google"
4. Should work without errors

---

## 📋 Complete Configuration Checklist

### In Google Cloud Console:

#### **OAuth Consent Screen:**
- ✅ App name: `Betsy CRM` (or your app name)
- ✅ User support email: Your email
- ✅ Authorized domain: `betsycrm.com`
- ✅ Scopes: `userinfo.email`, `userinfo.profile`, `openid`

#### **OAuth 2.0 Client ID:**
- ✅ Application type: **Web application**
- ✅ Name: `Betsy CRM Production`

**Authorized JavaScript origins:**
- ✅ `https://www.betsycrm.com`
- ✅ `http://localhost:3000` (optional, for local dev)

**Authorized redirect URIs:**
- ✅ `https://www.betsycrm.com/api/auth/callback/google`
- ✅ `http://localhost:3000/api/auth/callback/google` (optional, for local dev)

---

## 🔍 How to Find Current Redirect URI

If you're unsure what URL your app is sending, check the error details in browser:

1. Open browser console (F12)
2. Go to **Network** tab
3. Try Google sign-in
4. Look for the failed request
5. Check the `redirect_uri` parameter

It should show:
```
redirect_uri=https://www.betsycrm.com/api/auth/callback/google
```

Copy this exact URL and add it to Google Cloud Console.

---

## 🛠️ Vercel Environment Variables

Make sure these are set in Vercel:

| Variable | Value | Example |
|----------|-------|---------|
| `GOOGLE_CLIENT_ID` | Your Client ID | `123456789-abc...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Your Client Secret | `GOCSPX-xxxxx...` |
| `NEXTAUTH_URL` | Your production URL | `https://www.betsycrm.com` |
| `NEXTAUTH_SECRET` | Random secret | (32+ characters) |

---

## 🎯 Quick Fix Summary

1. **Go to:** https://console.cloud.google.com
2. **Navigate:** APIs & Services → Credentials
3. **Edit:** Your OAuth 2.0 Client ID
4. **Add redirect URI:** `https://www.betsycrm.com/api/auth/callback/google`
5. **Add origin:** `https://www.betsycrm.com`
6. **Save**
7. **Test:** Try Google sign-in again

---

## 📞 Still Not Working?

### Check:
1. ✅ URLs are **exact** (no trailing slash)
2. ✅ Using **https** for production (not http)
3. ✅ Including **www** if your site uses it
4. ✅ Path is `/api/auth/callback/google`
5. ✅ Saved changes in Google Console
6. ✅ Waited 5 minutes for changes to propagate
7. ✅ Cleared browser cache
8. ✅ Environment variables set in Vercel

### Verify in Browser:
```javascript
// Open browser console and run:
console.log(window.location.origin + '/api/auth/callback/google')
```

Copy that output and add it to Google Cloud Console.

---

## ✅ After Fix

Once corrected, Google sign-in will:
1. ✅ Open Google popup
2. ✅ Let user select account
3. ✅ Redirect back to your app
4. ✅ Create user + tenant
5. ✅ Log in successfully

---

**Your Google OAuth should work now! 🎉**

