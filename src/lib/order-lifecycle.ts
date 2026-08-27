import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { OrderLifecycleAdapter } from '@/lib/feature-flags';

type Tx = Prisma.TransactionClient;

export class OrderLifecycleError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'OrderLifecycleError';
  }
}

export function normalizeClientPhone(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('506')) return digits.slice(3);
  return digits;
}

export function normalizeClientEmail(value: unknown): string | null {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function stringOrEmpty(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type ClientResolutionInput = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  province?: unknown;
  canton?: unknown;
  district?: unknown;
  address?: unknown;
  business?: unknown;
  username?: unknown;
};

export function chooseClientIdentityMatch(
  normalizedPhone: string | null,
  phoneMatches: Array<{ id: string; normalizedPhone?: string | null }>,
  emailMatches: Array<{ id: string; normalizedPhone?: string | null }>,
) {
  const phoneIds = new Set(phoneMatches.map(client => client.id));
  const emailIds = new Set(emailMatches.map(client => client.id));
  if (phoneMatches.length > 1) return { matchId: null, conflict: { reason: 'multiple_phone_matches', candidateIds: [...phoneIds] } };
  if (phoneMatches.length === 1) {
    const matchId = phoneMatches[0].id;
    if (emailIds.size > 0 && !emailIds.has(matchId)) {
      return { matchId: null, conflict: { reason: 'phone_email_disagree', candidateIds: [...new Set([...phoneIds, ...emailIds])] } };
    }
    return { matchId, conflict: null };
  }
  if (emailMatches.length > 1) return { matchId: null, conflict: { reason: 'multiple_email_matches', candidateIds: [...emailIds] } };
  if (emailMatches.length === 1) {
    const emailMatch = emailMatches[0];
    if (normalizedPhone && emailMatch.normalizedPhone && emailMatch.normalizedPhone !== normalizedPhone) {
      return { matchId: null, conflict: { reason: 'email_phone_disagree', candidateIds: [emailMatch.id] } };
    }
    return { matchId: emailMatch.id, conflict: null };
  }
  return { matchId: null, conflict: null };
}

async function resolveClient(
  tx: Tx,
  tenantId: string,
  userId: string,
  input: ClientResolutionInput,
  provisionalKey: string,
  existingClientId?: string | null,
) {
  const normalizedPhone = normalizeClientPhone(input.phone);
  const normalizedEmail = normalizeClientEmail(input.email);

  if (existingClientId) {
    const existing = await tx.client.findFirst({
      where: { id: existingClientId, tenantId, isActive: true },
    });
    if (
      existing &&
      (!normalizedPhone || existing.normalizedPhone === normalizedPhone) &&
      (!normalizedEmail || !existing.normalizedEmail || existing.normalizedEmail === normalizedEmail)
    ) {
      return { client: existing, conflict: null as null | { reason: string; candidateIds: string[] } };
    }
  }

  const phoneMatches = normalizedPhone
    ? await tx.client.findMany({ where: { tenantId, normalizedPhone, isActive: true, isProvisional: false }, take: 3 })
    : [];
  const emailMatches = normalizedEmail
    ? await tx.client.findMany({ where: { tenantId, normalizedEmail, isActive: true, isProvisional: false }, take: 3 })
    : [];

  const choice = chooseClientIdentityMatch(normalizedPhone, phoneMatches, emailMatches);
  const match = choice.matchId
    ? [...phoneMatches, ...emailMatches].find(client => client.id === choice.matchId) || null
    : null;
  const conflict = choice.conflict;

  if (match && !conflict) {
    const client = await tx.client.update({
      where: { id: match.id },
      data: {
        // Fill gaps but never overwrite manually maintained identity data.
        name: match.name || stringOrEmpty(input.name) || 'Cliente sin nombre',
        email: match.email || stringOrEmpty(input.email) || null,
        normalizedEmail: match.normalizedEmail || normalizedEmail,
        province: match.province || stringOrEmpty(input.province),
        canton: match.canton || stringOrEmpty(input.canton),
        district: match.district || stringOrEmpty(input.district),
        address: match.address || stringOrEmpty(input.address) || null,
        business: match.business || stringOrEmpty(input.business) || null,
        username: match.username || stringOrEmpty(input.username) || null,
        lastUpdated: new Date(),
      },
    });
    return { client, conflict: null };
  }

  const missingIdentity = !normalizedPhone && !normalizedEmail;
  const client = await tx.client.create({
    data: {
      tenantId,
      name: stringOrEmpty(input.name) || 'Cliente por confirmar',
      phone: stringOrEmpty(input.phone) || `provisional:${provisionalKey.slice(0, 48)}`,
      email: stringOrEmpty(input.email) || null,
      normalizedPhone,
      normalizedEmail,
      province: stringOrEmpty(input.province),
      canton: stringOrEmpty(input.canton),
      district: stringOrEmpty(input.district),
      address: stringOrEmpty(input.address) || null,
      business: stringOrEmpty(input.business) || null,
      username: stringOrEmpty(input.username) || null,
      totalOrders: 0,
      totalSpent: 0,
      averageOrderValue: 0,
      firstOrder: new Date(),
      lastOrder: new Date(),
      isActive: true,
      isAutoGenerated: true,
      isProvisional: missingIdentity || Boolean(conflict),
      createdBy: userId,
    },
  });
  return { client, conflict };
}

type ProductRequest = { key: string; quantity: number };

export function extractInventoryRequests(order: Record<string, unknown>): ProductRequest[] {
  const requests: ProductRequest[] = [];
  const rawDetails = order.productDetails;
  try {
    const details = typeof rawDetails === 'string' ? JSON.parse(rawDetails) : rawDetails;
    if (Array.isArray(details)) {
      for (const item of details) {
        const data = jsonObject(item);
        const key = stringOrEmpty(data.sku || data.type || data.name);
        const quantity = Math.max(0, Math.trunc(numberOrZero(data.cantidad || data.quantity || 1)));
        if (key && quantity > 0) requests.push({ key, quantity });
      }
      if (requests.length > 0) return requests;
    }
  } catch {
    // Invalid legacy productDetails falls through to the conservative parser.
  }

  const products = stringOrEmpty(order.product).split(',').map(value => value.trim()).filter(Boolean);
  if (products.length === 1) {
    requests.push({ key: products[0], quantity: Math.max(1, Math.trunc(numberOrZero(order.quantity) || 1)) });
  } else {
    for (const key of products) requests.push({ key, quantity: 1 });
  }
  return requests;
}

async function desiredAllocations(tx: Tx, tenantId: string, order: Record<string, unknown>) {
  const desired = new Map<string, number>();
  const unresolved: string[] = [];
  for (const request of extractInventoryRequests(order)) {
    const matches = await tx.inventoryItem.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { sku: { equals: request.key, mode: 'insensitive' } },
          { name: { equals: request.key, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 2,
    });
    if (matches.length !== 1) {
      unresolved.push(request.key);
      continue;
    }
    desired.set(matches[0].id, (desired.get(matches[0].id) || 0) + request.quantity);
  }
  return { desired, unresolved };
}

async function syncInventory(tx: Tx, tenantId: string, orderId: string, order: Record<string, unknown>) {
  const { desired, unresolved } = await desiredAllocations(tx, tenantId, order);
  const existing = await tx.orderInventoryAllocation.findMany({ where: { tenantId, orderId } });
  const old = new Map(existing.map(row => [row.inventoryItemId, row.quantity]));
  const itemIds = new Set([...old.keys(), ...desired.keys()]);

  for (const inventoryItemId of itemIds) {
    const before = old.get(inventoryItemId) || 0;
    const after = desired.get(inventoryItemId) || 0;
    const delta = after - before;
    if (delta > 0) {
      const changed = await tx.inventoryItem.updateMany({
        where: { id: inventoryItemId, tenantId, currentStock: { gte: delta } },
        data: { currentStock: { decrement: delta }, totalSold: { increment: delta }, lastSold: new Date(), lastUpdated: new Date() },
      });
      if (changed.count !== 1) throw new OrderLifecycleError('INSUFFICIENT_STOCK', 'Inventario insuficiente o producto no disponible', 409);
    } else if (delta < 0) {
      const amount = Math.abs(delta);
      const item = await tx.inventoryItem.findFirst({ where: { id: inventoryItemId, tenantId } });
      if (!item) throw new OrderLifecycleError('INVENTORY_ITEM_MISSING', 'El producto asignado ya no existe', 409);
      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          currentStock: { increment: amount },
          totalSold: Math.max(0, item.totalSold - amount),
          lastUpdated: new Date(),
        },
      });
    }

    if (after === 0) {
      await tx.orderInventoryAllocation.deleteMany({ where: { tenantId, orderId, inventoryItemId } });
    } else {
      await tx.orderInventoryAllocation.upsert({
        where: { tenantId_orderId_inventoryItemId: { tenantId, orderId, inventoryItemId } },
        create: { tenantId, orderId, inventoryItemId, quantity: after },
        update: { quantity: after },
      });
    }
  }
  return unresolved;
}

