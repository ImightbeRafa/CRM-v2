/**
 * Telegram Bot Webhook Handler
 * 
 * This endpoint receives all incoming messages and updates from Telegram.
 * It processes them through the AI agent and sends responses back.
 * 
 * Webhook URL: https://betsycrm.com/api/bot/telegram/webhook
 */

console.log('🚀🚀🚀 WEBHOOK MODULE LOADING 🚀🚀🚀', new Date().toISOString());

import { NextRequest, NextResponse } from 'next/server';
import { getTelegramBot, sendMessage, sendTypingAction } from '@/lib/bot/telegram';
import { 
  findBotSession, 
  getBotSessionWithContext,
  createBotSession,
  verifyConnectionToken 
} from '@/lib/bot/bot-session';
import { processMessage, generateWelcomeMessage, generateUnauthorizedMessage } from '@/lib/bot/ai-agent';
import { clearConversationHistory } from '@/lib/bot/conversation-memory';

console.log('🚀 WEBHOOK MODULE LOADED SUCCESSFULLY 🚀');

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Rate limiting - simple in-memory store (would use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30; // messages per window
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

/**
 * Check if a chat is rate limited
 */
function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(chatId);
  
  if (!entry || now > entry.resetAt) {
    // Reset or create new entry
    rateLimitMap.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  
  entry.count++;
  return false;
}

/**
 * Optional: Verify webhook secret (disabled by default for easier setup)
 * Enable this in production by setting TELEGRAM_WEBHOOK_SECRET
 */
function verifyWebhookSecret(request: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  
  // If no secret is configured, allow all requests (for easier initial setup)
  if (!secret || secret === '') {
    console.log('[Telegram Webhook] ℹ️ Secret verification disabled (TELEGRAM_WEBHOOK_SECRET not set)');
    return true;
  }
  
  // Check X-Telegram-Bot-Api-Secret-Token header
  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  
  if (!providedSecret) {
    console.warn('[Telegram Webhook] ⚠️ Secret is configured but Telegram did not send secret token header');
    console.warn('[Telegram Webhook] ℹ️ Set webhook with: setWebhook?url=...&secret_token=YOUR_SECRET');
    return false;
  }
  
  if (providedSecret !== secret) {
    console.warn('[Telegram Webhook] ⚠️ Invalid secret token received');
    return false;
  }
  
  console.log('[Telegram Webhook] ✅ Secret token verified');
  return true;
}

/**
 * POST handler for Telegram webhook
 * This endpoint is PUBLIC - no authentication required (Telegram calls it directly)
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Verify the request came from Telegram
    if (!verifyWebhookSecret(request)) {
      console.warn('[Telegram Webhook] ❌ Unauthorized webhook request (invalid secret)');
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    
    console.log('[Telegram Webhook] ✅ Received update:', JSON.stringify(body).slice(0, 500));
    
    // Handle different update types
    if (body.message) {
      console.log('[Telegram Webhook] 📨 Processing message...');
      await handleMessage(body.message);
      console.log('[Telegram Webhook] ✅ Message handled successfully');
    } else if (body.callback_query) {
      console.log('[Telegram Webhook] 🔘 Processing callback query...');
      await handleCallbackQuery(body.callback_query);
      console.log('[Telegram Webhook] ✅ Callback handled successfully');
    } else {
      console.log('[Telegram Webhook] ⚠️ Unknown update type:', Object.keys(body));
    }
    
    // Always return 200 to acknowledge receipt
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[Telegram Webhook] ❌ CRITICAL ERROR:', error);
    console.error('[Telegram Webhook] Error stack:', error.stack);
    console.error('[Telegram Webhook] Error message:', error.message);
    // Still return 200 to prevent Telegram from retrying
    return NextResponse.json({ ok: true, error: 'Internal error' });
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any) {
  try {
    const chatId = String(message.chat.id);
    const userId = String(message.from?.id || chatId);
    const text = message.text || '';
    const displayName = message.from?.first_name || message.from?.username || 'Usuario';
    const username = message.from?.username;
    
    console.log(`[Telegram] 📩 Message from ${displayName} (${chatId}): ${text.slice(0, 100)}`);
    
    // Rate limiting
    if (isRateLimited(chatId)) {
      console.log(`[Telegram] ⏳ Rate limited: ${chatId}`);
      await sendMessage(chatId, '⏳ Has enviado muchos mensajes. Por favor espera un momento antes de continuar.');
      return;
    }
    
    // Handle /start command (connection flow)
    if (text.startsWith('/start')) {
      console.log(`[Telegram] 🚀 Handling /start command for ${chatId}`);
      await handleStartCommand(chatId, text, { displayName, username });
      return;
    }
    
    // Handle /help command
    if (text === '/help') {
      console.log(`[Telegram] ❓ Handling /help command for ${chatId}`);
      await handleHelpCommand(chatId);
      return;
    }
    
    // Handle /clear command (clear conversation history)
    if (text === '/clear') {
      console.log(`[Telegram] 🗑️ Handling /clear command for ${chatId}`);
      await clearConversationHistory('telegram', chatId);
      await sendMessage(chatId, '🗑️ Historial de conversación limpiado. ¡Empecemos de nuevo!');
      return;
    }
    
    // Handle /status command
    if (text === '/status') {
      console.log(`[Telegram] 📊 Handling /status command for ${chatId}`);
      await handleStatusCommand(chatId);
      return;
    }
    
    // Check if user is connected
    console.log(`[Telegram] 🔍 Checking session for ${chatId}...`);
    const sessionContext = await getBotSessionWithContext('telegram', chatId);
    
    if (!sessionContext) {
      console.log(`[Telegram] ⚠️ No session found for ${chatId}`);
      await sendMessage(chatId, generateUnauthorizedMessage());
      return;
    }
    
    console.log(`[Telegram] ✅ Session found for ${chatId} - User: ${sessionContext.user.email}, Tenant: ${sessionContext.tenant.name}`);
    
    // Check if tenant is active
    if (!sessionContext.tenant.isActive) {
      console.log(`[Telegram] ⚠️ Tenant inactive for ${chatId}`);
      await sendMessage(chatId, '⚠️ Tu cuenta de Betsy está desactivada. Contacta a soporte para más información.');
      return;
    }
    
    // Show typing indicator
    console.log(`[Telegram] ⌨️ Sending typing action...`);
    await sendTypingAction(chatId);
    
    // Process message through AI agent
    console.log(`[Telegram] 🤖 Processing message through AI agent...`);
    const response = await processMessage(
      'telegram',
      chatId,
      text,
      {
        tenantId: sessionContext.session.tenantId,
        userId: sessionContext.user.id,
        userName: sessionContext.user.name || sessionContext.user.username || sessionContext.user.email || displayName,
        userRole: sessionContext.role,
      }
    );
    
    console.log(`[Telegram] 💬 AI Response generated (${response.length} chars)`);
    
    // Send response (split if too long for Telegram)
    console.log(`[Telegram] 📤 Sending response to ${chatId}...`);
    await sendLongMessage(chatId, response);
    console.log(`[Telegram] ✅ Response sent successfully to ${chatId}`);
  } catch (error: any) {
    console.error(`[Telegram] ❌ Error in handleMessage:`, error);
    console.error(`[Telegram] Error stack:`, error.stack);
    // Try to send error message to user
    try {
      await sendMessage(message.chat.id, '❌ Lo siento, ocurrió un error al procesar tu mensaje. Por favor intenta de nuevo.');
    } catch (sendError) {
      console.error(`[Telegram] ❌ Failed to send error message:`, sendError);
    }
  }
}

/**
 * Handle /start command - connection flow
 */
async function handleStartCommand(
  chatId: string,
  text: string,
  userInfo: { displayName: string; username?: string }
) {
  // Check if there's a connection token
  const parts = text.split(' ');
  const token = parts[1]; // /start <token>
  
  if (token) {
    // Verify and use the token to connect
    const payload = await verifyConnectionToken(token);
    
    if (!payload) {
      await sendMessage(chatId, '⚠️ El enlace de conexión ha expirado o es inválido.\n\nPor favor, genera un nuevo enlace desde tu panel de Betsy.');
      return;
    }
    
    // Create bot session
    await createBotSession(
      'telegram',
      chatId,
      payload.userId,
      payload.tenantId,
      {
        displayName: userInfo.displayName,
        username: userInfo.username,
      }
    );
    
    // Get tenant name
    const { prisma } = await import('@/lib/db');
    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { name: true },
    });
    
    // Send welcome message
    await sendMessage(
      chatId,
      generateWelcomeMessage(payload.userName || userInfo.displayName, tenant?.name || 'tu negocio')
    );
    
    return;
  }
  
  // No token - check if already connected
  const existingSession = await findBotSession('telegram', chatId);
  
  if (existingSession) {
    // Already connected
    await sendMessage(chatId, `👋 ¡Hola de nuevo! Ya estás conectado a Betsy.

¿En qué puedo ayudarte hoy?

Escribe tu pregunta en lenguaje natural o usa /help para ver los comandos disponibles.`);
    return;
  }
  
  // Not connected and no token
  await sendMessage(chatId, generateUnauthorizedMessage());
}

