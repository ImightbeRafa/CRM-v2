/**
 * MCP endpoint for the support agent (SPEC §6): JSON-RPC 2.0 over Streamable HTTP (POST, JSON
 * responses). Auth: `Authorization: Bearer SUPPORT_MCP_TOKEN` only — cookies are ignored.
 * Off (404) unless SUPPORT_PIPELINE_ENABLED=true; 503 when the token is unset/short.
 * 60 requests/min; every tools/call is audited in SupportMcpAudit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { supportPipelineEnabled } from '@/lib/support/config'
import { checkMcpBearer } from '@/lib/support/mcp/auth'
import { RPC, handleMcpMessage, type AuditSink } from '@/lib/support/mcp/protocol'
import { MCP_INSTRUCTIONS, supportMcpTools } from '@/lib/support/mcp/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const limiter = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 60, identifier: 'support-mcp' })
const MAX_BODY = 64_000

const audit: AuditSink = async (row) => {
  try {
    await prisma.supportMcpAudit.create({
      data: { tool: row.tool.slice(0, 80), ticketId: row.ticketId, ok: row.ok, error: row.error?.slice(0, 300) ?? null },
    })
  } catch {
    // Audit must never break the call (e.g. 059 not applied yet).
  }
}

const rpcError = (status: number, code: number, message: string) =>
  NextResponse.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status })

export async function POST(request: NextRequest) {
  if (!supportPipelineEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const auth = checkMcpBearer(request.headers.get('authorization'), process.env.SUPPORT_MCP_TOKEN)
  if (!auth.ok) {
    return auth.status === 503
      ? NextResponse.json({ error: 'MCP not configured' }, { status: 503 })
      : NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  // DNS-rebinding guard (MCP spec): a browser Origin must be our own host.
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host !== request.nextUrl.host) return rpcError(403, RPC.INVALID_REQUEST, 'Origin not allowed')
    } catch {
      return rpcError(403, RPC.INVALID_REQUEST, 'Origin not allowed')
    }
  }
  if (!(await limiter('agent')).allowed) return rpcError(429, RPC.INTERNAL, 'Rate limit exceeded')

  const len = Number(request.headers.get('content-length') || 0)
  if (len > MAX_BODY) return rpcError(413, RPC.INVALID_REQUEST, 'Request too large')
  const text = await request.text()
  if (text.length > MAX_BODY) return rpcError(413, RPC.INVALID_REQUEST, 'Request too large')
  let msg: unknown
  try {
    msg = JSON.parse(text)
  } catch {
    return rpcError(400, RPC.PARSE, 'Parse error')
  }

  const response = await handleMcpMessage(msg, { tools: supportMcpTools(), audit, instructions: MCP_INSTRUCTIONS })
  if (!response) return new NextResponse(null, { status: 202 })
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
}

/** No server-initiated SSE stream. */
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
}