async function refreshClientStats(tx: Tx, tenantId: string, clientId: string | null | undefined) {
  if (!clientId) return;
  const aggregate = await tx.order.aggregate({
    where: { tenantId, clientId },
    _count: { _all: true },
    _sum: { total: true },
    _min: { timestamp: true },
    _max: { timestamp: true },
  });
  const totalOrders = aggregate._count._all;
  const totalSpent = aggregate._sum.total || 0;
  await tx.client.updateMany({
    where: { id: clientId, tenantId },
    data: {
      totalOrders,
      totalSpent,
      averageOrderValue: totalOrders > 0 ? totalSpent / totalOrders : 0,
      ...(aggregate._min.timestamp && { firstOrder: aggregate._min.timestamp }),
      ...(aggregate._max.timestamp && { lastOrder: aggregate._max.timestamp }),
      lastUpdated: new Date(),
    },
  });
}

function auditUserId(userId: string) {
  return userId === 'system' || userId === 'website-integration' ? null : userId;
}

function orderCreateData(tenantId: string, body: Record<string, unknown>, clientId: string) {
  const productCost = numberOrZero(body.productCost);
  const shippingCost = numberOrZero(body.shippingCost);
  const iva = numberOrZero(body.iva);
  const suppliedTotal = numberOrZero(body.total);
  const customFields = jsonObject(body.customFields);
  return {
    tenantId,
    orderId: stringOrEmpty(body.orderId) || `ORDER-${Date.now()}`,
    orderType: stringOrEmpty(body.orderType) || 'EA',
    status: stringOrEmpty(body.status) || 'Pendiente',
    delivery: stringOrEmpty(body.delivery) || 'Pendiente',
    customerName: stringOrEmpty(body.customerName) || 'Cliente sin nombre',
    username: stringOrEmpty(body.username),
    phone: stringOrEmpty(body.phone),
    email: stringOrEmpty(body.email),
    business: stringOrEmpty(body.business),
    product: stringOrEmpty(body.product),
    quantity: Math.trunc(numberOrZero(body.quantity)),
    size: stringOrEmpty(body.size),
    color: stringOrEmpty(body.color),
    packaging: stringOrEmpty(body.packaging),
    customization: stringOrEmpty(body.customization),
    comments: stringOrEmpty(body.comments),
    total: suppliedTotal > 0 ? suppliedTotal : productCost + shippingCost + iva,
    iva,
    shippingCost,
    productCost,
    funnel: stringOrEmpty(body.funnel),
    address: stringOrEmpty(body.address),
    province: stringOrEmpty(body.province),
    canton: stringOrEmpty(body.canton),
    district: stringOrEmpty(body.district),
    courier: stringOrEmpty(body.courier),
    expectedDate: stringOrEmpty(body.expectedDate),
    saleDate: stringOrEmpty(body.saleDate) || new Date().toISOString(),
    agreedDate: stringOrEmpty(body.agreedDate),
    pickupDate: stringOrEmpty(body.pickupDate),
    seller: stringOrEmpty(body.seller),
    salesChannel: stringOrEmpty(body.salesChannel) || null,
    productDetails: typeof body.productDetails === 'string' ? body.productDetails : body.productDetails ? JSON.stringify(body.productDetails) : '',
    timestamp: body.timestamp ? new Date(String(body.timestamp)) : new Date(),
    customFields: Object.keys(customFields).length > 0 ? customFields as Prisma.InputJsonValue : undefined,
    contraEntrega: body.contraEntrega === true,
    cePaymentConfirmed: body.cePaymentConfirmed === true,
    clientId,
    lifecycleVersion: 2,
  };
}

