# 🔧 **BETSY CRM - ENVIRONMENT SETUP GUIDE**

**Created:** October 21, 2025  
**Version:** 1.0  
**Status:** ✅ **COMPLETE**

---

## 📋 **OVERVIEW**

This guide will walk you through setting up all the required environment variables for your Betsy CRM system. The system needs these variables to function properly in both development and production environments.

### **Required Variables:**
- ✅ **DATABASE_URL** - Database connection
- ✅ **NEXTAUTH_SECRET** - Authentication secret
- ✅ **NEXTAUTH_URL** - Application URL

### **Optional Variables:**
- ⚠️ **BLOB_READ_WRITE_TOKEN** - Backup storage
- ⚠️ **CRON_SECRET** - Cron job security
- ⚠️ **BACKUP_API_KEY** - Backup API security

---

## 🚀 **QUICK START SETUP**

### **Step 1: Create Environment File**
```bash
# Copy the template to create your .env file
cp env-template-complete.txt .env
```

### **Step 2: Configure Required Variables**
Edit your `.env` file and set these **REQUIRED** variables:

```env
# Database connection (REQUIRED)
DATABASE_URL="postgresql://username:password@localhost:5432/betsy_crm"

# Authentication secret (REQUIRED)
NEXTAUTH_SECRET="your-super-secure-secret-key-here"

# Application URL (REQUIRED)
NEXTAUTH_URL="http://localhost:3000"
```

### **Step 3: Test Configuration**
```bash
# Run the verification test
node scripts/simple-verification.js
```

---

## 🔧 **DETAILED SETUP INSTRUCTIONS**

### **A. DATABASE CONFIGURATION**

#### **For Local Development:**
```env
# Local PostgreSQL database
DATABASE_URL="postgresql://postgres:password@localhost:5432/betsy_crm"
DIRECT_URL="postgresql://postgres:password@localhost:5432/betsy_crm"
```

#### **For Supabase (Recommended):**
```env
# Supabase database connection
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres"
```

#### **For Production:**
```env
# Production database (replace with your actual values)
DATABASE_URL="postgresql://username:password@your-host:5432/your-database"
DIRECT_URL="postgresql://username:password@your-host:5432/your-database"
```

### **B. AUTHENTICATION CONFIGURATION**

#### **Generate NEXTAUTH_SECRET:**
```bash
# Option 1: Using OpenSSL
openssl rand -base64 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Option 3: Online generator
# Visit: https://generate-secret.vercel.app/32
```

#### **Set NEXTAUTH_URL:**
```env
# For development
NEXTAUTH_URL="http://localhost:3000"

# For production
NEXTAUTH_URL="https://your-domain.com"
```

### **C. GOOGLE OAUTH SETUP (OPTIONAL)**

#### **Step 1: Create Google OAuth App**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://your-domain.com/api/auth/callback/google` (production)

#### **Step 2: Configure Environment Variables**
```env
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

---

## 💾 **BACKUP SYSTEM SETUP**

### **A. Vercel Blob Storage Setup**

#### **Step 1: Get Vercel Blob Token**
1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Navigate to your project
3. Go to Settings → Environment Variables
4. Add `BLOB_READ_WRITE_TOKEN` with your token

#### **Step 2: Configure Environment Variables**
```env
# Vercel Blob Storage token
BLOB_READ_WRITE_TOKEN="vercel_blob_token_here"

# Backup retention policy (days)
BACKUP_RETENTION_DAYS="30"

# Cron job security secret
CRON_SECRET="your-cron-secret-key"

# Backup API key
BACKUP_API_KEY="your-backup-api-key"
```

### **B. Generate Security Keys**
```bash
# Generate CRON_SECRET
openssl rand -base64 32

# Generate BACKUP_API_KEY
openssl rand -base64 32
```

---

## 🚀 **PRODUCTION SETUP**

### **A. Vercel Deployment**

#### **Step 1: Add Environment Variables in Vercel**
1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add all required variables:

```env
DATABASE_URL="your-production-database-url"
NEXTAUTH_SECRET="your-production-secret"
NEXTAUTH_URL="https://your-domain.com"
BLOB_READ_WRITE_TOKEN="your-vercel-blob-token"
CRON_SECRET="your-cron-secret"
BACKUP_API_KEY="your-backup-api-key"
```

#### **Step 2: Configure Custom Domain**
1. Go to Settings → Domains
2. Add your custom domain
3. Update NEXTAUTH_URL accordingly

### **B. Database Setup**

#### **For Supabase Production:**
1. Create a new Supabase project
2. Get the connection string
3. Update DATABASE_URL and DIRECT_URL
4. Enable Row Level Security (RLS)

#### **For Other PostgreSQL Providers:**
1. Create a PostgreSQL database
2. Get the connection string
3. Update DATABASE_URL and DIRECT_URL
4. Ensure SSL is enabled

---

## 🧪 **TESTING YOUR SETUP**

### **Step 1: Test Database Connection**
```bash
# Test database connectivity
node -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
sql\`SELECT 1\`.then(() => {
  console.log('✅ Database connected successfully');
  process.exit(0);
}).catch(err => {
  console.log('❌ Database connection failed:', err.message);
  process.exit(1);
});
"
```