/**
 * Handle /help command
 */
async function handleHelpCommand(chatId: string) {
  const helpMessage = `📚 **Comandos disponibles:**

/start - Iniciar o reconectar el bot
/help - Mostrar esta ayuda
/status - Ver estado de conexión
/clear - Limpiar historial de conversación

📦 **Ejemplos de uso:**

• "Muéstrame las órdenes de hoy"
• "Crea orden para María García, 1 camiseta talla M, ₡12000"
• "¿Cuánto vendí esta semana?"
• "Busca el cliente Juan Pérez"
• "Cambia estado de orden BOT-123 a Enviado"
• "¿Cuánto stock tengo de hoodie negro?"

💡 **Tips:**
• Puedes escribir en lenguaje natural
• Incluye toda la información posible en tu mensaje
• Para cancelar una acción, escribe "cancelar"

¿Necesitas más ayuda? Visita https://betsycrm.com/docs`;

  await sendMessage(chatId, helpMessage);
}

/**
 * Handle /status command
 */
async function handleStatusCommand(chatId: string) {
  const session = await getBotSessionWithContext('telegram', chatId);
  
  if (!session) {
    await sendMessage(chatId, '❌ No estás conectado a ninguna cuenta de Betsy.\n\nUsa el enlace de conexión desde tu panel de Betsy para vincular tu cuenta.');
    return;
  }
  
  const statusMessage = `✅ **Estado de conexión**

👤 **Usuario:** ${session.user.name || session.user.email}
🏢 **Tenant:** ${session.tenant.name}
📊 **Plan:** ${session.tenant.plan}
🔑 **Rol:** ${session.role}

Conectado desde: ${session.session.connectedAt.toLocaleDateString('es-CR')}`;

  await sendMessage(chatId, statusMessage);
}

