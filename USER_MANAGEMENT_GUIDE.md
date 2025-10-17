# User Management & Data Seeding Guide

## Overview

This CRM now includes a complete user management system and data seeding capabilities for testing.

## User Management

### User Roles

- **MASTER**: Full access to all features including user management and system configuration
- **REGULAR**: Access to all features except:
  - User management
  - System data reset
  - Data seeding

### API Endpoints

#### Get All Users
```
GET /api/users
```
Returns list of all users (master only)

#### Create New User
```
POST /api/users
Body: {
  username: string,
  password: string,
  role: "MASTER" | "REGULAR" (optional, defaults to REGULAR)
}
```

#### Update User
```
PUT /api/users/[id]
Body: {
  username?: string,
  password?: string,
  role?: "MASTER" | "REGULAR",
  active?: boolean
}
```

#### Delete User
```
DELETE /api/users/[id]
```
Note: Cannot delete master users

### Password Requirements
- Minimum 6 characters
- Passwords are hashed using bcrypt with salt rounds of 12

## Data Seeding System

### Reset All Data
```
POST /api/seed
Body: { action: "reset" }
```

This will DELETE ALL DATA:
- Orders
- Product options
- Product option sets
- Product fields
- Shipping methods
- Sellers
- Users

⚠️ **WARNING**: This action cannot be undone!

### Populate Test Data
```
POST /api/seed
Body: { action: "populate" }
```

This will create:
- **4 Users**:
  - master (password: master123) - MASTER role
  - user1 (password: user1123) - REGULAR role
  - user2 (password: user2123) - REGULAR role
  - user3 (password: user3123) - REGULAR role

- **4 Sellers**:
  - Juan Pérez
  - María García
  - Carlos López
  - Ana Rodríguez

- **3 Shipping Methods**:
  - Envío Estándar (₡0)
  - Envío Express (₡5,000)
  - Recogida en Tienda (₡0)

- **3 Option Sets**:
  - Colores Disponibles (6 colors including gold with ₡2,000 premium)
  - Tamaños (4 sizes with progressive pricing)
  - Materiales (4 materials with varying prices)

- **7 Product Fields**:
  - Nombre del Producto (text, required)
  - Color (select, required)
  - Tamaño (select, required)
  - Material (select, optional)
  - Cantidad (number, required)
  - ¿Es personalizado? (boolean, optional)
  - Comentarios Adicionales (text, optional)

- **3 Sample Orders**:
  - EA-2024-001 (Completed, delivered)
  - RA-2024-001 (In process, pending)
  - EA-2024-002 (Pending, in process)

## Testing Workflow

### Quick Start with Test Data

1. **Reset Database** (if needed):
   ```bash
   POST /api/seed with { "action": "reset" }
   ```

2. **Populate Test Data**:
   ```bash
   POST /api/seed with { "action": "populate" }
   ```

3. **Login with Test Accounts**:
   - Master: `master` / `master123`
   - Regular: `user1` / `user1123`

### Manual Testing Steps

1. **Login as Master**
   - Access `/config` to see all configuration options
   - View user management section
   - Create/edit/delete users
   - Test data seeding functionality

2. **Login as Regular User**
   - Verify access to sales, orders, statistics
   - Verify NO access to user management
   - Verify NO access to data seeding

3. **Test User Creation**:
   ```javascript
   fetch('/api/users', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       username: 'testuser',
       password: 'test123',
       role: 'REGULAR'
     })
   })
   ```

4. **Test User Update**:
   ```javascript
   fetch('/api/users/[user-id]', {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       password: 'newpassword123'
     })
   })
   ```

## Database Schema

### User Model
```prisma
model User {
  id        String   @id @default(cuid())
  username  String   @unique
  password  String   // Hashed with bcrypt
  role      UserRole @default(REGULAR)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum UserRole {
  MASTER
  REGULAR
}
```

## Security Notes

1. **Passwords**: All passwords are hashed using bcrypt before storage
2. **Master Protection**: Master users cannot be deleted via API
3. **Username Uniqueness**: Usernames must be unique across the system
4. **Session Management**: Use NextAuth for session handling

## Troubleshooting

### "Cannot delete master user"
- This is by design. Master users are protected from deletion.

### "User already exists"
- Username must be unique. Choose a different username.

### "Password must be at least 6 characters"
- Ensure passwords meet minimum length requirement.

### Data seeding fails
- Check database connection
- Ensure no foreign key constraints are violated
- Try resetting data first, then populating

## Future Enhancements

Potential improvements:
- Email verification for new users
- Password reset functionality
- User activity logging
- Role-based UI hiding/showing
- More granular permissions
- Multi-factor authentication
- Password complexity requirements
- Account lockout after failed attempts

