import type { DocMeta } from '@/lib/docs'
import { getAllDocs } from '@/lib/docs'

/** Docs that exist for staff only and must not appear in the owner Help center. */
export const HELP_HIDDEN_SLUGS: readonly string[] = ['ai-assistant']

export function isHelpHidden(slug: string): boolean {
  return HELP_HIDDEN_SLUGS.includes(slug)
}

/** Private (in-app) docs visible to owners. */
export function getHelpDocs(): DocMeta[] {
  return getAllDocs('private').filter((d) => !isHelpHidden(d.slug))
}
