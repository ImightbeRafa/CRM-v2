-- Minimal fixture for backup round-trip tests.
-- Includes representative CRM tables + all required lm_* tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "Tenant" (
  id text PRIMARY KEY,
  name text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "User" (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Order" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES "Tenant"(id),
  status text NOT NULL DEFAULT 'NEW',
  total numeric(12,2) NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Client" (
  id text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES "Tenant"(id),
  name text NOT NULL,
  phone text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ShippingGuia" (
  id text PRIMARY KEY,
  "orderId" text NOT NULL REFERENCES "Order"(id),
  tracking text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "InventoryItem" (
  id text PRIMARY KEY,
  sku text NOT NULL,
  qty int NOT NULL DEFAULT 0,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Invoice" (
  id text PRIMARY KEY,
  amount numeric(12,2) NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "BillingTransaction" (
  id text PRIMARY KEY,
  amount numeric(12,2) NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  id text PRIMARY KEY,
  action text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "IntegrationLog" (
  id text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "WebhookLog" (
  id text PRIMARY KEY,
  body text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "UsageLog" (
  id text PRIMARY KEY,
  units int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ChatMessage" (
  id text PRIMARY KEY,
  content text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Seller" (
  id text PRIMARY KEY,
  name text NOT NULL
);

-- future_table proves discovery picks up unknown tables automatically
CREATE TABLE IF NOT EXISTS future_table (
  id text PRIMARY KEY,
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- All required lm_* tables (simplified shapes for restore proof)
CREATE TABLE IF NOT EXISTS lm_tenant_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_order_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id text NOT NULL,
  crm_tenant_id text,
  carrier text,
  status text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_order_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_cost_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_handling_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_carrier_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_ce_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_work_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_gd_balance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_billing_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES lm_employees(id),
  hourly_rate_crc numeric(12,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_schedule_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES lm_employees(id),
  starts_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_workforce_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_operational_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_retiro_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  sku text NOT NULL,
  qty int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_retiro_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  sku text NOT NULL,
  delta int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_retiro_product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  sku text NOT NULL,
  alias_normalized text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_retiro_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id text NOT NULL,
  agent_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lm_retiro_order_allocations (
  crm_order_id text NOT NULL,
  slot_key text NOT NULL,
  sku text NOT NULL,
  qty integer NOT NULL,
  raw_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crm_order_id, slot_key)
);
CREATE TABLE IF NOT EXISTS lm_private_delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_order_id text NOT NULL,
  confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed data
INSERT INTO "Tenant" (id, name) VALUES ('t1', 'Test Tenant');
INSERT INTO "User" (id, email) VALUES ('u1', 'backup-test@example.com');
INSERT INTO "Order" (id, "tenantId", status, total, meta)
VALUES ('o1', 't1', 'NEW', 12.50, '{"channel":"test"}'::jsonb);
INSERT INTO "Client" (id, "tenantId", name, phone) VALUES ('c1', 't1', 'Ada', '555');
INSERT INTO "ShippingGuia" (id, "orderId", tracking) VALUES ('g1', 'o1', 'TRK-1');
INSERT INTO "InventoryItem" (id, sku, qty) VALUES ('i1', 'SKU-1', 3);
INSERT INTO "Invoice" (id, amount) VALUES ('inv1', 99.00);
INSERT INTO "BillingTransaction" (id, amount) VALUES ('bt1', 99.00);
INSERT INTO "AuditLog" (id, action) VALUES ('a1', 'create');
INSERT INTO "IntegrationLog" (id, payload) VALUES ('il1', '{"ok":true}'::jsonb);
INSERT INTO "WebhookLog" (id, body) VALUES ('w1', '{}');
INSERT INTO "UsageLog" (id, units) VALUES ('ul1', 2);
INSERT INTO "ChatMessage" (id, content) VALUES ('cm1', 'hello');
INSERT INTO "Seller" (id, name) VALUES ('s1', 'Seller');
INSERT INTO future_table (id, note) VALUES ('f1', 'discovered automatically');

INSERT INTO lm_tenant_links (tenant_id) VALUES ('t1');
INSERT INTO lm_order_statuses (code) VALUES ('CREATED');
INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
VALUES ('o1', 't1', 'correos', 'Guía Creada');
INSERT INTO lm_order_costs (amount) VALUES (1.5);
INSERT INTO lm_cost_rules (rule) VALUES ('default');
INSERT INTO lm_handling_costs (amount) VALUES (0.5);
INSERT INTO lm_carrier_configs (key, value) VALUES ('rate', '{"x":1}'::jsonb);
INSERT INTO lm_accounting_entries (amount) VALUES (10);
INSERT INTO lm_documents (name) VALUES ('doc');
INSERT INTO lm_ce_payments (crm_order_id, amount) VALUES ('o1', 5);
INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
VALUES ('o1', 'status', '{"s":1}'::jsonb, 'test');
INSERT INTO lm_work_days (work_date) VALUES (CURRENT_DATE);
INSERT INTO lm_gd_balance_entries (amount) VALUES (2);
INSERT INTO lm_billing_weeks (week_start, week_end)
VALUES (CURRENT_DATE - 7, CURRENT_DATE);
INSERT INTO lm_employees (full_name) VALUES ('Worker One');
INSERT INTO lm_time_entries (employee_id, hourly_rate_crc)
SELECT id, 20 FROM lm_employees LIMIT 1;
INSERT INTO lm_schedule_shifts (employee_id, starts_at)
SELECT id, now() FROM lm_employees LIMIT 1;
INSERT INTO lm_workforce_audit_events (event_type) VALUES ('punch_in');
INSERT INTO lm_operational_costs (category, amount) VALUES ('fuel', 15);
INSERT INTO lm_retiro_stock (agent_key, sku, qty) VALUES ('agent', 'SKU-1', 4);
INSERT INTO lm_retiro_stock_movements (agent_key, sku, delta) VALUES ('agent', 'SKU-1', 1);
INSERT INTO lm_retiro_product_aliases (agent_key, sku, alias_normalized)
VALUES ('agent', 'SKU-1', 'sku1');
INSERT INTO lm_retiro_handoffs (crm_order_id, agent_key) VALUES ('o1', 'agent');
INSERT INTO lm_retiro_order_allocations (crm_order_id, slot_key, sku, qty, raw_name)
VALUES ('o1', 'slot-1', 'SKU-1', 1, 'Widget');
INSERT INTO lm_private_delivery_confirmations (crm_order_id, confirmed_at)
VALUES ('o1', now());
