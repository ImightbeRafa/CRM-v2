import type { Prisma } from '@prisma/client';
import { hashCursorScope, normalizeStoredStatus, parseOptionalDate } from '@/lib/cursor-pagination';

export const UNCONFIGURED_COLUMN = 'unconfigured';
export const TERMINAL_RETENTION_DAYS = 30;

export interface ProductionQueryInput {
  view: 'list' | 'column';
  statusId: string | null;
  column: string | null;
  search: string;
  orderType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  courier: string | null;
  priority: string | null;
}

export interface ProductionStatusReference {
  id: string;
  label: string;
}

export interface TerminalClassificationReference {
  statusValue: string;
  isTerminal: boolean;
}

export function parseProductionQuery(searchParams: URLSearchParams): ProductionQueryInput {
  const view = searchParams.get('view') === 'column' ? 'column' : 'list';
  const search = (searchParams.get('search') || '').trim();
  if (search.length === 1) throw new Error('Search must contain at least 2 characters');
  const orderType = searchParams.get('orderType');
  if (orderType && !['EA', 'RA'].includes(orderType)) throw new Error('Invalid orderType');
  const priority = searchParams.get('priority');
  if (priority && !['urgent', 'high', 'normal'].includes(priority)) throw new Error('Invalid priority');
  return {
    view,
    statusId: searchParams.get('statusId'),
    column: searchParams.get('column'),
    search,
    orderType,
    dateFrom: searchParams.get('dateFrom'),
    dateTo: searchParams.get('dateTo'),
    courier: searchParams.get('courier'),
    priority,
  };
}

function notMatchingStatuses(labels: string[]): Prisma.OrderWhereInput {
  if (labels.length === 0) return {};
  return {
    NOT: labels.map(label => ({ status: { equals: label, mode: 'insensitive' } })),
  };
}

export function buildProductionWhere(args: {
  input: ProductionQueryInput;
  configuredStatuses: ProductionStatusReference[];
  selectedStatus: ProductionStatusReference | null;
  terminalClassifications: TerminalClassificationReference[];
  terminalFilteringEnabled: boolean;
  now?: Date;
}): Prisma.OrderWhereInput {
  const { input, configuredStatuses, selectedStatus, terminalClassifications, terminalFilteringEnabled } = args;
  const and: Prisma.OrderWhereInput[] = [];
  if (input.view === 'column') {
    if (selectedStatus) {
      and.push({ status: { equals: selectedStatus.label, mode: 'insensitive' } });
      const terminal = terminalFilteringEnabled && terminalClassifications.some(
        item => item.isTerminal && normalizeStoredStatus(item.statusValue) === normalizeStoredStatus(selectedStatus.label),
      );
      if (terminal) {
        const now = args.now || new Date();
        and.push({ timestamp: { gte: new Date(now.getTime() - TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000) } });
      }
    } else if (input.column === UNCONFIGURED_COLUMN) {
      and.push(notMatchingStatuses(configuredStatuses.map(status => status.label)));
    } else {
      throw new Error('Column requests require a valid statusId or unconfigured column');
    }
  } else if (input.column === UNCONFIGURED_COLUMN) {
    and.push(notMatchingStatuses(configuredStatuses.map(status => status.label)));
  } else if (selectedStatus) {
    and.push({ status: { equals: selectedStatus.label, mode: 'insensitive' } });
  }
  if (input.search) {
    and.push({
      OR: [
        { customerName: { contains: input.search, mode: 'insensitive' } },
        { orderId: { contains: input.search, mode: 'insensitive' } },
        { phone: { contains: input.search, mode: 'insensitive' } },
        { product: { contains: input.search, mode: 'insensitive' } },
        { business: { contains: input.search, mode: 'insensitive' } },
      ],
    });
  }
  if (input.orderType) and.push({ orderType: input.orderType });
  if (input.courier) and.push({ courier: { contains: input.courier, mode: 'insensitive' } });
  const dateFrom = parseOptionalDate(input.dateFrom, 'dateFrom');
  const dateTo = parseOptionalDate(input.dateTo, 'dateTo');
  if (dateFrom || dateTo) {
    and.push({ timestamp: { ...(dateFrom && { gte: dateFrom }), ...(dateTo && { lte: dateTo }) } });
  }
  const now = args.now || new Date();
  if (input.priority === 'urgent') {
    and.push({
      OR: [
        { status: { in: ['urgent', 'urgente'], mode: 'insensitive' } },
        { status: { equals: 'Pendiente', mode: 'insensitive' }, timestamp: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      ],
    });
  } else if (input.priority === 'high') {
    and.push({
      status: { equals: 'En Proceso', mode: 'insensitive' },
      timestamp: { lt: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
    });
  }

  if (terminalFilteringEnabled && input.view === 'list' && !selectedStatus) {
    const terminalLabels = terminalClassifications
      .filter(item => item.isTerminal)
      .map(item => item.statusValue);
    if (terminalLabels.length > 0) {
      const cutoff = new Date(now.getTime() - TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      and.push({
        OR: [
          notMatchingStatuses(terminalLabels),
          { timestamp: { gte: cutoff } },
        ],
      });
    }
  }

  return and.length > 0 ? { AND: and } : {};
}

export function productionCursorScope(
  input: ProductionQueryInput,
  selectedStatus: ProductionStatusReference | null,
  mappingRevision: string | null,
) {
  return hashCursorScope({
    view: input.view,
    status: selectedStatus?.id || '',
    column: input.column || '',
    search: input.search.toLowerCase(),
    orderType: input.orderType || '',
    dateFrom: input.dateFrom || '',
    dateTo: input.dateTo || '',
    courier: input.courier?.toLowerCase() || '',
    priority: input.priority || '',
    mappingRevision: mappingRevision || '',
  });
}

export function groupStatusCounts(
  rawCounts: Array<{ status: string; _count: { _all: number } }>,
  statuses: ProductionStatusReference[],
) {
  const counts = new Map(statuses.map(status => [status.id, 0]));
  let unconfigured = 0;
  for (const row of rawCounts) {
    const normalized = normalizeStoredStatus(row.status);
    const match = statuses.find(status => normalizeStoredStatus(status.label) === normalized);
    if (match) counts.set(match.id, (counts.get(match.id) || 0) + row._count._all);
    else unconfigured += row._count._all;
  }
  return { counts: Object.fromEntries(counts), unconfigured };
}