export async function createLifecycleOrder(input: {
  tenantId: string;
  userId: string;
  adapter: OrderLifecycleAdapter;
  idempotencyKey: string;
  data: Record<string, unknown>;
}) {
  const replay = await prisma.orderLifecycleOperation.findUnique({
    where: { tenantId_adapter_idempotencyKey: { tenantId: input.tenantId, adapter: input.adapter, idempotencyKey: input.idempotencyKey } },
    include: { order: true },
  });
  if (replay?.order) return { order: replay.order, idempotentReplay: true, unresolvedInventory: [] as string[] };

  try {
    return await prisma.$transaction(async tx => {
      const resolution = await resolveClient(tx, input.tenantId, input.userId, {
        name: input.data.customerName,
        phone: input.data.phone,
        email: input.data.email,
        province: input.data.province,
        canton: input.data.canton,
        district: input.data.district,
        address: input.data.address,
        business: input.data.business,
        username: input.data.username,
      }, input.idempotencyKey);

      const order = await tx.order.create({ data: orderCreateData(input.tenantId, input.data, resolution.client.id) });
      const unresolvedInventory = await syncInventory(tx, input.tenantId, order.id, order as unknown as Record<string, unknown>);
      if (resolution.conflict) {
        await tx.clientIdentityConflict.create({
          data: {
            tenantId: input.tenantId,
            orderId: order.id,
            normalizedPhone: normalizeClientPhone(input.data.phone),
            normalizedEmail: normalizeClientEmail(input.data.email),
            candidateClientIds: resolution.conflict.candidateIds,
            reason: resolution.conflict.reason,
          },
        });
      }
      await refreshClientStats(tx, input.tenantId, resolution.client.id);
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          action: 'CREATE',
          entityType: 'order',
          entityId: order.id,
          entityName: `Order #${order.orderId}`,
          userId: auditUserId(input.userId),
          userName: input.adapter,
          userRole: 'LIFECYCLE_V2',
          newValues: { status: order.status, total: order.total, clientId: order.clientId, lifecycleVersion: 2 },
        },
      });
      await tx.orderLifecycleOperation.create({
        data: {
          tenantId: input.tenantId,
          adapter: input.adapter,
          operation: 'create',
          idempotencyKey: input.idempotencyKey,
          orderId: order.id,
          result: { unresolvedInventory },
        },
      });
      return { order, idempotentReplay: false, unresolvedInventory };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.orderLifecycleOperation.findUnique({
        where: { tenantId_adapter_idempotencyKey: { tenantId: input.tenantId, adapter: input.adapter, idempotencyKey: input.idempotencyKey } },
        include: { order: true },
      });
      if (raced?.order) return { order: raced.order, idempotentReplay: true, unresolvedInventory: [] as string[] };
    }
    throw error;
  }
}

