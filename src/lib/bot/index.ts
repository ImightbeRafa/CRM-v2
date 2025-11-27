/**
 * Betsy AI Bot Module
 * 
 * Central exports for the Telegram/WhatsApp AI Sales Assistant.
 */

// Telegram bot utilities
export {
  getTelegramBot,
  sendMessage,
  sendTypingAction,
  sendMessageWithButtons,
  generateDeepLink,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  formatOrderForTelegram,
  formatInventoryForTelegram,
  formatStatsForTelegram,
  type Context,
} from './telegram';

// Bot session management
export {
  createBotSession,
  findBotSession,
  findUserBotSessions,
  findTenantBotSessions,
  deactivateBotSession,
  deactivateBotSessionById,
  getBotSessionWithContext,
  generateConnectionToken,
  verifyConnectionToken,
  type BotSessionData,
  type ConnectionTokenPayload,
} from './bot-session';

// AI agent
export {
  processMessage,
  generateWelcomeMessage,
  generateUnauthorizedMessage,
} from './ai-agent';

// AI tools
export {
  toolSchemas,
  executeTool,
  type ToolContext,
  type ToolResult,
  type ToolName,
} from './ai-tools';

// Conversation memory
export {
  getConversationHistory,
  addUserMessage,
  addAssistantMessage,
  clearConversationHistory,
  getFormattedHistory,
  setPendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
  type ConversationMessage,
} from './conversation-memory';

