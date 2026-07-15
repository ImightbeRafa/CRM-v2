/**
 * Shared audit payload helpers — sanitize snapshots, normalize entity types,
 * and format human-readable field diffs for Auditoría.
 */

const SENSITIVE_KEY_RE =
  /password|passwd|secret|token|apikey|api_key|authorization|auth|hash|salt|privatekey|private_key|refresh/i

/** Internal keys we never show as primary business content */
const HIDDEN_KEYS = new Set([
  'id',
  'tenantId',
  'userId',
  'password',
  'passwordHash',
  'hashedPassword',
  '_meta',
  'changes',
])

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  orderId: 'Nº Orden',
  orderType: 'Tipo',
  status: 'Estado',
  timestamp: 'Fecha',
  customerName: 'Cliente',
  username: 'Usuario',
  phone: 'Teléfono',
  email: 'Email',
  business: 'Negocio',
  product: 'Producto',
  quantity: 'Cantidad',
  size: 'Tamaño',
  color: 'Color',
  packaging: 'Empaque',
  customization: 'Personalización',
  comments: 'Comentarios',
  total: 'Total',
  iva: 'IVA',
  shippingCost: 'Costo de envío',
  productCost: 'Costo de producto',
  address: 'Dirección',
  province: 'Provincia',
  canton: 'Cantón',
  district: 'Distrito',
  courier: 'Mensajería',
  expectedDate: 'Fecha esperada',
  funnel: 'Canal',
  agreedDate: 'Fecha acordada',
  pickupDate: 'Fecha de recogida',
  saleDate: 'Fecha de venta',
  seller: 'Vendedor',
  salesChannel: 'Canal de venta',
  delivery: 'Delivery',
  productDetails: 'Detalle producto',
  customFields: 'Campos personalizados',
  contraEntrega: 'Contra entrega',
  cePaymentConfirmed: 'Pago CE confirmado',
  name: 'Nombre',
  label: 'Etiqueta',
  active: 'Activo',
  role: 'Rol',
  price: 'Precio',
  stock: 'Stock',
  sku: 'SKU',
  description: 'Descripción',
  type: 'Tipo',
  value: 'Valor',
}

/** Fields worth keeping in order delete/create snapshots */
const ORDER_SNAPSHOT_KEYS = [
  'orderId',
  'orderType',
  'status',
  'timestamp',
  'customerName',
  'username',
  'phone',
  'email',
  'business',
  'product',
  'quantity',
  'size',
  'color',
  'packaging',
  'customization',
  'comments',
  'total',
  'iva',
  'shippingCost',
  'productCost',
  'address',
  'province',
  'canton',
  'district',
  'courier',
  'expectedDate',
  'funnel',
  'agreedDate',
  'pickupDate',
  'saleDate',
  'seller',
  'salesChannel',
  'delivery',
  'productDetails',
  'customFields',
  'contraEntrega',
  'cePaymentConfirmed',
] as const

const GENERIC_SNAPSHOT_KEYS = [
  'name',
  'label',
  'username',
  'email',
  'phone',
  'active',
  'role',
  'status',
  'type',
  'price',
  'stock',
  'sku',
  'description',
  'value',
  'orderId',
  'customer',
] as const

export function normalizeEntityType(entityType: string): string {
  const key = String(entityType || '')
  const map: Record<string, string> = {
    orders: 'order',
    users: 'user',
    fields: 'field',
    optionSets: 'optionSet',
    options: 'option',
    shipping: 'shipping',
    sellers: 'seller',
    Seller: 'seller',
    sale: 'order',
    Order: 'order',
    Client: 'client',
    InventoryItem: 'inventory',
    inventoryitem: 'inventory',
    // Prisma model names from middleware (often lowercased)
    productfield: 'field',
    ProductField: 'field',
    shippingmethod: 'shipping',
    ShippingMethod: 'shipping',
    productoption: 'option',
    ProductOption: 'option',
    productoptionset: 'optionSet',
    ProductOptionSet: 'optionSet',
    orderstatus: 'status',
    OrderStatus: 'status',
    shippingconfig: 'shipping',
    ShippingConfig: 'shipping',
    shippingguia: 'shipping',
    ShippingGuia: 'shipping',
  }
  return map[key] || map[key.toLowerCase()] || key
}