/**
 * Handle callback queries (button clicks)
 */
async function handleCallbackQuery(callbackQuery: any) {
  const chatId = String(callbackQuery.message?.chat.id);
  const data = callbackQuery.data;
  const messageId = callbackQuery.message?.message_id;
  
  console.log(`[Telegram] Callback query from ${chatId}: ${data}`);
  
  // Acknowledge the callback
  const bot = getTelegramBot();
  await bot.api.answerCallbackQuery(callbackQuery.id);
  
  // Process callback data
  // This can be extended for interactive buttons
  if (data === 'confirm_yes') {
    // Handle confirmation
  } else if (data === 'confirm_no') {
    await sendMessage(chatId, '✅ Acción cancelada.');
  }
}

/**
 * Send a long message by splitting it if necessary
 * Telegram has a 4096 character limit
 */
async function sendLongMessage(chatId: string, text: string) {
  const MAX_LENGTH = 4000; // Leave some margin
  
  if (text.length <= MAX_LENGTH) {
    await sendMessage(chatId, text);
    return;
  }
  
  // Split by paragraphs first
  const paragraphs = text.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > MAX_LENGTH) {
      if (currentChunk) {
        await sendMessage(chatId, currentChunk.trim());
      }
      currentChunk = paragraph + '\n\n';
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }
  
  if (currentChunk.trim()) {
    await sendMessage(chatId, currentChunk.trim());
  }
}

/**
 * GET handler for webhook verification (Telegram doesn't use this, but good to have)
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    message: 'Betsy Telegram Bot Webhook',
    timestamp: new Date().toISOString(),
  });
}

