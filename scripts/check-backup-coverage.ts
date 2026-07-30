#!/usr/bin/env npx tsx
/**
 * Verify lm_* allowlist matches code references (and optionally live DB).
 *
 *   npx tsx scripts/check-backup-coverage.ts
 *   npx tsx scripts/check-backup-coverage.ts --live
 */
import { compareCoverage, scanLmTableReferences } from '../src/lib/backups/coverage';
import { createBackupSql, discoverPublicTables } from '../src/lib/backups/postgres';

async function main() {
  const root = process.cwd();
  const referenced = await scanLmTableReferences(root);
  let liveLm: string[] | undefined;

  if (process.argv.includes('--live')) {
    const sql = createBackupSql();
    try {
      const tables = await discoverPublicTables(sql);
      liveLm = tables.map((t) => t.tableName).filter((n) => n.startsWith('lm_'));
      console.log(`Live public tables: ${tables.length}; lm_*: ${liveLm.length}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const report = compareCoverage(referenced, liveLm);
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    console.error('❌ Backup coverage check failed');
    process.exit(1);
  }
  console.log('✅ Backup coverage OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
