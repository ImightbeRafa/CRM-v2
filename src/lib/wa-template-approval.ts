/**
 * WhatsApp template APPROVED gate for CRM inbox send.
 * Uses tenant SocialAccount tokens only — never staff WHATSAPP_* env.
 */

export type WhatsAppTemplateStatusRow = {
  name: string
  language: string
  status: string
  category?: string
}

/** Meta statuses that may be sent as customer templates. */
export function isWhatsAppTemplateStatusApproved(status: string | null | undefined): boolean {
  const normalized = String(status || '')
    .trim()
    .toUpperCase()
  return normalized === 'APPROVED' || normalized === 'ACTIVE'
}

export function normalizeWhatsAppTemplateRows(rawList: unknown): WhatsAppTemplateStatusRow[] {
  if (!Array.isArray(rawList)) return []
  return rawList
    .map((row: any) => ({
      name: String(row?.name || '').trim(),
      language: String(row?.language || 'es').trim() || 'es',
      status: String(row?.status || '').toUpperCase(),
      category: row?.category ? String(row.category) : undefined,
    }))
    .filter((t) => Boolean(t.name))
}

export function filterApprovedWhatsAppTemplates(
  rows: WhatsAppTemplateStatusRow[],
): WhatsAppTemplateStatusRow[] {
  return rows.filter((t) => isWhatsAppTemplateStatusApproved(t.status))
}

/**
 * Find an APPROVED/ACTIVE template matching name + language (case-insensitive language).
 * Returns null when missing or not approved — callers must reject send.
 */
export function findApprovedWhatsAppTemplate(
  rows: WhatsAppTemplateStatusRow[],
  templateName: string,
  templateLanguage: string,
): WhatsAppTemplateStatusRow | null {
  const name = templateName.trim()
  const language = (templateLanguage || 'es').trim().toLowerCase() || 'es'
  if (!name) return null
  const match = rows.find(
    (t) =>
      t.name === name &&
      t.language.toLowerCase() === language &&
      isWhatsAppTemplateStatusApproved(t.status),
  )
  return match || null
}

export function templateNotApprovedErrorMessage(
  templateName: string,
  status?: string | null,
): string {
  const name = templateName.trim() || 'plantilla'
  const st = String(status || '').trim().toUpperCase()
  if (st && !isWhatsAppTemplateStatusApproved(st)) {
    return `Plantilla "${name}" no está APPROVED (estado: ${st}). Solo se pueden enviar plantillas aprobadas por Meta.`
  }
  return `Plantilla "${name}" no está APPROVED o no existe en esta WABA. Solo se pueden enviar plantillas aprobadas por Meta.`
}
