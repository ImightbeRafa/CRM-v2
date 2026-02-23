-- Migration: Add contra entrega tracking columns to lm_orders
-- Run this in the Supabase SQL Editor

ALTER TABLE lm_orders
    ADD COLUMN IF NOT EXISTS is_contra_entrega BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS contraentrega_collected BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for quick COD lookups
CREATE INDEX IF NOT EXISTS idx_lm_orders_contra_entrega ON lm_orders(is_contra_entrega);
