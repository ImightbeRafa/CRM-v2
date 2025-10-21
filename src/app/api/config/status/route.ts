import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET() {
  try {
    const statuses = await prisma.orderStatus.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } })
    return NextResponse.json({ status: 'success', data: statuses })
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : ''
    if (msg.includes('no such table') || msg.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load statuses' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    // Idempotent: if key exists (even inactive), update/reactivate; else create
    const existing = await prisma.orderStatus.findUnique({ where: { key: body.key } })
    if (existing) {
      const updated = await prisma.orderStatus.update({
        where: { id: existing.id },
        data: {
          label: body.label ?? existing.label,
          color: body.color ?? existing.color,
          order: body.order ?? existing.order,
          isActive: true,
        },
      })
      return NextResponse.json({ status: 'success', data: updated })
    }
    const created = await prisma.orderStatus.create({ data: { key: body.key, label: body.label, color: body.color || null, order: Number(body.order) || 0, isActive: true } })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to create status' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const updated = await prisma.orderStatus.update({ where: { id: body.id }, data: { key: body.key, label: body.label, color: body.color || null, order: Number(body.order) || 0, isActive: body.isActive ?? true } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update status' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL((request as any).url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    const updated = await prisma.orderStatus.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to delete status' }, { status: 500 })
  }
}


