/**
 * Agent pack (one business = one folder outside the repo: pack.json + images/). The pack holds ONLY that business's
 * data; this file holds the shape and loading. Same sales pipeline for every business — swap the pack, not the code.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ScenarioStep } from '@/lib/soft-ai/probar-scenarios'
import type { AgentIntent } from '@/lib/soft-ai/agent-intents'
import { AGENT_NAME_MAX, CHAT_AGENT_MODEL_ALLOWLIST } from '@/lib/soft-ai/agent-types'
import { KNOWLEDGE_NAME_MAX } from '@/lib/soft-ai/knowledge-types'
import { validateShortcutForSave } from '@/lib/soft-ai/shortcuts'

export type PackShortcut = {
  key: string
  title: string
  intents: AgentIntent[]
  keywords: string[]
  body: string
  deliveryMode?: 'guide' | 'verbatim'
  /** 'handoff': sent word for word and the chat goes to a person (must be verbatim, with keywords). Default 'playbook'. */
  kind?: 'playbook' | 'handoff'
  /** File names under images/ (max 3). */
  images?: string[]
}

export type PackTest = { title: string; steps: ScenarioStep[] }

export type AgentPack = {
  schemaVersion: 1
  target: { tenantId: string; actorEmail: string; socialAccountIds: string[] }
  agent: {
    name: string
    emoji?: string
    description?: string
    introductionNames?: string[]
    tonePreset?: 'warm_concise' | 'formal' | 'playful'
    model?: string
    systemInstructions: string
    replyStyle?: Record<string, unknown>
  }
  brandFacts: Record<string, unknown>
  inventory: { names: string[] }
  salesRules: Record<string, unknown>
  systemReplies?: Record<string, string>
  knowledge: Array<{ kind: 'brand_book' | 'policy' | 'faq'; name: string; body: string }>
  shortcuts: PackShortcut[]
  tests: PackTest[]
}

export function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Loads and sanity-checks a pack folder. Throws with a plain message on anything malformed. */
export function loadPack(dir: string): { pack: AgentPack; dir: string } {
  const root = resolve(dir)
  const file = join(root, 'pack.json')
  if (!existsSync(file)) throw new Error(`No existe ${file}`)
  const pack = JSON.parse(readFileSync(file, 'utf8')) as AgentPack
  pack.salesRules ??= {}
  pack.knowledge ??= []
  pack.shortcuts ??= []
  pack.tests ??= []
  pack.target.socialAccountIds ??= []
  const problems: string[] = []
  // Names are matched as stored (trimmed, capped): a name that would be changed on save could miss an existing row.
  const exact = (s: string | undefined, max: number) => typeof s === 'string' && s.length > 0 && s === s.trim() && s.length <= max
  if (pack.schemaVersion !== 1) problems.push('schemaVersion debe ser 1')
  if (!pack.target?.tenantId || !pack.target.actorEmail) problems.push('target.tenantId / target.actorEmail')
  if (!exact(pack.agent?.name, AGENT_NAME_MAX)) problems.push(`agent.name: sin espacios al borde y hasta ${AGENT_NAME_MAX} caracteres`)
  if (!pack.agent?.systemInstructions?.trim()) problems.push('agent.systemInstructions')
  if ((pack.agent?.systemInstructions || '').length > 1200) problems.push('agent.systemInstructions > 1200 caracteres')
  if (pack.agent?.model && !(CHAT_AGENT_MODEL_ALLOWLIST as readonly string[]).includes(pack.agent.model)) problems.push(`modelo no permitido: ${pack.agent.model}`)
  const keys = new Set<string>()
  for (const s of pack.shortcuts) {
    if (s.key.startsWith('sys_')) problems.push(`atajo con clave reservada: ${s.key}`)
    const v = validateShortcutForSave({ ...s, kind: s.kind ?? 'playbook', deliveryMode: s.deliveryMode ?? 'guide' })
    if (!v.ok) problems.push(`atajo ${s.key}: ${v.code}`)
    if (s.title !== s.title.trim() || s.body !== s.body.trim()) problems.push(`atajo ${s.key}: sin espacios al inicio o al final`)
    if (keys.has(s.key)) problems.push(`atajo repetido: ${s.key}`)
    keys.add(s.key)
    for (const img of s.images || []) {
      // A bare file name inside images/ — never a path out of the pack folder.
      if (!/^[\w.-]+\.(?:jpe?g|png|webp)$/i.test(img) || img.includes('..')) problems.push(`nombre de imagen inválido: ${img}`)
      else if (!existsSync(join(root, 'images', img))) problems.push(`falta la imagen ${img}`)
    }
    if ((s.images || []).length > 3) problems.push(`${s.key}: máximo 3 imágenes`)
  }
  for (const [key, body] of Object.entries(pack.systemReplies ?? {})) {
    if (!key.startsWith('sys_') || !body.trim() || body !== body.trim() || body.length > 1500) problems.push(`respuesta del sistema inválida: ${key}`)
  }
  const docNames = new Set<string>()
  for (const k of pack.knowledge) {
    if (!exact(k.name, KNOWLEDGE_NAME_MAX)) problems.push(`conocimiento "${k.name}": sin espacios al borde y hasta ${KNOWLEDGE_NAME_MAX} caracteres`)
    if (docNames.has(`${k.kind}:${k.name}`)) problems.push(`conocimiento repetido: ${k.name}`)
    docNames.add(`${k.kind}:${k.name}`)
    if (k.body.trim().length > 12_000) problems.push(`conocimiento muy largo: ${k.name}`)
  }
  if (problems.length) throw new Error(`Pack inválido:\n- ${problems.join('\n- ')}`)
  return { pack, dir: root }
}
