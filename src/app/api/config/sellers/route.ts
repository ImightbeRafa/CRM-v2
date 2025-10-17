import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET() {
  try {
    const sellers = await prisma.seller.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
    return NextResponse.json({ status: 'success', data: sellers })
  } catch (error) {
    // If table doesn't exist yet, return empty array
    if (error instanceof Error && error.message.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load sellers' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const created = await prisma.seller.create({ data: { name: body.name, active: true } })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to create seller' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const updated = await prisma.seller.update({ where: { id: body.id }, data: { name: body.name, active: body.active ?? true } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update seller' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL((request as any).url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    const updated = await prisma.seller.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to delete seller' }, { status: 500 })
  }
}


