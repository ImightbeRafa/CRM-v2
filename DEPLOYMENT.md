# Betsy CRM - Production Deployment Guide

## 🚀 Vercel Deployment with Prisma Database

This guide covers deploying Betsy CRM to Vercel using Prisma's managed database service.

## 📋 Environment Variables

### Required Variables

Set these in your Vercel project dashboard under **Settings → Environment Variables**:

```bash
# Database (Prisma Managed Database with Accelerate)
DATABASE_PRISM_PRISMA_DATABASE_URL="prisma+postgres://accelerate.prisma-data.net/?api_key=YOUR_API_KEY"
DATABASE_PRISM_POSTGRES_URL="postgres://user:password@db.prisma.io:5432/postgres?sslmode=require"

# Optional: Alternative database URL (if using Vercel Postgres or other provider)
DATABASE_PRISM_DATABASE_URL="postgres://user:password@host:5432/database"

# Authentication
NEXTAUTH_SECRET="your-secure-secret-key"
NEXTAUTH_URL="https://yourdomain.com"

# Master User Configuration
MASTER_USERNAME="admin"
MASTER_PASSWORD="your-secure-password"

# Optional
AUTH_DEMO_MODE="false"
```

### Variable Descriptions

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_PRISM_PRISMA_DATABASE_URL` | Prisma Accelerate connection string (pooled) | ✅ Yes |
| `DATABASE_PRISM_POSTGRES_URL` | Direct PostgreSQL connection for migrations | ✅ Yes |
| `NEXTAUTH_SECRET` | Secret key for NextAuth.js authentication | ✅ Yes |
| `NEXTAUTH_URL` | Your production domain URL | ✅ Yes |
| `MASTER_USERNAME` | Master/admin user username | ✅ Yes |
| `MASTER_PASSWORD` | Master/admin user password | ✅ Yes |
| `AUTH_DEMO_MODE` | Enable demo mode (optional) | ❌ No |

## 🔐 Generating NEXTAUTH_SECRET

Generate a secure 32-character random string:

```bash
# Option 1: Using OpenSSL
openssl rand -base64 32

# Option 2: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Option 3: Online generator
# Visit: https://generate-secret.vercel.app/32
```

## 🗄️ Database Setup

### Option 1: Prisma Managed Database (Recommended)

1. **Sign up for Prisma Data Platform:**
   - Visit: https://cloud.prisma.io/
   - Create a new project
   - Create a database

2. **Get Connection Strings:**
   - **Accelerate URL**: `prisma+postgres://accelerate.prisma-data.net/?api_key=...`
   - **Direct URL**: `postgres://...@db.prisma.io:5432/postgres?sslmode=require`

3. **Set in Vercel:**
   ```bash
   DATABASE_PRISM_PRISMA_DATABASE_URL="prisma+postgres://..."
   DATABASE_PRISM_POSTGRES_URL="postgres://..."
   ```

### Option 2: Vercel Postgres

1. **Add Postgres Storage in Vercel:**
   - Go to your project dashboard
   - Click "Storage" tab
   - Click "Create Database"
   - Select "Postgres"

2. **Update `prisma/schema.prisma`:**
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("POSTGRES_PRISMA_URL")
     directUrl = env("POSTGRES_URL_NON_POOLING")
   }
   ```

3. **Environment Variables:**
   Vercel automatically sets `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING`

## 🏗️ Build Process

The build script in `package.json`:

```json
{
  "build": "prisma generate && prisma db push --accept-data-loss && next build",
  "postbuild": "node scripts/setup-master-user.js"
}
```

### Build Steps:

1. **`prisma generate`**
   - Generates Prisma Client with TypeScript types
   - Required before any database operations

2. **`prisma db push --accept-data-loss`**
   - Syncs database schema with Prisma schema
   - Creates/updates tables as needed
   - ⚠️ Uses `--accept-data-loss` for production deployments

3. **`next build`**
   - Builds the Next.js application
   - Optimizes for production

4. **`postbuild` hook (setup-master-user.js)**
   - Automatically creates master/admin user
   - Uses `MASTER_USERNAME` and `MASTER_PASSWORD` from env
   - Skips if master user already exists

## 👤 Master User Creation

The master user is automatically created during deployment using your environment variables:

```javascript
// From scripts/setup-master-user.js
const masterUsername = process.env.MASTER_USERNAME || 'master';
const masterPassword = process.env.MASTER_PASSWORD || 'Master2024!';
```

**Your Configuration:**
- Username: `admin` (from `MASTER_USERNAME`)
- Password: `21126` (from `MASTER_PASSWORD`)

The script will:
- ✅ Check if a master user already exists
- ✅ Hash the password securely (bcrypt with 12 rounds)
- ✅ Create the user with MASTER role
- ✅ Skip if already exists (idempotent)

## 🚀 Deployment Steps

### 1. Push to Git

```bash
git add .
git commit -m "Production ready deployment"
git push origin main
```

### 2. Deploy to Vercel

**Option A: Vercel CLI**
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

**Option B: Vercel Dashboard**
1. Go to https://vercel.com/new
2. Import your Git repository
3. Vercel will automatically detect Next.js
4. Add environment variables
5. Click "Deploy"

### 3. Verify Deployment

After deployment completes:

1. **Check build logs:**
   ```bash
   vercel logs <your-deployment-url>
   ```

2. **Look for these success messages:**
   ```
   ✔ Generated Prisma Client
   ✔ Database schema synchronized
   ✔ Master user created successfully
   ```

3. **Test the application:**
   - Visit: `https://yourdomain.com`
   - Login with your master credentials
   - Username: `admin`
   - Password: `21126`

