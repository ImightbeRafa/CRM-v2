# 🔴 Google OAuth: "Acceso Denegado" (Access Denied)

## ❌ Error Message:
```
Acceso Denegado
Lo sentimos, no tienes autorización para acceder a esta aplicación
(Access Denied - You don't have authorization to access this application)
```

---

## 🔍 Why This Happens

Your OAuth consent screen is in **"Testing"** mode, which means:
- ✅ Only specific test users can sign in
- ❌ Everyone else gets "Access Denied"

---

## ✅ Solution: Choose One of Two Options

### **Option 1: Add Test Users (Quick - 5 minutes)**
Best for: Testing, small teams, before public launch

### **Option 2: Publish to Production (Quick - 5 minutes)**
Best for: Public launch, allowing anyone to sign in

---

## 🚀 Option 1: Add Test Users (Recommended for Now)

### **Step 1: Go to Google Cloud Console**
Visit: https://console.cloud.google.com

### **Step 2: Navigate to OAuth Consent Screen**
1. Click on your project (top left)
2. Go to: **APIs & Services** → **OAuth consent screen**

### **Step 3: Add Test Users**
1. Scroll down to **"Test users"** section
2. Click **"+ ADD USERS"**
3. Enter email addresses (one per line):
   ```
   your-email@gmail.com
   team-member@gmail.com
   another-user@gmail.com
   ```
4. Click **"SAVE"**

### **Step 4: Test Again**
- Wait 1-2 minutes
- Try signing in with Google again
- Should work now! ✅

---

## 🌐 Option 2: Publish to Production (For Public Access)

### **Step 1: Go to OAuth Consent Screen**
Visit: https://console.cloud.google.com
- **APIs & Services** → **OAuth consent screen**

### **Step 2: Review Your App Info**

Make sure these are filled in:
- ✅ **App name**: Betsy CRM (or your app name)
- ✅ **User support email**: Your email
- ✅ **App logo**: (Optional but recommended)
- ✅ **Application home page**: `https://www.betsycrm.com`
- ✅ **Application privacy policy**: `https://www.betsycrm.com/privacy` (create if needed)
- ✅ **Application terms of service**: `https://www.betsycrm.com/terms` (create if needed)
- ✅ **Authorized domains**: `betsycrm.com`
- ✅ **Developer contact**: Your email

### **Step 3: Review Scopes**

Make sure you have these scopes (and ONLY these):
- ✅ `userinfo.email`
- ✅ `userinfo.profile`
- ✅ `openid`

⚠️ **Do NOT add sensitive scopes** (like Gmail, Drive, etc.) unless you need them.

### **Step 4: Publish Your App**

1. Scroll to the top of the OAuth consent screen page
2. Look for **"Publishing status"**
3. Click **"PUBLISH APP"** button
4. Confirm the dialog

**Result:**
- ✅ **Status changes to:** "In production"
- ✅ **Anyone** can now sign in with Google
- ✅ No verification needed (for basic scopes)

### **Step 5: Test**
- Try signing in with any Google account
- Should work immediately! ✅

---

## 📋 Comparison: Testing vs Production

| Feature | Testing Mode | Production Mode |
|---------|-------------|-----------------|
| Who can access? | Only test users (max 100) | Anyone with Google account |
| Verification needed? | No | Only for sensitive scopes |
| Setup time | 5 minutes | 5 minutes |
| Good for | Development, testing | Public launch |
| User limit | 100 test users | Unlimited |

---

## ⚠️ Will Google Verify My App?

### **For Basic Scopes (what you're using):**
- ✅ `userinfo.email`
- ✅ `userinfo.profile`
- ✅ `openid`

**No verification needed!** You can publish immediately.

### **For Sensitive/Restricted Scopes:**
- Gmail API
- Drive API
- Calendar API
- etc.

**Verification required** (takes 4-6 weeks). But you're NOT using these.

---

## 🎯 Recommended Workflow

### **During Development:**
1. Keep app in **Testing mode**
2. Add your email as test user
3. Add team members as test users
4. Test thoroughly

### **Before Launch:**
1. Review app information
2. Add privacy policy URL (if needed)
3. Click **"PUBLISH APP"**
4. Test with real users

### **After Launch:**
1. Monitor for issues
2. Anyone can sign in
3. No user limit

---

## 🛠️ Quick Fix Steps (Right Now)

### **To fix immediately:**

```
1. Go to: https://console.cloud.google.com
2. Click: APIs & Services → OAuth consent screen
3. Scroll to: "Test users" section
4. Click: "+ ADD USERS"
5. Enter: your-email@gmail.com
6. Click: "SAVE"
7. Wait: 1-2 minutes
8. Try: Sign in with Google again
```

---

## 🧪 Testing Checklist

After adding test users or publishing:

- [ ] Clear browser cookies/cache
- [ ] Try signing in with added test user
- [ ] Should see Google account picker
- [ ] Should see consent screen (first time)
- [ ] Should redirect back to your app
- [ ] Should create user + tenant
- [ ] Should be logged in

---

## 🔒 Security Notes

### **Publishing to Production is Safe:**
- ✅ Only basic profile info accessed
- ✅ Users see what you're requesting
- ✅ Users can revoke access anytime
- ✅ No sensitive data accessed
- ✅ No verification needed

### **What Users See:**
```
Betsy CRM wants to:
✓ See your email address
✓ See your basic profile info

[Continue] [Cancel]
```

Users can say no, and Google clearly shows what you're requesting.

---

## 📞 Troubleshooting

### Issue: "This app is still being tested"
**Fix:** Click "PUBLISH APP" in OAuth consent screen

### Issue: Test user still can't access
**Fix:** 
1. Make sure email is exactly correct
2. Wait 2-3 minutes after adding
3. User must use that exact Google account
4. Clear browser cache

### Issue: "Verification required"
**Fix:** This shouldn't happen with basic scopes. Check you only requested `userinfo.email`, `userinfo.profile`, `openid`

---

## ✅ Summary

**Quick Fix (5 minutes):**
1. Go to OAuth consent screen
2. Add test users (your email)
3. OR click "PUBLISH APP"
4. Done!

**For Production:**
- Publishing is safe and instant
- No verification needed for basic scopes
- Allows anyone to sign in

---

**Your users should be able to sign in now! 🎉**

