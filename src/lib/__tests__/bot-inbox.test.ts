import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseWhatsAppWebhooks } from '../bot/whatsapp';
import {
  addAssistantMessage,
  addUserMessage,
  clearConversationHistory,
  getConversationHistory,
} from '../bot/conversation-memory';

test('WhatsApp parser preserves every message in a batched envelope', () => {
  const messages = parseWhatsAppWebhooks({
    entry: [
      { changes: [{ value: {
        contacts: [{ wa_id: 'one', profile: { name: 'One' } }],
        messages: [
          { id: 'm1', from: 'one', timestamp: '1', type: 'text', text: { body: 'first' } },
          { id: 'm2', from: 'one', timestamp: '2', type: 'text', text: { body: 'second' } },
        ],
      } }] },
      { changes: [{ value: {
        contacts: [{ wa_id: 'two', profile: { name: 'Two' } }],
        messages: [{ id: 'm3', from: 'two', timestamp: '3', type: 'button', button: { text: 'third' } }],
      } }] },
    ],
  });
  assert.deepEqual(messages.map(message => message.messageId), ['m1', 'm2', 'm3']);
  assert.deepEqual(messages.map(message => message.text), ['first', 'second', 'third']);
});

test('queued retries append one user-history entry per operation key', async () => {
  const platformId = `V2TEST-history-${Date.now()}`;
  await addUserMessage('test', platformId, 'same command', 'provider:message:1');
  await addUserMessage('test', platformId, 'same command', 'provider:message:1');
  const history = await getConversationHistory('test', platformId);
  assert.equal(history.filter(message => message.role === 'user').length, 1);
  await clearConversationHistory('test', platformId);
});

test('queued retries append one assistant-history entry per operation key', async () => {
  const platformId = `V2TEST-assistant-history-${Date.now()}`;
  await addAssistantMessage('test', platformId, 'same reply', undefined, 'provider:message:1:assistant');
  await addAssistantMessage('test', platformId, 'same reply', undefined, 'provider:message:1:assistant');
  const history = await getConversationHistory('test', platformId);
  assert.equal(history.filter(message => message.role === 'assistant').length, 1);
  await clearConversationHistory('test', platformId);
});

