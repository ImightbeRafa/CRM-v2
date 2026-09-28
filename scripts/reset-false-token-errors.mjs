// One-off (2026-09-28): undo the false "Error de token" written by the old token-health
// probe (wrong appsecret_proof → Graph code 100). Only touches active lines stored as
// tokenStatus='error' with lastErrorCode='100'; aborts unless exactly 5 match.
// Run from the repo root: node --env-file=../CRM-v2/.env.local scripts/reset-false-token-errors.mjs
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
const where = {
  isActive: true,
  disconnectedAt: null,
  tokenStatus: 'error',
  lastErrorCode: '100',
  platform: { in: ['whatsapp', 'instagram'] },
}
const rows = await p.socialAccount.findMany({ where, select: { id: true, platform: true, displayName: true } })
console.log('matching', rows.length, rows.map((r) => `${r.platform}:${r.displayName}`).join(', '))
if (rows.length !== 5) {
  console.log('ABORT: expected 5')
  process.exit(1)
}
const res = await p.socialAccount.updateMany({
  where: { ...where, id: { in: rows.map((r) => r.id) } },
  data: { tokenStatus: 'valid', lastErrorCode: 'probe_fix_reset', lastErrorAt: null },
})
console.log('updated', res.count)
await p.$disconnect()
