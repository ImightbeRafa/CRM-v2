import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { REQUIRED_LM_TABLES } from './config';

/** Match lm_* only in SQL table positions, not index/column/constraint names. */
const LM_TABLE_SQL_RES = [
  /\b(?:FROM|INTO|UPDATE|JOIN|REFERENCES)\s+(?:ONLY\s+)?(?:public\.)?(lm_[a-z][a-z0-9_]*)\b/gi,
  /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(?:public\.)?(lm_[a-z][a-z0-9_]*)\b/gi,
];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'backups',
]);

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      await walk(full, files);
    } else if (/\.(ts|tsx|js|jsx|sql)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

/** Extract lm_* table names referenced in SQL-ish contexts under src/ and supabase/. */
export async function scanLmTableReferences(rootDir: string): Promise<string[]> {
  const roots = [
    path.join(rootDir, 'src'),
    path.join(rootDir, 'supabase'),
  ];
  const found = new Set<string>();
  for (const root of roots) {
    const files = await walk(root);
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const re of LM_TABLE_SQL_RES) {
        re.lastIndex = 0;
        for (const match of text.matchAll(re)) {
          found.add(match[1]);
        }
      }
    }
  }
  found.delete('lm_is_admin');
  found.delete('lm_update_updated_at');
  return [...found].sort();
}

export interface CoverageReport {
  ok: boolean;
  requiredAllowlist: string[];
  referencedInCode: string[];
  referencedButUnlisted: string[];
  allowlistedButUnreferenced: string[];
  liveMissingRequired?: string[];
  liveExtraLm?: string[];
}

export function compareCoverage(
  referencedInCode: string[],
  liveLmTables?: string[],
): CoverageReport {
  const required = [...REQUIRED_LM_TABLES].sort();
  const refSet = new Set(referencedInCode);
  const reqSet = new Set<string>(required);

  const referencedButUnlisted = referencedInCode.filter((t) => !reqSet.has(t));
  const allowlistedButUnreferenced = required.filter((t) => !refSet.has(t));

  let liveMissingRequired: string[] | undefined;
  let liveExtraLm: string[] | undefined;
  if (liveLmTables) {
    const liveSet = new Set(liveLmTables);
    liveMissingRequired = required.filter((t) => !liveSet.has(t));
    liveExtraLm = liveLmTables.filter((t) => !reqSet.has(t)).sort();
  }

  const ok = referencedButUnlisted.length === 0
    && (!liveMissingRequired || liveMissingRequired.length === 0);

  return {
    ok,
    requiredAllowlist: required,
    referencedInCode,
    referencedButUnlisted,
    allowlistedButUnreferenced,
    liveMissingRequired,
    liveExtraLm,
  };
}
