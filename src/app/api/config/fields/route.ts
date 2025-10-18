import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET() {
  try {
    const fields = await prisma.productField.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      include: { optionSet: { include: { options: { where: { active: true } } } } },
    })
    return NextResponse.json({ status: 'success', data: fields })
  } catch (error) {
    // If table doesn't exist yet, return empty array
    if (error instanceof Error && error.message.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load fields' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { authorized } = await requireAdmin(request)
    if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const body = await request.json()
    
    const created = await prisma.productField.create({
      data: {
        key: body.key,
        label: body.label,
        type: body.type,
        required: Boolean(body.required),
        order: Number(body.order) || 0,
        optionSetId: body.optionSetId || null,
        multiSelect: Boolean(body.multiSelect),
        active: true,
      },
    })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    console.error('Error creating field:', e)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to create field',
      details: e instanceof Error ? e.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const updated = await prisma.productField.update({
      where: { id: body.id },
      data: {
        label: body.label,
        type: body.type,
        required: body.required,
        order: Number(body.order),
        optionSetId: body.optionSetId || null,
        multiSelect: Boolean(body.multiSelect),
        active: body.active ?? true,
      },
    })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update field' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL((request as any).url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  try {
    const updated = await prisma.productField.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to delete field' }, { status: 500 })
  }
}


