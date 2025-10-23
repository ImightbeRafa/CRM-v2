-- ============================================================================
-- BILLING & INVOICES DATABASE SCHEMA
-- Run this SQL directly in Supabase SQL Editor
-- ============================================================================

-- Step 1: Add billing fields to Tenant table
ALTER TABLE "Tenant" 
ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT,
ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT,
ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT,
ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Create BillingTransaction table
CREATE TABLE IF NOT EXISTS "BillingTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CRC',
    "status" TEXT NOT NULL,
    "description" TEXT,
    "paymentMethod" TEXT,
    "stripePaymentId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingTransaction_pkey" PRIMARY KEY ("id")
);

-- Step 3: Create Invoice table
CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "customerIdNumber" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'CRC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- Step 4: Create UsageLog table
CREATE TABLE IF NOT EXISTS "UsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- Step 5: Create indexes for BillingTransaction
CREATE INDEX IF NOT EXISTS "BillingTransaction_tenantId_idx" ON "BillingTransaction"("tenantId");
CREATE INDEX IF NOT EXISTS "BillingTransaction_status_idx" ON "BillingTransaction"("status");
CREATE INDEX IF NOT EXISTS "BillingTransaction_createdAt_idx" ON "BillingTransaction"("createdAt");

-- Step 6: Create indexes and unique constraints for Invoice
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_invoiceNumber_key" ON "Invoice"("tenantId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_idx" ON "Invoice"("tenantId");
CREATE INDEX IF NOT EXISTS "Invoice_paymentStatus_idx" ON "Invoice"("paymentStatus");
CREATE INDEX IF NOT EXISTS "Invoice_createdAt_idx" ON "Invoice"("createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_customerName_idx" ON "Invoice"("customerName");

-- Step 7: Create indexes and unique constraints for UsageLog
CREATE UNIQUE INDEX IF NOT EXISTS "UsageLog_tenantId_metric_period_key" ON "UsageLog"("tenantId", "metric", "period");
CREATE INDEX IF NOT EXISTS "UsageLog_tenantId_idx" ON "UsageLog"("tenantId");
CREATE INDEX IF NOT EXISTS "UsageLog_period_idx" ON "UsageLog"("period");

-- Step 8: Add foreign key constraints
ALTER TABLE "BillingTransaction" 
ADD CONSTRAINT "BillingTransaction_tenantId_fkey" 
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" 
ADD CONSTRAINT "Invoice_tenantId_fkey" 
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" 
ADD CONSTRAINT "Invoice_orderId_fkey" 
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UsageLog" 
ADD CONSTRAINT "UsageLog_tenantId_fkey" 
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these to verify everything was created correctly
-- ============================================================================

-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('BillingTransaction', 'Invoice', 'UsageLog')
ORDER BY table_name;

-- Check Tenant table columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'Tenant'
AND column_name IN ('stripeCustomerId', 'stripeSubscriptionId', 'subscriptionStatus', 'currentPeriodStart', 'currentPeriodEnd', 'cancelAtPeriodEnd')
ORDER BY column_name;

-- Check BillingTransaction structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'BillingTransaction'
ORDER BY ordinal_position;

-- Check Invoice structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Invoice'
ORDER BY ordinal_position;

-- Check UsageLog structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'UsageLog'
ORDER BY ordinal_position;

-- Count existing records (should all be 0)
SELECT 
    'BillingTransaction' as table_name, COUNT(*) as record_count FROM "BillingTransaction"
UNION ALL
SELECT 'Invoice', COUNT(*) FROM "Invoice"
UNION ALL
SELECT 'UsageLog', COUNT(*) FROM "UsageLog";

-- ============================================================================
-- SUCCESS!
-- ============================================================================
-- If all queries above run without errors, your database is ready!
-- You can now use the Billing Dashboard and Invoice Generator.
-- ============================================================================

