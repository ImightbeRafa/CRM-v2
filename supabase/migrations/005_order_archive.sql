-- ============================================================
-- Logistics Manager — Migration 005 (Order Archive)
-- Run in Supabase SQL Editor (fully idempotent)
-- Adds archived_at column to lm_orders for the "Terminar" flow
-- ============================================================

ALTER TABLE lm_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_lm_orders_archived ON lm_orders(archived_at);
