-- ============================================================
-- Logistics Manager — Migration 002
-- Run in Supabase SQL Editor (fully idempotent)
-- ============================================================

-- ─── 1. isLogisticsAdmin on User ─────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "isLogisticsAdmin" BOOLEAN NOT NULL DEFAULT FALSE;

-- Grant access to the two initial logistics admins
UPDATE "User"
  SET "isLogisticsAdmin" = TRUE
  WHERE email IN ('deepsleepp.cr@gmail.com', 'peter@peter.com');

-- ─── 2. RLS helper function ───────────────────────────────────
-- Returns TRUE when the calling Supabase auth user is a logistics admin.
-- SECURITY DEFINER allows it to query the Prisma-owned "User" table.
CREATE OR REPLACE FUNCTION lm_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT u."isLogisticsAdmin"
      FROM "User" u
      INNER JOIN auth.users au ON au.email = u.email
      WHERE au.id = auth.uid()
      LIMIT 1
    ),
    FALSE
  );
$$;

-- ─── 3. Linked tenants ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_tenant_links (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL UNIQUE,  -- Prisma Tenant.id (cuid)
  display_name  TEXT        NOT NULL,
  slug          TEXT,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_tenant_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_tenant_links: admin only" ON lm_tenant_links;
CREATE POLICY "lm_tenant_links: admin only" ON lm_tenant_links
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

-- Seed: 7 managed tenants
INSERT INTO lm_tenant_links (tenant_id, display_name, slug) VALUES
  ('cmh32z0ol0000k004hvx9tg3p', 'WhatASheet''s Organization', 'whatasheetcr'),
  ('cmhsibjue0004js04gie724nx', 'DeepSleep',                  'deepsleepp-cr'),
  ('cmhutd1th0000jp04oqibtz54', 'WAS CR''s Organization',     'whatasheetcr-2'),
  ('cmigornmw0000lb04kl75262e', 'Kroma Lab''s Organization',  'tazaskroma'),
  ('cmjdabz4d0000il04dyc5qmcc', 'SimplePatch',                'simplepatch'),
  ('cmln5u7k70000ld042qify2og', 'DeepCLean',                  'deepcleancr07'),
  ('cmh44aerw0006vijg0640vfl0', 'PeterTesting',               'peter')
ON CONFLICT (tenant_id) DO NOTHING;

-- ─── 4. Logistics Order Statuses ─────────────────────────────
CREATE TABLE IF NOT EXISTS lm_order_statuses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier     TEXT        NOT NULL CHECK (carrier IN ('mensajeria', 'correos')),
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#6c63ff',
  position    INTEGER     NOT NULL DEFAULT 0,
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_order_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_order_statuses: admin only" ON lm_order_statuses;
CREATE POLICY "lm_order_statuses: admin only" ON lm_order_statuses
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

-- Default kanban statuses
INSERT INTO lm_order_statuses (carrier, name, color, position, is_default) VALUES
  ('mensajeria', 'Pendiente',    '#64748b', 0, TRUE),
  ('mensajeria', 'En Proceso',   '#6c63ff', 1, FALSE),
  ('mensajeria', 'En Tránsito',  '#f59e0b', 2, FALSE),
  ('mensajeria', 'Entregado',    '#22c55e', 3, FALSE),
  ('mensajeria', 'Devuelto',     '#ef4444', 4, FALSE),
  ('correos',    'Pendiente',    '#64748b', 0, TRUE),
  ('correos',    'En Sucursal',  '#3b82f6', 1, FALSE),
  ('correos',    'En Tránsito',  '#f59e0b', 2, FALSE),
  ('correos',    'Entregado',    '#22c55e', 3, FALSE),
  ('correos',    'Devuelto',     '#ef4444', 4, FALSE)
ON CONFLICT DO NOTHING;

-- ─── 5. Logistics Orders (metadata overlay on top of CRM orders) ──
-- crm_order_id references the Prisma Order.id (cuid string, not enforced by FK
-- since it's across schema boundaries). The logistics dashboard joins them in app code.
CREATE TABLE IF NOT EXISTS lm_orders (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id      TEXT        NOT NULL UNIQUE,     -- Prisma Order.id
  crm_tenant_id     TEXT        NOT NULL,            -- Prisma Tenant.id
  carrier           TEXT        NOT NULL CHECK (carrier IN ('mensajeria', 'correos')),
  status_id         UUID        REFERENCES lm_order_statuses(id) ON DELETE SET NULL,
  tracking_number   TEXT,
  weight_kg         NUMERIC(8,2),
  declared_value    NUMERIC(12,2),
  recipient_province TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_orders: admin only" ON lm_orders;
CREATE POLICY "lm_orders: admin only" ON lm_orders
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS lm_orders_crm_order    ON lm_orders(crm_order_id);
CREATE INDEX IF NOT EXISTS lm_orders_tenant       ON lm_orders(crm_tenant_id);
CREATE INDEX IF NOT EXISTS lm_orders_carrier      ON lm_orders(carrier);
CREATE INDEX IF NOT EXISTS lm_orders_status       ON lm_orders(status_id);
CREATE INDEX IF NOT EXISTS lm_orders_created      ON lm_orders(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION lm_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lm_orders_updated_at ON lm_orders;
CREATE TRIGGER lm_orders_updated_at
  BEFORE UPDATE ON lm_orders
  FOR EACH ROW EXECUTE FUNCTION lm_update_updated_at();

-- ─── 6. Order Costs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_order_costs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lm_order_id     UUID        NOT NULL REFERENCES lm_orders(id) ON DELETE CASCADE,
  carrier_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,
  handling_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_costs     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(12,2) GENERATED ALWAYS AS (carrier_cost + handling_cost + other_costs) STORED,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_order_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_order_costs: admin only" ON lm_order_costs;
CREATE POLICY "lm_order_costs: admin only" ON lm_order_costs
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS lm_order_costs_order ON lm_order_costs(lm_order_id);

-- ─── 7. Cost Rules ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_cost_rules (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier      TEXT        NOT NULL CHECK (carrier IN ('mensajeria', 'correos')),
  zone         TEXT        NOT NULL,          -- province name
  weight_from  NUMERIC(8,2) NOT NULL DEFAULT 0,
  weight_to    NUMERIC(8,2) NOT NULL,
  cost         NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lm_cost_rules_weight_range CHECK (weight_to > weight_from)
);

ALTER TABLE lm_cost_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_cost_rules: admin only" ON lm_cost_rules;
CREATE POLICY "lm_cost_rules: admin only" ON lm_cost_rules
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS lm_cost_rules_lookup ON lm_cost_rules(carrier, zone);

-- ─── 8. Handling Costs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_handling_costs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT        NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  applies_to  TEXT        NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'mensajeria', 'correos')),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_handling_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_handling_costs: admin only" ON lm_handling_costs;
CREATE POLICY "lm_handling_costs: admin only" ON lm_handling_costs
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

-- ─── 9. Carrier Configs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_carrier_configs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier     TEXT        NOT NULL CHECK (carrier IN ('mensajeria', 'correos')),
  key         TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carrier, key)
);

