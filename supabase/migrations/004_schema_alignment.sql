-- ============================================================
-- Logistics Manager — Migration 004 (Schema Alignment)
-- Run in Supabase SQL Editor (fully idempotent)
-- Fixes schema to match the logistics dashboard app code
-- ============================================================

-- ─── 1. Fix lm_orders ─────────────────────────────────────────
-- The original schema had carrier NOT NULL with CHECK, status_id UUID.
-- App code uses: carrier TEXT (nullable), status TEXT, contra entrega booleans.

-- Drop the old carrier constraint and add new columns
ALTER TABLE lm_orders
    -- Make carrier nullable (orders may not have a carrier yet)
    ALTER COLUMN carrier DROP NOT NULL,
    -- Add status as plain TEXT (replaces status_id FK)
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pendiente',
    -- Add contra entrega tracking
    ADD COLUMN IF NOT EXISTS is_contra_entrega BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS contraentrega_collected BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop old carrier CHECK constraint if it exists (allow nullable)
ALTER TABLE lm_orders DROP CONSTRAINT IF EXISTS lm_orders_carrier_check;

-- Add updated_at column if not present (trigger references it)
ALTER TABLE lm_orders
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── 2. Fix lm_carrier_configs ────────────────────────────────
-- Original schema had UNIQUE(carrier, key) with carrier CHECK constraint.
-- App code uses it as a simple key-value store (key is globally unique).

-- Drop old constraints
ALTER TABLE lm_carrier_configs DROP CONSTRAINT IF EXISTS lm_carrier_configs_carrier_key_key;
ALTER TABLE lm_carrier_configs DROP CONSTRAINT IF EXISTS lm_carrier_configs_carrier_check;

-- Make carrier nullable (we use some keys without a carrier e.g. tenant config, rates)
ALTER TABLE lm_carrier_configs ALTER COLUMN carrier DROP NOT NULL;

-- Add a unique constraint on just key (so ON CONFLICT (key) works)
-- First drop if there's already a key-only unique index
DROP INDEX IF EXISTS lm_carrier_configs_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS lm_carrier_configs_key_unique ON lm_carrier_configs(key);

-- ─── 3. Add contra entrega index ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lm_orders_contra_entrega ON lm_orders(is_contra_entrega);

-- ─── 4. Seed flat rates (if not already present) ──────────────
INSERT INTO lm_carrier_configs (carrier, key, value, description)
VALUES
    (NULL, 'mensajeria_rate', '2600', 'Flat shipping rate for private courier per package'),
    (NULL, 'correos_rate',    '2500', 'Flat shipping rate for Correos CR per package'),
    (NULL, 'handling_rate',   '600',  'Handling/management cost per package')
ON CONFLICT (key) DO NOTHING;
