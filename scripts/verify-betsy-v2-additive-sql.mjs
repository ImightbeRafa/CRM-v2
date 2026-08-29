/**
 * Read-only catalog check for Betsy v2 additive SQL 018–023.
 * Does not apply DDL. Safe against shared Supabase.
 *
 *   node --env-file=.env.local scripts/verify-betsy-v2-additive-sql.mjs
 */
import postgres from 'postgres';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const tenantId = process.env.BETSY_V2_TEST_TENANT_ID;
if (!url) {
  console.error('ERROR: DIRECT_URL / DATABASE_URL is missing.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: 'require', prepare: false });

const expectedTables = [
  'TenantFeatureFlag',
  'ClientIdentityConflict',
  'OrderLifecycleOperation',
  'OrderInventoryAllocation',
  'TenantOrderStatusClassification',
  'BotInboxMessage',
  'BotInboxDelivery',
  'TenantSetupProgress',
];

const expectedColumns = [
  ['Order', 'clientId'],
  ['Order', 'lifecycleVersion'],
  ['Order', 'deletedAt'],
  ['Order', 'archiveMetadata'],
  ['Client', 'normalizedPhone'],
  ['Client', 'normalizedEmail'],
  ['Invoice', 'emailStatus'],
  ['Invoice', 'sourceOperationKey'],
  ['BotSession', 'seatPolicy'],
];

const tables = await sql`
  SELECT c.relname, c.relrowsecurity AS rls,
         (SELECT COUNT(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY(${expectedTables})
  ORDER BY c.relname
`;

const columns = await sql`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'Order' AND column_name IN ('clientId','lifecycleVersion','deletedAt','archiveMetadata'))
      OR (table_name = 'Client' AND column_name IN ('normalizedPhone','normalizedEmail'))
      OR (table_name = 'Invoice' AND column_name IN ('emailStatus','sourceOperationKey'))
      OR (table_name = 'BotSession' AND column_name = 'seatPolicy')
    )
  ORDER BY table_name, column_name
`;

const indexes = await sql`
  SELECT relname
  FROM pg_class
  WHERE relkind = 'i'
    AND (
      relname LIKE 'TenantOrderStatusClassification%'
      OR relname LIKE 'TenantFeatureFlag%'
      OR relname IN (
        'Order_tenantId_clientId_idx',
        'Order_tenantId_timestamp_id_idx',
        'Order_tenantId_status_timestamp_id_idx'
      )
    )
  ORDER BY relname
`;

const invalidIndexes = await sql`
  SELECT indexrelid::regclass::text AS name
  FROM pg_index
  WHERE NOT indisvalid
`;

const ledger = await sql`
  SELECT nspname FROM pg_namespace WHERE nspname IN ('supabase_migrations','schema_migrations')
`;

const counts = tenantId
  ? await sql`
      SELECT
        (SELECT COUNT(*)::int FROM public."Order") AS orders,
        (SELECT COUNT(*)::int FROM public."Order" WHERE "tenantId" <> ${tenantId}) AS other_tenant_orders,
        (SELECT COUNT(*)::int FROM public."Order" WHERE "tenantId" = ${tenantId}) AS isolated_orders,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled AND "tenantId" = ${tenantId}) AS isolated_enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled AND "tenantId" <> ${tenantId}) AS other_enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE "scope" IS NULL OR "scope" = '') AS global_flags
    `
  : await sql`
      SELECT
        (SELECT COUNT(*)::int FROM public."Order") AS orders,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled) AS enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE "scope" IS NULL OR "scope" = '') AS global_flags
    `;

const flags = tenantId
  ? await sql`
      SELECT key, enabled, "scope"
      FROM public."TenantFeatureFlag"
      WHERE "tenantId" = ${tenantId}
      ORDER BY key
    `
  : [];

const errors = [];
if (tables.length !== expectedTables.length) {
  errors.push(`expected ${expectedTables.length} v2 tables, found ${tables.length}`);
}
for (const table of tables) {
  if (table.rls !== true) errors.push(`${table.relname} RLS is off`);
  if (Number(table.policies) < 1) errors.push(`${table.relname} has no RLS policies`);
}
const foundColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
for (const [table, column] of expectedColumns) {
  if (!foundColumns.has(`${table}.${column}`)) errors.push(`missing ${table}.${column}`);
}
if (invalidIndexes.length > 0) {
  errors.push(`invalid indexes: ${invalidIndexes.map((row) => row.name).join(', ')}`);
}
const snapshot = counts[0];
if (Number(snapshot.other_enabled_flags || 0) !== 0) {
  errors.push('v2 flags are enabled on a tenant other than the isolated test tenant');
}
if (Number(snapshot.global_flags || 0) !== 0) {
  errors.push('global v2 flags are present');
}

const report = {
  ok: errors.length === 0,
  errors,
  tables,
  columns,
  indexes,
  invalidIndexes,
  counts: snapshot,
  isolatedFlags: flags,
  migrationLedgers: ledger,
};

console.log(JSON.stringify(report, null, 2));
await sql.end({ timeout: 5 });
if (errors.length > 0) process.exit(1);
