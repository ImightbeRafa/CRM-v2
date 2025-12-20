# BetsyCRM 2.0.0 Roadmap

**Created:** December 12, 2025  
**Status:** Planning Phase  
**Goal:** Stabilize existing features, fix bugs, then enhance with AI-powered automation

---

## Table of Contents

1. [Current Architecture Overview](#current-architecture-overview)
2. [Phase 0: Immediate Blockers](#phase-0-immediate-blockers)
3. [Phase 1: Bug Pulverization & Stability](#phase-1-bug-pulverization--stability)
4. [Phase 2: Feature Reworks](#phase-2-feature-reworks)
5. [Phase 3: New Features](#phase-3-new-features)
6. [Database Schema Updates](#database-schema-updates)
7. [Implementation Dependencies](#implementation-dependencies)

---

## Current Architecture Overview

### Database Schema (PostgreSQL via Prisma)

**Core Multi-Tenancy Models:**
| Model | Purpose | Key Relations |
|-------|---------|---------------|
| `Tenant` | Organization/business account | Has memberships, orders, clients, inventory, social accounts, bot sessions |
| `Membership` | User-Tenant relationship with role | Links User ↔ Tenant with MemberRole |
| `User` | Individual user account | Has memberships, audit logs, social accounts, bot sessions |

**Business Models (all tenant-isolated):**
| Model | Purpose |
|-------|---------|
| `Order` | Sales orders (EA=delivery, RA=pickup) |
| `Client` | Customer records |
| `InventoryItem` | Product inventory |
| `Invoice` | Generated invoices linked to orders |
| `Seller` | Sales team members |
| `ShippingMethod` | Delivery options |
| `ShippingConfig` | Carrier credentials (Correos de CR) |
| `ShippingGuia` | Generated shipping labels with PDF storage |

**Configuration Models:**
| Model | Purpose |
|-------|---------|
| `ProductField` | Custom form fields per tenant |
| `ProductOptionSet` / `ProductOption` | Dropdown options |
| `OrderStatus` | Custom status workflow |
| `BusinessInfo` | Tenant business profile fields |

**Chat & Integration Models:**
| Model | Purpose |
|-------|---------|
| `SocialAccount` | Connected Instagram/WhatsApp accounts (Meta API) |
| `ChatMessage` | Inbound/outbound messages from social platforms |
| `BotSession` | Telegram/WhatsApp AI bot connections |
| `ApiKey` | External website integration keys |
| `IntegrationLog` | API activity logging |

**Billing & Audit:**
| Model | Purpose |
|-------|---------|
| `BillingTransaction` | Payment records |
| `UsageLog` | Feature usage tracking |
| `WebhookLog` | External webhook debugging |
| `AuditLog` | User action history |

### Authentication System

**Files:**
- `src/lib/auth-options.ts` - NextAuth configuration (Credentials + Google OAuth)
- `src/middleware.ts` - Route protection and tenant context injection
- `src/lib/tenantContext.ts` - AsyncLocalStorage for request-scoped tenant isolation
- `src/lib/prisma-tenant.ts` - Tenant-isolated Prisma client
- `src/lib/auth-helpers.ts` - Permission checking utilities

**Key Flows:**
1. **OAuth Sign-in:** Creates user + tenant + membership atomically
2. **Credentials Sign-in:** Validates bcrypt password, loads memberships
3. **JWT Callback:** Enriches token with tenant data, plan info, trial status
4. **Middleware:** Validates session, injects tenant context, enforces trial/subscription

**Role System (MemberRole enum):**
- `OWNER` - Full access including billing
- `ADMIN` - Full access except billing
- `MANAGER` - Sales + Production + Stats
- `SALES` - /ventas only
- `PRODUCTION` - /produccion only
- `VIEWER` - Read-only

### Chat Integrations

**Two Distinct Systems:**

1. **`/chats` Page (Social Media Management)**
   - Files: `src/app/chats/page.tsx`, `src/app/api/chat/*`
   - Purpose: Unified inbox for Instagram/WhatsApp messages via Meta API
   - Models: `SocialAccount`, `ChatMessage`
   - Status: Instagram receiving works, sending needs Advanced Access

2. **AI Assistant Bot (Telegram/WhatsApp)**
   - Files: `src/app/api/bot/telegram/*`, `src/app/api/bot/whatsapp/*`, `src/lib/bot/*`
   - Purpose: Standalone conversational bot for order management
   - Models: `BotSession`
   - Features: Natural language order creation, inventory queries, status updates
   - AI Tools: `src/lib/bot/ai-tools.ts` (create_order, get_orders, search_inventory, etc.)

---

## Phase 0: Immediate Blockers

**Priority: CRITICAL - Complete before anything else**

### 0.1 Meta Approval for Instagram/WhatsApp
- [ ] Complete Meta Business verification
- [ ] Record 2-3 min demo video (1080p) showing:
  - Login flow
  - /config social account connection
  - Receiving messages in /chats
  - Replying to messages
  - Message history
- [ ] Submit for Advanced Access review
- [ ] Verify privacy policy URLs in Meta App settings

### 0.2 Finish Latest Implementations
- [ ] Test invoice PDF generation (just fixed Puppeteer integration)
- [ ] Verify order ID fix in InvoiceGenerator (was passing display ID instead of DB UUID)
- [ ] Test Correos de Costa Rica guía generation end-to-end
- [ ] Verify tenant isolation with AsyncLocalStorage under concurrent load

---

## Phase 1: Bug Pulverization & Stability

**Priority: HIGH - Clean slate before new features**

### 1.1 Full Application Audit

**Authentication & Tenant Isolation:**
- [ ] Audit all API routes for proper `authenticateAPI()` usage
- [ ] Verify all Prisma queries use `getTenantPrisma(tenantId)`
- [ ] Test concurrent requests from different tenants
- [ ] Review `withoutTenantIsolation()` usage (should be rare)

**Known Issues to Investigate:**
- [ ] `url.parse()` deprecation warning (use WHATWG URL API)
- [ ] Invoice generation error handling improvements
- [ ] Shipping guía automation reliability
- [ ] Mobile responsiveness across all pages

**Performance Audit:**
- [ ] Identify slow API routes (add timing logs)
- [ ] Review database indexes for common queries
- [ ] Check for N+1 query patterns
- [ ] Optimize large list rendering (virtualization)

### 1.2 Known Bugs (User-Reported)

*Add specific bugs here as they're identified:*

Minor nitpicks (barely worth mentioning)Betsy Meets and AI Automation Builder are correctly deferred — perfect.
I would move “Voice input in /ventas” from Phase 2.2 to a “nice-to-have later” — it’s cool but not core.
Consider renaming “AI Automation Builder” → “Respuestas Automáticas” or “Bots Personalizados” in the UI when you get there. Spanish-speaking users will understand that better than “automation builder.”


| Bug ID | Description | Severity | Status |
|--------|-------------|----------|--------|
| BUG-001 | Invoice PDF was returning HTML instead of PDF | High | ✅ Fixed |
| BUG-002 | Order ID mismatch in InvoiceGenerator | High | ✅ Fixed |
| BUG-003 | | | |

### 1.3 Error Handling Improvements
- [ ] Standardize API error responses (use `createErrorResponse`)
- [ ] Add user-friendly error messages in Spanish
- [ ] Implement error boundary components for React
- [ ] Add Sentry or similar error tracking

### 1.4 Testing Infrastructure
- [ ] Set up basic integration tests for critical flows
- [ ] Create test tenant for automated testing
- [ ] Document manual QA checklist

---

## Phase 2: Feature Reworks

**Priority: MEDIUM - Enhance existing features**

### 2.1 Full Tenant Support for /chats

**Goal:** Each tenant manages their own social accounts independently

**Tasks:**
- [ ] Ensure OAuth flows store tokens per-tenant
- [ ] Filter webhook messages by tenant's connected accounts
- [ ] Add tenant-specific webhook endpoints if needed
- [ ] Real-time message notifications (WebSocket or polling)
- [ ] Keyboard shortcuts for power users

**Files to Update:**
- `src/app/api/auth/instagram/callback/route.ts`
- `src/app/api/auth/whatsapp/exchange/route.ts`
- `src/app/api/chat/webhook/route.ts`
- `src/app/chats/page.tsx`

### 2.2 AI-Powered /ventas Rework

**Goal:** Use AI (like the bot) to assist order creation in the web UI

**Tasks:**
- [ ] Add AI assistant panel to /ventas page
- [ ] Natural language order input ("Juan Pérez quiere 2 camisetas talla M")
- [ ] Auto-suggest existing clients by name/phone
- [ ] Auto-suggest inventory items
- [ ] Smart field population from pasted text (already partially exists)
- [ ] Voice input option (Web Speech API)

**Implementation:**
- Reuse `src/lib/bot/ai-tools.ts` tool definitions
- Create new AI chat component for web
- Stream responses for better UX

### 2.3 Enhanced Telegram/WhatsApp AI Bot

**Goal:** Improve bot reliability and add features

**Tasks:**
- [ ] Better error handling for failed tool calls
- [ ] Pending message reminders ("You have 3 unread messages")
- [ ] Context-aware follow-ups
- [ ] Multi-language support (Spanish primary)
- [ ] Rate limiting per user
- [ ] Admin commands for bot management

**Files:**
- `src/app/api/bot/telegram/webhook/route.ts`
- `src/app/api/bot/whatsapp/webhook/route.ts`
- `src/lib/bot/ai-tools.ts`
- `src/lib/bot/telegram-handler.ts` (if exists)

### 2.4 /chats Dashboard Enhancement

**Goal:** Full CRM actions from within chat conversations

**Tasks:**
- [ ] Modern UI redesign (cleaner, more compact)
- [ ] In-chat order creation widget
- [ ] In-chat inventory lookup
- [ ] Customer profile sidebar (link to Client record)
- [ ] Conversation status (pending, active, closed, archived)
- [ ] Quick replies / templates
- [ ] Keyboard navigation (arrow keys, shortcuts)

**New Fields for ChatMessage/Conversation:**
- `status` (enum: pending, active, closed, archived)
- `assignedTo` (user ID for team assignment)
- `linkedOrderId` (quick order reference)

---

## Phase 3: New Features

**Priority: LOW - After stability and reworks**

### 3.1 Betsy Meets (Online Services/Appointments)

**Goal:** Support service-based businesses (courses, consultations, appointments)

**Scope:**
- Service catalog management
- Booking/appointment scheduling
- Calendar integration
- Payment integration for services
- Reminders via bot/chat

**New Models:**
```prisma
model Service {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  description String?
  price       Float
  duration    Int      // minutes
  isActive    Boolean  @default(true)
  
  tenant      Tenant   @relation(...)
  appointments Appointment[]
}

model Appointment {
  id          String   @id @default(cuid())
  tenantId    String
  serviceId   String
  clientId    String?
  chatId      String?  // If booked via chat
  datetime    DateTime
  status      String   // scheduled, confirmed, completed, cancelled
  notes       String?
  
  tenant      Tenant   @relation(...)
  service     Service  @relation(...)
  client      Client?  @relation(...)
}
```

**Status:** DEFERRED - Consult external resources first

### 3.2 AI Automation Builder

**Goal:** Let users create custom chatbots/automations

**Scope:**
- Bot template library (appointment booking, product selling, FAQ)
- Visual flow builder (or simple rule-based)
- Auto-replies based on keywords
- Integration with inventory/orders for dynamic responses
- Analytics on bot performance

**New Models:**
```prisma
model ChatAutomation {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  type      String   // appointment, selling, faq, custom
  rules     Json     // Automation logic
  isActive  Boolean  @default(true)
  scope     String   // bot (AI assistant) or chats (social management)
  
  tenant    Tenant   @relation(...)
}
```

**Status:** DEFERRED - Requires solid foundation first

---

## Database Schema Updates

### Immediate (Phase 1-2)

**ChatMessage Enhancements:**
```prisma
model ChatMessage {
  // ... existing fields ...
  status        String?   // pending, read, replied
  source        String?   // social, bot (distinguish origin)
}
```

**New: Conversation Model (optional, for grouping):**
```prisma
model Conversation {
  id              String   @id @default(cuid())
  tenantId        String
  socialAccountId String
  contactId       String   // External user ID (IGSID, phone)
  contactName     String?
  status          String   @default("active") // active, pending, closed, archived
  lastMessageAt   DateTime
  unreadCount     Int      @default(0)
  assignedUserId  String?
  
  tenant          Tenant   @relation(...)
  socialAccount   SocialAccount @relation(...)
  messages        ChatMessage[]
}
```

### Future (Phase 3)

See Service and Appointment models above.

---

## Implementation Dependencies

```
Phase 0 (Blockers)
    │
    ▼
Phase 1 (Stability)
    │
    ├──► 1.1 Full Audit
    ├──► 1.2 Bug Fixes
    ├──► 1.3 Error Handling
    └──► 1.4 Testing
    │
    ▼
Phase 2 (Reworks) - Can be parallelized
    │
    ├──► 2.1 /chats Tenant Support ──────┐
    ├──► 2.2 AI /ventas ─────────────────┤
    ├──► 2.3 Bot Enhancements ───────────┤
    └──► 2.4 /chats Dashboard ───────────┘
    │                                    │
    │         All depend on Phase 1      │
    ▼                                    ▼
Phase 3 (New Features)
    │
    ├──► 3.1 Betsy Meets (requires 2.4)
    └──► 3.2 AI Automations (requires 2.3, 2.4)
```

---

## Tracking Progress

### Weekly Checkpoints

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | Phase 0 + 1.1 | Meta demo video, full audit complete |
| 2 | Phase 1.2-1.4 | All known bugs fixed, error handling improved |
| 3 | Phase 2.1 | /chats tenant isolation complete |
| 4 | Phase 2.2 | AI-powered /ventas MVP |
| 5 | Phase 2.3-2.4 | Bot improvements, /chats dashboard |
| 6+ | Phase 3 | New features as prioritized |

### Definition of Done

- [ ] Feature works on desktop and mobile
- [ ] Tenant isolation verified
- [ ] Error handling in place
- [ ] Spanish UI text
- [ ] No console errors
- [ ] Performance acceptable (<2s load times)

---

## Notes

- **Key Distinction:** `/chats` = social media inbox (Meta API), AI Bot = standalone assistant (Telegram/WhatsApp direct)
- **Tenant Isolation:** Always use `getTenantPrisma(tenantId)` and `withTenantContext()`
- **AI Tools:** Reuse `src/lib/bot/ai-tools.ts` for consistency across bot and web
- **Real-time:** Consider Socket.io or Server-Sent Events for /chats notifications

---

*Last Updated: December 12, 2025*
