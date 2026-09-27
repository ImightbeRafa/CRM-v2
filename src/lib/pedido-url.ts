/**
 * `/ventas` URL state for the Aurora Pedidos surface:
 *   ?pedido=<ref>  opens the detail drawer (ref = public orderId or Order.id)
 *   ?nuevo=1       opens "Crear pedido"
 *   ?buscar=<q>    seeds the Pedidos search 
 */
export interface PedidoParams {
  pedido: string | null
  nuevo: boolean
  buscar: string | null
}

type ParamsLike = { get(name: string): string | null }

const MAX_REF = 120

export function parsePedidoParams(params: ParamsLike | null | undefined): PedidoParams {
  const clean = (value: string | null | undefined) => {
    const v = (value ?? '').trim()
    return v && v.length <= MAX_REF ? v : null
  }
  return {
    pedido: clean(params?.get('pedido')),
    nuevo: params?.get('nuevo') === '1',
    buscar: clean(params?.get('buscar')),
  }
}

export function pedidoHref(ref: string): string {
  return `/ventas?pedido=${encodeURIComponent(ref)}`
}

/** Next query string with `changes` applied on top of `current`; `null` removes a key. */
export function withPedidoParams(
  current: ParamsLike & { toString(): string },
  changes: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current.toString())
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `?${qs}` : ''
}

/** cuid-like ids (Order.id): `c` + ~24 base36 chars. */
export function looksLikeCuid(ref: string): boolean {
  return /^c[a-z0-9]{20,30}$/i.test(ref)
}

export interface PedidoRefLike {
  id?: string
  orderId: string
}

export interface PedidoRefResolvers<T extends PedidoRefLike> {
  /** Sales already loaded in the current range. */
  loaded: T[]
  /** `GET /api/orders?search=<ref>&limit=5` */
  search: (ref: string) => Promise<T[]>
  /** `GET /api/orders/details?id=<ref>` (Order.id only). */
  details: (ref: string) => Promise<T | null>
}

/**
 * Resolve a `?pedido=` ref to an order, cheapest source first:
 * loaded list -> search by public id -> details by cuid. `null` = not found.
 */
export async function resolvePedidoRef<T extends PedidoRefLike>(
  ref: string,
  { loaded, search, details }: PedidoRefResolvers<T>,
): Promise<T | null> {
  const hit = loaded.find((s) => s.orderId === ref || s.id === ref)
  if (hit) return hit
  try {
    const found = await search(ref)
    const exact = found.find((s) => s.orderId === ref || s.id === ref)
    if (exact) return exact
  } catch {
    // fall through to details
  }
  if (looksLikeCuid(ref)) {
    try {
      return await details(ref)
    } catch {
      return null
    }
  }
  return null
}
