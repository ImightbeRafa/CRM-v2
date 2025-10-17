# Quick Start Guide for Testing

## Initial Setup

1. **Start the Development Server**
   ```bash
   npm run dev
   ```

2. **Access the Application**
   Open http://localhost:3000 in your browser

## Quick Test Data Setup

### Option 1: Using the Seed Script (Recommended)

```bash
# Populate test data
node scripts/seed-test-data.js populate

# Or simply
node scripts/seed-test-data.js
```

This will create:
- 4 test users (1 master + 3 regular)
- 4 sellers
- 3 shipping methods
- 3 option sets with multiple options
- 7 product fields
- 3 sample orders

### Option 2: Using API Calls

Open your browser console or use curl:

```javascript
// Populate test data
await fetch('http://localhost:3000/api/seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'populate' })
})
```

## Test Accounts

After seeding, you can login with:

| Username | Password | Role |
|----------|----------|------|
| master | master123 | MASTER |
| user1 | user1123 | REGULAR |
| user2 | user2123 | REGULAR |
| user3 | user3123 | REGULAR |

## Testing User Management (Master Only)

1. **Login as Master**
   - Username: `master`
   - Password: `master123`

2. **Navigate to Configuration**
   - Go to http://localhost:3000/config

3. **User Management Features**
   - View all users
   - Create new users
   - Edit existing users
   - Delete users (except master)
   - Toggle user active/inactive status

## Testing Regular User Access

1. **Login as Regular User**
   - Username: `user1`
   - Password: `user1123`

2. **Verify Access**
   - ✅ Can access: Sales, Orders, Statistics, Production
   - ❌ Cannot access: User Management section
   - ❌ Cannot access: Data Seeding tools

## Creating Users via API

### Create a New Regular User

```javascript
const response = await fetch('http://localhost:3000/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'newuser',
    password: 'secure123',
    role: 'REGULAR'  // Optional, defaults to REGULAR
  })
})

const result = await response.json()
console.log(result)
```

### Update User Password

```javascript
const userId = 'user-id-here'
const response = await fetch(`http://localhost:3000/api/users/${userId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    password: 'newpassword123'
  })
})

const result = await response.json()
console.log(result)
```

### Delete a User

```javascript
const userId = 'user-id-here'
const response = await fetch(`http://localhost:3000/api/users/${userId}`, {
  method: 'DELETE'
})

const result = await response.json()
console.log(result)
```

## Resetting All Data

⚠️ **WARNING**: This will delete ALL data including users, orders, products, etc.

### Option 1: Using Script

```bash
node scripts/seed-test-data.js reset
```

### Option 2: Using API

```javascript
await fetch('http://localhost:3000/api/seed', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'reset' })
})
```

## Complete Workflow Example

### 1. Fresh Start

```bash
# Reset everything
node scripts/seed-test-data.js reset

# Populate with test data
node scripts/seed-test-data.js populate
```

### 2. Login and Test

```
1. Open http://localhost:3000
2. Login with: master / master123
3. Go to /config to see user management
4. Test creating a new user
5. Logout and login with the new user
6. Verify the new user has appropriate access
```

### 3. Test Product Configuration

```
1. Login as master
2. Go to /config
3. Create product fields
4. Create option sets
5. Add options to sets
6. Test in /ventas to see dynamic form
```

### 4. Test Order Management

```
1. Go to /ventas
2. Create a new sale with test data
3. Check /produccion to see order
4. Update order status
5. Check /estadisticas for analytics
```

## Troubleshooting

### "Module not found" errors
```bash
npm install
```

### Database is locked
```bash
# Stop the dev server
# Delete prisma/dev.db.lock
# Restart dev server
npm run dev
```

### Need to rebuild Prisma client
```bash
npx prisma generate
```

### Start completely fresh
```bash
# Delete the database
rm prisma/dev.db

# Run migrations
npx prisma migrate dev

# Seed test data
node scripts/seed-test-data.js populate
```

## API Endpoints Reference

### User Management
- `GET /api/users` - List all users
- `POST /api/users` - Create user
- `PUT /api/users/[id]` - Update user
- `DELETE /api/users/[id]` - Delete user

### Data Seeding
- `POST /api/seed` with `{ "action": "reset" }` - Reset all data
- `POST /api/seed` with `{ "action": "populate" }` - Populate test data

### Configuration
- `GET /api/config/fields` - Get product fields
- `POST /api/config/fields` - Create field
- `GET /api/config/option-sets` - Get option sets
- `POST /api/config/option-sets` - Create option set
- And more...

## Next Steps

1. ✅ Review the USER_MANAGEMENT_GUIDE.md for detailed documentation
2. ✅ Test user creation and management
3. ✅ Configure your product fields and options
4. ✅ Start creating real orders
5. ✅ Customize the system to your business needs

## Support

For more information, see:
- `USER_MANAGEMENT_GUIDE.md` - Detailed user management documentation
- `README.md` - General project documentation

