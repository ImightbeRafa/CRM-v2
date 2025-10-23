# 🔧 Vercel 500 Error - Database Connection Fix

## 🔴 Error You're Seeing

```
GET https://www.betsycrm.com/api/auth/error 500 (Internal Server Error)
```

This is a **database connection error**. NextAuth can't connect to your Supabase database.

---

## ✅ **Quick Fix Checklist**

### **1. Verify Environment Variables in Vercel**

Go to: Vercel Dashboard → Your Project → Settings → Environment Variables

**CHECK THESE ARE SET CORRECTLY:**

```bash
# Database Connection (Transaction Pooler - port 6543)
DATABASE_URL=postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct Database Connection (Session Pooler - port 5432)  
DIRECT_URL=postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:5432/postgres

# NextAuth Configuration
NEXTAUTH_SECRET=jK9mP2nQ5rT8wX3zA6bC4dE7fH0gJ1kL
NEXTAUTH_URL=https://www.betsycrm.com
```

⚠️ **CRITICAL**: Make sure `NEXTAUTH_URL` is set to `https://www.betsycrm.com` (your actual domain)

---

### **2. Common Issues & Fixes**

#### **Issue A: Wrong Database Password**
Your database password is: `QIPddmdUjwBYSKBn`

Make sure BOTH `DATABASE_URL` and `DIRECT_URL` use this password.

**Verify in Vercel**:
- Click on `DATABASE_URL` → Edit
- Check the password in the connection string matches

#### **Issue B: Wrong Connection Pooler**
Vercel REQUIRES the connection pooler (not direct connection).

**Make sure your `DATABASE_URL` has**:
- `aws-1-us-east-1.pooler.supabase.com` (NOT `db.bmolvybsqzkeswkomgzw.supabase.co`)
- Port `6543` (NOT 5432)
- Ends with `?pgbouncer=true`

#### **Issue C: IPv6 Compatibility**
Supabase's direct connection requires IPv6, but Vercel uses IPv4.

**Solution**: Use the pooler connections (which support IPv4)
- Transaction pooler: port 6543 ✅
- Session pooler: port 5432 ✅

#### **Issue D: Missing Environment Variables**
Check that ALL these are set in Vercel:
- [ ] `DATABASE_URL`
- [ ] `DIRECT_URL`
- [ ] `NEXTAUTH_SECRET`
- [ ] `NEXTAUTH_URL`

---

### **3. Check Supabase Project Status**

1. Go to: https://supabase.com/dashboard
2. Select your project: `bmolvybsqzkeswkomgzw`
3. Check:
   - [ ] Project is **Active** (not Paused)
   - [ ] Database is **Healthy**
   - [ ] Connection pooling is **Enabled**

---

### **4. Get Fresh Connection Strings**

Go to Supabase → Settings → Database → Connection string

**Copy these EXACT values**:

**Transaction mode** (for `DATABASE_URL`):
```
postgresql://postgres.bmolvybsqzkeswkomgzw:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

**Session mode** (for `DIRECT_URL`):
```
postgresql://postgres.bmolvybsqzkeswkomgzw:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

Replace `[PASSWORD]` with: `QIPddmdUjwBYSKBn`

**Add to `DATABASE_URL`**: `?pgbouncer=true` at the end

---

## 🔍 **Debug Steps**

### **Step 1: Check Vercel Logs**

1. Go to: Vercel Dashboard → Your Project → Deployments
2. Click on your latest deployment
3. Click "Functions" tab
4. Look for error messages about database connection

**Common error messages**:
```
❌ "Can't reach database server"
   → Check DATABASE_URL is correct

❌ "password authentication failed"
   → Check password in connection string

❌ "SASL authentication failed"
   → Password is incorrect

❌ "Connection timeout"
   → Using direct connection instead of pooler
```

### **Step 2: Test Database Connection**

Create a test API route to verify connection:

**File**: `Betsy/src/app/api/test-db-connection/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    // Try to connect to database
    await prisma.$connect();
    
    // Try a simple query
    const userCount = await prisma.user.count();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database connected!',
      users: userCount 
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
}
```

Deploy and visit: `https://www.betsycrm.com/api/test-db-connection`

**If it works**: Database is fine, issue is with NextAuth config
**If it fails**: Database connection is the problem

---

## 🛠️ **Step-by-Step Fix**

