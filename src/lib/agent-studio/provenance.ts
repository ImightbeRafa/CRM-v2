/**
 * Provenance checks for the extracted profile: a fact is kept only if its snippet really appears in the source it
 * cites (whitespace / accents / case normalized). Payment numbers must appear literally in the source; otherwise
 * the account is kept but marked "confirmar" (the owner must check it). Facts with no valid source are dropped,
 * except voice / "cómo vendo" / quick replies, which are suggestions the owner edits anyway.
 */
import type { ExtractedProfile, Fact } from '@/lib/agent-studio/profile-schema'

export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function verifySnippet(sourceText: string | undefined, snippet: string | null): boolean {
  if (!sourceText || !snippet) return false
  const needle = normalizeForMatch(snippet)
  if (needle.length < 4) return false
  return normalizeForMatch(sourceText).includes(needle)
}

const digits = (s: string | null | undefined) => (s || '').replace(/\D/g, '')

export function verifyProfile(profile: ExtractedProfile, sources: Map<string, string>): ExtractedProfile {
  const ok = (x: { sourceId: string | null; snippet: string | null }) => verifySnippet(x.sourceId ? sources.get(x.sourceId) : undefined, x.snippet)
  const fact = (f: Fact): Fact => (f.value && ok(f) ? f : { value: null, sourceId: null, snippet: null })
  return {
    ...profile,
    brand: {
      storeName: fact(profile.brand.storeName),
      website: fact(profile.brand.website),
      address: fact(profile.brand.address),
      hours: fact(profile.brand.hours),
      pickupText: fact(profile.brand.pickupText),
      whatWeSell: fact(profile.brand.whatWeSell),
    },
    paymentAccounts: profile.paymentAccounts
      .filter((p) => p.number)
      .map((p) => {
        const src = p.sourceId ? sources.get(p.sourceId) : undefined
        const literal = Boolean(src && digits(p.number).length >= 8 && digits(src).includes(digits(p.number)))
        return { ...p, confirm: !literal }
      }),
    shipping: profile.shipping.filter(ok),
    policies: profile.policies.filter((p) => p.text && ok(p)),
    faq: profile.faq.filter((p) => p.question && p.answer && ok(p)),
    products: profile.products.filter((p) => p.nameAsSeen && ok(p)),
  }
}

/** Imported prose must never act as instructions: drop lines that look like commands to an AI. */
export function stripInstructionLike(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/\b(ignor[aá]|olvid[aá]|ignore|disregard)\b.{0,40}\b(instrucciones|reglas|instructions|rules|prompt)\b/i.test(line))
    .filter((line) => !/\b(system prompt|eres un|you are an? (ai|assistant))\b/i.test(line))
    .join('\n')
}
