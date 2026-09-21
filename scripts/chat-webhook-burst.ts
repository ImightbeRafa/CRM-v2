/**
 * Simulate 500 signed inbound webhook events across 5 accounts within a 60s budget.
 *
 * Unit-style: verifies Meta HMAC, parses payload, and stores via an in-memory
 * dual-write mock (unique providerMessageId). Does not call live HTTP or Supabase.
 *
 *   npx tsx scripts/chat-webhook-burst.ts
 *   CHAT_WEBHOOK_BURST_EVENTS=500 CHAT_WEBHOOK_BURST_ACCOUNTS=5 npx tsx scripts/chat-webhook-burst.ts
 */
import { verifyMetaWebhookSignature } from '../src/lib/meta-api'
import { parseMetaChatPayload } from '../src/lib/meta-chat'
import { summarizeLatencies } from './lib/chat-scale-db-guard'
import {
  buildSignedWhatsAppFixture,
  CHAT_WEBHOOK_FIXTURE_SECRET,
} from '../tests/fixtures/chat-webhook/signed-payload'

const EVENT_COUNT = Number(process.env.CHAT_WEBHOOK_BURST_EVENTS || 500)
const ACCOUNT_COUNT = Number(process.env.CHAT_WEBHOOK_BURST_ACCOUNTS || 5)
const BUDGET_MS = Number(process.env.CHAT_WEBHOOK_BURST_BUDGET_MS || 60_000)
const P95_TARGET_MS = Number(process.env.CHAT_WEBHOOK_BURST_P95_TARGET_MS || 800)

type StoreResult = { ok: true; duplicate: boolean } | { ok: false; reason: string }

/** In-memory stand-in for dualWriteChatMessage uniqueness on providerMessageId. */
export function createBurstStore() {
  const seen = new Set<string>()
  return {
    async persist(args: {
      socialAccountKey: string
      providerMessageId: string
      peerId: string
      content: string
    }): Promise<StoreResult> {
      const key = `${args.socialAccountKey}::${args.providerMessageId}`
      if (seen.has(key)) return { ok: true, duplicate: true }
      seen.add(key)
      // Simulate a light dual-write cost without touching a DB.
      await Promise.resolve()
      return { ok: true, duplicate: false }
    },
    size: () => seen.size,
  }
}

export async function runWebhookBurst(options?: {
  events?: number
  accounts?: number
  secret?: string
}): Promise<{
  events: number
  accounts: number
  elapsedMs: number
  duplicates: number
  signatureFailures: number
  parseFailures: number
  storeFailures: number
  latenciesMs: number[]
  summary: ReturnType<typeof summarizeLatencies>
  withinBudget: boolean
  p95UnderTarget: boolean
}> {
  const events = options?.events ?? EVENT_COUNT
  const accounts = options?.accounts ?? ACCOUNT_COUNT
  const secret = options?.secret ?? CHAT_WEBHOOK_FIXTURE_SECRET
  const store = createBurstStore()
  const latenciesMs: number[] = []
  let duplicates = 0
  let signatureFailures = 0
  let parseFailures = 0
  let storeFailures = 0

  const env = {
    META_APP_SECRET: secret,
    META_WA_APP_SECRET: undefined,
    INSTAGRAM_APP_SECRET: undefined,
  }

  const t0 = performance.now()
  for (let i = 0; i < events; i++) {
    const accountIndex = i % accounts
    const fixture = buildSignedWhatsAppFixture({
      accountIndex,
      eventIndex: i,
      secret,
    })
    const started = performance.now()

    const sig = verifyMetaWebhookSignature(fixture.rawBody, fixture.signatureHeader, env)
    if (!sig.valid) {
      signatureFailures += 1
      latenciesMs.push(performance.now() - started)
      continue
    }

    let parsed
    try {
      parsed = parseMetaChatPayload(JSON.parse(fixture.rawBody))
    } catch {
      parseFailures += 1
      latenciesMs.push(performance.now() - started)
      continue
    }

    if (!parsed.messages.length) {
      parseFailures += 1
      latenciesMs.push(performance.now() - started)
      continue
    }

    for (const message of parsed.messages) {
      const result = await store.persist({
        socialAccountKey: message.accountId,
        providerMessageId: message.providerMessageId || fixture.providerMessageId,
        peerId: message.senderId,
        content: message.content,
      })
      if (!result.ok) storeFailures += 1
      else if (result.duplicate) duplicates += 1
    }

    latenciesMs.push(performance.now() - started)
  }

  // Intentional duplicate replay of the first event — must count as duplicate, not failure.
  if (events > 0) {
    const replay = buildSignedWhatsAppFixture({ accountIndex: 0, eventIndex: 0, secret })
    const sig = verifyMetaWebhookSignature(replay.rawBody, replay.signatureHeader, env)
    if (sig.valid) {
      const parsed = parseMetaChatPayload(JSON.parse(replay.rawBody))
      for (const message of parsed.messages) {
        const result = await store.persist({
          socialAccountKey: message.accountId,
          providerMessageId: replay.providerMessageId,
          peerId: message.senderId,
          content: message.content,
        })
        if (result.ok && result.duplicate) duplicates += 1
      }
    }
  }

  const elapsedMs = performance.now() - t0
  const summary = summarizeLatencies(latenciesMs)
  return {
    events,
    accounts,
    elapsedMs,
    duplicates,
    signatureFailures,
    parseFailures,
    storeFailures,
    latenciesMs,
    summary,
    withinBudget: elapsedMs <= BUDGET_MS,
    p95UnderTarget: summary.p95Ms < P95_TARGET_MS,
  }
}

async function main() {
  const result = await runWebhookBurst()
  console.log(
    JSON.stringify(
      {
        ok:
          result.signatureFailures === 0 &&
          result.parseFailures === 0 &&
          result.storeFailures === 0 &&
          result.withinBudget &&
          result.p95UnderTarget,
        acceptance_4_5: {
          events: result.events,
          accounts: result.accounts,
          elapsedMs: Math.round(result.elapsedMs),
          budgetMs: BUDGET_MS,
          withinBudget: result.withinBudget,
          duplicates: result.duplicates,
          signatureFailures: result.signatureFailures,
          parseFailures: result.parseFailures,
          storeFailures: result.storeFailures,
          p50Ms: Number(result.summary.p50Ms.toFixed(3)),
          p95Ms: Number(result.summary.p95Ms.toFixed(3)),
          p95TargetMs: P95_TARGET_MS,
          p95UnderTarget: result.p95UnderTarget,
        },
      },
      null,
      2,
    ),
  )

  if (
    result.signatureFailures ||
    result.parseFailures ||
    result.storeFailures ||
    !result.withinBudget ||
    !result.p95UnderTarget
  ) {
    process.exit(1)
  }
}

const isDirect = /(?:^|[/\\])chat-webhook-burst\.ts$/.test(process.argv[1] || '')

if (isDirect) {
  main().catch((err) => {
    console.error('chat-webhook-burst failed:', err)
    process.exit(1)
  })
}
