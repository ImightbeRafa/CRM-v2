/**
 * Telegram Bot Setup using Grammy.js
 * 
 * This module provides the core Telegram bot functionality for Betsy AI Assistant.
 * Uses webhooks for production (Vercel) instead of polling.
 * 
 * @see https://grammy.dev/guide/deployment-types#webhooks
 */

import { Bot, Context, webhookCallback, InlineKeyboard } from 'grammy';

/**
 * Convert markdown to HTML for Telegram
 * Handles common markdown patterns that AI might generate
 */
function markdownToHtml(text: string): string {
  return text
    // Bold: **text** or __text__ -> <b>text</b>
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    // Italic: *text* or _text_ -> <i>text</i>
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<i>$1</i>')
    // Strikethrough: ~~text~~ -> <s>text</s>
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    // Code: `text` -> <code>text</code>
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Escape special HTML characters that Telegram requires
    .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;');
}

// Bot instance - singleton pattern for webhook mode
let botInstance: Bot | null = null;

/**
 * Get or create the Telegram bot instance
 * Uses TELEGRAM_BOT_TOKEN from environment
 */
export function getTelegramBot(): Bot {
  if (!botInstance) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
    }
    
    botInstance = new Bot(token);
    
    // Error handler - log but don't crash
    botInstance.catch((err) => {
      console.error('[Telegram Bot] Error:', err);
    });
  }
  
  return botInstance;
}

/**
 * Create webhook callback handler for Next.js API route
 * This is used in the webhook route handler
 */
export function createWebhookHandler() {
  const bot = getTelegramBot();
  return webhookCallback(bot, 'std/http');
}

/**
 * Send a text message to a Telegram chat
 * Uses direct HTTP API to avoid AbortSignal issues in serverless
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    replyMarkup?: InlineKeyboard;
  }
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }
  
  // Convert markdown to HTML if using HTML parse mode
  const parseMode = options?.parseMode || 'HTML';
  const processedText = parseMode === 'HTML' ? markdownToHtml(text) : text;
  
  const body: any = {
    chat_id: chatId,
    text: processedText,
    parse_mode: parseMode,
  };
  
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }
  
  console.log(`[Telegram] 📤 Sending message to ${chatId} (original: ${text.length} chars, processed: ${processedText.length} chars)...`);
  
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  const responseData = await response.json();
  
  if (!response.ok || !responseData.ok) {
    console.error('[Telegram] ❌ sendMessage failed:', JSON.stringify(responseData));
    throw new Error(`Telegram API error: ${responseData.description || 'Unknown error'}`);
  }
  
  console.log(`[Telegram] ✅ Message delivered, message_id: ${responseData.result?.message_id}`);
}

/**
 * Send typing indicator to show the bot is processing
 * Uses direct HTTP API to avoid AbortSignal issues in serverless
 */
export async function sendTypingAction(chatId: string | number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }
  
  const response = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      action: 'typing',
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('[Telegram] sendChatAction failed:', error);
    // Don't throw - typing indicator is optional
  }
}

/**
 * Send a message with inline keyboard buttons
 * Uses direct HTTP API to avoid AbortSignal issues in serverless
 */
export async function sendMessageWithButtons(
  chatId: string | number,
  text: string,
  buttons: Array<{ text: string; callbackData: string }[]>
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }
  
  // Build inline keyboard structure
  const inline_keyboard = buttons.map(row =>
    row.map(btn => ({
      text: btn.text,
      callback_data: btn.callbackData,
    }))
  );
  
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard,
      },
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('[Telegram] sendMessageWithButtons failed:', error);
    throw new Error(`Telegram API error: ${error}`);
  }
}

/**
 * Generate a magic deep link for bot connection
 * The payload contains encrypted user/tenant info
 */
export function generateDeepLink(payload: string): string {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'BetsyAIBot';
  return `https://t.me/${botUsername}?start=${payload}`;
}

/**
 * Set the webhook URL for the bot
 * Call this once during deployment or via CLI
 */
