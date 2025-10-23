# 🧹 Database Cleanup Guide

Clean your database before production launch to remove test data.

---

## ⚠️ **CRITICAL WARNING**

These scripts **DELETE DATA PERMANENTLY**. There is no undo.

**Before running:**
1. ✅ Backup your database
2. ✅ Confirm you're on the right database
3. ✅ Double-check environment variables

---

## 🎯 Two Options

### **Option 1: Complete Cleanup** (Recommended for Fresh Start)
Deletes **ALL** data. Database will be completely empty.

### **Option 2: Selective Cleanup** (Keep Some Data)
Choose what to delete. Can preserve OWNER users and production data.

---

## 🚀 Option 1: Complete Cleanup

### When to Use:
- Before production launch (fresh start)
- Switching from dev to production database
- Want to start with a clean slate

### What Gets Deleted:
- ❌ All tenants
- ❌ All users
- ❌ All orders
- ❌ All clients
- ❌ All inventory
- ❌ All invoices
- ❌ All audit logs
- ❌ All configuration data
- ✅ Database schema remains intact

### How to Run:

```bash
# 1. Make sure you're in the Betsy directory
cd Betsy

# 2. Run the cleanup script
node scripts/clean-database.js

# 3. Confirm by typing exactly: DELETE ALL DATA
```

### Expected Output:

```
============================================================
🧹 DATABASE CLEANUP SCRIPT
============================================================

⚠️  WARNING: This will DELETE ALL DATA from your database!
📊 Database: aws-1-us-east-1.pooler.supabase.com

Tables that will be cleared:
  - AuditLog
  - Invoice
  - Order
  - BillingTransaction
  ...

❓ Type "DELETE ALL DATA" to confirm deletion: DELETE ALL DATA

🗑️  Starting database cleanup...

⏳ Deleting AuditLog...
✅ Deleted 150 audit logs
⏳ Deleting Invoice...
✅ Deleted 25 invoices
...

============================================================
✅ DATABASE CLEANUP COMPLETE!
============================================================

📊 Summary:
   Tenants: 5
   Users: 12
   Orders: 342
   Total Records Deleted: 580

🎉 Your database is now clean and ready for production!
```

---

## 🔧 Option 2: Selective Cleanup

### When to Use:
- Want to keep your account but delete test data
- Cleaning up specific types of data
- Preserving configuration while removing orders

### How to Run:

```bash
# 1. Make sure you're in the Betsy directory
cd Betsy

# 2. Run the selective cleanup script
node scripts/clean-database-selective.js

# 3. Answer the prompts for each data type
```

### Interactive Prompts:

```
============================================================
🧹 SELECTIVE DATABASE CLEANUP
============================================================

Choose what to delete:

Delete all Orders? (y/n): y
Delete all Clients (frequent customers)? (y/n): y
Delete all Inventory Items? (y/n): n
Delete all Invoices? (y/n): y
Delete all Audit Logs? (y/n): y
Delete all Users (except OWNER)? (y/n): y
Delete all Config (fields, options, shipping, sellers)? (y/n): n

============================================================
CONFIRMATION
============================================================

You chose to delete:
  ✓ Orders
  ✓ Clients
  ✓ Invoices
  ✓ Audit Logs
  ✓ Users (except OWNER)

⚠️  Proceed with deletion? (yes/no): yes
```

---

## 📋 Pre-Cleanup Checklist

### 1. Backup Your Database (IMPORTANT!)

**In Supabase:**
```
1. Go to Supabase Dashboard
2. Click on your project
3. Go to Database → Backups
4. Click "Create Backup"
5. Wait for completion
```

