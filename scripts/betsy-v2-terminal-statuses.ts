import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../src/lib/db';
import { normalizeStoredStatus } from '../src/lib/cursor-pagination';
import { PRODUCTION_SERVER_V2_FLAG } from '../src/lib/feature-flags';

interface MappingFile {
  statuses: Record<string, boolean>;
  approvedBy: string;
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function isApply() {
  return process.argv.includes('--apply');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function main() {
  const tenantId = argument('tenant');
  if (!tenantId) throw new Error('Exact --tenant=<id> is required');
  const apply = isApply();
  const mappingPath = argument('mapping');
  if (apply && !mappingPath) throw new Error('--mapping=<file.json> is required with --apply');
  if (apply && process.env.BETSY_V2_TERMINAL_MAPPING_APPROVED_TENANT !== tenantId) {
    throw new Error('BETSY_V2_TERMINAL_MAPPING_APPROVED_TENANT must exactly match --tenant');
  }

  const [storedStatuses, configuredStatuses] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
      orderBy: { status: 'asc' },
    }),
    prisma.orderStatus.findMany({
      where: { tenantId },
      select: { id: true, key: true, label: true, isActive: true },
      orderBy: { order: 'asc' },
    }),
  ]);

  let classifications: Array<{ normalizedStatusValue: string; statusValue: string; isTerminal: boolean }> = [];
  try {
    classifications = await prisma.tenantOrderStatusClassification.findMany({
      where: { tenantId },
      select: { normalizedStatusValue: true, statusValue: true, isTerminal: true },
    });
  } catch {
    // The dry-run remains useful before the additive Slice 4 SQL is approved.
  }
  const configuredByNormalized = new Map(configuredStatuses.map(status => [normalizeStoredStatus(status.label), status]));
  const classifiedByNormalized = new Map(classifications.map(item => [item.normalizedStatusValue, item]));
  const report = storedStatuses.map(row => {
    const normalized = normalizeStoredStatus(row.status);
    const configured = configuredByNormalized.get(normalized);
    const classification = classifiedByNormalized.get(normalized);
    return {
      statusValue: row.status,
      normalizedStatusValue: normalized,
      orderCount: row._count._all,
      oldestOrderAt: row._min.timestamp?.toISOString() || null,
      newestOrderAt: row._max.timestamp?.toISOString() || null,
      configuredStatus: configured ? { id: configured.id, key: configured.key, label: configured.label, isActive: configured.isActive } : null,
      currentClassification: classification ? { statusValue: classification.statusValue, isTerminal: classification.isTerminal } : null,
    };
  });

  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', tenantId, rows: report }, null, 2));
    return;
  }

  const parsed = JSON.parse(await readFile(mappingPath!, 'utf8')) as MappingFile;
  if (!parsed?.statuses || typeof parsed.approvedBy !== 'string' || !parsed.approvedBy.trim()) {
    throw new Error('Mapping must contain statuses and approvedBy');
  }
  const explicitMapping = new Map<string, { raw: string; terminal: boolean }>();
  for (const [raw, terminal] of Object.entries(parsed.statuses)) {
    if (typeof terminal !== 'boolean') throw new Error(`Mapping for ${raw} must be boolean`);
    const normalized = normalizeStoredStatus(raw);
    if (explicitMapping.has(normalized)) throw new Error(`Duplicate normalized mapping: ${normalized}`);
    explicitMapping.set(normalized, { raw, terminal });
  }
  const missing = [...new Set(report.map(row => row.normalizedStatusValue))].filter(value => !explicitMapping.has(value));
  if (missing.length > 0) throw new Error(`Mapping is incomplete: ${missing.join(', ')}`);
  const revisionPayload = JSON.stringify([...explicitMapping.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const mappingRevision = createHash('sha256').update(revisionPayload).digest('hex');
  const approvedAt = new Date();

  await prisma.$transaction(async tx => {
    for (const [normalizedStatusValue, mapping] of explicitMapping) {
      await tx.tenantOrderStatusClassification.upsert({
        where: { tenantId_normalizedStatusValue: { tenantId, normalizedStatusValue } },
        create: {
          tenantId,
          statusValue: mapping.raw,
          normalizedStatusValue,
          isTerminal: mapping.terminal,
          approvedAt,
          approvedBy: parsed.approvedBy.trim(),
        },
        update: {
          statusValue: mapping.raw,
          isTerminal: mapping.terminal,
          approvedAt,
          approvedBy: parsed.approvedBy.trim(),
        },
      });
    }
    const existingFlag = await tx.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: PRODUCTION_SERVER_V2_FLAG },
      select: { id: true, enabled: true, config: true },
    });
    const config = {
      ...asRecord(existingFlag?.config),
      terminalMappingRevision: mappingRevision,
      terminalMappingApprovedAt: approvedAt.toISOString(),
      terminalFilteringEnabled: false,
    };
    if (existingFlag) {
      await tx.tenantFeatureFlag.update({ where: { id: existingFlag.id }, data: { config } });
    } else {
      await tx.tenantFeatureFlag.create({
        data: { tenantId, scope: tenantId, key: PRODUCTION_SERVER_V2_FLAG, enabled: false, config },
      });
    }
  });
  console.log(JSON.stringify({ mode: 'apply', tenantId, mappingRevision, classifications: explicitMapping.size }, null, 2));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
