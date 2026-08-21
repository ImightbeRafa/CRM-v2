/**
 * Backup v1 configuration — private Vercel Blob logical dumps.
 * Primary DR without Supabase PITR.
 */

export const BACKUP_FORMAT_VERSION = 1 as const;

export const BACKUP_PREFIX = 'betsy/backups/v1';
export const MANIFEST_PREFIX = `${BACKUP_PREFIX}/manifests`;
export const OBJECT_PREFIX = `${BACKUP_PREFIX}/objects`;

/** Days to retain full + hot manifests (and reachable objects). */
export const DEFAULT_RETENTION_DAYS = 14;

/** Grace period before sweeping unreferenced objects (hours). */
export const RETENTION_SWEEP_GRACE_HOURS = 24;

/** Freshness thresholds for status health. */
export const FULL_FRESH_HOURS = 36;
export const HOT_FRESH_HOURS = 18;

/**
 * Required logistics tables that must appear in every successful backup.
 * Keep in sync with code references — enforced by coverage tests/scripts.
 */
export const REQUIRED_LM_TABLES = [
  'lm_accounting_entries',
  'lm_billing_weeks',
  'lm_carrier_configs',
  'lm_ce_payments',
  'lm_cost_rules',
  'lm_documents',
  'lm_employees',
  'lm_gd_balance_entries',
  'lm_handling_costs',
  'lm_operational_costs',
  'lm_order_costs',
  'lm_order_events',
  'lm_order_statuses',
  'lm_orders',
  'lm_private_delivery_confirmations',
  'lm_retiro_handoffs',
  'lm_retiro_order_allocations',
  'lm_retiro_product_aliases',
  'lm_retiro_stock',
  'lm_retiro_stock_movements',
  'lm_schedule_shifts',
  'lm_tenant_links',
  'lm_time_entries',
  'lm_work_days',
  'lm_workforce_audit_events',
] as const;

export type RequiredLmTable = (typeof REQUIRED_LM_TABLES)[number];

/**
 * Prisma / CRM tables included in hot (mid-day) backups in addition to all lm_*.
 * Case-sensitive Postgres identifiers as created by Prisma.
 */
export const HOT_PRISMA_TABLES = [
  'Order',
  'Client',
  'InventoryItem',
  'ShippingGuia',
  'Invoice',
  'BillingTransaction',
  'AuditLog',
  'IntegrationLog',
  'WebhookLog',
  'UsageLog',
  'ChatMessage',
] as const;

/** Preferred watermark columns (first match wins). */
export const WATERMARK_CANDIDATES = [
  'updatedAt',
  'updated_at',
  'createdAt',
  'created_at',
] as const;

export const EXCLUDED_TABLES = new Set([
  '_prisma_migrations',
]);

export function isHotTable(tableName: string): boolean {
  if (tableName.startsWith('lm_')) return true;
  return (HOT_PRISMA_TABLES as readonly string[]).includes(tableName);
}

export function encodeTableFileName(tableName: string): string {
  return encodeURIComponent(tableName);
}

export function decodeTableFileName(fileName: string): string {
  return decodeURIComponent(fileName.replace(/\.jsonl\.gz$/, ''));
}
