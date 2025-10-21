# 🔐 Master User Automatic Setup for Vercel

## 🎯 **How Master User Creation Works**

The system automatically creates a master user during Vercel deployment using your environment variables.

### **Environment Variables Required:**

```bash
MASTER_USERNAME=admin
MASTER_PASSWORD=21126
```

### **Automatic Setup Process:**

1. **During Vercel Build**: The `postbuild` script runs automatically
2. **Database Check**: System checks if master user already exists
3. **User Creation**: If no master user exists, creates one with your credentials
4. **Verification**: Confirms master user was created successfully

## 🔧 **Implementation Details**

### **Files Created:**

1. **`/api/setup-master/route.ts`** - API endpoint for master user management
2. **`scripts/setup-master-user.js`** - Build script for automatic setup
3. **`package.json`** - Updated with `postbuild` script

### **How It Works:**

```javascript
// 1. Environment variables are read
const masterUsername = process.env.MASTER_USERNAME || 'admin';
const masterPassword = process.env.MASTER_PASSWORD || 'admin123';

// 2. Check if master user exists
const existingMaster = await prisma.user.findFirst({
  where: { role: 'MASTER', active: true }
});

// 3. Create master user if doesn't exist
if (!existingMaster) {
  const hashedPassword = await bcrypt.hash(masterPassword, 12);
  await prisma.user.create({
    data: {
      username: masterUsername,
      password: hashedPassword,
      role: 'MASTER',
      active: true
    }
  });
}
```

## 🚀 **Vercel Deployment Process**

### **Step 1: Set Environment Variables in Vercel**

```bash
MASTER_USERNAME=admin
MASTER_PASSWORD=21126
NEXTAUTH_SECRET=your-production-secret
NEXTAUTH_URL=https://betsycrm.com
DATABASE_URL=your-database-url
```

### **Step 2: Deploy to Vercel**

1. Push your code to the `casa` branch
2. Connect to Vercel
3. Vercel runs: `npm run build`
4. **Automatically runs**: `npm run postbuild` → `npm run setup:master`
5. Master user is created with your credentials

### **Step 3: Verify Master User**

Visit: `https://betsycrm.com/api/setup-master`

**Response if successful:**
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

## 🔒 **Security Features**

### **Password Hashing:**
- Uses bcrypt with salt rounds: 12
- Passwords are never stored in plain text
- Secure password verification

### **User Validation:**
- Checks for existing master users
- Prevents duplicate master users
- Validates environment variables

### **Role-Based Access:**
- Master user has `MASTER` role
- Full system access
- Can create other users

## 🎯 **Login After Deployment**

1. **Visit**: `https://betsycrm.com`
2. **Username**: `admin` (from MASTER_USERNAME)
3. **Password**: `21126` (from MASTER_PASSWORD)
4. **Access**: Full admin dashboard

## 🔧 **Manual Setup (If Needed)**

If automatic setup fails, you can manually create the master user:

```bash
# Call the setup API
curl -X POST https://betsycrm.com/api/setup-master
```

## 📋 **Troubleshooting**

### **Master User Not Created:**
1. Check environment variables in Vercel
2. Verify database connection
3. Check build logs for errors
4. Call setup API manually

### **Login Issues:**
1. Verify username/password match environment variables
2. Check if user exists: `GET /api/setup-master`
3. Ensure database is properly migrated

## ✅ **Verification Checklist**

- [ ] Environment variables set in Vercel
- [ ] Database connected and migrated
- [ ] Build completed successfully
- [ ] Master user created (check `/api/setup-master`)
- [ ] Can login with master credentials
- [ ] Admin dashboard accessible

**Your master user will be automatically created during Vercel deployment!** 🎉
