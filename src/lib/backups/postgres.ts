import postgres from 'postgres';
import { EXCLUDED_TABLES, WATERMARK_CANDIDATES } from './config';
import type { TableFingerprint } from './types';
import { createHash } from 'crypto';

export type Sql = postgres.Sql<Record<string, unknown>>;

export function getBackupDatabaseUrl(): string {
  const url = process.env.BACKUP_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('BACKUP_DATABASE_URL, DIRECT_URL, or DATABASE_URL is required');
  }
  return url;
}

export function createBackupSql(url = getBackupDatabaseUrl()): Sql {
  return postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
  });
}

export interface DiscoveredTable {
  tableName: string;
  columns: string[];
  primaryKey: string[];
  watermarkColumn: string | null;
}

export async function discoverPublicTables(sql: Sql): Promise<DiscoveredTable[]> {
  const tables = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  `;

  const result: DiscoveredTable[] = [];
  for (const { table_name } of tables) {
    if (EXCLUDED_TABLES.has(table_name)) continue;

    const cols = await sql<{ column_name: string }[]>`
      SELECT a.attname AS column_name
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ${table_name}
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `;

    const pk = await sql<{ column_name: string }[]>`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ${table_name}
        AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `;

    const columnNames = cols.map((c) => c.column_name);
    const watermarkColumn =
      WATERMARK_CANDIDATES.find((c) => columnNames.includes(c)) ?? null;

    result.push({
      tableName: table_name,
      columns: columnNames,
      primaryKey: pk.map((p) => p.column_name),
      watermarkColumn,
    });
  }
  return result;
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function quoteQualified(tableName: string): string {
  return `public.${quoteIdent(tableName)}`;
}

export async function fingerprintTable(
  sql: Sql,
  table: DiscoveredTable,
  schemaHash: string,
): Promise<TableFingerprint> {
  const q = quoteQualified(table.tableName);
  const reuseSafe = Boolean(table.watermarkColumn);

  let maxWatermark: string | null = null;
  let maxPrimaryKey: string | null = null;

  if (table.watermarkColumn) {
    const wm = quoteIdent(table.watermarkColumn);
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::bigint AS row_count, MAX(${wm})::text AS max_watermark FROM ${q}`,
    );
    const row = rows[0] as unknown as { row_count: string | number; max_watermark: string | null };
    const rowCount = Number(row.row_count);
    if (table.primaryKey.length === 1) {
      const pk = quoteIdent(table.primaryKey[0]);
      const pkRows = await sql.unsafe(`SELECT MAX(${pk}::text) AS max_pk FROM ${q}`);
      maxPrimaryKey = (pkRows[0] as unknown as { max_pk: string | null }).max_pk;
    }
    return {
      rowCount,
      watermarkColumn: table.watermarkColumn,
      maxWatermark: row.max_watermark,
      maxPrimaryKey,
      schemaHash,
      reuseSafe,
    };
  }

  if (table.primaryKey.length === 1) {
    const pk = quoteIdent(table.primaryKey[0]);
    const rows = await sql.unsafe(
      `SELECT COUNT(*)::bigint AS row_count, MAX(${pk}::text) AS max_pk FROM ${q}`,
    );
    const row = rows[0] as unknown as { row_count: string | number; max_pk: string | null };
    return {
      rowCount: Number(row.row_count),
      watermarkColumn: null,
      maxWatermark: null,
      maxPrimaryKey: row.max_pk,
      schemaHash,
      reuseSafe: false,
    };
  }

  const rows = await sql.unsafe(`SELECT COUNT(*)::bigint AS row_count FROM ${q}`);
  const row = rows[0] as unknown as { row_count: string | number };
  return {
    rowCount: Number(row.row_count),
    watermarkColumn: null,
    maxWatermark: null,
    maxPrimaryKey: null,
    schemaHash,
    reuseSafe: false,
  };
}

export function fingerprintsEqual(a: TableFingerprint, b: TableFingerprint): boolean {
  return a.rowCount === b.rowCount
    && a.watermarkColumn === b.watermarkColumn
    && a.maxWatermark === b.maxWatermark
    && a.maxPrimaryKey === b.maxPrimaryKey
    && a.schemaHash === b.schemaHash;
}

/** Stream table rows as JSON text lines (one object per line). */
export async function dumpTableJsonl(sql: Sql, table: DiscoveredTable): Promise<string[]> {
  const q = quoteQualified(table.tableName);
  const orderBy = table.primaryKey.length
    ? table.primaryKey.map(quoteIdent).join(', ')
    : table.columns[0]
      ? quoteIdent(table.columns[0])
      : '1';

  const pageSize = 2000;
  const lines: string[] = [];
  let offset = 0;

  for (;;) {
    const rows = await sql.unsafe(
      `SELECT row_to_json(t)::text AS row
       FROM (
         SELECT * FROM ${q}
         ORDER BY ${orderBy}
         LIMIT ${pageSize} OFFSET ${offset}
       ) t`,
    );
    if (!rows.length) break;
    for (const r of rows as unknown as Array<{ row: string }>) {
      lines.push(r.row);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return lines;
}

export async function computeSchemaHash(sql: Sql, tableName: string): Promise<string> {
  const cols = await sql`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;
  return createHash('sha256').update(JSON.stringify(cols)).digest('hex').slice(0, 16);
}

export { quoteIdent };