**Or export manually:**
```bash
# Using pg_dump
pg_dump -h db.bmolvybsqzkeswkomgzw.supabase.co \
  -U postgres \
  -d postgres \
  -F c \
  -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### 2. Verify Database Connection

```bash
# Check which database you're connected to
echo $DATABASE_URL
```

Make sure it's the correct database!

### 3. Check Current Data Count

```bash
# See how much data you have
node scripts/check-database-stats.js
```

---

## 🛡️ Safety Features

Both scripts include:
- ✅ Confirmation prompts
- ✅ Database connection verification
- ✅ Display of what will be deleted
- ✅ Summary of deleted records
- ✅ Error handling
- ✅ Graceful exits

---

## 📊 What Happens After Cleanup?

### Database State:
- ✅ All tables exist (schema intact)
- ✅ All indexes intact
- ✅ All relationships intact
- ✅ Zero data (empty tables)

### First User Sign-Up:
1. User visits `/landing`
2. Clicks "Get Started"
3. Signs up with email or Google
4. **New tenant automatically created**
5. User becomes OWNER of new tenant
6. Can start using the system immediately

---

## 🔄 Common Workflows

### Before Production Launch:
```bash
# 1. Backup current database
supabase db dump

# 2. Complete cleanup
node scripts/clean-database.js

# 3. Deploy to production
git push

# 4. Test first user sign-up
```

### Clean Test Data Only:
```bash
# 1. Run selective cleanup
node scripts/clean-database-selective.js

# 2. Choose: Orders (y), Clients (y), Audit (y)
# 3. Choose: Users (n), Config (n), Inventory (n)

# This keeps your account and configuration
```

### Reset Everything for Testing:
```bash
# 1. Complete cleanup
node scripts/clean-database.js

# 2. Seed test data (if you have seed script)
node scripts/seed-test-data.js
```

---

## 🐛 Troubleshooting

### Error: "Cannot reach database server"
**Fix:** Check your DATABASE_URL in `.env.local`

### Error: "EPERM: operation not permitted"
**Fix:** Stop your dev server first:
```bash
# Press Ctrl+C to stop server
# Then run cleanup script
```

### Error: "Foreign key constraint failed"
**Fix:** Tables are deleted in dependency order automatically. If this occurs, report it as a bug.

### Script Hangs or Freezes
**Fix:** Press Ctrl+C to cancel, then try again.

---

## 📝 Additional Cleanup Scripts

### Check Database Stats (No Deletion):
```bash
# See how many records in each table
node scripts/check-database-stats.js
```

### Delete Specific Tenant Data:
```bash
# Delete all data for a specific tenant
node scripts/delete-tenant-data.js <tenant-id>
```

---

## ✅ Post-Cleanup Verification

After cleanup, verify:

```bash
# 1. Check database is empty
node scripts/check-database-stats.js

# Expected output:
# Tenants: 0
# Users: 0
# Orders: 0
# ...

# 2. Start dev server
npm run dev

# 3. Test sign-up flow
# Visit: http://localhost:3000/landing
# Click "Get Started"
# Create account
# Verify redirect to /home

# 4. Check new tenant created
node scripts/check-database-stats.js

# Expected output:
# Tenants: 1
# Users: 1
# Memberships: 1
```

---

## 🎯 Production Deployment Flow

### Recommended Steps:

1. **Backup Production DB**
   ```bash
   # In Supabase Dashboard → Backups → Create Backup
   ```

2. **Run Cleanup Locally First**
   ```bash
   # Test on local/dev database
   node scripts/clean-database.js
   ```

3. **Deploy Code to Production**
   ```bash
   git push
   ```

4. **Clean Production Database**
   ```bash
   # Update .env.local to production DATABASE_URL
   # OR run script on production (Vercel CLI)
   node scripts/clean-database.js
   ```

5. **Test First User Sign-Up**
   - Visit production URL
   - Sign up with real account
   - Verify everything works

6. **Restore .env.local**
   ```bash
   # Switch back to local database
   ```

---

## 🔒 Security Notes

- ✅ Scripts use Prisma (safe, parameterized queries)
- ✅ No SQL injection risk
- ✅ Requires explicit confirmation
- ✅ Can't be run accidentally
- ⚠️ Still destructive - use with caution

---

## 📞 Need Help?

If cleanup fails or data is not deleted:
1. Check Vercel/Supabase logs
2. Verify database connection
3. Try selective cleanup instead
4. Contact support with error logs

---

**Your database is now ready for a clean production launch! 🚀**

