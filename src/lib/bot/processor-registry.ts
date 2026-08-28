import type { BotPlatform } from './inbox';

export type BotInboxProcessor = (
  payload: unknown,
  operation: { inboxMessageId: string; providerMessageId: string; tenantId: string },
) => Promise<void>;

const processors = new Map<BotPlatform, BotInboxProcessor>();

export function registerBotInboxProcessor(platform: BotPlatform, processor: BotInboxProcessor) {
  processors.set(platform, processor);
}

export function getBotInboxProcessor(platform: BotPlatform) {
  const processor = processors.get(platform);
  if (!processor) throw new Error('BOT_INBOX_PROCESSOR_UNAVAILABLE');
  return processor;
}
