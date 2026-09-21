/**
 * Chat Phase 4 local load-test seed.
 *
 *   CHAT_SCALE_DATABASE_URL=postgresql://...@127.0.0.1:5432/... \
 *     npx tsx scripts/chat-scale-seed.ts
 *   npx tsx scripts/chat-scale-seed.ts --dry-run
 *
 * Targets ONLY CHAT_SCALE_DATABASE_URL (loopback). Never DATABASE_URL.
 * Deterministic IDs so re-runs replace the same scale tenant.
 *
 * Prerequisites on the target DB:
 *   - Tenant / User / SocialAccount / ChatMessage base tables (Prisma schema)
 *   - 024 (+ 025) chat inbox SQL applied
 */
import postgres from 'postgres'
import {
  ACCOUNT_COUNT,
  CONVERSATION_COUNT,
  HEAVY_THREAD_MESSAGES,
  MESSAGE_COUNT,
  SCALE_TENANT_ID,
  SCALE_TENANT_SLUG,
  SCALE_USER_EMAIL,
  SCALE_USER_ID,
  scaleAccountId,
  scaleConversationId,
  scaleMessageId,
  scalePeerId,
  scaleProviderMessageId,
} from './lib/chat-scale-constants'
import { requireChatScaleDatabaseUrl } from './lib/chat-scale-db-guard'

const CONV_BATCH = 250
const MSG_BATCH = 1000

const dryRun = process.argv.includes('--dry-run')

function messageCountsPerConversation(): number[] {
  const counts = new Array<number>(CONVERSATION_COUNT).fill(0)
  counts[0] = HEAVY_THREAD_MESSAGES
  const remaining = MESSAGE_COUNT - HEAVY_THREAD_MESSAGES
  const others = CONVERSATION_COUNT - 1
  const base = Math.floor(remaining / others)
  let leftover = remaining - base * others
  for (let i = 1; i < CONVERSATION_COUNT; i++) {
    counts[i] = base + (leftover > 0 ? 1 : 0)
    if (leftover > 0) leftover -= 1
  }
  return counts
}

function planSummary(counts: number[]) {
  const totalMsgs = counts.reduce((a, b) => a + b, 0)
  return {
    tenantId: SCALE_TENANT_ID,
    accounts: ACCOUNT_COUNT,
    conversations: CONVERSATION_COUNT,
    messages: totalMsgs,
    heavyThreadMessages: counts[0],
    dryRun,
  }
}

async function wipeScaleTenant(sql: postgres.Sql) {
  await sql`DELETE FROM public."ChatMessage" WHERE "tenantId" = ${SCALE_TENANT_ID}`
  await sql`DELETE FROM public."ChatConversationReadState" WHERE "tenantId" = ${SCALE_TENANT_ID}`
  await sql`DELETE FROM public."ChatConversation" WHERE "tenantId" = ${SCALE_TENANT_ID}`
  await sql`DELETE FROM public."SocialAccount" WHERE "tenantId" = ${SCALE_TENANT_ID}`
  await sql`DELETE FROM public."User" WHERE id = ${SCALE_USER_ID}`
  await sql`DELETE FROM public."Tenant" WHERE id = ${SCALE_TENANT_ID}`
}

async function upsertTenantUser(sql: postgres.Sql) {
  const now = new Date()
  await sql`
    INSERT INTO public."Tenant" (
      id, name, slug, plan, "isActive", "createdAt", "updatedAt",
      "phoneVerified", "phoneVerificationAttempts", "profileCompleted"
    ) VALUES (
      ${SCALE_TENANT_ID},
      ${'Chat Scale Phase4'},
      ${SCALE_TENANT_SLUG},
      ${'FREE'}::"SubscriptionTier",
      true,
      ${now},
      ${now},
      false,
      0,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      "updatedAt" = EXCLUDED."updatedAt"
  `

  await sql`
    INSERT INTO public."User" (
      id, email, name, "createdAt", "updatedAt"
    ) VALUES (
      ${SCALE_USER_ID},
      ${SCALE_USER_EMAIL},
      ${'Chat Scale Seeder'},
      ${now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      "updatedAt" = EXCLUDED."updatedAt"
  `
}

async function insertAccounts(sql: postgres.Sql) {
  const now = new Date()
  const rows = Array.from({ length: ACCOUNT_COUNT }, (_, i) => ({
    id: scaleAccountId(i),
    tenantId: SCALE_TENANT_ID,
    userId: SCALE_USER_ID,
    platform: i % 2 === 0 ? 'whatsapp' : 'instagram',
    accountId: `scale_acct_${String(i + 1).padStart(4, '0')}`,
    isActive: true,
    linkedAt: now,
    tokenStatus: 'unknown',
    displayName: `Scale Account ${i + 1}`,
  }))

  await sql`
    INSERT INTO public."SocialAccount" ${sql(
      rows,
      'id',
      'tenantId',
      'userId',
      'platform',
      'accountId',
      'isActive',
      'linkedAt',
      'tokenStatus',
      'displayName',
    )}
  `
}

