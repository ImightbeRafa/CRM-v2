/**
 * First-reply greeting (DeepSleep review 2026-11-03): the first reply of a chat opens with a hello — keyword saved
 * replies and bursts included — never twice, and the night intro stays one intro.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FIRST_GREETING_FLAG, firstGreetingLine, opensWithGreeting, withFirstGreeting } from '../soft-ai/first-greeting'
import { withNightIntro } from '../soft-ai/business-hours'
import { splitReplyParts } from '../soft-ai/reply-parts'

const forge = { name: 'Andrés', store: 'ForgeCR', introduced: false }
const NIGHT = { afterHours: true, transparent: true } as const
const DAY = { afterHours: false, transparent: true } as const

describe('withFirstGreeting', () => {
  it('flag name is stable (CoS flips it by key)', () => {
    assert.equal(FIRST_GREETING_FLAG, 'agent_first_greeting_v1')
  })

  it('verbatim saved reply on an IG-ad burst gets the hello (fg_personalizar, 2026-11-03 20:54Z)', () => {
    const body = '¡Sí! 💪 Las tiras son de tensión ajustable: vos elegís si lo querés como un recordatorio suave o como un soporte más firme.'
    assert.equal(withFirstGreeting(body, forge, true), `¡Hola! Soy Andrés de ForgeCR 😊 ${body}`)
  })

  it('model back-pain reply (15:21 case) gets the hello', () => {
    const out = withFirstGreeting('Entiendo 💙 El arnés ayuda con la postura, pero no es un tratamiento médico.', forge, true)
    assert.match(out, /^¡Hola! Soy Andrés de ForgeCR 😊 Entiendo 💙/u)
  })

  it('off, already introduced, or empty: unchanged', () => {
    const t = 'El Arnés ForgeCR cuesta ₡14 900.'
    assert.equal(withFirstGreeting(t, forge, false), t)
    assert.equal(withFirstGreeting(t, { ...forge, introduced: true }, true), t)
    assert.equal(withFirstGreeting('', forge, true), '')
    assert.equal(withFirstGreeting('   ', forge, true), '   ')
  })

  it('never double-greets: replies that already open with a hello stay as written', () => {
    for (const t of [
      '¡Hola! Soy Andrés de ForgeCR 💪 El arnés cuesta ₡14 900.',
      'Hola 👋 ¿en qué te ayudo?',
      'Buenas tardes 😊 Sí tenemos.',
      'Buenos días, claro.',
      '👋 ¡Hola! Te cuento.',
      'Pura vida 🙌 Te cuento.',
      '¿Qué tal? Te cuento.',
      'Hi, soy Dani de Prototipo 😊',
      'Hello! Sure.',
    ]) {
      assert.equal(opensWithGreeting(t), true, t)
      assert.equal(withFirstGreeting(t, forge, true), t, t)
    }
    // "hola" later in the text is not a greeting at the start.
    assert.equal(opensWithGreeting('El precio es ₡14 900. ¡Hola de nuevo!'), false)
    assert.equal(opensWithGreeting('Holanda no, Costa Rica sí.'), false)
  })

  it('already introduces itself without a hello → only "¡Hola!" in front', () => {
    assert.equal(withFirstGreeting('Soy Andrés de ForgeCR 💪 El arnés cuesta ₡14 900.', forge, true), '¡Hola! Soy Andrés de ForgeCR 💪 El arnés cuesta ₡14 900.')
  })

  it('"Soy Dani…" only further down (after a data list) → unchanged, day and night (no second intro / hello)', () => {
    const dani = { name: 'Dani', store: 'Prototipo', introduced: false }
    const t = 'Para coordinar el envío, pasame estos datos:\n- Nombre completo\n- Teléfono\n\nSoy Dani de Prototipo 😊 ¿Cómo preferís pagar?'
    assert.equal(withFirstGreeting(t, dani, true), t)
    const night = withNightIntro(withFirstGreeting(t, dani, true), { afterHours: true, transparent: true }, dani)
    assert.equal((night.match(/hola/giu) || []).length, 1)
  })

  it('a first-line list keeps its own line (same message)', () => {
    const t = '- Nombre completo\n- Teléfono'
    assert.equal(withFirstGreeting(t, forge, true), `¡Hola! Soy Andrés de ForgeCR 😊\n${t}`)
  })

  it('keeps the number of messages the reply splits into', () => {
    for (const t of ['Uno.\n\nDos.\n\nTres.', 'Uno.\n\nDos.', 'Uno.']) {
      assert.equal(splitReplyParts(withFirstGreeting(t, forge, true)).length, splitReplyParts(t).length)
    }
  })

  it('no name / no store fall back to a plain hello', () => {
    assert.equal(firstGreetingLine({ name: null, store: 'ForgeCR' }), '¡Hola! 😊')
    assert.equal(firstGreetingLine({ name: 'Laura', store: null }), '¡Hola! Soy Laura 😊')
    assert.equal(withFirstGreeting('Claro.', { name: '', store: '', introduced: false }, true), '¡Hola! 😊 Claro.')
  })

  it('night: one intro — "Soy Andrés" becomes "Soy Andrés, asistente virtual", no 🌙 intro on top', () => {
    const who = forge
    const out = withNightIntro(withFirstGreeting('¡Sí! 💪 Las tiras son ajustables.', who, true), NIGHT, who)
    assert.equal(out, '¡Hola! Soy Andrés, asistente virtual de ForgeCR 😊 ¡Sí! 💪 Las tiras son ajustables.')
    assert.equal((out.match(/hola/giu) || []).length, 1)
    assert.equal((out.match(/asistente virtual/giu) || []).length, 1)
  })

  it('night with the flag off: the existing night intro is unchanged', () => {
    const t = '¡Sí! 💪 Las tiras son ajustables.'
    assert.equal(withNightIntro(withFirstGreeting(t, forge, false), NIGHT, forge), withNightIntro(t, NIGHT, forge))
  })

  it('day: withNightIntro leaves the greeted text alone', () => {
    const g = withFirstGreeting('Claro.', forge, true)
    assert.equal(withNightIntro(g, DAY, forge), g)
  })
})

describe('first greeting wiring (agent-turn.ts)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/soft-ai/agent-turn.ts'), 'utf8')
  it('every place that applies the night intro applies the first greeting first (live code path, model path, Probar ×2)', () => {
    const night = src.match(/withNightIntro\(\s*\n?\s*withFirstGreeting\(/g) || []
    assert.equal(night.length, 4)
    assert.equal((src.match(/withNightIntro\(/g) || []).length, 4)
  })
  it('the live check also looks at the whole chat, and fails closed', () => {
    assert.match(src, /async function firstGreetingOn\([\s\S]*?direction: 'outbound'[\s\S]*?catch \{\s*return false/)
  })
})
