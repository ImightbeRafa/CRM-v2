# 🔐 Admin Login Troubleshooting Guide

## 🚨 **Current Issue**

Admin login is not working because the master user was never created during deployment.

## 🔍 **Root Cause Analysis**

### **Problem 1: No Master User Created**
- The `setup-master-user.js` script didn't run during Vercel deployment
- `DATABASE_URL` was not available during build time
- Master user was never created in the database

### **Problem 2: Conflicting Credentials**
Your codebase has **3 different master user setups**:

1. **Environment Variables** (Recommended):
   - Username: `process.env.MASTER_USERNAME || 'admin'`
   - Password: `process.env.MASTER_PASSWORD || 'admin123'`

2. **Full Seed Script**:
   - Username: `'master'`
   - Password: `'master123'`

3. **Documentation Examples**:
   - Username: `'admin'`
   - Password: `'21126'`

## ✅ **Immediate Solutions**

### **Solution 1: Create Master User via API (Recommended)**

Call the setup API to create the master user:

```bash
# Option A: Using environment variables (if set in Vercel)
curl -X POST https://your-app.vercel.app/api/setup-master

# Option B: Check if master user exists
curl -X GET https://your-app.vercel.app/api/setup-master
```

### **Solution 2: Use Full Seed Script**

If the setup API doesn't work, use the seed endpoint:

```bash
# This will create master user with username: 'master', password: 'master123'
curl -X POST https://your-app.vercel.app/api/seed \
  -H "Content-Type: application/json" \
  -d '{"action": "populate"}'
```

### **Solution 3: Manual Database Setup**

If you have database access, create the user manually:

```sql
-- Create master user with hashed password
INSERT INTO User (id, username, password, role, active, createdAt, updatedAt)
VALUES (
  'master-user-id',
  'admin',
  '$2a$12$hashedpasswordhere', -- Use bcrypt to hash your password
  'MASTER',
  true,
  NOW(),
  NOW()
);
```

## 🎯 **Recommended Login Credentials**

### **After using Solution 1 (Environment Variables):**
- **Username**: `admin` (or whatever you set in `MASTER_USERNAME`)
- **Password**: `admin123` (or whatever you set in `MASTER_PASSWORD`)

### **After using Solution 2 (Full Seed):**
- **Username**: `master`
- **Password**: `master123`

### **After using Solution 3 (Manual):**
- **Username**: `admin`
- **Password**: `your-chosen-password`

## 🔧 **Vercel Environment Variables**

Make sure these are set in your Vercel project settings:

```bash
# Required for automatic master user creation
MASTER_USERNAME=admin
MASTER_PASSWORD=your-secure-password

# Required for authentication
NEXTAUTH_SECRET=your-production-secret
NEXTAUTH_URL=https://your-app.vercel.app
DATABASE_URL=your-database-url
```

## 🚀 **Step-by-Step Fix**

### **Step 1: Check Current Status**
```bash
curl -X GET https://your-app.vercel.app/api/setup-master
```

### **Step 2: Create Master User**
```bash
# If no master user exists, create one
curl -X POST https://your-app.vercel.app/api/setup-master
```

### **Step 3: Verify Creation**
```bash
# Check if master user was created
curl -X GET https://your-app.vercel.app/api/setup-master
```

### **Step 4: Test Login**
- Go to your app's login page
- Use the credentials from the API response
- Login should work now

## 🔍 **Debugging Commands**

### **Check Authentication Status**
```bash
curl -X GET https://your-app.vercel.app/api/auth/me
```

### **Check All Users**
```bash
curl -X GET https://your-app.vercel.app/api/users
```

## ✅ **Expected Results**

After successful setup, you should see:

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

## 🎯 **Quick Fix Summary**

1. **Call the setup API** to create master user
2. **Use the correct credentials** from the API response
3. **Login should work** with those credentials

**The master user needs to be created first before you can login!** 🔐
