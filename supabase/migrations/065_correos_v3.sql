-- 065 Correos API v3 (REST): guía extras, tracking events, pickup requests. 2026-10-28. Additive only.
-- Gated: BETSY_V2_APPLY_FILES=065 — never DEFAULT_APPLY_FILES. DO NOT run prisma db push / migrate.
--
-- Read/written with raw SQL only (src/lib/correos/v3/store.ts), NOT in prisma/schema.prisma: code deployed
-- before this file keeps working (missing table = feature quietly off, 42P01 is tolerated).
-- lm_correos_guias      one row per guía made through v3 (or tracked by the sync): delivery type, branch,
--                       ZPL label, freight, weight, and the latest tracking state + next check time.
-- lm_correos_tracking_events  every Correos event once (unique per guía + time + code), with GPS.
-- lm_correos_pickups    each "Solicitar recolección" sent to Correos, idempotent per key.
-- Rollback: deploy previous code; the tables can stay.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.lm_correos_guias (
  guia_number        text PRIMARY KEY,
  shipping_guia_id   text NULL,
  crm_tenant_id      text NOT NULL,
  crm_order_id       text NULL,
  order_number       text NULL,
  api_version        text NOT NULL DEFAULT 'v3',
  environment        text NOT NULL DEFAULT 'prod',
  tipo_destino       text NULL,
  codigo_sucursal    text NULL,
  sucursal_nombre    text NULL,
  zpl                text NULL,
  monto_flete        numeric(12, 2) NULL,
  peso_g             integer NULL,
  dest_zip           text NULL,
  last_status        text NULL,
  last_status_text   text NULL,
  last_status_code   text NULL,
  delivered_at       timestamptz NULL,
  received_by        text NULL,
  last_event_at      timestamptz NULL,
  last_checked_at    timestamptz NULL,
  next_check_at      timestamptz NULL DEFAULT now(),
  check_failures     integer NOT NULL DEFAULT 0,
  closed             boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lm_correos_guias_api_check CHECK (api_version IN ('v3', 'soap')),
  CONSTRAINT lm_correos_guias_env_check CHECK (environment IN ('test', 'prod')),
  CONSTRAINT lm_correos_guias_tipo_check CHECK (tipo_destino IS NULL OR tipo_destino IN ('DOM', 'SUC')),
  CONSTRAINT lm_correos_guias_len_check CHECK (
    char_length(guia_number) <= 50 AND char_length(coalesce(codigo_sucursal, '')) <= 20
    AND char_length(coalesce(sucursal_nombre, '')) <= 200 AND char_length(coalesce(zpl, '')) <= 200000
    AND char_length(coalesce(last_status_text, '')) <= 300 AND char_length(coalesce(received_by, '')) <= 200)
);

CREATE INDEX IF NOT EXISTS lm_correos_guias_due_idx ON public.lm_correos_guias (next_check_at) WHERE closed = false;
CREATE INDEX IF NOT EXISTS lm_correos_guias_tenant_idx ON public.lm_correos_guias (crm_tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lm_correos_guias_sg_idx ON public.lm_correos_guias (shipping_guia_id) WHERE shipping_guia_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lm_correos_tracking_events (
  id             bigserial PRIMARY KEY,
  guia_number    text NOT NULL,
  crm_tenant_id  text NOT NULL,
  event_at       timestamptz NULL,
  codigo         text NOT NULL DEFAULT '',
  descripcion    text NOT NULL,
  ubicacion      text NULL,
  recibido_por   text NULL,
  lat            double precision NULL,
  lng            double precision NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lm_correos_tracking_events_len_check CHECK (
    char_length(guia_number) <= 50 AND char_length(codigo) <= 20 AND char_length(descripcion) <= 300
    AND char_length(coalesce(ubicacion, '')) <= 120 AND char_length(coalesce(recibido_por, '')) <= 120)
);

-- Per business: one business can never own (or hide) another's events for the same number.
CREATE UNIQUE INDEX IF NOT EXISTS lm_correos_tracking_events_uniq
  ON public.lm_correos_tracking_events (crm_tenant_id, guia_number, coalesce(event_at, 'epoch'::timestamptz), codigo, descripcion);
CREATE INDEX IF NOT EXISTS lm_correos_tracking_events_guia_idx ON public.lm_correos_tracking_events (guia_number, event_at);

CREATE TABLE IF NOT EXISTS public.lm_correos_pickups (
  id               bigserial PRIMARY KEY,
  idempotency_key  text NOT NULL UNIQUE,
  crm_tenant_id    text NOT NULL,
  requested_by     text NULL,
  guia_numbers     text[] NOT NULL,
  pickup_address   text NULL,
  status           text NOT NULL DEFAULT 'pending',
  error            text NULL,
  environment      text NOT NULL DEFAULT 'prod',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lm_correos_pickups_status_check CHECK (status IN ('pending', 'sent', 'failed', 'unknown')),
  CONSTRAINT lm_correos_pickups_env_check CHECK (environment IN ('test', 'prod')),
  CONSTRAINT lm_correos_pickups_len_check CHECK (
    char_length(idempotency_key) <= 120 AND cardinality(guia_numbers) BETWEEN 1 AND 200
    AND char_length(coalesce(error, '')) <= 500 AND char_length(coalesce(pickup_address, '')) <= 400)
);

CREATE INDEX IF NOT EXISTS lm_correos_pickups_tenant_idx ON public.lm_correos_pickups (crm_tenant_id, created_at DESC);

-- Supabase data API must not expose them (migration-rls-guard). The app role owns the tables and bypasses RLS.
ALTER TABLE public.lm_correos_guias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lm_correos_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lm_correos_pickups ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Cross-store lookups by guía number (ownership, manual guía check, enrollment) — SecureDog DB-08.
-- Plain CREATE INDEX in its own short transaction (the gated apply sends one simple query; see 032).
-- Apply in the madrugada: it briefly blocks writes on "ShippingGuia" while it builds.
-- Rollback: DROP INDEX IF EXISTS "ShippingGuia_guiaNumber_idx", "ShippingGuia_trackingNumber_idx";
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
CREATE INDEX IF NOT EXISTS "ShippingGuia_guiaNumber_idx" ON public."ShippingGuia" ("guiaNumber") WHERE "guiaNumber" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ShippingGuia_trackingNumber_idx" ON public."ShippingGuia" ("trackingNumber") WHERE "trackingNumber" IS NOT NULL;
COMMIT;
