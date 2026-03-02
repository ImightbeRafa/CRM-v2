-- ============================================================
-- Logistics Manager — Migration 006 (Correos Per-Order Shipping Cost)
-- Run in Supabase SQL Editor (fully idempotent)
-- Adds correos_shipping_cost column to lm_orders so each
-- Correos CR order can store its actual shipping cost.
-- ============================================================

-- ─── 1. Add correos_shipping_cost column ────────────────────
ALTER TABLE lm_orders
    ADD COLUMN IF NOT EXISTS correos_shipping_cost NUMERIC(12,2) DEFAULT NULL;

-- ─── 2. Composite index for Entregado + carrier lookups ─────
CREATE INDEX IF NOT EXISTS idx_lm_orders_carrier_status
    ON lm_orders(carrier, status);