test('bot inbox schema is additive and does not rewrite existing rows', async () => {
  const migration = await readFile('supabase/migrations/021_betsy_v2_bot_inbox.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\."BotInboxMessage"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\."BotInboxDelivery"/);
  assert.match(migration, /UNIQUE \("platform", "providerMessageId"\)/);
  assert.match(migration, /"seatPolicy" text NULL/);
  assert.doesNotMatch(migration, /(^|\n)\s*(DROP|TRUNCATE|DELETE|UPDATE)\s/im);
});

test('both authenticated provider routes persist before fast acknowledgement', async () => {
  const [whatsapp, telegram, transport] = await Promise.all([
    readFile('src/app/api/bot/whatsapp/webhook/route.ts', 'utf8'),
    readFile('src/app/api/bot/telegram/webhook/route.ts', 'utf8'),
    readFile('src/lib/bot/whatsapp.ts', 'utf8'),
  ]);
  for (const [route, persistCall] of [
    [whatsapp, 'persistBotInboxMessages('],
    [telegram, 'persistBotInboxMessage({'],
  ] as const) {
    const persistIndex = route.indexOf(persistCall);
    const acceptedIndex = route.indexOf("status: 'accepted'") >= 0
      ? route.indexOf("status: 'accepted'")
      : route.indexOf('accepted: true');
    assert.ok(persistIndex > 0 && acceptedIndex > persistIndex);
    assert.match(route, /status:\s*503/);
    assert.match(route, /processBotInboxMessageById/);
    assert.doesNotMatch(route, /Received:', JSON\.stringify|Received update:', JSON\.stringify/);
  }
  assert.match(transport, /parseWhatsAppWebhooks/);
  assert.match(transport, /for \(const entry of Array\.isArray\(body\?\.entry\)/);
  assert.match(transport, /throw new Error\('WHATSAPP_DELIVERY_FAILED'\)/);
});

test('claimant uses leases, durable ordering, retries, and terminal cleanup', async () => {
  const [inbox, cron, backups] = await Promise.all([
    readFile('src/lib/bot/inbox.ts', 'utf8'),
    readFile('src/app/api/cron/bot-inbox/route.ts', 'utf8'),
    readFile('src/lib/backups/config.ts', 'utf8'),
  ]);
  assert.match(inbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(inbox, /NOT EXISTS/);
  assert.match(inbox, /flag\."key" = 'bot_inbox_v2'/);
  assert.match(inbox, /older\."conversationKey" = current\."conversationKey"/);
  assert.match(inbox, /leaseExpiresAt/);
  assert.match(inbox, /MAX_ATTEMPTS = 5/);
  assert.match(inbox, /status: terminal \? 'failed' : 'retry'/);
  assert.match(inbox, /payload: terminal \? Prisma\.DbNull/);
  assert.match(inbox, /createMany/);
  assert.match(inbox, /skipDuplicates: true/);
  assert.match(inbox, /deliverBotOutputOnce/);
  assert.match(inbox, /BOT_OUTBOUND_AMBIGUOUS/);
  assert.match(inbox, /status: 'ambiguous'/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /claimBotInboxBatch\(2\)/);
  assert.match(backups, /'BotInboxMessage'/);
  assert.match(backups, /'BotInboxDelivery'/);
});

test('bot sessions are limited-role and existing unlinked rows are grandfather-safe', async () => {
  const [session, seats, schema] = await Promise.all([
    readFile('src/lib/bot/bot-session.ts', 'utf8'),
    readFile('src/lib/plan-enforcement.ts', 'utf8'),
    readFile('prisma/schema.prisma', 'utf8'),
  ]);
  assert.doesNotMatch(session, /role:\s*'MANAGER'/);
  assert.match(session, /BOT_OPERATOR/);
  assert.match(session, /GRANDFATHERED/);
  assert.match(session, /BOT_SEAT_LIMIT_REACHED/);
  assert.match(session, /pg_advisory_xact_lock/);
  assert.match(session, /existing\.isActive/);
  assert.match(session, /TransactionIsolationLevel\.Serializable/);
  const usersRoute = await readFile('src/app/api/users/route.ts', 'utf8');
  assert.match(usersRoute, /bot-seat:\$\{tenantId\}/);
  assert.match(usersRoute, /getTenantSeatUsageWithClient/);
  assert.match(usersRoute, /active === true && !membership\.isActive/);
  assert.match(usersRoute, /const usage = await lockAndReadSeatUsage\(tx, tenantId\)/);
  assert.match(seats, /seatPolicy: 'COUNTED'/);
  assert.match(schema, /seatPolicy\s+String\?/);
});

test('bot writes recheck billing and external effects are fail-closed and idempotent', async () => {
  const [tools, invoiceService, email, featureFlags, guiaService, agent] = await Promise.all([
    readFile('src/lib/bot/ai-tools.ts', 'utf8'),
    readFile('src/lib/invoice-service.ts', 'utf8'),
    readFile('src/lib/invoice-email.ts', 'utf8'),
    readFile('src/lib/feature-flags.ts', 'utf8'),
    readFile('src/lib/bot/guia-service.ts', 'utf8'),
    readFile('src/lib/bot/ai-agent.ts', 'utf8'),
  ]);
  assert.match(tools, /guardTenantWrite\(ctx\.tenantId/);
  assert.match(tools, /generate_invoice/);
  assert.match(tools, /confirmedInvoiceIntent/);
  assert.match(tools, /shouldUseBotLifecycleV2/);
  assert.match(tools, /botLifecycleReady: true/);
  assert.doesNotMatch(tools, /ctx\.operationKey && await shouldUseBotLifecycleV2/);
  assert.match(tools, /BOT_TOOL_RETRYABLE_FAILURE/);
  assert.match(tools, /BOT_BILLING_CHECK_FAILED/);
  assert.match(tools, /redactSensitiveLogValue/);
  assert.match(invoiceService, /sourceOperationKey/);
  assert.match(email, /idempotencyKey/);
  assert.match(guiaService, /correos_guia_external_claim/);
  assert.match(guiaService, /externalClaimKey = `correos-guia:\$\{order\.id\}`/);
  assert.match(agent, /if \(context\.operationKey\)[\s\S]*throw retryable/);
  assert.match(agent, /SENSITIVE_TOOL_LOG_KEY/);
  assert.match(agent, /addUserMessage\(platform, platformId, userMessage, context\.operationKey\)/);
  assert.match(agent, /context\.operationKey \? `\$\{context\.operationKey\}:assistant`/);
  assert.match(featureFlags, /scope: tenantId/);
  assert.doesNotMatch(featureFlags, /scope: 'tenant'/);
});
