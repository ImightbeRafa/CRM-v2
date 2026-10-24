/**
 * "Know what sells" (Lane E2) · campaign names for ad ids.
 *
 * Meta only gives campaign / ad set names through the Marketing API with the `ads_read` permission. With an ad
 * account connected (Config › Cuentas sociales › Cuenta publicitaria) the names come from
 * src/lib/meta-ads/insights.ts (`GET /?ids=…&fields=name,campaign{name},adset{name}`, the business's own token,
 * batched ≤ 50, cached 1 h). Without a connection, or on any failure: no names, and the report shows the ad id +
 * headline + link it already has. Callers never change: the report renders `campaignName` when present.
 */
import 'server-only'
import { loadAdNames } from '@/lib/meta-ads/insights'

export async function loadCampaignNames(tenantId: string, adIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const found = await loadAdNames(tenantId, adIds)
    for (const [id, n] of found) if (n.campaign) out.set(id, n.campaign)
  } catch {
    // Names are a nice-to-have: the report never fails because of them.
  }
  return out
}
