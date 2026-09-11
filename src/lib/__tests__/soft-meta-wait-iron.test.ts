import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterApprovedWhatsAppTemplates,
  findApprovedWhatsAppTemplate,
  isWhatsAppTemplateStatusApproved,
  normalizeWhatsAppTemplateRows,
  templateNotApprovedErrorMessage,
} from '../wa-template-approval'
import {
  buildSoftDemoConversations,
  isSoftDemoAccountId,
  isSoftDemoConversation,
  SOFT_DEMO_ACCOUNT_WA,
  softDemoSocialAccounts,
} from '../soft-demo-chats'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('wa-template-approval', () => {
  it('approves only APPROVED and ACTIVE statuses', () => {
    assert.equal(isWhatsAppTemplateStatusApproved('APPROVED'), true)
    assert.equal(isWhatsAppTemplateStatusApproved('active'), true)
    assert.equal(isWhatsAppTemplateStatusApproved('PENDING'), false)
    assert.equal(isWhatsAppTemplateStatusApproved('REJECTED'), false)
    assert.equal(isWhatsAppTemplateStatusApproved('PAUSED'), false)
    assert.equal(isWhatsAppTemplateStatusApproved(''), false)
  })

  it('normalizes Graph rows and filters approved for list', () => {
    const rows = normalizeWhatsAppTemplateRows([
      { name: 'hello', language: 'es', status: 'approved', category: 'MARKETING' },
      { name: 'pending_one', language: 'es', status: 'PENDING' },
      { name: '', language: 'es', status: 'APPROVED' },
      { name: 'active_tpl', language: 'en_US', status: 'ACTIVE' },
    ])
    assert.equal(rows.length, 3)
    const approved = filterApprovedWhatsAppTemplates(rows)
    assert.deepEqual(
      approved.map((t) => t.name),
      ['hello', 'active_tpl'],
    )
  })

  it('findApprovedWhatsAppTemplate matches name+language and rejects non-approved', () => {
    const rows = normalizeWhatsAppTemplateRows([
      { name: 'pedido_listo', language: 'es', status: 'APPROVED' },
      { name: 'pedido_listo', language: 'en', status: 'PENDING' },
      { name: 'otro', language: 'es', status: 'REJECTED' },
    ])
    assert.equal(findApprovedWhatsAppTemplate(rows, 'pedido_listo', 'es')?.status, 'APPROVED')
    assert.equal(findApprovedWhatsAppTemplate(rows, 'pedido_listo', 'ES')?.name, 'pedido_listo')
    assert.equal(findApprovedWhatsAppTemplate(rows, 'pedido_listo', 'en'), null)
    assert.equal(findApprovedWhatsAppTemplate(rows, 'otro', 'es'), null)
    assert.equal(findApprovedWhatsAppTemplate(rows, 'missing', 'es'), null)
  })

  it('templateNotApprovedErrorMessage mentions APPROVED literally', () => {
    const msg = templateNotApprovedErrorMessage('x', 'PENDING')
    assert.match(msg, /APPROVED/)
    assert.match(msg, /PENDING/)
    assert.match(templateNotApprovedErrorMessage('y'), /APPROVED/)
  })

  it('POST /api/chat/send re-checks APPROVED before Graph template send', () => {
    const sendSrc = readFileSync(resolve('src/app/api/chat/send/route.ts'), 'utf8')
    assert.match(sendSrc, /findApprovedWhatsAppTemplate/)
    assert.match(sendSrc, /templateNotApprovedErrorMessage/)
    assert.match(sendSrc, /message_templates/)
    assert.match(sendSrc, /Server-side APPROVED gate/)
    // Staff bot hard lock — send route must not import bot whatsapp
    assert.doesNotMatch(sendSrc, /lib\/bot\/whatsapp/)
    assert.doesNotMatch(sendSrc, /WHATSAPP_ACCESS_TOKEN/)
  })
})

describe('soft-demo-chats', () => {
  it('builds clearly DEMO-marked removable local conversations', () => {
    const now = Date.parse('2026-09-11T12:00:00.000Z')
    const demos = buildSoftDemoConversations(now)
    assert.ok(demos.length >= 2)
    for (const c of demos) {
      assert.equal(c.isDemo, true)
      assert.ok(isSoftDemoAccountId(c.socialAccountId))
      assert.ok(isSoftDemoConversation(c))
      assert.match(c.accountLabel, /DEMO/i)
      assert.match(c.recipientName || '', /Demo/i)
      assert.ok(c.messages.length > 0)
    }
    const accounts = softDemoSocialAccounts()
    assert.ok(accounts.some((a) => a.id === SOFT_DEMO_ACCOUNT_WA))
    assert.ok(accounts.every((a) => isSoftDemoAccountId(a.id)))
  })

  it('demo seed never uses production-looking social account ids alone', () => {
    const demos = buildSoftDemoConversations()
    for (const c of demos) {
      assert.match(c.socialAccountId, /^demo-/)
      assert.match(c.recipientId, /^demo-/)
    }
  })
})
