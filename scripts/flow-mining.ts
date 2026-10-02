/**
 * Flow mining report (read-only, offline). What do customers ask first, and which first questions lead to an order.
 *
 *   node --env-file=.env.local --import tsx scripts/flow-mining.ts --tenant=<tenantId> [--days=60] [--out=name.md]
 *
 * SAFETY: SELECT only (one statement, 60 s timeout, max 20 000 chats). Output is COUNTS ONLY — no message text,
 * no names, no phone numbers — and any phrase/topic with fewer than 5 chats is dropped (k-anonymity).
 * The report goes to .reports/flow-mining/ (gitignored); the conversation must have its FIRST message inside the window
 * (imported/backfilled old chats are not counted as new). Run it deliberately: it reads the database DATABASE_URL points to.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { buildFlowReport, reportToMarkdown, type ConversationRow } from '../src/lib/flow-mining'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function main() {
  const tenantId = (arg('tenant') || '').trim()
  if (!tenantId) {
    console.error('Falta --tenant=<tenantId>. Este reporte nunca corre sobre todos los negocios a la vez.')
    process.exit(2)
  }
  const days = Math.min(180, Math.max(7, Math.floor(Number(arg('days') || 60)) || 60))
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL statement_timeout = '60s'`,
      prisma.$queryRaw<
        Array<{
          firstInboundText: string
          hour: number
          secondsToFirstReply: number | null
          ordered: boolean
          secondsToOrder: number | null
        }>
      >`
        WITH convs AS (
          SELECT c."id", c."clientId" FROM "ChatConversation" c
           WHERE c."tenantId" = ${tenantId} AND c."createdAt" >= ${from}::timestamp - interval '180 days'
           ORDER BY c."createdAt" DESC LIMIT 20000),
        first_in AS (
          SELECT DISTINCT ON (m."conversationId") m."conversationId" AS cid, m."content", m."sentAt"
            FROM "ChatMessage" m JOIN convs ON convs."id" = m."conversationId"
           WHERE m."tenantId" = ${tenantId} AND m."direction" = 'inbound'
           ORDER BY m."conversationId", m."sentAt" ASC),
        first_out AS (
          SELECT m."conversationId" AS cid, min(m."sentAt") AS at
            FROM "ChatMessage" m JOIN first_in f ON f.cid = m."conversationId"
           WHERE m."tenantId" = ${tenantId} AND m."direction" = 'outbound' AND m."sentAt" > f."sentAt"
           GROUP BY m."conversationId"),
        first_order AS (
          SELECT c."id" AS cid, min(o."timestamp") AS at
            FROM convs c
            JOIN first_in f ON f.cid = c."id"
            JOIN "Order" o ON o."clientId" = c."clientId" AND o."tenantId" = ${tenantId} AND o."deletedAt" IS NULL
                          AND o."timestamp" >= f."sentAt" AND o."timestamp" < f."sentAt" + interval '14 days'
           WHERE c."clientId" IS NOT NULL
           GROUP BY c."id")
        SELECT f."content" AS "firstInboundText",
               extract(hour FROM ((f."sentAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica'))::int AS "hour",
               extract(epoch FROM (fo.at - f."sentAt"))::int AS "secondsToFirstReply",
               (ord.at IS NOT NULL) AS "ordered",
               extract(epoch FROM (ord.at - f."sentAt"))::int AS "secondsToOrder"
          FROM first_in f
          LEFT JOIN first_out fo ON fo.cid = f.cid
          LEFT JOIN first_order ord ON ord.cid = f.cid
         WHERE f."sentAt" >= ${from} AND f."sentAt" < ${to}`,
    ])
    const data = rows[1]
    const conv: ConversationRow[] = data.map((r) => ({
      firstInboundText: r.firstInboundText,
      firstInboundHourCR: r.hour,
      secondsToFirstReply: r.secondsToFirstReply,
      ordered: r.ordered,
      secondsToOrder: r.secondsToOrder,
    }))
    const report = buildFlowReport(conv)
    const label = `negocio ${tenantId} · últimos ${days} días`
    const md = reportToMarkdown(report, label)
    // Output always stays inside the gitignored .reports/ folder (a custom name is only a file name).
    const custom = (arg('out') || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
    const out = join('.reports', 'flow-mining', custom || `${tenantId}-${to.toISOString().slice(0, 10)}.md`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, md, 'utf8')
    console.log(`Listo: ${report.conversations} chats analizados. Reporte en ${out}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('flow-mining falló:', error instanceof Error ? error.name : 'unknown')
  process.exit(1)
})
