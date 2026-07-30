# BETSY CRM - Complete Documentation

**Version:** 2.0.0  
**Last Updated:** December 2024  
**Tech Stack:** Next.js 14, TypeScript, Prisma, PostgreSQL, NextAuth.js, TailwindCSS

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Technology Stack](#2-architecture--technology-stack)
3. [Getting Started](#3-getting-started)
4. [Database Schema](#4-database-schema)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Multi-Tenancy Architecture](#6-multi-tenancy-architecture)
7. [API Documentation](#7-api-documentation)
8. [AI Bot Setup (Telegram & WhatsApp)](#8-ai-bot-setup)
9. [Meta App Verification](#9-meta-app-verification)
10. [Deployment](#10-deployment)
11. [File Structure](#11-file-structure)

---

## 1. Project Overview

**Betsy CRM** is a comprehensive multi-tenant SaaS platform designed for order management, sales tracking, production workflows, and customer relationship management. Built for small and medium businesses in Costa Rica and Central America.

### Core Capabilities

- **Order Management** - EA/RA order types with custom fields
- **Sales Module** (`/ventas`) - Order creation, tracking, filtering
- **Production Module** (`/produccion`) - Production workflow management
- **Statistics Dashboard** (`/estadisticas`) - Analytics and reporting
- **Client Management** - Customer database with auto-generation from orders
- **Inventory Management** - Stock tracking, SKU management
- **AI Sales Assistant** - Telegram & WhatsApp bot for voice/text commands
- **Social Media Integration** - Instagram DMs, WhatsApp
- **Billing & Subscriptions** - Tilopay payment integration

### Unique Value Proposition

Betsy is the **ONLY CRM** that lets you manage your entire business by talking to an AI assistant on Telegram or WhatsApp using natural Spanish voice/text commands.

---

## 2. Architecture & Technology Stack

### Frontend
- **Framework:** Next.js 14.0.4 (App Router)
- **UI Library:** React 18.2.0
- **Styling:** TailwindCSS 3.3.6 with Radix UI primitives
- **State Management:** React Context (TenantSettingsContext)
- **Charts:** Recharts 3.3.0
- **Animations:** Framer Motion 12.23.24

### Backend
- **Runtime:** Node.js 18.18.0+ (Edge Runtime for middleware)
- **API Framework:** Next.js API Routes (App Router)
- **Database:** PostgreSQL (via Prisma ORM 6.17.1)
- **Authentication:** NextAuth.js 4.24.11 (JWT strategy)
- **Email:** Resend 6.4.0
- **File Storage:** Vercel Blob 2.0.0
- **Validation:** Zod 3.23.8

### External Integrations
- **Payments:** Tilopay (Costa Rican gateway) - SDK v2, recurring subscriptions
- **Social:** Instagram Graph API, WhatsApp Cloud API
- **AI:** OpenAI GPT-4o for bot intelligence
- **Redis:** Upstash for conversation memory

---

## 3. Getting Started

### Local Development Setup

```bash
# Clone and install
npm install

# Configure environment
cp env-template-local.txt .env
# Edit .env with your database URL, secrets, etc.

# Generate Prisma client (schema is already applied on shared Supabase)
npx prisma generate

# Do NOT run prisma db push / migrate against shared Supabase — it can DROP
# logistics lm_* tables that are not in schema.prisma. Local throwaway DBs only:
#   npm run db:push   # guarded; refuses Supabase and any DB with lm_* tables

# Start development server
npm run dev
```

### Required Environment Variables

```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Authentication
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Payments (Tilopay)
TILOPAY_API_KEY=...
TILOPAY_USER=...
TILOPAY_PASSWORD=...
TILOPAY_BASE_URL=https://api.tilopay.com
TILOPAY_WEBHOOK_SECRET=...

# AI Bot
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Social
META_APP_ID=...
META_APP_SECRET=...
```

### NPM Scripts

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm run lint         # Linting
npm run db:generate           # Generate Prisma client
npm run db:push               # Guarded prisma db push (local only)
npm run backup:coverage       # Verify lm_* allowlist vs code refs
npm run test:backups          # Backup unit + coverage tests
npm run test:backup-roundtrip # Local Postgres backup→restore proof
npm run db:studio             # Prisma Studio
```

---

## 4. Database Schema

### Multi-Tenancy Models

**Tenant** - Core tenant entity with subscription management
- Fields: `id`, `name`, `slug`, `plan` (FREE/BASIC/PRO/ENTERPRISE)
- Billing: `tilopaySubscriptionId`, `subscriptionStatus`, `trialEndsAt`

**Membership** - User-tenant relationship with roles
- Roles: OWNER, ADMIN, MANAGER, SALES, PRODUCTION, VIEWER
- Unique constraint: `[userId, tenantId]`

**User** - Global user entity (not tenant-scoped)
- Fields: `email` (unique), `password` (bcrypt), `active`
- OAuth support: `provider`, `providerId`

### Core Business Models

**Order** - Primary business entity
- Types: EA (Envío a Domicilio), RA (Retiro en Local)
- Fields: `orderId`, `status`, `customerName`, `product`, `total`
- Dynamic: `customFields` (JSON) for tenant-defined fields
- Indexes: `[tenantId, orderId]`, `[tenantId, status]`

**Client** - Customer database with auto-generation
- Analytics: `totalOrders`, `totalSpent`, `averageOrderValue`

**InventoryItem** - Stock management with SKU tracking

### Configuration Models

- **ProductOptionSet** - Reusable option sets (Size, Color)
- **ProductOption** - Individual options with price deltas
- **ProductField** - Dynamic product fields for order forms
- **OrderStatus** - Tenant-defined order statuses

### Audit & Logging

**AuditLog** - Comprehensive audit trail
- Actions: CREATE, UPDATE, DELETE, BULK_*, LOGIN, LOGOUT, EXPORT
- Stores: `oldValues`, `newValues`, `userId`, `userName`, `ipAddress`

---

## 5. Authentication & Authorization

### Authentication System

- **Providers:** Credentials, Google OAuth
- **Strategy:** JWT (24-hour sessions)
- **Session Data:** `id`, `email`, `role`, `tenantId`, `membershipRole`, `currentTenant`

### Role-Based Access Control (RBAC)

| Role | Access |
|------|--------|
| OWNER | Full access + billing + tenant management |
| ADMIN | Full access except billing |
| MANAGER | Sales + Production + Statistics |
| SALES | `/ventas` only (create/update orders) |
| PRODUCTION | `/produccion` only (update status) |
| VIEWER | Read-only access |

### Middleware Protection

- Public routes: `/auth/*`, `/landing`, `/home`, `/api/auth/*`, webhooks
- Admin routes: `/admin/*` (MASTER only)
- Trial/subscription enforcement: Redirects to billing if expired

---

## 6. Multi-Tenancy Architecture

### Tenant Isolation Strategy

**Database Level**
- All tenant-scoped models have `tenantId` field
- Unique constraints include `tenantId`
- Cascade deletes on tenant removal

**Application Level**
- Prisma extensions auto-inject `tenantId` in queries
- Context-based isolation via AsyncLocalStorage pattern

```typescript
// Set tenant context
await withTenantContext({ tenantId, userId, role }, async () => {
  const orders = await prisma.order.findMany(); // Auto-filtered by tenant
});

// System operations (bypass isolation)
await withoutTenantIsolation(async () => {
  // Can access all tenants (for admin operations)
});
```

---

## 7. API Documentation

### Authentication

All API endpoints require authentication via API key or session.

**Headers:**
```
x-api-key: your-api-key-here
Content-Type: application/json
```

### Rate Limits

| Plan | Limit |
|------|-------|
| Free | 100 requests/hour |
| Basic | 1,000 requests/hour |
| Pro | 10,000 requests/hour |
| Enterprise | Unlimited |

### Core Endpoints

#### Create Order
```
POST /api/integration/orders/create

{
  "orderId": "ORDER-12345",
  "customer": {
    "name": "Juan Pérez",
    "phone": "88888888",
    "email": "juan@example.com"
  },
  "product": {
    "name": "Camiseta Personalizada",
    "quantity": 2,
    "unitPrice": "₡15.000"
  },
  "shipping": {
    "cost": "₡3.500",
    "courier": "Correos de Costa Rica",
    "address": {
      "province": "San José",
      "canton": "San José",
      "district": "Carmen",
      "fullAddress": "Avenida Central, 100m sur"
    }
  },
  "total": "₡33.500"
}
```

#### Check Order Status
```
GET /api/integration/orders/check?orderId=ORDER-12345
```

#### Update Order Status
```
POST /api/integration/orders/status

{
  "orderId": "ORDER-12345",
  "status": "Enviado"
}
```

#### Generate Shipping Guía
```
POST /api/integration/guia/generate

{
  "orderIds": ["ORDER-12345", "ORDER-12346"],
  "carrier": "correos_cr",
  "deliveryType": "Domicilio"
}
```

### Error Handling

All endpoints return standard HTTP status codes:
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `404` - Not Found
- `409` - Conflict (duplicate)
- `429` - Too Many Requests
- `500` - Internal Server Error

---

## 8. AI Bot Setup

### Telegram Setup

#### Step 1: Create Bot
1. Open Telegram, search for **@BotFather**
2. Send `/newbot` command
3. Set name: "Betsy AI" and username: "BetsyAIBot"
4. Save the **API token**

#### Step 2: Environment Variables
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_USERNAME=BetsyAIBot
TELEGRAM_WEBHOOK_SECRET=random_secret_string
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4o-mini
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token
```

#### Step 3: Set Webhook
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/bot/telegram/webhook"
```

#### Step 4: Connect Users
1. Users send `/start` to the bot
2. Bot asks for access code (from Config → AI Assistant)
3. User enters 12-character code
4. Session is created

### WhatsApp Setup

#### Prerequisites
- Meta Business Account
- WhatsApp Business Account
- Meta Developer Account

#### Step 1: Create Meta App
1. Go to developers.facebook.com/apps
2. Create Business app
3. Add WhatsApp product

#### Step 2: Environment Variables
```env
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_verify_token
```

#### Step 3: Configure Webhook
- Callback URL: `https://yourdomain.com/api/bot/whatsapp/webhook`
- Verify Token: Same as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to: `messages`

### AI Commands

| Command | Description |
|---------|-------------|
| `create_order` | Create new orders with voice or text |
| `get_orders` | Search and list orders with filters |
| `update_order_status` | Change order status |
| `search_inventory` | Check product stock levels |
| `get_statistics_summary` | Sales reports and metrics |
| `search_clients` | Find customer information |

### Example Voice Commands

- *"¿Cuántas órdenes tengo pendientes?"*
- *"Crea orden para María García, 2 camisetas, 25 mil colones"*
- *"Muéstrame las ventas de esta semana"*
- *"¿Cuántas camisetas azules hay en inventario?"*

---

## 9. Meta App Verification

### Required URLs

| Setting | URL |
|---------|-----|
| Privacy Policy | `https://DOMAIN/privacy` |
| Terms of Service | `https://DOMAIN/terms` |
| Data Deletion Request | `https://DOMAIN/api/auth/instagram/data-deletion` |
| Webhook Callback | `https://DOMAIN/api/chat/webhook` |
| OAuth Redirect URI | `https://DOMAIN/api/auth/instagram/callback` |

### Required Permissions

| Permission | Purpose |
|------------|---------|
| `instagram_basic` | Access basic account info |
| `instagram_manage_messages` | Read/send DMs |
| `pages_show_list` | List linked FB pages |
| `business_management` | Access business settings |

### Demo Video Requirements

1. Login Flow: User connecting Instagram Business account
2. Receiving Messages: Show incoming DM in CRM
3. Sending Messages: Reply from CRM
4. Data Management: Show disconnect option
5. Privacy/Terms Links: Show accessibility

---

## 10. Deployment

### Vercel Configuration

**Build Settings:**
- Framework: Next.js
- Build Command: `npm run build`
- Output: Standalone
- Node Version: 18.18.0+

**Cron Jobs:**
- Full backup: Daily 02:00 UTC (`/api/cron/backup`) — all `public` tables + DDL
- Hot backup: Daily 14:00 UTC (`/api/cron/backup/hot`) — high-churn CRM + all `lm_*`
- Subscription Expiry: Daily at 2 AM (`/api/cron/process-subscription-expiry`)

**Function Configuration:**
- API routes: 30s max duration (backup routes: 300s)
- Region: `sfo1`

### Database

- PostgreSQL via Supabase
- Connection pooling via `DATABASE_URL`
- Direct connection via `DIRECT_URL` (backups prefer `BACKUP_DATABASE_URL` or `DIRECT_URL`)

### Backups (primary DR — private Vercel Blob)

We do **not** rely on paid Supabase PITR. App-owned backups are the recovery path.

- Format v1 under `betsy/backups/v1/` (private Blob objects + manifests)
- Discovers every `public` table (including all logistics `lm_*`)
- Stores gzip JSONL data + live DDL (`schema/pre.sql.gz`, `schema/post.sql.gz`)
- Fingerprint reuse skips re-upload when watermarked tables are unchanged
- Retention default: 14 days (`BACKUP_RETENTION_DAYS`)
- Auth: `CRON_SECRET` (GET cron), `BACKUP_API_KEY` required (POST manual)
- Restore CLI (loopback only by default):
  `npx tsx scripts/restore-from-backup.ts list|verify|restore <runId> --apply`
  Requires `RESTORE_DATABASE_URL` (never defaults to `DATABASE_URL`)
- Coverage: `npm run backup:coverage` / `npm run test:backup-roundtrip`
- Env: `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `BACKUP_API_KEY`, `BACKUP_RETENTION_DAYS`

---

## 11. File Structure

```
Betsy/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app/
│   │   ├── api/               # API routes (100+ files)
│   │   ├── auth/              # Auth pages
│   │   ├── config/            # Configuration
│   │   ├── dashboard/         # Dashboard
│   │   ├── ventas/            # Sales module
│   │   ├── produccion/        # Production module
│   │   ├── estadisticas/      # Statistics
│   │   └── chats/             # Chat interface
│   ├── lib/
│   │   ├── db.ts              # Prisma client
│   │   ├── prisma-tenant.ts   # Tenant-aware Prisma
│   │   ├── tenantContext.ts   # Tenant context
│   │   ├── auth-options.ts    # NextAuth config
│   │   ├── rbac.ts            # Access control
│   │   └── bot/               # AI bot modules
│   └── middleware.ts          # Request middleware
├── public/                    # Static assets
├── scripts/                   # Utility scripts
└── docs/                      # Additional docs
```

---

## Summary Statistics

- **Total API Routes:** 100+
- **Database Models:** 25+
- **Frontend Pages:** 20+
- **React Components:** 100+
- **Dependencies:** 50+ npm packages
- **Lines of Code:** ~50,000+ (estimated)

---

## Support

- **Email:** support@betsycrm.com
- **Website:** https://www.betsycrm.com

---

*End of Documentation*

