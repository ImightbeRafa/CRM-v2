/**
 * First-reply greeting (bot review 2026-11-03): in business hours the greeting was only a prompt hint, so a
 * keyword saved reply ("¡Sí! 💪 Las tiras…"), a back-pain answer ("Entiendo 💙…") or a buy cue on the first message
 * went out with no hello — 60 first replies to Instagram-ad bursts in 7 days. Code now opens the first reply of a chat
 * with "¡Hola! Soy {name} de {store}" when nobody has written to the customer yet. Wording pending Rafael.
 *
 * Runs before withNightIntro: at night a transparent agent turns "Soy Andrés de La Tienda" into
 * "Soy Andrés, asistente virtual de La Tienda" (one intro, never two). Pure and client-safe; the live turn and Probar
 * both call it. Default off: tenant flag FIRST_GREETING_FLAG.
 */

export const FIRST_GREETING_FLAG = 'agent_first_greeting_v1'

export type FirstGreetingWho = {
  name: string | null | undefined
  store: string | null | undefined
  /** Anyone (agent, person, follow-up) already wrote to this customer in this chat. */
  introduced: boolean
}

/** The reply already opens with a hello (first words, after emoji / punctuation). */
const OPENS_WITH_GREETING_RE =
  /^[\s\p{P}\p{S}\p{Extended_Pictographic}️‍]*(?:hola|holi|buen[oa]s|buen\s+d[ií]a|hi|hello|hey|pura\s+vida|qu[eé]\s+tal|saludos|good\s+(?:morning|afternoon|evening))(?![\p{L}\p{N}])/iu

export function opensWithGreeting(text: string): boolean {
  return OPENS_WITH_GREETING_RE.test(text || '')
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const selfIntroRe = (name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:soy|te\\s+escribe|te\\s+habla|habla)\\s+${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu')

/** "Soy Andrés" / "te escribe Andrés" in the first two non-empty lines (the agent already introduced itself). */
function introducesSelf(text: string, name: string): boolean {
  if (!name) return false
  const head = text
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 2)
    .join('\n')
  return selfIntroRe(name).test(head)
}

/** The hello line: "¡Hola! Soy Andrés de La Tienda 😊" / "¡Hola! Soy Andrés 😊" / "¡Hola! 😊". */
export function firstGreetingLine(who: Pick<FirstGreetingWho, 'name' | 'store'>): string {
  const name = (who.name || '').trim()
  const store = (who.store || '').trim()
  if (!name) return '¡Hola! 😊'
  return `¡Hola! Soy ${name}${store ? ` de ${store}` : ''} 😊`
}

/**
 * The first reply of a chat with the hello in front, inline in the first paragraph (the reply keeps its number of
 * WhatsApp / Instagram messages). Unchanged when: off, someone already wrote in the chat, the text is empty, or it
 * already greets. When the agent already says "Soy Andrés…" but no hello, only "¡Hola!" goes in front (and when
 * it says it only further down, the text stays as written).
 */
export function withFirstGreeting(text: string, who: FirstGreetingWho, enabled: boolean): string {
  if (!enabled || who.introduced) return text
  const t = (text || '').trim()
  if (!t || opensWithGreeting(t)) return text
  const name = (who.name || '').trim()
  // "Soy Andrés…" further down (after a data list): a hello in front would make a second intro, and at night the night
  // intro would add its own hello on top — leave it as written.
  if (name && !introducesSelf(t, name) && selfIntroRe(name).test(t)) return text
  const line = introducesSelf(t, name) ? '¡Hola!' : firstGreetingLine(who)
  // A list or a token on the first line keeps its own line (same message: single line break).
  const joiner = /^(?:[-•*–]|\d{1,2}[.)]|\[\[)/u.test(t) ? '\n' : ' '
  return `${line}${joiner}${t}`
}