const mutableOrderFields = new Set([
  'orderType', 'status', 'delivery', 'timestamp', 'customerName', 'username', 'phone', 'email', 'business',
  'product', 'quantity', 'size', 'color', 'packaging', 'customization', 'comments', 'total', 'iva',
  'shippingCost', 'productCost', 'funnel', 'address', 'province', 'canton', 'district', 'courier',
  'expectedDate', 'saleDate', 'agreedDate', 'pickupDate', 'seller', 'salesChannel', 'productDetails',
  'customFields', 'contraEntrega', 'cePaymentConfirmed',
]);

function buildUpdateData(patch: Record<string, unknown>) {
  const data: Record<string, unknown> = { lifecycleVersion: 2 };
  for (const [key, value] of Object.entries(patch)) {
    if (!mutableOrderFields.has(key) || value === undefined) continue;
    if (['quantity', 'total', 'iva', 'shippingCost', 'productCost'].includes(key)) data[key] = value == null ? null : Number(value);
    else if (key === 'timestamp') data[key] = new Date(String(value));
    else if (key === 'productDetails' && typeof value !== 'string') data[key] = JSON.stringify(value);
    else data[key] = value;
  }
  return data;
}

export async function updateLifecycleOrder(input: {
  tenantId: string;
  userId: string;
  adapter: OrderLifecycleAdapter;
  idempotencyKey: string;
  orderId: string;
  patch: Record<string, unknown>;
}) {
  return prisma.$transaction(async tx => {
    const existingOperation = await tx.orderLifecycleOperation.findUnique({
      where: { tenantId_adapter_idempotencyKey: { tenantId: input.tenantId, adapter: input.adapter, idempotencyKey: input.idempotencyKey } },
      include: { order: true },
    });
    if (existingOperation?.order) return { order: existingOperation.order, idempotentReplay: true, unresolvedInventory: [] as string[] };

    const existing = await tx.order.findFirst({ where: { tenantId: input.tenantId, orderId: input.orderId } });
    if (!existing) throw new OrderLifecycleError('ORDER_NOT_FOUND', 'Order not found', 404);
    const hasIdentityPatch = ['customerName', 'phone', 'email'].some(key => input.patch[key] !== undefined);
    let clientId = existing.clientId;
    let conflict: null | { reason: string; candidateIds: string[] } = null;
    if (hasIdentityPatch || !clientId) {
      const merged = { ...existing, ...input.patch };
      const resolution = await resolveClient(tx, input.tenantId, input.userId, {
        name: merged.customerName, phone: merged.phone, email: merged.email,
        province: merged.province, canton: merged.canton, district: merged.district,
        address: merged.address, business: merged.business, username: merged.username,
      }, input.idempotencyKey, existing.clientId);
      clientId = resolution.client.id;
      conflict = resolution.conflict;
    }

    const updateData = { ...buildUpdateData(input.patch), clientId };
    const order = await tx.order.update({ where: { id: existing.id }, data: updateData as Prisma.OrderUpdateInput });
    const productChanged = ['product', 'quantity', 'productDetails'].some(key => input.patch[key] !== undefined);
    const unresolvedInventory = productChanged
      ? await syncInventory(tx, input.tenantId, order.id, order as unknown as Record<string, unknown>)
      : [];
    if (conflict) {
      await tx.clientIdentityConflict.create({
        data: {
          tenantId: input.tenantId,
          orderId: order.id,
          normalizedPhone: normalizeClientPhone(order.phone),
          normalizedEmail: normalizeClientEmail(order.email),
          candidateClientIds: conflict.candidateIds,
          reason: conflict.reason,
        },
      });
    }
    await refreshClientStats(tx, input.tenantId, existing.clientId);
    await refreshClientStats(tx, input.tenantId, clientId);
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        action: 'UPDATE',
        entityType: 'order',
        entityId: order.id,
        entityName: `Order #${order.orderId}`,
        userId: auditUserId(input.userId),
        userName: input.adapter,
        userRole: 'LIFECYCLE_V2',
        oldValues: { status: existing.status, total: existing.total, clientId: existing.clientId },
        newValues: { status: order.status, total: order.total, clientId: order.clientId },
      },
    });
    await tx.orderLifecycleOperation.create({
      data: { tenantId: input.tenantId, adapter: input.adapter, operation: 'update', idempotencyKey: input.idempotencyKey, orderId: order.id, result: { unresolvedInventory } },
    });
    return { order, idempotentReplay: false, unresolvedInventory };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setLifecycleOrderStatus(input: {
  tenantId: string; userId?: string; adapter: OrderLifecycleAdapter; idempotencyKey: string; orderId: string; status: string; courier?: string;
}) {
  const result = await updateLifecycleOrder({
    tenantId: input.tenantId,
    userId: input.userId || 'system',
    adapter: input.adapter,
    idempotencyKey: input.idempotencyKey,
    orderId: input.orderId,
    patch: { status: input.status, ...(input.courier && { courier: input.courier }) },
  });
  return result;
}

export async function confirmLifecycleCashPayment(input: {
  tenantId: string; userId: string; idempotencyKey: string; orderId: string;
}) {
  const existing = await prisma.order.findFirst({ where: { tenantId: input.tenantId, orderId: input.orderId } });
  if (!existing) throw new OrderLifecycleError('ORDER_NOT_FOUND', 'Order not found', 404);
  if (!existing.contraEntrega) throw new OrderLifecycleError('NOT_CASH_ON_DELIVERY', 'Order is not contra entrega');
  return updateLifecycleOrder({
    tenantId: input.tenantId,
    userId: input.userId,
    adapter: 'ce-confirmation',
    idempotencyKey: input.idempotencyKey,
    orderId: input.orderId,
    patch: { cePaymentConfirmed: true },
  });
}

export function lifecycleIdempotencyKey(request: Request, fallback: string) {
  return request.headers.get('idempotency-key')?.trim() || fallback;
}
