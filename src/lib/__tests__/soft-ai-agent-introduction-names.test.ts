/**
 * A1.5 — introductionNames normalize + prompt identity layer + schema/SQL markers.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INTRODUCTION_NAMES_MAX,
  INTRODUCTION_NAME_MAX_LEN,
  normalizeIntroductionNames,
} from '../soft-ai/agent-types'
import {
  IMMUTABLE_SAFETY_POLICY,
  buildAgentSystemInstructions,
} from '../soft-ai/llm/prompt'

const ROOT = process.cwd()

describe('normalizeIntroductionNames (A1.5)', () => {
  it('accepts 1–3 unique trimmed names', () => {
    assert.deepEqual(normalizeIntroductionNames(['  Sofía ', 'Forge']), ['Sofía', 'Forge'])
    assert.deepEqual(normalizeIntroductionNames(['Forge']), ['Forge'])
    assert.deepEqual(normalizeIntroductionNames([]), [])
    assert.deepEqual(normalizeIntroductionNames(null), [])
  })

  it('rejects duplicates, empties, oversize, and 4th name', () => {
    assert.throws(() => normalizeIntroductionNames(['A', 'a']), /INTRODUCTION_NAMES_INVALID/)
    assert.throws(() => normalizeIntroductionNames(['']), /INTRODUCTION_NAMES_INVALID/)
    assert.throws(() => normalizeIntroductionNames(['ok', ' ']), /INTRODUCTION_NAMES_INVALID/)
    assert.throws(
      () => normalizeIntroductionNames(['x'.repeat(INTRODUCTION_NAME_MAX_LEN + 1)]),
      /INTRODUCTION_NAMES_INVALID/,
    )
    assert.throws(
      () => normalizeIntroductionNames(['a', 'b', 'c', 'd']),
      /INTRODUCTION_NAMES_INVALID/,
    )
    assert.throws(() => normalizeIntroductionNames('Forge'), /INTRODUCTION_NAMES_INVALID/)
    assert.equal(INTRODUCTION_NAMES_MAX, 3)
  })
})

describe('buildAgentSystemInstructions identity layer (A1.5)', () => {
  it('keeps immutable safety first and injects identity before voice', () => {
    const out = buildAgentSystemInstructions({
      systemInstructions: 'Voz editable de prueba.',
      tonePreset: 'warm_concise',
      introductionNames: ['Sofía', 'Forge'],
    })
    const safetyIdx = out.indexOf(IMMUTABLE_SAFETY_POLICY.slice(0, 24))
    const identityIdx = out.indexOf('--- Identidad')
    const voiceIdx = out.indexOf('--- Voz del agente')
    assert.ok(safetyIdx >= 0)
    assert.ok(identityIdx > safetyIdx)
    assert.ok(voiceIdx > identityIdx)
    assert.match(out, /Sofía/)
    assert.match(out, /Forge/)
  })

  it('omits identity layer when introductionNames is empty', () => {
    const out = buildAgentSystemInstructions({
      systemInstructions: 'Solo voz.',
      tonePreset: 'formal',
      introductionNames: [],
    })
    assert.doesNotMatch(out, /--- Identidad/)
    assert.match(out, /--- Voz del agente/)
    assert.ok(out.includes(IMMUTABLE_SAFETY_POLICY.slice(0, 24)))
  })
})

describe('A1.5 schema + SQL 027b markers', () => {
  it('prisma ChatAgent includes introductionNames String[]', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /introductionNames\s+String\[\]\s+@default\(\[\]\)/)
  })

  it('gated SQL 027b adds introductionNames and is not default-applied', () => {
    const sql = readFileSync(
      join(ROOT, 'supabase/migrations/027b_chat_agent_introduction_names.sql'),
      'utf8',
    )
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "introductionNames" text\[\]/)
    assert.match(sql, /BETSY_V2_APPLY_FILES=027b/)
    const manifest = readFileSync(
      join(ROOT, 'scripts/lib/betsy-v2-additive-manifest.mjs'),
      'utf8',
    )
    assert.match(manifest, /'027b':\s*'027b_chat_agent_introduction_names\.sql'/)
    assert.match(manifest, /introductionNames/)
    assert.doesNotMatch(manifest, /DEFAULT_APPLY_FILES\s*=\s*'[^']*027b/)
  })

  it('agent-admin patches introductionNames with version bump + post-commit audit', () => {
    const adminSrc = readFileSync(join(ROOT, 'src/lib/soft-ai/agent-admin.ts'), 'utf8')
    const start = adminSrc.indexOf('export async function updateChatAgent')
    assert.ok(start >= 0)
    const next = adminSrc.indexOf('\nexport async function ', start + 1)
    const body = adminSrc.slice(start, next === -1 ? undefined : next)
    assert.match(body, /introductionNames/)
    assert.match(body, /normalizeIntroductionNames/)
    assert.match(body, /bumpVersion\s*=\s*true/)
    assert.doesNotMatch(body, /\$transaction\s*\(\s*async/)
    assert.match(body, /await logAuditEvent\(/)
  })
})