ALTER TABLE lm_carrier_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_carrier_configs: admin only" ON lm_carrier_configs;
CREATE POLICY "lm_carrier_configs: admin only" ON lm_carrier_configs
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

-- ─── 10. Accounting Entries ──────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_accounting_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lm_order_id     UUID        REFERENCES lm_orders(id) ON DELETE SET NULL,
  crm_tenant_id   TEXT,
  type            TEXT        NOT NULL CHECK (type IN ('income', 'expense', 'adjustment')),
  amount          NUMERIC(12,2) NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_accounting_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_accounting_entries: admin only" ON lm_accounting_entries;
CREATE POLICY "lm_accounting_entries: admin only" ON lm_accounting_entries
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS lm_accounting_tenant ON lm_accounting_entries(crm_tenant_id);
CREATE INDEX IF NOT EXISTS lm_accounting_type   ON lm_accounting_entries(type);

-- ─── 11. Documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lm_documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lm_order_id   UUID        REFERENCES lm_orders(id) ON DELETE SET NULL,
  type          TEXT        NOT NULL CHECK (type IN ('guia', 'ticket', 'report')),
  storage_path  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lm_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lm_documents: admin only" ON lm_documents;
CREATE POLICY "lm_documents: admin only" ON lm_documents
  FOR ALL USING (lm_is_admin()) WITH CHECK (lm_is_admin());

CREATE INDEX IF NOT EXISTS lm_documents_order ON lm_documents(lm_order_id);
