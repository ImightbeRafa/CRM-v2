# 🔧 Vercel Environment Variables Setup Guide

## 🚨 **Current Issue**
Your Vercel app is missing the `DATABASE_URL` environment variable, causing API endpoints to fail.

## ✅ **Step-by-Step Fix**

### **Step 1: Access Vercel Dashboard**
1. Go to [https://vercel.com/dashboard](https://vercel.com/dashboard)
2. Find your project: `crm-v2-omega`
3. Click on the project

### **Step 2: Add Environment Variables**
1. Go to **Settings** tab
2. Click **Environment Variables**
3. Add the following variables:

#### **Required Variables:**
```bash
DATABASE_URL=postgresql://username:password@host:port/database
NEXTAUTH_SECRET=your-32-character-secret-key
NEXTAUTH_URL=https://crm-v2-omega.vercel.app
```

#### **Optional Variables:**
```bash
MASTER_USERNAME=admin
MASTER_PASSWORD=your-secure-password
AUTH_DEMO_MODE=false
```

### **Step 3: Database Setup Options**

#### **Option A: Vercel Postgres (Easiest)**
1. In Vercel dashboard, go to **Storage** tab
2. Click **Create Database** → **Postgres**
3. Copy the connection string
4. Use it as `DATABASE_URL`

#### **Option B: External Database**
- **Supabase**: [https://supabase.com](https://supabase.com) (Free tier)
- **PlanetScale**: [https://planetscale.com](https://planetscale.com)
- **Railway**: [https://railway.app](https://railway.app)
- **Neon**: [https://neon.tech](https://neon.tech)

### **Step 4: Redeploy**
1. After adding environment variables, Vercel will automatically redeploy
2. Wait for deployment to complete
3. Test your API endpoints

## 🧪 **Testing After Setup**

### **Test 1: Check Database Connection**
```bash
curl -X GET https://crm-v2-omega.vercel.app/api/setup-master
```

**Expected Response:**
```json
{
  "status": "success",
  "exists": false,
  "message": "No master user found"
}
```

### **Test 2: Create Master User**
```bash
curl -X POST https://crm-v2-omega.vercel.app/api/setup-master
```

**Expected Response:**
```json
{
  "status": "success",
  "message": "Master user created successfully",
  "data": {
    "username": "admin",
    "role": "MASTER",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### **Test 3: Verify Master User**
```bash
curl -X GET https://crm-v2-omega.vercel.app/api/setup-master
```

**Expected Response:**
```json
{
  "status": "success",
  "exists": true,
  "data": {
    "username": "admin",
    "role": "MASTER",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🔑 **Login Credentials**

After successful setup, use these credentials:
- **Username**: `admin` (or your `MASTER_USERNAME`)
- **Password**: `admin123` (or your `MASTER_PASSWORD`)

## 🚀 **Quick Commands**

### **Generate NEXTAUTH_SECRET:**
```bash
# Generate a secure secret
openssl rand -base64 32
```

### **Test API Endpoints:**
```bash
# Check if master user exists
curl -X GET https://crm-v2-omega.vercel.app/api/setup-master

# Create master user
curl -X POST https://crm-v2-omega.vercel.app/api/setup-master

# Check authentication
curl -X GET https://crm-v2-omega.vercel.app/api/auth/me
```

## ✅ **Success Indicators**

- ✅ API endpoints return JSON responses (not errors)
- ✅ Master user can be created successfully
- ✅ Login page works with correct credentials
- ✅ No more "Environment variable not found" errors

## 🎯 **Next Steps**

1. **Set environment variables** in Vercel dashboard
2. **Wait for redeployment** to complete
3. **Test API endpoints** to verify database connection
4. **Create master user** using the setup API
5. **Login** with the created credentials

**Your app will work perfectly once the environment variables are set!** 🚀
