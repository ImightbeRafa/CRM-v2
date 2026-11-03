/**
 * Revert DeepSleep conversion data apply (2026-11-03).
 *
 * Restores shortcut keywords/bodies and systemInstructions from the ChatAgentVersion
 * snapshot taken immediately before the apply (or a --version=N you name). Disables
 * follow-up campaigns' new stageTexts when --disable-follow-ups is passed.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-conversion-revert.ts [--dry-run] [--apply] \
 *     [--agent=forge|prototipo|pura|all] [--version=N] [--disable-follow-ups]
 *
 * Default: dry-run. Does not delete knowledge docs (unbinds the new FAQ titles only).
 */
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { listShortcuts, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { unbindKnowledgeFromAgent } from '@/lib/soft-ai/knowledge-admin'
import { FOLLOW_UP_FLAG, parseFollowUpConfig } from '@/lib/soft-ai/follow-up'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY || process.argv.includes('--dry-run')
const DISABLE_FU = process.argv.includes('--disable-follow-ups')
const TENANT_ID = 'cmhsibjue0004js04gie724nx'

const AGENTS: Record<string, string> = {
  forge: 'cmub1rziw0005l704mebpx4xc',
  sleeping: 'cmv9xf14x0001vitkkhx2vxd4',
  pura: 'cmvda4onv0001vip0rj6q7jkt',
  prototipo: 'cmvdaghtc0001vi98x3abfr1r',
}

const NEW_FAQ_NAMES = [
  'FAQ — dolor de espalda (sin claims médicos)',
  'FAQ — cómo pagar / pedir / envío / lavado / mayoreo',
  'FAQ — cambio de talla',
]

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function actor() {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: 'rafael@betsycrm.com' }, { email: { contains: 'rafa', mode: 'insensitive' } }] },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!user) throw new Error('No actor user')
  const member = await prisma.membership.findFirst({
    where: { userId: user.id, tenantId: TENANT_ID, isActive: true },
    select: { role: true },
  })
  return {
    actorUserId: user.id,
    actorName: `${user.name || user.email} (deepsleep-conversion-revert)`,
    actorRole: String(member?.role ?? 'OWNER'),
  }
}

async function revertAgent(agentId: string, label: string, versionPin: number | null, act: Awaited<ReturnType<typeof actor>>) {
  const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId: TENANT_ID } })
  if (!agent) {
    console.log(`! ${label} missing`)
    return
  }
  const snap = await prisma.$queryRaw<Array<{ version: number; snapshot: unknown }>>`
    SELECT "version", "snapshot" FROM "ChatAgentVersion"
     WHERE "tenantId" = ${TENANT_ID} AND "agentId" = ${agentId}
       AND "version" = ${versionPin ?? agent.version - 1}
     LIMIT 1`
  if (!snap[0]) {
    console.log(`! ${label}: no ChatAgentVersion at v${versionPin ?? agent.version - 1} (current v${agent.version})`)
    return
  }
  const s = snap[0].snapshot as {
    systemInstructions?: string
    shortcuts?: Array<{ key: string; keywords?: string[]; body?: string }>
  }
  console.log(`~ ${label}: restore snapshot v${snap[0].version} → write new version (current ${agent.version})`)
  if (typeof s.systemInstructions === 'string') {
    console.log(`  instructions: ${s.systemInstructions.slice(0, 80)}…`)
    if (!DRY) {
      await updateChatAgent({
        tenantId: TENANT_ID,
        agentId,
        ...act,
        patch: { systemInstructions: s.systemInstructions },
      })
    }
  }
  if (Array.isArray(s.shortcuts)) {
    const { shortcuts } = await listShortcuts(TENANT_ID, agentId)
    for (const want of s.shortcuts) {
      const row = shortcuts.find((x) => x.key === want.key)
      if (!row || (!want.keywords && !want.body)) continue
      console.log(`  shortcut ${want.key}`)
      if (!DRY) {
        await updateShortcut({
          tenantId: TENANT_ID,
          agentId,
          shortcutId: row.id,
          ...act,
          patch: {
            ...(want.keywords ? { keywords: want.keywords } : {}),
            ...(want.body ? { body: want.body } : {}),
          },
        })
      }
    }
  }
  // Unbind FAQ docs added by the apply script.
  const docs = await prisma.chatKnowledgeSource.findMany({
    where: { tenantId: TENANT_ID, name: { in: NEW_FAQ_NAMES } },
    select: { id: true, name: true },
  })
  for (const d of docs) {
    console.log(`  unbind knowledge "${d.name}"`)
    if (!DRY) {
      await unbindKnowledgeFromAgent({
        tenantId: TENANT_ID,
        agentId,
        sourceId: d.id,
        ...act,
      }).catch(() => null)
    }
  }
}

async function main() {
  console.log(`DeepSleep conversion revert — ${DRY ? 'DRY-RUN' : 'APPLY'}`)
  const which = arg('agent') || 'all'
  const versionPin = arg('version') ? Number(arg('version')) : null
  const act = await actor()
  const ids =
    which === 'all' ? Object.entries(AGENTS) : Object.entries(AGENTS).filter(([k]) => k === which)
  for (const [label, id] of ids) {
    await revertAgent(id, label, versionPin, act)
  }
  if (DISABLE_FU) {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { key: FOLLOW_UP_FLAG, scope: TENANT_ID },
    })
    if (!flag) console.log('! follow-up flag missing')
    else {
      const cfg = parseFollowUpConfig(flag.config)
      const next = {
        campaigns: cfg.campaigns.map((c) => {
          const { stageTexts: _drop, ...rest } = c
          return { ...rest, active: false }
        }),
      }
      console.log(`~ disable follow-ups + clear stageTexts on ${next.campaigns.length} campaigns`)
      if (!DRY) {
        await prisma.tenantFeatureFlag.update({
          where: { id: flag.id },
          data: { enabled: false, config: next as object },
        })
      }
    }
  }
  console.log(`Done (${DRY ? 'dry-run — re-run with --apply' : 'applied'}).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
