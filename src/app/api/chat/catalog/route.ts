/**
 * GET /api/chat/catalog?q=&limit= — active products for the inbox composer "Catálogo" picker.
 * tenantId from the session. Sellable fields only (no cost data).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { clampCatalogLimit, parseCatalogQuery } from '@/lib/chat-catalog'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const q = parseCatalogQuery(request.nextUrl.searchParams.get('q'))
    const limit = clampCatalogLimit(request.nextUrl.searchParams.get('limit'))
    const items = await prisma.inventoryItem.findMany({
      where: {
        tenantId: auth.tenantId,
        isActive: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        sellingPrice: true,
        currentStock: true,
        minStock: true,
      },
      orderBy: [{ isFavorite: 'desc' }, { name: 'asc' }],
      take: limit,
    })
    return NextResponse.json(
      {
        success: true,
        items: items.map((item) => ({
          ...item,
          sellingPrice: Number(item.sellingPrice),
          currentStock: Number(item.currentStock),
          minStock: Number(item.minStock),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/catalog GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo cargar el catálogo' }, { status: 500 })
  }
}
