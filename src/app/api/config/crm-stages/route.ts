import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { loadStages, saveStages } from '@/lib/crm-stages-server'
import { validateStageList, type StagePipeline } from '@/lib/crm-stages'
import { logAuditEvent } from '@/lib/auditLogger'
import { recordActivity } from '@/lib/activity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pipelineOf(value: unknown): StagePipeline | null {
  return value === 'chat' || value === 'client' ? value : null
}

/** Any member of the business can read the lists (the inbox needs them). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPI(request)
  if (!auth.ok) return auth.response
  const pipeline = pipelineOf(request.nextUrl.searchParams.get('pipeline'))
  if (!pipeline) return NextResponse.json({ success: false, error: 'pipeline debe ser chat o client' }, { status: 400 })
  const result = await loadStages(auth.tenantId, pipeline)
  return NextResponse.json({ success: true, pipeline, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const json = (await request.json().catch(() => null)) as { pipeline?: unknown; stages?: unknown } | null
  const pipeline = pipelineOf(json?.pipeline)
  if (!pipeline) return NextResponse.json({ success: false, error: 'pipeline debe ser chat o client' }, { status: 400 })
  const valid = validateStageList(pipeline, json?.stages)
  if (!valid.ok) return NextResponse.json({ success: false, error: valid.error }, { status: 400 })

  const current = await loadStages(auth.tenantId, pipeline)
  if (!current.available) {
    return NextResponse.json({ success: false, error: 'La personalización de etapas aún no está disponible.' }, { status: 503 })
  }
  await saveStages(auth.tenantId, pipeline, valid.stages, auth.userId)
  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'CrmStage',
    entityId: `${auth.tenantId}:${pipeline}`,
    description: pipeline === 'chat' ? 'Etapas de chats actualizadas' : 'Etapas de clientes actualizadas',
    oldValues: { keys: current.stages.map((s) => s.key) },
    newValues: { keys: valid.stages.map((s) => s.key) },
    userId: auth.userId,
    userRole: auth.role,
    tenantId: auth.tenantId,
  }).catch(() => {})
  void recordActivity({ tenantId: auth.tenantId, actorUserId: auth.userId, verb: 'config.stages.save', surface: 'config', props: { pipeline, count: valid.stages.length } })
  const saved = await loadStages(auth.tenantId, pipeline)
  return NextResponse.json({ success: true, pipeline, ...saved })
}
