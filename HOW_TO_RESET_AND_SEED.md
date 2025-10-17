# How to Reset All Data and Quickly Populate Test Data

## Quick Reference

### Reset Everything
```bash
node scripts/seed-test-data.js reset
```

### Add Test Data
```bash
node scripts/seed-test-data.js populate
```

### Reset + Populate (Complete Fresh Start)
```bash
node scripts/seed-test-data.js reset && node scripts/seed-test-data.js populate
```

---

## Step-by-Step Instructions

### Method 1: Using the Seed Script (Easiest)

#### Prerequisites
1. Development server must be running:
   ```bash
   npm run dev
   ```

#### To Reset All Data

1. Open a new terminal window
2. Navigate to the project directory
3. Run:
   ```bash
   node scripts/seed-test-data.js reset
   ```
4. Confirm when prompted
5. ✅ All data is now deleted

#### To Populate Test Data

1. Ensure dev server is running
2. Run:
   ```bash
   node scripts/seed-test-data.js populate
   ```
3. Wait for confirmation
4. ✅ Test data is now loaded

#### What Gets Created?

**4 Test Users:**
- `master` / `master123` (MASTER role)
- `user1` / `user1123` (REGULAR role)
- `user2` / `user2123` (REGULAR role)
- `user3` / `user3123` (REGULAR role)

**4 Sellers:**
- Juan Pérez
- María García
- Carlos López
- Ana Rodríguez

**3 Shipping Methods:**
- Envío Estándar (Free)
- Envío Express (₡5,000)
- Recogida en Tienda (Free)

**3 Option Sets with Multiple Options:**
- **Colores** (6 options)
  - Rojo, Azul, Verde, Negro, Blanco
  - Dorado (+₡2,000)
  
- **Tamaños** (4 options)
  - Pequeño (₡0)
  - Mediano (+₡1,000)
  - Grande (+₡2,000)
  - Extra Grande (+₡3,000)
  
- **Materiales** (4 options)
  - Algodón (₡0)
  - Poliester (+₡500)
  - Lino (+₡1,500)
  - Seda (+₡5,000)

**7 Product Fields:**
- Nombre del Producto (text, required)
- Color (select, required)
- Tamaño (select, required)
- Material (select, optional)
- Cantidad (number, required)
- ¿Es personalizado? (boolean, optional)
- Comentarios Adicionales (text, optional)

**3 Sample Orders:**
- EA-2024-001 (Completed)
- RA-2024-001 (In Process)
- EA-2024-002 (Pending)

---

### Method 2: Using Browser Console

#### To Reset All Data

1. Open your browser to http://localhost:3000
2. Open Developer Tools (F12)
3. Go to Console tab
4. Paste and run:
   ```javascript
   fetch('/api/seed', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ action: 'reset' })
   }).then(r => r.json()).then(console.log)
   ```
5. ✅ All data is deleted

#### To Populate Test Data

1. In the same console, run:
   ```javascript
   fetch('/api/seed', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ action: 'populate' })
   }).then(r => r.json()).then(console.log)
   ```
2. ✅ Test data is loaded

---

### Method 3: Using curl (Command Line)

#### To Reset All Data
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{"action":"reset"}'
```

#### To Populate Test Data
```bash
curl -X POST http://localhost:3000/api/seed \
  -H "Content-Type: application/json" \
  -d '{"action":"populate"}'
```

---

## Complete Fresh Start Workflow

### Scenario: I Want to Start Completely Fresh

```bash
# 1. Start the dev server
npm run dev

# 2. In another terminal, reset everything
node scripts/seed-test-data.js reset

# 3. Populate with test data
node scripts/seed-test-data.js populate

# 4. Done! Now login with:
#    Username: master
#    Password: master123
```

---

## Verification Steps

### After Populating Data

1. **Check Users Created**
   - Open browser console
   - Run: `fetch('/api/users').then(r => r.json()).then(console.log)`
   - Should see 4 users

2. **Check Sellers Created**
   - Run: `fetch('/api/config/sellers').then(r => r.json()).then(console.log)`
   - Should see 4 sellers

3. **Check Orders Created**
   - Go to http://localhost:3000/produccion
   - Should see 3 sample orders

4. **Check Product Fields**
   - Go to http://localhost:3000/config
   - Should see 7 configured fields

5. **Test Login**
   - Go to http://localhost:3000/auth/signin
   - Login with `master` / `master123`
   - Should be able to access all pages

---

## Troubleshooting

### Error: "Cannot find module"
**Solution:** Make sure you're in the correct directory
```bash
cd /path/to/Betsy
node scripts/seed-test-data.js populate
```

### Error: "Failed to seed data"
**Solution:** Make sure dev server is running
```bash
# Terminal 1
npm run dev

# Terminal 2
node scripts/seed-test-data.js populate
```

### Error: "ECONNREFUSED"
**Solution:** Dev server is not running or is on a different port
```bash
# Check if server is running
# Default is http://localhost:3000
npm run dev
```

### Database is Locked
**Solution:** Stop the dev server and try again
```bash
# Stop the server (Ctrl+C)
# Delete the lock file
rm prisma/dev.db.lock
# Restart
npm run dev
```

### Want to Delete the Database Completely
```bash
# Stop the dev server
# Delete the database file
rm prisma/dev.db

# Run migrations to recreate
npx prisma migrate dev

# Populate test data
node scripts/seed-test-data.js populate
```

---

## Advanced: Custom Test Data

### Create Your Own Seeding Script

Create `scripts/my-custom-seed.js`:

```javascript
async function myCustomSeed() {
  // First reset
  await fetch('http://localhost:3000/api/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reset' })
  })
  
  // Then populate
  await fetch('http://localhost:3000/api/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'populate' })
  })
  
  // Add your custom data here...
  await fetch('http://localhost:3000/api/config/sellers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'My Custom Seller' })
  })
  
  console.log('Custom seed complete!')
}

myCustomSeed()
```

Run with:
```bash
node scripts/my-custom-seed.js
```

---

## Best Practices

### For Development
1. Use `populate` at the start of each dev session
2. Use `reset` only when you need to clean up
3. Don't commit `dev.db` to git (already in .gitignore)

### For Testing
1. Always `reset` before running tests
2. Always `populate` after reset for consistent state
3. Use test accounts, not real user data

### For Production
1. **Never use reset in production!**
2. **Never use default test passwords!**
3. Create real users through the UI/API
4. Backup your database regularly

---

## Summary

**Quickest Way to Get Started:**
```bash
npm run dev                              # Terminal 1
node scripts/seed-test-data.js populate  # Terminal 2
```

**Login:**
- Username: `master`
- Password: `master123`

**Reset Everything:**
```bash
node scripts/seed-test-data.js reset
```

**Complete Fresh Start:**
```bash
node scripts/seed-test-data.js reset
node scripts/seed-test-data.js populate
```

That's it! You're ready to test the CRM with realistic data.

