/**
 * GET /api/chat/stream — Server-Sent Events "something changed" ticks for the inbox.
 * Off unless CHAT_SSE=1 (the client then keeps polling every 5 s). No data in frames: the client
 * re-reads /api/chat/conversations/changes on every tick. Closes after 5 minutes; the client reconnects.
 * ?probe=1 answers JSON {enabled} so the client can decide without opening a stream.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatSseEnabled, subscribeChatTicks } from '@/lib/chat-stream-hub'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 20_000
const MAX_LIFETIME_MS = 5 * 60_000

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response

  if (request.nextUrl.searchParams.get('probe') === '1') {
    return NextResponse.json({ enabled: chatSseEnabled() }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (!chatSseEnabled()) {
    return NextResponse.json({ error: 'disabled' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  if (request.signal.aborted) return new Response(null, { status: 204 })
  const encoder = new TextEncoder()
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }
      const unsubscribe = subscribeChatTicks(auth.tenantId, (revision) => {
        send(`event: tick\ndata: ${JSON.stringify({ revision })}\n\n`)
      })
      if (!unsubscribe) {
        send('event: full\ndata: {}\n\n')
        closed = true
        controller.close()
        return
      }
      const heartbeat = setInterval(() => send('event: ping\ndata: {}\n\n'), HEARTBEAT_MS)
      const lifetime = setTimeout(() => close(), MAX_LIFETIME_MS)
      function close() {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        clearTimeout(lifetime)
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      cleanup = close
      request.signal.addEventListener('abort', close)
      send('retry: 5000\nevent: ready\ndata: {}\n\n')
    },
    cancel() {
      cleanup?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