/** Entity type filter aliases for GET /api/audit/logs */
export function entityTypeFilterAliases(entityType: string): string[] {
  const normalized = normalizeEntityType(entityType)
  const groups: Record<string, string[]> = {
    order: ['order', 'orders', 'sale', 'Order'],
    user: ['user', 'users'],
    field: ['field', 'fields', 'productfield', 'ProductField'],
    option: ['option', 'options', 'productoption', 'ProductOption'],
    optionSet: ['optionSet', 'optionSets', 'productoptionset', 'ProductOptionSet'],
    seller: ['seller', 'sellers', 'Seller'],
    shipping: [
      'shipping',
      'shippingmethod',
      'ShippingMethod',
      'shippingconfig',
      'ShippingConfig',
      'shippingguia',
      'ShippingGuia',
    ],
    status: ['status', 'orderstatus', 'OrderStatus'],
    inventory: ['inventory', 'inventoryitem', 'InventoryItem'],
    client: ['client', 'Client'],
  }
  return groups[normalized] || [entityType, normalized]
}

export function hasMeaningfulOldValues(oldValues: unknown): boolean {
  if (!oldValues || typeof oldValues !== 'object' || Array.isArray(oldValues)) return false
  const obj = oldValues as Record<string, unknown>
  return Object.keys(obj).some((key) => !HIDDEN_KEYS.has(key) && !isSensitiveKey(key))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key)
}

export function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > 4) return '[…]'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditPayload(item, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) continue
    out[key] = sanitizeAuditPayload(val, depth + 1)
  }
  return out
}

export function pickSnapshot(
  entityType: string,
  record: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!record || typeof record !== 'object') return null

  const normalized = normalizeEntityType(entityType)
  const keys =
    normalized === 'order' || normalized === 'sale'
      ? ORDER_SNAPSHOT_KEYS
      : GENERIC_SNAPSHOT_KEYS

  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      picked[key] = record[key]
    }
  }

  // Fallback: take a few non-sensitive top-level scalars if allowlist empty
  if (Object.keys(picked).length === 0) {
    for (const [key, val] of Object.entries(record)) {
      if (HIDDEN_KEYS.has(key) || isSensitiveKey(key)) continue
      if (val === null || val === undefined || val === '') continue
      if (typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) continue
      picked[key] = val
      if (Object.keys(picked).length >= 12) break
    }
  }

  return sanitizeAuditPayload(picked) as Record<string, unknown>
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'N/A'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value instanceof Date) {
    return value.toLocaleString('es-CR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  if (typeof value === 'string') {
    // ISO date-ish
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value)
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString('es-CR', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      }
    }
    return value.length > 200 ? `${value.slice(0, 200)}…` : value
  }
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    try {
      const s = JSON.stringify(value)
      return s.length > 200 ? `${s.slice(0, 200)}…` : s
    } catch {
      return `[${value.length} items]`
    }
  }
  if (isPlainObject(value)) {
    try {
      const s = JSON.stringify(value)
      return s.length > 200 ? `${s.slice(0, 200)}…` : s
    } catch {
      return 'objeto'
    }
  }
  return String(value)
}

export function labelForField(key: string): string {
  return AUDIT_FIELD_LABELS[key] || key
}

export function buildFieldDiffLines(
  oldValues: Record<string, unknown> | null | undefined,
  newValues: Record<string, unknown> | null | undefined
): string[] {
  // Require real before-state — otherwise every create/partial update becomes fake "N/A → …" lines
  if (!hasMeaningfulOldValues(oldValues) || !newValues || typeof newValues !== 'object') return []
  const oldObj = (oldValues || {}) as Record<string, unknown>
  const newObj = (newValues || {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  const lines: string[] = []

  for (const key of keys) {
    if (HIDDEN_KEYS.has(key) || isSensitiveKey(key) || key === 'changes') continue
    const from = oldObj[key]
    const to = newObj[key]
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    // Skip if both empty
    if ((from === null || from === undefined || from === '') &&
        (to === null || to === undefined || to === '')) continue
    lines.push(
      `${labelForField(key)}: "${formatAuditValue(from)}" → "${formatAuditValue(to)}"`
    )
  }
  return lines
}

export function entriesForDisplay(
  values: Record<string, unknown> | null | undefined
): { key: string; label: string; value: string }[] {
  if (!values || typeof values !== 'object') return []
  return Object.entries(values)
    .filter(([key]) => !HIDDEN_KEYS.has(key) && !isSensitiveKey(key))
    .map(([key, value]) => ({
      key,
      label: labelForField(key),
      value: formatAuditValue(value),
    }))
}

/** Resolve displayable reason text, dropping noisy English middleware stubs when richer data exists */
export function isNoisyAutoReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  return /^Performed\s+\w+\s+on\s+/i.test(reason)
}
