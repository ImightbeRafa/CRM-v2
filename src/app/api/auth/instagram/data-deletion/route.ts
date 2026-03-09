import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET handler for Meta verification
 * Meta checks if the endpoint exists before approving the app
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Data deletion endpoint is active',
    method: 'POST',
    description: 'Send a POST request with signed_request parameter to delete user data'
  })
}

/**
 * Instagram Data Deletion Request endpoint (required for Meta compliance)
 * When a user deletes your app from their Instagram/Facebook account,
 * Meta will call this endpoint to request deletion of their data.
 * 
 * Must return a JSON with { url: "status_url" } or { confirmation_code: "code" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('[instagram/data-deletion] Request received', body)

    // Extract user ID from the signed request
    // Meta sends: { signed_request: "signature.payload" }
    const signedRequest = body.signed_request
    
    if (!signedRequest) {
      console.error('[instagram/data-deletion] No signed_request provided')
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Parse the signed request (format: signature.base64_payload)
    const [encodedSig, payload] = signedRequest.split('.')
    if (!payload || !encodedSig) {
      console.error('[instagram/data-deletion] Invalid signed_request format')
      return NextResponse.json({ error: 'Invalid request format' }, { status: 400 })
    }

    // Verify HMAC signature using Meta app secret
    const appSecret = (process.env.META_APP_SECRET || '').trim()
    if (!appSecret) {
      console.error('[instagram/data-deletion] META_APP_SECRET not configured')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }
    const expectedSig = crypto.createHmac('sha256', appSecret).update(payload).digest('hex')
    const providedSig = Buffer.from(encodedSig, 'base64url').toString('hex')
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(providedSig, 'hex'))) {
      console.error('[instagram/data-deletion] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // Decode the verified payload
    const decodedPayload = Buffer.from(payload, 'base64').toString('utf-8')
    const data = JSON.parse(decodedPayload)
    const userId = data.user_id

    console.log('[instagram/data-deletion] Processing deletion for user:', userId)

    // Delete all SocialAccount records for this Instagram user across all tenants
    const db = prisma as any
    const deletedAccounts = await db.socialAccount.deleteMany({
      where: {
        platform: 'instagram',
        accountId: String(userId)
      }
    })

    console.log('[instagram/data-deletion] Deleted accounts:', deletedAccounts.count)

    // Also delete any ChatMessages associated with those accounts
    // (Note: This is already handled by CASCADE in the schema)

    // Generate a confirmation code
    const confirmationCode = `BETSY-DELETE-${userId}-${Date.now()}`

    // Return confirmation
    // You can return either:
    // 1) { confirmation_code: "code" } - immediate confirmation
    // 2) { url: "https://yourapp.com/deletion-status/123" } - status URL for async deletion
    return NextResponse.json({ 
      confirmation_code: confirmationCode,
      status: 'deleted',
      deleted_accounts: deletedAccounts.count
    })

  } catch (e: any) {
    console.error('[instagram/data-deletion] Error', e)
    return NextResponse.json({ 
      error: 'Internal server error',
      confirmation_code: `BETSY-ERROR-${Date.now()}`
    }, { status: 500 })
  }
}
