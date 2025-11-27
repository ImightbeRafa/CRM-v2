/**
 * Telegram Bot Webhook Handler
 * 
 * This endpoint receives all incoming messages and updates from Telegram.
 * It processes them through the AI agent and sends responses back.
 * 
 * Webhook URL: https://betsycrm.com/api/bot/telegram/webhook
 */

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
 * POST handler for Telegram webhook
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('[Telegram Webhook] Received update:', JSON.stringify(body).slice(0, 500));
    
    // Handle different update types
    if (body.message) {
      await handleMessage(body.message);
    } else if (body.callback_query) {
      await handleCallbackQuery(body.callback_query);
    }
    
    // Always return 200 to acknowledge receipt
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    // Still return 200 to prevent Telegram from retrying
    return NextResponse.json({ ok: true, error: 'Internal error' });
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any) {
  const chatId = String(message.chat.id);
  const userId = String(message.from?.id || chatId);
  const text = message.text || '';
  const displayName = message.from?.first_name || message.from?.username || 'Usuario';
  const username = message.from?.username;
  
  console.log(`[Telegram] Message from ${displayName} (${chatId}): ${text.slice(0, 100)}`);
  
  // Rate limiting
  if (isRateLimited(chatId)) {
    await sendMessage(chatId, '⏳ Has enviado muchos mensajes. Por favor espera un momento antes de continuar.');
    return;
  }
  
  // Handle /start command (connection flow)
  if (text.startsWith('/start')) {
    await handleStartCommand(chatId, text, { displayName, username });
    return;
  }
  
  // Handle /help command
  if (text === '/help') {
    await handleHelpCommand(chatId);
    return;
  }
  
  // Handle /clear command (clear conversation history)
  if (text === '/clear') {
    await clearConversationHistory('telegram', chatId);
    await sendMessage(chatId, '🗑️ Historial de conversación limpiado. ¡Empecemos de nuevo!');
    return;
  }
  
  // Handle /status command
  if (text === '/status') {
    await handleStatusCommand(chatId);
    return;
  }
  
  // Check if user is connected
  const sessionContext = await getBotSessionWithContext('telegram', chatId);
  
  if (!sessionContext) {
    await sendMessage(chatId, generateUnauthorizedMessage());
    return;
  }
  
  // Check if tenant is active
  if (!sessionContext.tenant.isActive) {
    await sendMessage(chatId, '⚠️ Tu cuenta de Betsy está desactivada. Contacta a soporte para más información.');
    return;
  }
  
  // Show typing indicator
  await sendTypingAction(chatId);
  
  // Process message through AI agent
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
  
  // Send response (split if too long for Telegram)
  await sendLongMessage(chatId, response);
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

