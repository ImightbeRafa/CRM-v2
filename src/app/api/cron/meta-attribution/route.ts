import { NextRequest, NextResponse } from 'next/server'
import { requireCronBearer } from '@/lib/ops/cron-auth'
import { listEnabledTenants, senderSwitchOn } from '@/lib/meta-attribution/settings'
import { sweepTenant } from '@/lib/meta-attribution/sweep'
import { sendPendingEvents } from '@/lib/meta-attribution/sender'
import { refreshTenantDatasets } from '@/lib/meta-attribution/dataset'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATASET_RECHECK_MS = 24 * 60 * 60_000
const MAX_DATASET_CHECKS_PER_RUN = 5

/**
 * Every 5 min: queue paid ad sales, then send them. Does NOTHING unless the server switch
 * META_SALES_CAPI_SENDER=1 is set (Cloudflare only) — and then only for businesses that turned
 * the feature on. Never touches WhatsApp messaging.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request)
  if (denied) return denied
  if (!senderSwitchOn()) return NextResponse.json({ ok: true, disabled: 'sender_switch_off' })

  const tenants = await listEnabledTenants()
  let checks = 0
  const sweeps = []
  for (const tenantId of tenants) {
    if (checks < MAX_DATASET_CHECKS_PER_RUN) {
      const stale = await prisma.metaCapiDataset
        .findFirst({ where: { tenantId, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - DATASET_RECHECK_MS) } }] }, select: { socialAccountId: true } })
        .catch(() => null)
      const known = await prisma.metaCapiDataset.count({ where: { tenantId } }).catch(() => 0)
      if (stale || known === 0) {
        checks += 1
        await refreshTenantDatasets(tenantId).catch(() => undefined)
      }
    }
    sweeps.push(await sweepTenant(tenantId).catch(() => ({ tenantId, failed: true })))
  }
  const sent = await sendPendingEvents()
  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    queued: sweeps.reduce((n, s) => n + ('queued' in s ? s.queued : 0), 0),
    sent,
  })
}
