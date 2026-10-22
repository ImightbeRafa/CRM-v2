/**
 * Pure: shapes a month of AiUsageEvent groups (day × feature × agent) into the usage page's tables.
 * Billed amounts per row are ceil(list × markup) for display; the month total uses the same rule on the month sum
 * (it can differ from the sum of rows by a few micros, never by a cent shown on screen).
 */
import { billedFromList, isBillableFeature, type AiBillingRate } from './math'

export const FEATURE_LABELS: Record<string, string> = {
  inbox_agent: 'Agente en chats',
  payment_check: 'Revisión de comprobantes',
  vision: 'Lectura de imágenes',
  customer_paste: 'Pegar datos del cliente',
  agent_import: 'Importar conocimiento',
  shortcut_import: 'Importar respuestas',
  staff_bot: 'Asistente del equipo',
  staff_bot_voice: 'Asistente del equipo (voz)',
  agent_test: 'Pruebas del agente',
  probar: 'Probar agente',
  transcription: 'Transcripción',
  template: 'Plantillas',
  other: 'Otros',
}

export type UsageGroup = { day: string; feature: string; agentId: string | null; events: number; listMicros: number }

export type UsageReport = {
  periodKey: string
  rate: AiBillingRate
  totals: { billableListMicros: number; billedMicros: number; includedListMicros: number; events: number }
  days: Array<{ day: string; billedMicros: number; includedListMicros: number; events: number }>
  byFeature: Array<{ feature: string; label: string; billable: boolean; events: number; listMicros: number; billedMicros: number }>
  byAgent: Array<{ agentId: string; events: number; billedMicros: number }>
}

export function buildUsageReport(groups: UsageGroup[], rate: AiBillingRate, periodKey: string): UsageReport {
  const days = new Map<string, { billable: number; included: number; events: number }>()
  const features = new Map<string, { events: number; list: number }>()
  const agents = new Map<string, { events: number; list: number }>()
  let billableList = 0
  let includedList = 0
  let events = 0
  for (const g of groups) {
    const billable = isBillableFeature(g.feature)
    const d = days.get(g.day) ?? { billable: 0, included: 0, events: 0 }
    if (billable) d.billable += g.listMicros
    else d.included += g.listMicros
    d.events += g.events
    days.set(g.day, d)
    const f = features.get(g.feature) ?? { events: 0, list: 0 }
    f.events += g.events
    f.list += g.listMicros
    features.set(g.feature, f)
    if (g.agentId && billable) {
      const a = agents.get(g.agentId) ?? { events: 0, list: 0 }
      a.events += g.events
      a.list += g.listMicros
      agents.set(g.agentId, a)
    }
    if (billable) billableList += g.listMicros
    else includedList += g.listMicros
    events += g.events
  }
  return {
    periodKey,
    rate,
    totals: { billableListMicros: billableList, billedMicros: billedFromList(billableList, rate.markupBps), includedListMicros: includedList, events },
    days: [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, v]) => ({ day, billedMicros: billedFromList(v.billable, rate.markupBps), includedListMicros: v.included, events: v.events })),
    byFeature: [...features.entries()]
      .map(([feature, v]) => {
        const billable = isBillableFeature(feature)
        return {
          feature,
          label: FEATURE_LABELS[feature] ?? feature,
          billable,
          events: v.events,
          listMicros: v.list,
          billedMicros: billable ? billedFromList(v.list, rate.markupBps) : 0,
        }
      })
      .sort((a, b) => Number(b.billable) - Number(a.billable) || b.listMicros - a.listMicros),
    byAgent: [...agents.entries()]
      .map(([agentId, v]) => ({ agentId, events: v.events, billedMicros: billedFromList(v.list, rate.markupBps) }))
      .sort((a, b) => b.billedMicros - a.billedMicros),
  }
}
