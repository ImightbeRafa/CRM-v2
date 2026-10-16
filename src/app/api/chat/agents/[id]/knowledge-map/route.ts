/**
 * GET /api/chat/agents/[id]/knowledge-map — the agent's Mapa de conocimiento: standard template per product and
 * store, measured against what fits the prompt, conflicts with the structured facts, and the live gaps (questions
 * the agent could not answer in the last 90 days). Read-only. tenantId from the session; view_config; customer
 * questions only for people who can edit the agent (update_config, like Corregir). Rate-limited and cached for a
 * short time (SecureDog INT-127 / INT-128); `?fresh=1` (sent right after a knowledge change) skips the cache.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { loadKnowledgeMap, type KnowledgeMapResult } from '@/lib/soft-ai/knowledge-map-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const mapRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-agent-knowledge-map' })
const CACHE_MS = 30_000
const CACHE_MAX = 500
const cache = new Map<string, { at: number; map: KnowledgeMapResult }>()

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const rate = await mapRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiadas consultas. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const includeGaps = hasPermission(auth.role, 'update_config')
    const key = `${auth.tenantId}:${id}:${includeGaps ? 'g' : '-'}`
    const fresh = request.nextUrl.searchParams.get('fresh') === '1'
    const hit = cache.get(key)
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
      return NextResponse.json({ success: true, map: hit.map }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const map = await loadKnowledgeMap({ tenantId: auth.tenantId, agentId: id, includeGaps })
    if (!map) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(key, { at: Date.now(), map })
    return NextResponse.json({ success: true, map }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/agents/knowledge-map GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar el mapa' }, { status: 500 })
  }
}