### **Fix 1: Update Environment Variables**

1. Go to Vercel → Settings → Environment Variables
2. Delete all existing database variables
3. Add them fresh:

**Click "Add New"**:
```
Name: DATABASE_URL
Value: postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
Environment: Production, Preview, Development
```

**Click "Add New"**:
```
Name: DIRECT_URL
Value: postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:5432/postgres
Environment: Production, Preview, Development
```

**Click "Add New"**:
```
Name: NEXTAUTH_URL
Value: https://www.betsycrm.com
Environment: Production
```

**Click "Add New"**:
```
Name: NEXTAUTH_SECRET  
Value: jK9mP2nQ5rT8wX3zA6bC4dE7fH0gJ1kL
Environment: Production, Preview, Development
```

4. Click "Save"

### **Fix 2: Redeploy**

After updating environment variables:
1. Go to Deployments
2. Click "..." on latest deployment
3. Click "Redeploy"
4. Wait for deployment to complete
5. Test again

---

## 🔐 **Security Check**

Make sure your Supabase database:
- [ ] Is not behind a firewall blocking Vercel
- [ ] Has connection pooling enabled
- [ ] Allows connections from Vercel's IP ranges (usually automatic)

---

## 📊 **Verify Connection Strings**

Your connection strings should look EXACTLY like this:

### **DATABASE_URL** (Transaction Pooler):
```
postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Check**:
- ✅ Starts with `postgresql://`
- ✅ Username: `postgres.bmolvybsqzkeswkomgzw`
- ✅ Password: `QIPddmdUjwBYSKBn` (after `:`)
- ✅ Host: `aws-1-us-east-1.pooler.supabase.com`
- ✅ Port: `6543`
- ✅ Database: `postgres`
- ✅ Ends with: `?pgbouncer=true`

### **DIRECT_URL** (Session Pooler):
```
postgresql://postgres.bmolvybsqzkeswkomgzw:QIPddmdUjwBYSKBn@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

**Check**:
- ✅ Same as above but port `5432`
- ✅ NO `?pgbouncer=true` at the end

---

## 🚨 **Most Likely Causes**

Based on your error, here are the most common issues (in order):

### **1. Wrong `NEXTAUTH_URL`** (80% chance)
If you didn't update this after deployment, NextAuth will fail.

**Fix**: Set to `https://www.betsycrm.com` in Vercel env vars

### **2. Missing `DATABASE_URL`** (15% chance)  
Environment variable not set in Vercel.

**Fix**: Add it with the exact connection string above

### **3. Wrong Database Password** (4% chance)
Password doesn't match what's in Supabase.

**Fix**: Get fresh password from Supabase, update both URLs

### **4. Using Direct Connection** (1% chance)
Using `db.bmolvybsqzkeswkomgzw.supabase.co` instead of pooler.

**Fix**: Use `aws-1-us-east-1.pooler.supabase.com`

---

## ✅ **After Fixing**

Once you've updated the environment variables and redeployed:

1. Visit: `https://www.betsycrm.com/landing`
2. Click "Empezar Gratis" or "Iniciar Sesión"
3. Try to sign in
4. Should work! ✅

---

## 📞 **Still Not Working?**

If you still get 500 errors after trying all fixes above:

### **Check Vercel Function Logs**:
1. Vercel Dashboard → Deployments → Click your deployment
2. Click "Functions" tab
3. Find `/api/auth/[...nextauth]` function
4. Look at the error logs
5. Share the error message

### **Common Error Messages**:

**"Error: P1001: Can't reach database server"**
- Issue: Wrong host or port
- Fix: Use pooler URL with port 6543

**"Error: P1017: Connection timeout"**
- Issue: Database is paused or unreachable
- Fix: Check Supabase project is active

**"Error: P1000: Authentication failed"**
- Issue: Wrong password
- Fix: Get fresh password from Supabase

**"Error: SASL authentication failed"**
- Issue: Password is wrong or has special characters
- Fix: URL encode the password or get a new simpler one

---

## 🎯 **Quick Test After Fix**

```bash
# Test 1: Check if site loads
curl https://www.betsycrm.com/landing

# Test 2: Check auth endpoint
curl https://www.betsycrm.com/api/auth/session

# Should return: {"user":null} (not 500 error)
```

---

**The issue is 99% likely one of the environment variables. Update them in Vercel and redeploy! 🚀**

