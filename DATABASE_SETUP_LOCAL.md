# Local Database Setup Guide

**Issue:** After changing `schema.prisma` to use `DATABASE_PRISM_POSTGRES_URL`, the database connection needs to be properly configured.

---

## 🔧 Step-by-Step Setup

### 1. Create/Update Your `.env` File

In the root `Betsy/` directory, create or update your `.env` file:

```bash
# Copy this content into Betsy/.env

# Database Configuration
DATABASE_PRISM_POSTGRES_URL="postgresql://user:password@localhost:5432/betsy_crm?schema=public"

# For Production (if using Prisma Cloud):
# DATABASE_PRISM_POSTGRES_URL="postgres://user:password@db.prisma.io:5432/postgres?sslmode=require"

# Authentication
NEXTAUTH_SECRET="generate-a-secure-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"

# Master User Configuration
MASTER_USERNAME="admin"
MASTER_PASSWORD="21126"

# Optional
AUTH_DEMO_MODE="false"
```

---

## 📝 Configuration Options

### Option 1: Local SQLite (Simple Testing)

For quick local development, you can use SQLite instead of PostgreSQL:

**Update `prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

**Then skip to Step 2 below.**

### Option 2: Local PostgreSQL

**Install PostgreSQL locally:**
```bash
# Windows (use installer from postgresql.org)
# Or use Docker:
docker run --name betsy-postgres -e POSTGRES_PASSWORD=betsy123 -e POSTGRES_DB=betsy_crm -p 5432:5432 -d postgres:15
```

**Your `.env` DATABASE_PRISM_POSTGRES_URL:**
```bash
DATABASE_PRISM_POSTGRES_URL="postgresql://postgres:betsy123@localhost:5432/betsy_crm?schema=public"
```

### Option 3: Production Database (Prisma Cloud)

If you want to connect to your production database locally:

**Your `.env` DATABASE_PRISM_POSTGRES_URL:**
```bash
DATABASE_PRISM_POSTGRES_URL="postgres://user:password@db.prisma.io:5432/postgres?sslmode=require"
```

*(Get this URL from your Prisma Cloud dashboard)*

---

## 🚀 Setup Commands

### 2. Generate Prisma Client

After updating your `.env` file, regenerate the Prisma client:

```bash
cd Betsy
npx prisma generate
```

**Expected output:**
```
✔ Generated Prisma Client
```

### 3. Push Schema to Database

Push your schema to the database (creates tables):

```bash
npx prisma db push
```

**Expected output:**
```
✔ Database synchronized with Prisma schema
```

### 4. Test Database Connection

Test the connection using Prisma Studio:

```bash
npx prisma studio
```

**Expected result:**
- Opens browser at `http://localhost:5555`
- Shows all your database tables
- You can browse data

### 5. Verify in Application

Restart your dev server:

```bash
npm run dev
```

Then test the estadísticas endpoints:
```bash
# In another terminal:
curl http://localhost:3000/api/estadisticas/summary
```

**Expected:** JSON response with data (or empty arrays if no orders yet)

---

## 🧪 Quick Test Script

Run this command to test all estadísticas endpoints:

```bash
# Test Summary
curl http://localhost:3000/api/estadisticas/summary

# Test Revenue
curl "http://localhost:3000/api/estadisticas/revenue?startDate=2025-01-01&endDate=2025-12-31&groupBy=day"

# Test Type Breakdown
curl http://localhost:3000/api/estadisticas/type-breakdown

# Test Status Breakdown
curl http://localhost:3000/api/estadisticas/status-breakdown
```

---

## ⚠️ Troubleshooting

### Error: "Environment variable not found: DATABASE_PRISM_POSTGRES_URL"

**Solution:**
1. Ensure `.env` file exists in `Betsy/` directory
2. Variable name in `.env` matches exactly: `DATABASE_PRISM_POSTGRES_URL`
3. Run `npx prisma generate` again
4. Restart your dev server

### Error: "Can't reach database server"

**Solution:**
1. **If using PostgreSQL:** Ensure PostgreSQL is running
2. **Check connection string:** Username, password, host, port are correct
3. **Try SQLite instead:** Update schema.prisma to use SQLite (see Option 1 above)

### Error: "Schema does not match database"

**Solution:**
```bash
npx prisma db push --accept-data-loss
```

This will sync your schema with the database.

### Error: "Prisma Client did not initialize yet"

**Solution:**
```bash
# Delete node_modules/.prisma
rm -rf node_modules/.prisma

# Regenerate
npx prisma generate

# Restart dev server
npm run dev
```

---

## 📊 Seed Sample Data

If you need sample data for testing estadísticas:

```bash
# Create some test orders
node scripts/full-seed.js
```

Or use the API:
```bash
curl http://localhost:3000/api/seed
```

---

## ✅ Verification Checklist

After setup, verify these work:

- [ ] `npx prisma generate` - No errors
- [ ] `npx prisma db push` - Schema synced
- [ ] `npx prisma studio` - Opens and shows tables
- [ ] `npm run dev` - Server starts without database errors
- [ ] Navigate to `/estadisticas` - Page loads
- [ ] KPI cards show data (or zeros if no orders)
- [ ] Charts render without errors
- [ ] Console has no database connection errors

---

## 🔄 Current Schema Configuration

Your current `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_PRISM_POSTGRES_URL")
  directUrl = env("DATABASE_PRISM_POSTGRES_URL")
}
```

This means:
- ✅ Both connection types use the same URL
- ✅ Matches production environment variable naming
- ✅ Works with Prisma Cloud databases
- ⚠️ If using Prisma Accelerate, you may want different URLs:
  - `url` = Accelerate pooled URL (`prisma+postgres://...`)
  - `directUrl` = Direct connection URL (`postgres://...`)

---

## 🎯 Recommended Setup for Development

### Quick Start (Easiest)

**Use SQLite for local development:**

1. **Update `prisma/schema.prisma`:**
   ```prisma
   datasource db {
     provider = "sqlite"
     url      = "file:./dev.db"
   }
   ```

2. **Run setup:**
   ```bash
   npx prisma generate
   npx prisma db push
   npm run dev
   ```

3. **Done!** No database server needed.

### Production-Like Setup

**Use PostgreSQL with Docker:**

1. **Start PostgreSQL:**
   ```bash
   docker run --name betsy-db -e POSTGRES_PASSWORD=betsy123 -e POSTGRES_DB=betsy_crm -p 5432:5432 -d postgres:15
   ```

2. **Create `.env`:**
   ```bash
   DATABASE_PRISM_POSTGRES_URL="postgresql://postgres:betsy123@localhost:5432/betsy_crm"
   NEXTAUTH_SECRET="your-secret-key"
   NEXTAUTH_URL="http://localhost:3000"
   MASTER_USERNAME="admin"
   MASTER_PASSWORD="21126"
   ```

3. **Run setup:**
   ```bash
   npx prisma generate
   npx prisma db push
   npm run dev
   ```

---

## 📞 Need Help?

If still having issues:
1. Check console output for specific error messages
2. Verify `.env` file location (must be in `Betsy/` root)
3. Try SQLite setup first (simplest option)
4. Ensure no typos in environment variable names

---

**Created:** October 21, 2025  
**Purpose:** Local database setup after schema.prisma update