### **Step 2: Test Authentication**
```bash
# Start the development server
npm run dev

# Visit http://localhost:3000/auth/signin
# Test login functionality
```

### **Step 3: Run Comprehensive Test**
```bash
# Run the verification test
node scripts/simple-verification.js

# Should show all tests passing
```

---

## 🔒 **SECURITY BEST PRACTICES**

### **A. Environment Variable Security**
- ✅ **Never commit .env files** to version control
- ✅ **Use strong, unique secrets** for each environment
- ✅ **Rotate secrets regularly** (every 90 days)
- ✅ **Use different secrets** for development and production
- ✅ **Limit access** to environment variables

### **B. Database Security**
- ✅ **Use SSL connections** (required for production)
- ✅ **Limit database access** to application only
- ✅ **Use connection pooling** for performance
- ✅ **Enable Row Level Security** (RLS) if using Supabase
- ✅ **Regular security updates** for database

### **C. Authentication Security**
- ✅ **Use strong NEXTAUTH_SECRET** (32+ characters)
- ✅ **Enable HTTPS** in production
- ✅ **Configure proper CORS** settings
- ✅ **Use secure cookies** for sessions
- ✅ **Implement rate limiting** for login attempts

---

## 🚨 **TROUBLESHOOTING**

### **Common Issues:**

#### **1. Database Connection Failed**
```bash
# Check if DATABASE_URL is set
echo $DATABASE_URL

# Test connection manually
psql $DATABASE_URL -c "SELECT 1;"
```

#### **2. Authentication Not Working**
```bash
# Check NEXTAUTH_SECRET
echo $NEXTAUTH_SECRET

# Check NEXTAUTH_URL
echo $NEXTAUTH_URL
```

#### **3. Backup System Not Working**
```bash
# Check BLOB_READ_WRITE_TOKEN
echo $BLOB_READ_WRITE_TOKEN

# Test Vercel Blob connection
node -e "require('@vercel/blob').list({token: process.env.BLOB_READ_WRITE_TOKEN}).then(console.log).catch(console.error)"
```

### **Debug Commands:**
```bash
# Check all environment variables
node -e "console.log(process.env)"

# Test specific variable
node -e "console.log('DATABASE_URL:', process.env.DATABASE_URL)"

# Run verification test
node scripts/simple-verification.js
```

---

## 📚 **ADDITIONAL RESOURCES**

### **Documentation:**
- [NextAuth.js Configuration](https://next-auth.js.org/configuration)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Supabase Database Setup](https://supabase.com/docs/guides/database)
- [PostgreSQL Connection Strings](https://www.postgresql.org/docs/current/libpq-connect.html)

### **Security Guides:**
- [Environment Variable Security](https://12factor.net/config)
- [Database Security Best Practices](https://owasp.org/www-project-top-ten/)
- [Authentication Security](https://owasp.org/www-project-authentication-cheat-sheet/)

---

## 🎯 **FINAL CHECKLIST**

### **Before Development:**
- [ ] **Create .env file** with required variables
- [ ] **Test database connection** (verify connectivity)
- [ ] **Test authentication** (verify login system)
- [ ] **Run verification test** (comprehensive test)
- [ ] **Check all systems** (backup, export, deployment)

### **Before Production:**
- [ ] **Configure production database** (PostgreSQL)
- [ ] **Set up Vercel Blob Storage** (backup system)
- [ ] **Configure custom domain** (HTTPS)
- [ ] **Set up monitoring** (system health)
- [ ] **Test all functionality** (end-to-end testing)

---

## 🎉 **CONCLUSION**

### **Your Betsy CRM Environment Setup:**
- ✅ **Database:** PostgreSQL with SSL
- ✅ **Authentication:** NextAuth.js with secure secrets
- ✅ **Backup System:** Vercel Blob Storage
- ✅ **Security:** Enterprise-grade protection
- ✅ **Production Ready:** Complete configuration

### **Next Steps:**
1. **Configure environment variables**
2. **Test all systems**
3. **Deploy to production**
4. **Monitor system health**

**Your Betsy CRM is ready for enterprise production! 🚀**

---

**Last Updated:** October 21, 2025  
**Setup Status:** ✅ **COMPLETE**  
**Document Owner:** Development Team