## 🔧 Troubleshooting

### Build Fails: "Environment variable not found"

**Error:**
```
Error: Environment variable not found: DATABASE_PRISM_POSTGRES_URL
```

**Solution:**
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Verify all required variables are set
3. Make sure they're enabled for "Production"
4. Trigger a new deployment

### Master User Not Created

**Symptoms:**
- Can't login after deployment
- No master user exists

**Solutions:**

1. **Check build logs:**
   ```bash
   vercel logs --follow
   ```

2. **Manually trigger master user creation:**
   ```bash
   # Via API endpoint
   curl -X POST https://yourdomain.com/api/setup-master
   ```

3. **Check environment variables:**
   - Verify `MASTER_USERNAME` is set
   - Verify `MASTER_PASSWORD` is set
   - Verify database URLs are correct

### Database Connection Issues

**Error:**
```
Can't reach database server
```

**Solutions:**

1. **Verify connection strings:**
   - Check `DATABASE_PRISM_POSTGRES_URL` is correct
   - Ensure it includes `?sslmode=require`
   - Test connection locally

2. **Check Prisma Cloud status:**
   - Visit: https://status.prisma.io/
   - Check for any ongoing issues

3. **Firewall/Network:**
   - Ensure Vercel can reach db.prisma.io
   - Check for any network restrictions

### "prisma db push" Fails

**Error:**
```
Schema validation failed
```

**Solutions:**

1. **Check schema syntax:**
   ```bash
   npx prisma validate
   ```

2. **Test locally:**
   ```bash
   npm run db:push
   ```

3. **Check for model conflicts:**
   - Review Prisma schema
   - Ensure all relations are valid

## 📊 Post-Deployment Checklist

- [ ] All environment variables are set in Vercel
- [ ] Build completed successfully
- [ ] Database schema synchronized
- [ ] Master user created (check logs)
- [ ] Can access application URL
- [ ] Can login with master credentials
- [ ] All pages load correctly
- [ ] API endpoints respond
- [ ] Database operations work

## 🔄 Updating the Deployment

### Making Changes

```bash
# 1. Make your changes locally
git add .
git commit -m "Your change description"

# 2. Push to trigger auto-deployment
git push origin main

# 3. Monitor deployment
vercel logs --follow
```

### Database Schema Changes

When you modify `prisma/schema.prisma`:

```bash
# The build will automatically:
# 1. Generate new Prisma Client
# 2. Push schema changes to database
# 3. Rebuild application
```

⚠️ **Important:** `prisma db push` may cause data loss if:
- You remove fields
- You change field types
- You have data conflicts

For production migrations with zero downtime, consider using:
```bash
prisma migrate dev --name your_migration_name
prisma migrate deploy  # in production
```

## 🔐 Security Best Practices

### 1. Strong Passwords
- ✅ Use strong, unique password for `MASTER_PASSWORD`
- ✅ Change default password after first login
- ✅ Use password manager

### 2. Environment Variables
- ✅ Never commit `.env` files to git
- ✅ Use different secrets for dev/staging/prod
- ✅ Rotate `NEXTAUTH_SECRET` periodically

### 3. Database Access
- ✅ Use connection pooling (Prisma Accelerate)
- ✅ Enable SSL (`?sslmode=require`)
- ✅ Restrict database access by IP (if possible)

### 4. Regular Updates
- ✅ Keep dependencies updated
- ✅ Monitor security advisories
- ✅ Review audit logs regularly

## 📝 Your Current Configuration

Based on your environment variables:

```bash
# ✅ Production URL
NEXTAUTH_URL=https://betsycrm.com

# ✅ Master User
MASTER_USERNAME=admin
MASTER_PASSWORD=21126  # ⚠️ Change after first login!

# ✅ Database (Prisma Cloud with Accelerate)
DATABASE_PRISM_PRISMA_DATABASE_URL=prisma+postgres://accelerate...
DATABASE_PRISM_POSTGRES_URL=postgres://...@db.prisma.io...
```

## 🆘 Need Help?

- **Vercel Documentation:** https://vercel.com/docs
- **Prisma Documentation:** https://www.prisma.io/docs
- **Next.js Deployment:** https://nextjs.org/docs/deployment
- **Vercel Logs:** `vercel logs <deployment-url>`

## ✅ Final Notes

Your deployment is configured to:
- ✅ Use Prisma's managed database with Accelerate
- ✅ Automatically create admin user with username: `admin`
- ✅ Deploy to https://betsycrm.com
- ✅ Use production-grade security

**First Login:**
1. Visit: https://betsycrm.com
2. Username: `admin`
3. Password: `21126`
4. **⚠️ IMMEDIATELY CHANGE PASSWORD IN /config**

---

**Betsy CRM** - Ready for production! 🚀