export async function setWebhook(webhookUrl: string): Promise<boolean> {
  const bot = getTelegramBot();
  
  try {
    await bot.api.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'callback_query', 'inline_query'],
      drop_pending_updates: true, // Don't process old messages on restart
    });
    
    console.log('[Telegram Bot] Webhook set to:', webhookUrl);
    return true;
  } catch (error) {
    console.error('[Telegram Bot] Failed to set webhook:', error);
    return false;
  }
}

/**
 * Delete the current webhook (for switching to polling in dev)
 */
export async function deleteWebhook(): Promise<boolean> {
  const bot = getTelegramBot();
  
  try {
    await bot.api.deleteWebhook();
    console.log('[Telegram Bot] Webhook deleted');
    return true;
  } catch (error) {
    console.error('[Telegram Bot] Failed to delete webhook:', error);
    return false;
  }
}

/**
 * Get webhook info for debugging
 */
export async function getWebhookInfo() {
  const bot = getTelegramBot();
  return await bot.api.getWebhookInfo();
}

/**
 * Format order for Telegram display
 */
export function formatOrderForTelegram(order: any): string {
  const lines = [
    `📦 <b>Orden #${order.orderId}</b>`,
    ``,
    `👤 <b>Cliente:</b> ${order.customerName}`,
    order.phone ? `📱 <b>Teléfono:</b> ${order.phone}` : null,
    order.email ? `📧 <b>Email:</b> ${order.email}` : null,
    ``,
    `🛍️ <b>Producto:</b> ${order.product || 'N/A'}`,
    order.quantity ? `📊 <b>Cantidad:</b> ${order.quantity}` : null,
    order.size ? `📏 <b>Talla:</b> ${order.size}` : null,
    order.color ? `🎨 <b>Color:</b> ${order.color}` : null,
    ``,
    `💰 <b>Total:</b> ₡${(order.total || 0).toLocaleString('es-CR')}`,
    `📍 <b>Estado:</b> ${order.status}`,
    order.province ? `🌍 <b>Ubicación:</b> ${[order.province, order.canton, order.district].filter(Boolean).join(', ')}` : null,
    order.address ? `📫 <b>Dirección:</b> ${order.address}` : null,
  ].filter(Boolean);
  
  return lines.join('\n');
}

/**
 * Format inventory item for Telegram display
 */
export function formatInventoryForTelegram(item: any): string {
  const stockStatus = item.currentStock <= item.minStock 
    ? '🔴 Stock bajo' 
    : item.currentStock <= item.reorderPoint 
      ? '🟡 Reabastecer pronto'
      : '🟢 En stock';
  
  return [
    `📦 <b>${item.name}</b>`,
    `SKU: ${item.sku}`,
    ``,
    `📊 <b>Stock actual:</b> ${item.currentStock} unidades`,
    `${stockStatus}`,
    ``,
    `💰 <b>Precio:</b> ₡${(item.sellingPrice || 0).toLocaleString('es-CR')}`,
    `💵 <b>Costo:</b> ₡${(item.unitCost || 0).toLocaleString('es-CR')}`,
    item.category ? `📁 <b>Categoría:</b> ${item.category}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Format statistics summary for Telegram display
 */
export function formatStatsForTelegram(stats: any): string {
  return [
    `📊 <b>Resumen de Ventas</b>`,
    ``,
    `🛒 <b>Total Órdenes:</b> ${stats.totalSales || 0}`,
    `💰 <b>Ingresos:</b> ₡${(stats.totalRevenue || 0).toLocaleString('es-CR')}`,
    `📈 <b>Promedio por orden:</b> ₡${(stats.averageOrderValue || 0).toLocaleString('es-CR')}`,
    `👥 <b>Clientes activos:</b> ${stats.activeClients || 0}`,
    stats.trends ? [
      ``,
      `📈 <b>Tendencias:</b>`,
      `Ventas: ${stats.trends.sales > 0 ? '↑' : '↓'} ${Math.abs(stats.trends.sales).toFixed(1)}%`,
      `Ingresos: ${stats.trends.revenue > 0 ? '↑' : '↓'} ${Math.abs(stats.trends.revenue).toFixed(1)}%`,
    ].join('\n') : null,
  ].filter(Boolean).join('\n');
}

export type { Context };

