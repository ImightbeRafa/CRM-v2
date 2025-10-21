# Betsy CRM - Setup Guide

## 📋 Environment Variables

### Required Environment Variables

Create these environment variables in your Vercel dashboard:

```bash
# Database (Vercel Postgres - automatically set by Vercel)
POSTGRES_PRISMA_URL="<provided-by-vercel>"
POSTGRES_URL_NON_POOLING="<provided-by-vercel>"

# Authentication
NEXTAUTH_SECRET="<generate-a-secure-random-string>"
NEXTAUTH_URL="https://yourdomain.com"
```

### Generating NEXTAUTH_SECRET

Generate a secure secret key:

```bash
openssl rand -base64 32
```

Or use this online: https://generate-secret.vercel.app/32

## 🚀 Deployment to Vercel

### 1. **Create Vercel Project**

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod
```

### 2. **Add Postgres Database**

1. Go to your Vercel project dashboard
2. Click "Storage" tab
3. Click "Create Database"
4. Select "Postgres"
5. Vercel will automatically set `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING`

### 3. **Set Environment Variables**

In your Vercel project settings:

1. Go to "Settings" → "Environment Variables"
2. Add:
   - `NEXTAUTH_SECRET` = Your generated secret
   - `NEXTAUTH_URL` = Your production URL (e.g., `https://betsycrm.com`)

### 4. **Trigger Deployment**

Push to your git repository or trigger a redeploy in Vercel dashboard.

The build process will:
1. ✅ Generate Prisma Client
2. ✅ Push database schema to Postgres
3. ✅ Build Next.js application
4. ✅ Create master user automatically

## 🔐 First Login

After deployment:

**Master User Credentials:**
- Username: `master`
- Password: `Master2024!`

**⚠️ IMPORTANT:** Change the master password immediately after first login!

## 🗄️ Database Schema

The application uses **PostgreSQL in production** with the following models:

### Core Models
- `Order` - Sales orders (EA/RA)
- `User` - System users (MASTER/REGULAR)
- `AuditLog` - System audit trail
- `Client` - Customer information
- `InventoryItem` - Product inventory

### Configuration Models
- `ProductOptionSet` - Option sets for products
- `ProductOption` - Individual options
- `ProductField` - Custom product fields
- `Seller` - Sales representatives
- `ShippingMethod` - Shipping methods
- `ShippingConfig` - Carrier configurations
- `ShippingGuia` - Shipping labels
- `BusinessInfo` - Custom business fields
- `OrderStatus` - Custom order statuses

## 🛠️ Build Process

The build script in `package.json`:

```json
"build": "prisma generate && prisma db push --accept-data-loss && next build"
```

### What happens during build:

1. **`prisma generate`**
   - Generates TypeScript types from schema
   - Creates Prisma Client for database access

2. **`prisma db push --accept-data-loss`**
   - Syncs database schema with your Prisma schema
   - Creates/updates tables
   - ⚠️ Uses `--accept-data-loss` flag for production deployments

3. **`next build`**
   - Builds Next.js application
   - Optimizes for production

4. **`postbuild` (setup-master-user.js)**
   - Automatically creates master user if it doesn't exist
   - Ensures you can always login

## 🧪 Testing Database Connection

After deployment, test the database connection:

```bash
# Visit your deployed app
https://yourdomain.com/api/test

# Should return:
{"message": "API is working"}
```

## 📊 Database Migrations

### Production Migrations

For Vercel deployments, `prisma db push` is used instead of migrations:

**Pros:**
- ✅ Simpler deployment
- ✅ No migration files to manage
- ✅ Works automatically with Vercel

**Cons:**
- ⚠️ Data loss possible if schema conflicts
- ⚠️ No migration history

### Alternative: Prisma Migrate (Advanced)

If you need migration history:

1. Update `package.json`:
```json
"build": "prisma generate && prisma migrate deploy && next build"
```

2. Create migrations locally:
```bash
prisma migrate dev --name your_migration_name
```

3. Commit migration files to git

## 🔧 Troubleshooting

### Build Fails: "DATABASE_URL not found"

**Solution:** Vercel hasn't set up the Postgres database yet.

1. Go to Vercel dashboard
2. Add Postgres database
3. Redeploy

### Master User Not Created

**Solution:** Run the setup manually:

```bash
# Via API endpoint
POST https://yourdomain.com/api/setup-master
```

Or SSH into Vercel and run:
```bash
node scripts/setup-master-user.js
```

### "prisma db push" Fails

**Common causes:**
- Database connection issues
- Schema conflicts
- Missing environment variables

**Solution:**
1. Check Vercel logs: `vercel logs`
2. Verify environment variables are set
3. Try redeploying

### Can't Login After Deployment

**Solutions:**

1. **Master user doesn't exist:**
   ```bash
   # Call setup endpoint
   POST https://yourdomain.com/api/setup-master
   ```

2. **NEXTAUTH_SECRET mismatch:**
   - Verify the secret in Vercel dashboard
   - Must be the same across all environments

3. **NEXTAUTH_URL incorrect:**
   - Must match your actual domain
   - Include `https://`

## 🔄 Local Development

For local development, you can use PostgreSQL or SQLite:

### Option 1: PostgreSQL (Recommended)

1. Install PostgreSQL locally
2. Create database:
```sql
CREATE DATABASE betsy_dev;
```

3. Set environment variable:
```bash
POSTGRES_PRISMA_URL="postgresql://user:password@localhost:5432/betsy_dev?pgbouncer=true&connection_limit=1"
POSTGRES_URL_NON_POOLING="postgresql://user:password@localhost:5432/betsy_dev"
```

4. Run migrations:
```bash
npm run db:push
```

### Option 2: SQLite (Quick Start)

1. Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

2. Run:
```bash
npm run db:push
npm run dev
```

## 📚 Additional Resources

- **Prisma Documentation:** https://www.prisma.io/docs
- **Vercel Postgres:** https://vercel.com/docs/storage/vercel-postgres
- **NextAuth.js:** https://next-auth.js.org/
- **Next.js Deployment:** https://nextjs.org/docs/deployment

## ✅ Post-Deployment Checklist

- [ ] Postgres database created in Vercel
- [ ] All environment variables set
- [ ] Build successful
- [ ] Can access application URL
- [ ] Master user created (test login)
- [ ] Database tables exist (check `/api/test`)
- [ ] Master password changed from default

---

**Need Help?** Check Vercel deployment logs:
```bash
vercel logs <your-deployment-url>
```

