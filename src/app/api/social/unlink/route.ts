import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/db'
import { withTenantContext } from '@/lib/tenantContext'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/social/unlink
 * Unlink (delete) a social account
 */
export async function DELETE(request: NextRequest) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = token.tenantId as string
    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('id')

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
    }

    // First, check if account exists at all (without tenant filter)
    const db = prisma as any
    const accountCheck = await db.$queryRaw`
      SELECT id, "tenantId", platform, "accountId" 
      FROM "SocialAccount" 
      WHERE id = ${accountId}
    `
    
    console.log('[social/unlink] Account check:', accountCheck)
    console.log('[social/unlink] Requested tenantId:', tenantId)

    if (!accountCheck || (accountCheck as any[]).length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const account = (accountCheck as any[])[0]
    
    // Verify tenant ownership
    if (account.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Account does not belong to your tenant' }, { status: 403 })
    }

    // Delete using raw SQL to bypass tenant isolation issues
    // Note: CASCADE is set in the schema, so related ChatMessages will be deleted automatically
    await db.$executeRaw`
      DELETE FROM "SocialAccount" 
      WHERE id = ${accountId} AND "tenantId" = ${tenantId}
    `

    console.log(`[social/unlink] Deleted account ${accountId} for tenant ${tenantId}`)

    return NextResponse.json({ 
      success: true,
      message: 'Account unlinked successfully'
    })

  } catch (e: any) {
    console.error('[social/unlink] Error', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
