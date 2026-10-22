/**
 * Minimal MCP server over Streamable HTTP, JSON responses only (SPEC §6).
 * JSON-RPC 2.0: initialize, ping, tools/list, tools/call; notifications → no body (202).
 * Pure: tools and the audit sink are injected, so tests run without a DB.
 */
import { z } from 'zod'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])

export type JsonRpcId = string | number
export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: { code: number; message: string } }

export const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

/** Thrown by a tool for an expected, user-facing failure (not found, refused…). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export type McpTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Zod schema that validates `arguments` (unknown keys rejected). */
  args: z.ZodTypeAny
  handler: (args: any) => Promise<{ result: unknown; ticketId?: string | null }>
}

export type AuditSink = (row: { tool: string; ticketId: string | null; ok: boolean; error: string | null }) => Promise<void>

const err = (id: JsonRpcId | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

function isId(v: unknown): v is JsonRpcId {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
}

export async function handleMcpMessage(
  msg: unknown,
  ctx: { tools: McpTool[]; audit: AuditSink; instructions?: string },
): Promise<JsonRpcResponse | null> {
  if (Array.isArray(msg)) return err(null, RPC.INVALID_REQUEST, 'Batch requests are not supported')
  if (!msg || typeof msg !== 'object') return err(null, RPC.INVALID_REQUEST, 'Invalid request')
  const m = msg as Record<string, unknown>
  const hasId = 'id' in m && m.id !== null && m.id !== undefined
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string' || (hasId && !isId(m.id))) {
    return err(hasId && isId(m.id) ? m.id : null, RPC.INVALID_REQUEST, 'Invalid request')
  }
  // Notifications (no id) and client responses get no reply.
  if (!hasId) return null
  const id = m.id as JsonRpcId
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>

  switch (m.method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'betsy-support', version: '1.0.0' },
          ...(ctx.instructions ? { instructions: ctx.instructions } : {}),
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: ctx.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        },
      }
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = ctx.tools.find((t) => t.name === name)
      if (!tool) {
        await ctx.audit({ tool: name.slice(0, 80) || '(none)', ticketId: null, ok: false, error: 'unknown_tool' })
        return err(id, RPC.INVALID_PARAMS, `Unknown tool: ${name.slice(0, 80)}`)
      }
      const parsed = tool.args.safeParse(params.arguments ?? {})
      if (!parsed.success) {
        await ctx.audit({ tool: tool.name, ticketId: null, ok: false, error: 'invalid_arguments' })
        const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').slice(0, 5).join(', ')
        return err(id, RPC.INVALID_PARAMS, `Invalid arguments: ${fields}`)
      }
      try {
        const out = await tool.handler(parsed.data)
        await ctx.audit({ tool: tool.name, ticketId: out.ticketId ?? null, ok: true, error: null })
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out.result) }],
            structuredContent: out.result,
          },
        }
      } catch (error) {
        const expected = error instanceof ToolError
        const message = expected ? error.message : 'Internal error'
        await ctx.audit({ tool: tool.name, ticketId: null, ok: false, error: message.slice(0, 300) })
        if (!expected) console.error('[mcp] tool failed', tool.name, (error as Error)?.name)
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: message }], isError: true },
        }
      }
    }
    default:
      return err(id, RPC.METHOD_NOT_FOUND, `Method not found: ${String(m.method).slice(0, 60)}`)
  }
}
