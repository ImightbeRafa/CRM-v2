/**
 * "Know what sells" (Lane E2) · campaign names for ad ids.
 *
 * Meta only gives campaign / ad set names through the Marketing API with the `ads_read` permission,
 * which the Betsy app does not have yet (needs Meta app review — Rafael's call). Until then this
 * adapter returns no names and the report shows the ad id + headline + link it already has.
 *
 * When `ads_read` is approved: implement the lookup here (Graph `GET /?ids=<ad ids>&fields=campaign{name}`
 * with the tenant's own token, batched ≤ 50 ids, cached per tenant ~1 h, failures → empty map). Callers
 * never change: the report already renders `campaignName` when present.
 */
import 'server-only'

export async function loadCampaignNames(tenantId: string, adIds: readonly string[]): Promise<Map<string, string>> {
  void tenantId
  void adIds
  return new Map()
}
