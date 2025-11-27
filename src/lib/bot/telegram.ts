/**
 * Telegram Bot Setup using Grammy.js
 * 
 * This module provides the core Telegram bot functionality for Betsy AI Assistant.
 * Uses webhooks for production (Vercel) instead of polling.
 * 
 * @see https://grammy.dev/guide/deployment-types#webhooks
 */

import { Bot, Context, webhookCallback, InlineKeyboard } from 'grammy';

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
 */
export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    replyMarkup?: InlineKeyboard;
  }
): Promise<void> {
  const bot = getTelegramBot();
  
  await bot.api.sendMessage(chatId, text, {
    parse_mode: options?.parseMode || 'HTML',
    reply_markup: options?.replyMarkup,
  });
}

/**
 * Send typing indicator to show the bot is processing
 */
export async function sendTypingAction(chatId: string | number): Promise<void> {
  const bot = getTelegramBot();
  await bot.api.sendChatAction(chatId, 'typing');
}

/**
 * Send a message with inline keyboard buttons
 */
export async function sendMessageWithButtons(
  chatId: string | number,
  text: string,
  buttons: Array<{ text: string; callbackData: string }[]>
): Promise<void> {
  const bot = getTelegramBot();
  
  const keyboard = new InlineKeyboard();
  for (const row of buttons) {
    for (const btn of row) {
      keyboard.text(btn.text, btn.callbackData);
    }
    keyboard.row();
  }
  
  await bot.api.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
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

