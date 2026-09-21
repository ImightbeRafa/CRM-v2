/**
 * Read-only catalog check for Betsy v2 additive SQL 018–024.
 * Does not apply DDL. Safe against shared Supabase.
 *
 *   node --env-file=.env.local scripts/verify-betsy-v2-additive-sql.mjs
 *   node --env-file=.env.local scripts/verify-betsy-v2-additive-sql.mjs --production-release
 *
 * `--production-release` (or BETSY_V2_PRODUCTION_RELEASE=1) requires zero
 * enabled TenantFeatureFlag rows globally. Isolated-tenant flags must also
 * be off before the first production deploy.
 *
 * 024 objects are reported when present; missing 024 is an error only when
 * BETSY_V2_REQUIRE_024=1 (post-apply verification).
 */
import postgres from 'postgres';
import {
  EXPECTED_INDEXES_024,
  EXPECTED_SEQUENCE_024,
  EXPECTED_TRIGGER_024,
  VERIFY_CATALOG_COLUMNS,
  VERIFY_CATALOG_TABLES,
} from './lib/betsy-v2-additive-manifest.mjs';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const tenantId = process.env.BETSY_V2_TEST_TENANT_ID;
const productionRelease = process.argv.includes('--production-release')
  || process.env.BETSY_V2_PRODUCTION_RELEASE === '1';
const require024 = process.env.BETSY_V2_REQUIRE_024 === '1'
  || process.argv.includes('--require-024');
if (!url) {
  console.error('ERROR: DIRECT_URL / DATABASE_URL is missing.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: 'require', prepare: false });

const pre024Tables = VERIFY_CATALOG_TABLES.filter(
  (name) => name !== 'ChatConversation' && name !== 'ChatConversationReadState',
);
const expectedTables = require024 ? VERIFY_CATALOG_TABLES : pre024Tables;

const tables = await sql`
  SELECT c.relname, c.relrowsecurity AS rls,
         (SELECT COUNT(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY(${VERIFY_CATALOG_TABLES})
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
      OR (table_name = 'SocialAccount' AND column_name IN ('displayName','tokenStatus','wabaId','pageId'))
      OR (table_name = 'ChatMessage' AND column_name IN (
        'conversationId','providerMessageId','peerId','duplicateOfMessageId','createdAt'
      ))
      OR (table_name = 'ChatConversation' AND column_name IN ('revision','peerId','inboundCount'))
      OR (table_name = 'ChatConversationReadState' AND column_name = 'readInboundCount')
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
      OR relname LIKE 'ChatConversation%'
      OR relname LIKE 'ChatConversationReadState%'
      OR relname LIKE 'ChatMessage_conversation%'
      OR relname LIKE 'ChatMessage_socialAccountId_provider%'
      OR relname LIKE 'ChatMessage_tenantId_createdAt%'
      OR relname LIKE 'SocialAccount_tenantId_isActive%'
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

const sequence024 = await sql`
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = ${EXPECTED_SEQUENCE_024}
`;

const trigger024 = await sql`
  SELECT t.tgname, t.tgenabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'ChatConversation'
    AND t.tgname = ${EXPECTED_TRIGGER_024}
    AND NOT t.tgisinternal
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
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled) AS enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled AND "tenantId" = ${tenantId}) AS isolated_enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled AND "tenantId" <> ${tenantId}) AS other_enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE "scope" IS NULL OR "scope" = '') AS global_flags
    `
  : await sql`
      SELECT
        (SELECT COUNT(*)::int FROM public."Order") AS orders,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled) AS enabled_flags,
        (SELECT COUNT(*)::int FROM public."TenantFeatureFlag" WHERE enabled) AS other_enabled_flags,
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

const enabledFlagRows = await sql`
  SELECT "tenantId", key, enabled, "scope"
  FROM public."TenantFeatureFlag"
  WHERE enabled
  ORDER BY "tenantId", key
`;

const foundTableNames = new Set(tables.map((row) => row.relname));
const errors = [];
for (const name of expectedTables) {
  if (!foundTableNames.has(name)) errors.push(`missing table ${name}`);
}
for (const table of tables) {
  if (table.rls !== true) errors.push(`${table.relname} RLS is off`);
  if (Number(table.policies) < 1) errors.push(`${table.relname} has no RLS policies`);
}
const foundColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
const requiredColumns = require024
  ? VERIFY_CATALOG_COLUMNS
  : VERIFY_CATALOG_COLUMNS.filter(
      ([table]) => table !== 'SocialAccount'
        && table !== 'ChatMessage'
        && table !== 'ChatConversation'
        && table !== 'ChatConversationReadState',
    );
for (const [table, column] of requiredColumns) {
  if (!foundColumns.has(`${table}.${column}`)) errors.push(`missing ${table}.${column}`);
}
if (invalidIndexes.length > 0) {
  errors.push(`invalid indexes: ${invalidIndexes.map((row) => row.name).join(', ')}`);
}
if (require024) {
  if (sequence024.length !== 1) errors.push(`missing sequence ${EXPECTED_SEQUENCE_024}`);
  if (trigger024.length !== 1) errors.push(`missing trigger ${EXPECTED_TRIGGER_024}`);
  else if (trigger024[0].tgenabled !== 'O') errors.push(`trigger ${EXPECTED_TRIGGER_024} disabled`);
  const foundIndexes = new Set(indexes.map((row) => row.relname));
  for (const indexName of EXPECTED_INDEXES_024) {
    if (!foundIndexes.has(indexName)) errors.push(`missing index ${indexName}`);
  }
}
const snapshot = counts[0];
if (Number(snapshot.global_flags || 0) !== 0) {
  errors.push('global v2 flags are present');
}
if (productionRelease) {
  if (Number(snapshot.enabled_flags || 0) !== 0) {
    errors.push('production release requires zero enabled v2 flags globally');
  }
} else if (Number(snapshot.other_enabled_flags || 0) !== 0) {
  errors.push('v2 flags are enabled on a tenant other than the isolated test tenant');
}

const report = {
  ok: errors.length === 0,
  productionRelease,
  require024,
  errors,
  tables,
  columns,
  indexes,
  invalidIndexes,
  sequence024,
  trigger024,
  expectedIndexes024: EXPECTED_INDEXES_024,
  counts: snapshot,
  isolatedFlags: flags,
  enabledFlagRows,
  migrationLedgers: ledger,
};

console.log(JSON.stringify(report, null, 2));
await sql.end({ timeout: 5 });
if (errors.length > 0) process.exit(1);