async function insertConversations(sql: postgres.Sql, counts: number[]) {
  const now = Date.now()
  for (let offset = 0; offset < CONVERSATION_COUNT; offset += CONV_BATCH) {
    const slice = Array.from(
      { length: Math.min(CONV_BATCH, CONVERSATION_COUNT - offset) },
      (_, j) => {
        const i = offset + j
        const accountIndex = i % ACCOUNT_COUNT
        const msgCount = counts[i]!
        const lastAt = new Date(now - (CONVERSATION_COUNT - i) * 60_000)
        return {
          id: scaleConversationId(i),
          tenantId: SCALE_TENANT_ID,
          socialAccountId: scaleAccountId(accountIndex),
          peerId: scalePeerId(i),
          peerName: `Peer ${i + 1}`,
          status: i % 3 === 0 ? 'nuevo' : i % 3 === 1 ? 'en_curso' : 'hecho',
          tags: [] as string[],
          lastMessageAt: lastAt,
          lastMessagePreview: `scale preview ${i + 1}`,
          lastMessageDirection: 'inbound',
          inboundCount: msgCount,
          messageCount: msgCount,
          createdAt: lastAt,
          updatedAt: lastAt,
        }
      },
    )

    await sql`
      INSERT INTO public."ChatConversation" ${sql(
        slice,
        'id',
        'tenantId',
        'socialAccountId',
        'peerId',
        'peerName',
        'status',
        'tags',
        'lastMessageAt',
        'lastMessagePreview',
        'lastMessageDirection',
        'inboundCount',
        'messageCount',
        'createdAt',
        'updatedAt',
      )}
    `
  }
}

async function insertMessages(sql: postgres.Sql, counts: number[]) {
  let globalMsg = 0
  const baseMs = Date.UTC(2026, 0, 1, 0, 0, 0)

  for (let convIndex = 0; convIndex < CONVERSATION_COUNT; convIndex++) {
    const n = counts[convIndex]!
    const accountIndex = convIndex % ACCOUNT_COUNT
    const convId = scaleConversationId(convIndex)
    const peer = scalePeerId(convIndex)
    const saId = scaleAccountId(accountIndex)

    for (let offset = 0; offset < n; offset += MSG_BATCH) {
      const batchLen = Math.min(MSG_BATCH, n - offset)
      const rows = Array.from({ length: batchLen }, (_, j) => {
        const local = offset + j
        const msgIndex = globalMsg + local
        const sentAt = new Date(baseMs + msgIndex * 1000)
        const direction = local % 5 === 0 ? 'outbound' : 'inbound'
        return {
          id: scaleMessageId(msgIndex),
          tenantId: SCALE_TENANT_ID,
          socialAccountId: saId,
          direction,
          content: `scale msg ${msgIndex + 1} c${convIndex + 1}`,
          sentAt,
          conversationId: convId,
          providerMessageId: scaleProviderMessageId(msgIndex),
          peerId: peer,
          messageType: 'text',
          deliveryStatus: direction === 'inbound' ? 'received' : 'sent',
          createdAt: sentAt,
          updatedAt: sentAt,
        }
      })

      await sql`
        INSERT INTO public."ChatMessage" ${sql(
          rows,
          'id',
          'tenantId',
          'socialAccountId',
          'direction',
          'content',
          'sentAt',
          'conversationId',
          'providerMessageId',
          'peerId',
          'messageType',
          'deliveryStatus',
          'createdAt',
          'updatedAt',
        )}
      `
      globalMsg += batchLen
    }
  }

  await sql`
    UPDATE public."ChatConversation" c
    SET "lastMessageId" = m.id
    FROM (
      SELECT DISTINCT ON ("conversationId")
        "conversationId",
        id
      FROM public."ChatMessage"
      WHERE "tenantId" = ${SCALE_TENANT_ID}
      ORDER BY "conversationId", "sentAt" DESC, id DESC
    ) m
    WHERE c.id = m."conversationId"
      AND c."tenantId" = ${SCALE_TENANT_ID}
  `
}

async function main() {
  const guard = requireChatScaleDatabaseUrl()
  const counts = messageCountsPerConversation()
  const plan = planSummary(counts)

  console.log('chat-scale-seed plan:', plan)
  console.log(`target: ${guard.hostname}:${guard.port}`)

  if (dryRun) {
    console.log('dry-run: no writes performed')
    return
  }

  const sql = postgres(guard.url, {
    max: 4,
    prepare: false,
    ssl: false,
    connect_timeout: 15,
  })

  const t0 = performance.now()
  try {
    console.log('wiping previous scale tenant (if any)…')
    await wipeScaleTenant(sql)
    console.log('upserting Tenant + User…')
    await upsertTenantUser(sql)
    console.log(`inserting ${ACCOUNT_COUNT} SocialAccounts…`)
    await insertAccounts(sql)
    console.log(`inserting ${CONVERSATION_COUNT} ChatConversations…`)
    await insertConversations(sql, counts)
    console.log(`inserting ${MESSAGE_COUNT} ChatMessages (heavy thread=${HEAVY_THREAD_MESSAGES})…`)
    await insertMessages(sql, counts)

    const [acct] =
      await sql`SELECT COUNT(*)::int AS n FROM public."SocialAccount" WHERE "tenantId" = ${SCALE_TENANT_ID}`
    const [conv] =
      await sql`SELECT COUNT(*)::int AS n FROM public."ChatConversation" WHERE "tenantId" = ${SCALE_TENANT_ID}`
    const [msg] =
      await sql`SELECT COUNT(*)::int AS n FROM public."ChatMessage" WHERE "tenantId" = ${SCALE_TENANT_ID}`
    const [heavy] = await sql`
      SELECT COUNT(*)::int AS n FROM public."ChatMessage"
      WHERE "conversationId" = ${scaleConversationId(0)}
    `

    const elapsedMs = Math.round(performance.now() - t0)
    console.log(
      JSON.stringify(
        {
          ok: true,
          elapsedMs,
          socialAccounts: acct?.n,
          conversations: conv?.n,
          messages: msg?.n,
          heavyThreadMessages: heavy?.n,
          tenantId: SCALE_TENANT_ID,
        },
        null,
        2,
      ),
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('chat-scale-seed failed:', err)
  process.exit(1)
})
