# Database Configuration - Quick Switch Guide

Your database is now properly configured! 🎉

---

## ✅ Current Setup: SQLite (Local Development)

Your `schema.prisma` is currently configured for local development with SQLite:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

**Benefits:**
- ✅ No database server needed
- ✅ Fast and simple
- ✅ Perfect for local development
- ✅ Data stored in `prisma/dev.db` file

---

## 🔄 Switching Between Configurations

### For Local Development (Current) - SQLite

**`prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

**After changing, run:**
```bash
npx prisma generate
npx prisma db push
npm run dev
```

---

### For Production Deploy - PostgreSQL

When deploying to production (Vercel), update to PostgreSQL:

**`prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_PRISM_POSTGRES_URL")
  directUrl = env("DATABASE_PRISM_POSTGRES_URL")
}
```

**Ensure `.env` has:**
```bash
DATABASE_PRISM_POSTGRES_URL="your-production-postgres-url"
```

**After changing, run:**
```bash
npx prisma generate
npx prisma db push
```

---

## 📝 Quick Commands

### Check Current Setup
```bash
npx prisma studio
# Opens http://localhost:5555 - browse your database
```

### Regenerate Client
```bash
npx prisma generate
```

### Sync Database
```bash
npx prisma db push
```

### Reset Database (Clear all data)
```bash
npx prisma db push --force-reset
```

### Seed Database with Sample Data
```bash
node scripts/full-seed.js
```

---

## 🎯 What's Working Now

✅ **Prisma Client Generated**  
✅ **Database In Sync**  
✅ **All Tables Created**  
✅ **Estadísticas API Ready**  

Your estadísticas dashboard should now work perfectly!

---

## 🧪 Test Your Setup

### 1. Prisma Studio is Running
Visit: **http://localhost:5555**
- You can browse all tables
- View/edit data directly

### 2. Test API Endpoints
```bash
# Summary endpoint
curl http://localhost:3000/api/estadisticas/summary

# Should return JSON (empty arrays if no data yet)
```

### 3. Visit Estadísticas Dashboard
Navigate to: **http://localhost:3000/estadisticas**
- Should load without errors
- KPIs show zeros (if no data)
- Charts render properly

---

## 🚀 Next Steps

1. **Keep SQLite for development** - It's working great!
2. **Only switch to PostgreSQL** when:
   - Deploying to production
   - Need advanced PostgreSQL features
   - Testing production-like environment

3. **Before deploying to production:**
   - Change schema.prisma back to PostgreSQL
   - Set DATABASE_PRISM_POSTGRES_URL in Vercel
   - Run build/deploy

---

## ⚠️ Important Notes

### Git Considerations

Your `.gitignore` should include:
```
.env
.env.local
prisma/dev.db
prisma/dev.db-journal
```

This prevents committing local database and secrets.

### Switching Databases

When switching from SQLite to PostgreSQL (or vice versa):
1. **Always run** `npx prisma generate` after changing provider
2. **Always run** `npx prisma db push` to sync schema
3. **Restart dev server** (`npm run dev`)

---

## 💡 Pro Tips

1. **Use SQLite for dev** - Fast and simple
2. **Use PostgreSQL for production** - Scalable and robust
3. **Prisma Studio** - Great for debugging data issues
4. **Keep schema.prisma in SQLite mode** - Commit this for team dev
5. **Only change to PostgreSQL** - In CI/CD or production deployments

---

## ✅ Verification Checklist

- [x] Prisma client generated successfully
- [x] Database synced (no errors)
- [x] Prisma Studio opens (http://localhost:5555)
- [x] Dev server runs without database errors
- [ ] Test `/estadisticas` page loads
- [ ] Test API endpoints return data

---

## 🐛 Troubleshooting

### "Database is locked"
SQLite issue - restart dev server.

### "Can't find Prisma Client"
Run: `npx prisma generate`

### "Environment variable not found"
- You're using SQLite now, so no env variables needed!
- If switching to PostgreSQL, add DATABASE_PRISM_POSTGRES_URL to .env

---

**Current Status:** ✅ **READY TO USE**

Your database is now properly configured for local development with SQLite!

**Date:** October 21, 2025

