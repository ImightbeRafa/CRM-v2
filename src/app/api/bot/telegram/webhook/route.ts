/**
 * Telegram Bot Webhook Handler
 * 
 * This endpoint receives all incoming messages and updates from Telegram.
 * It processes them through the AI agent and sends responses back.
 * 
 * Webhook URL: https://betsycrm.com/api/bot/telegram/webhook
 */

// Module loaded

import { NextRequest, NextResponse } from 'next/server';
import { getTelegramBot, sendMessage, sendTypingAction, sendDocument } from '@/lib/bot/telegram';
import { timingSafeEqual } from 'crypto';
import { 
  findBotSession, 
  getBotSessionWithContext,
  createBotSession,
  verifyConnectionToken 
} from '@/lib/bot/bot-session';
import { processMessage, generateWelcomeMessage, generateUnauthorizedMessage } from '@/lib/bot/ai-agent';
import { clearConversationHistory } from '@/lib/bot/conversation-memory';
import { escapeHtml } from '@/lib/validation';

console.log('🚀 WEBHOOK MODULE LOADED SUCCESSFULLY 🚀');

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Rate limiting - simple in-memory store (would use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30; // messages per window
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Deduplication - track recently processed update_ids to prevent Telegram retries
const processedUpdates = new Map<number, number>(); // update_id -> timestamp
const DEDUP_WINDOW = 5 * 60 * 1000; // 5 minutes
const DEDUP_CLEANUP_INTERVAL = 60 * 1000; // cleanup every 1 minute
const DEDUP_MAX_SIZE = 10000; // max entries to prevent unbounded memory growth
let lastDedupCleanup = Date.now();

// Max message length to prevent excessive AI token costs
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Check if an update_id was already processed (deduplication)
 */
function isDuplicateUpdate(updateId: number): boolean {
  const now = Date.now();
  
  // Periodic cleanup of old entries
  if (now - lastDedupCleanup > DEDUP_CLEANUP_INTERVAL) {
    lastDedupCleanup = now;
    for (const [id, timestamp] of processedUpdates.entries()) {
      if (now - timestamp > DEDUP_WINDOW) {
        processedUpdates.delete(id);
      }
    }
  }
  
  if (processedUpdates.has(updateId)) {
    return true;
  }
  
  // Prevent unbounded growth
  if (processedUpdates.size >= DEDUP_MAX_SIZE) {
    const oldest = processedUpdates.entries().next().value;
    if (oldest) processedUpdates.delete(oldest[0]);
  }
  
  processedUpdates.set(updateId, now);
  return false;
}

// Per-chat processing lock to prevent concurrent processing for the same chat
const chatProcessingLocks = new Map<string, Promise<void>>();

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
  
  if (!secret || secret === '') {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Telegram Webhook] TELEGRAM_WEBHOOK_SECRET must be set in production');
      return false;
    }
    return true;
  }
  
  // Check X-Telegram-Bot-Api-Secret-Token header
  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  
  if (!providedSecret) {
    console.warn('[Telegram Webhook] ⚠️ Secret is configured but Telegram did not send secret token header');
    console.warn('[Telegram Webhook] ℹ️ Set webhook with: setWebhook?url=...&secret_token=YOUR_SECRET');
    return false;
  }
  
  // SECURITY: Use timing-safe comparison to prevent timing attacks
  try {
    const providedBuffer = Buffer.from(providedSecret, 'utf8');
    const secretBuffer = Buffer.from(secret, 'utf8');
    
    // Lengths must match for timingSafeEqual
    if (providedBuffer.length !== secretBuffer.length) {
      console.warn('[Telegram Webhook] ⚠️ Invalid secret token received (length mismatch)');
      return false;
    }
    
    if (!timingSafeEqual(providedBuffer, secretBuffer)) {
      console.warn('[Telegram Webhook] ⚠️ Invalid secret token received');
      return false;
    }
  } catch {
    console.warn('[Telegram Webhook] ⚠️ Error comparing secret tokens');
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
    
    // Deduplication: skip if this update_id was already processed
    if (body.update_id && isDuplicateUpdate(body.update_id)) {
      console.log(`[Telegram Webhook] ⚠️ Duplicate update_id ${body.update_id}, skipping`);
      return NextResponse.json({ ok: true });
    }
    
    // Handle different update types
    if (body.message) {
      console.log('[Telegram Webhook] 📨 Processing message...');
      const chatId = String(body.message.chat?.id || '');
      
      // Per-chat lock: wait for any ongoing processing for this chat to finish
      const existingLock = chatProcessingLocks.get(chatId);
      if (existingLock) {
        console.log(`[Telegram Webhook] ⏳ Waiting for existing processing on chat ${chatId}`);
        await existingLock.catch(() => {}); // Wait but ignore errors from previous processing
      }
      
      // Create a new lock for this chat
      let resolveLock: () => void;
      const lockPromise = new Promise<void>((resolve) => { resolveLock = resolve; });
      chatProcessingLocks.set(chatId, lockPromise);
      
      try {
        await handleMessage(body.message);
        console.log('[Telegram Webhook] ✅ Message handled successfully');
      } finally {
        resolveLock!();
        chatProcessingLocks.delete(chatId);
      }
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
 * Transcribe voice message using OpenAI Whisper
 */
async function transcribeVoiceMessage(fileId: string): Promise<string | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;
  
  if (!botToken || !openaiKey) {
    console.error('[Telegram] Missing TELEGRAM_BOT_TOKEN or OPENAI_API_KEY for voice transcription');
    return null;
  }
  
  try {
    // 1. Get file path from Telegram
    console.log(`[Telegram] 🎤 Getting file path for voice message: ${fileId}`);
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.error('[Telegram] Failed to get file path:', fileData);
      return null;
    }
    
    const filePath = fileData.result.file_path;
    console.log(`[Telegram] 📁 File path: ${filePath}`);
    
    // 2. Download the voice file from Telegram
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const audioResponse = await fetch(fileUrl);
    const audioBuffer = await audioResponse.arrayBuffer();
    
    console.log(`[Telegram] 📥 Downloaded audio: ${audioBuffer.byteLength} bytes`);
    
    // 3. Send to OpenAI Whisper for transcription
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', audioBlob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'es'); // Spanish
    
    console.log(`[Telegram] 🔄 Sending to Whisper for transcription...`);
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: formData,
    });
    
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('[Telegram] Whisper API error:', errorText);
      return null;
    }
    
    const transcription = await whisperResponse.json();
    console.log(`[Telegram] ✅ Transcription: "${transcription.text?.slice(0, 100)}..."`);
    
    return transcription.text || null;
  } catch (error: any) {
    console.error('[Telegram] Voice transcription error:', error);
    return null;
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(message: any) {
  try {
    const chatId = String(message.chat.id);
    const userId = String(message.from?.id || chatId);
    let text = message.text || '';
    const displayName = message.from?.first_name || message.from?.username || 'Usuario';
    const username = message.from?.username;
    
    // Handle voice messages
    if (message.voice) {
      console.log(`[Telegram] 🎤 Voice message from ${displayName} (${chatId}), duration: ${message.voice.duration}s`);
      
      await sendMessage(chatId, '🎤 Procesando tu mensaje de voz...');
      
      const transcribedText = await transcribeVoiceMessage(message.voice.file_id);
      
      if (!transcribedText) {
        await sendMessage(chatId, '❌ No pude procesar tu mensaje de voz. Por favor intenta de nuevo o escribe tu mensaje.');
        return;
      }
      
      text = transcribedText;
      console.log(`[Telegram] 📝 Transcribed voice: "${text.slice(0, 100)}"`);
    }
    
    // Handle audio messages (similar to voice but different field)
    if (message.audio) {
      console.log(`[Telegram] 🎵 Audio message from ${displayName} (${chatId})`);
      
      await sendMessage(chatId, '🎵 Procesando tu audio...');
      
      const transcribedText = await transcribeVoiceMessage(message.audio.file_id);
      
      if (!transcribedText) {
        await sendMessage(chatId, '❌ No pude procesar tu audio. Por favor intenta de nuevo o escribe tu mensaje.');
        return;
      }
      
      text = transcribedText;
      console.log(`[Telegram] 📝 Transcribed audio: "${text.slice(0, 100)}"`);
    }
    
    console.log(`[Telegram] 📩 Message from ${displayName} (${chatId}): ${text.slice(0, 100)}`);
    
    // Input length validation - prevent excessively long messages
    if (text.length > MAX_MESSAGE_LENGTH) {
      console.log(`[Telegram] ⚠️ Message too long (${text.length} chars) from ${chatId}`);
      await sendMessage(chatId, `⚠️ Tu mensaje es demasiado largo (${text.length} caracteres). El máximo es ${MAX_MESSAGE_LENGTH}. Por favor acorta tu mensaje.`);
      return;
    }
    
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

    // Check if awaiting name (during setup)
    const { getConversationState, clearConversationState } = await import('@/lib/bot/conversation-memory');
    const state = await getConversationState('telegram', chatId);

    if (state?.awaitingName) {
      console.log(`[Telegram] 📝 User provided name during setup: ${text}`);

      if (text.length < 2 || text.length > 100) {
        await sendMessage(chatId, '⚠️ Por favor ingresa un nombre válido (entre 2 y 100 caracteres).');
        return;
      }

      try {
        console.log(`[Telegram] 🔧 Creating session for ${chatId} in tenant ${state.tenantId}`);
        const session = await createBotSession(
          'telegram',
          chatId,
          null,
          state.tenantId,
          {
            providedName: text.trim(),
            displayName: displayName,
            username: username,
          }
        );

        console.log(`[Telegram] ✅ Session created successfully:`, {
          id: session.id,
          platformId: session.platformId,
          tenantId: session.tenantId,
          providedName: session.providedName,
        });

        const verifySession = await findBotSession('telegram', chatId);
        if (!verifySession) {
          console.error(`[Telegram] ❌ CRITICAL: Session was created but cannot be found immediately!`);
          await sendMessage(chatId, '⚠️ Hubo un error al guardar tu sesión. Por favor intenta de nuevo con /start CODE');
          return;
        }
        console.log(`[Telegram] ✅ Session verified: ${verifySession.id}`);

      } catch (error: any) {
        console.error(`[Telegram] ❌ Error creating session:`, error);
        console.error(`[Telegram] Error details:`, {
          message: error.message,
          code: error.code,
          meta: error.meta,
        });
        await sendMessage(chatId, '❌ Error al crear tu sesión. Por favor contacta a soporte.');
        return;
      }

      await clearConversationState('telegram', chatId);

      const safeName = escapeHtml(text.trim());
      const safeTenantName = escapeHtml(state.tenantName);
      const safeUsername = username ? escapeHtml(username) : null;
      const welcomeMsg = `🎉 <b>¡Configuración completa, ${safeName}!</b>

✅ <b>Tu bot está listo para usar</b>

Conectado a: <b>${safeTenantName}</b>
Tu nombre: <b>${safeName}</b>
Usuario: ${safeUsername ? `@${safeUsername}` : 'Telegram'}

━━━━━━━━━━━━━━━━━━━━

<b>💬 Ya puedes empezar a trabajar:</b>

📦 <b>ÓRDENES</b>
• "Crea una orden para María López..."
• "Cuántas órdenes tengo pendientes?"
• "Muéstrame las órdenes de hoy"
• "Actualiza el estado de la orden #123"

📊 <b>INVENTARIO</b>
• "Cuánto stock tengo de camisetas?"
• "Busca producto hoodie negro"
• "Muéstrame productos con poco stock"

📈 <b>REPORTES</b>
• "Cuánto vendí esta semana?"
• "Top 5 productos más vendidos"
• "Estadísticas del mes"

🚚 <b>ENVÍOS</b>
• "Genera guía de envío para orden #456"
• "Órdenes listas para enviar"

👥 <b>CLIENTES</b>
• "Busca cliente Juan Pérez"
• "Clientes con más compras"

━━━━━━━━━━━━━━━━━━━━

<b>🚀 ¡Escribe tu primera consulta ahora!</b>

Usa /help para ver todos los comandos disponibles.`;

      await sendMessage(chatId, welcomeMsg);

      console.log(`[Telegram] ✅ Session created for ${text.trim()} (@${username}) in tenant ${state.tenantName}`);
      return;
    }

    // Check if user is connected
    console.log(`[Telegram] 🔍 Checking session for ${chatId}...`);
    console.log(`[Telegram] 🔍 Chat ID type: ${typeof chatId}, value: "${chatId}"`);

    const simpleSession = await findBotSession('telegram', chatId);
    console.log(`[Telegram] 🔍 Simple session lookup result:`, simpleSession ? {
      id: simpleSession.id,
      platformId: simpleSession.platformId,
      userId: simpleSession.userId,
      tenantId: simpleSession.tenantId,
      isActive: simpleSession.isActive,
    } : 'null');

    const sessionContext = await getBotSessionWithContext('telegram', chatId);

    if (!sessionContext) {
      console.log(`[Telegram] ⚠️ No session context found for ${chatId}`);
      console.log(`[Telegram] 📋 But simple session was: ${simpleSession ? 'FOUND' : 'NOT FOUND'}`);
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
    
    console.log(`[Telegram] 💬 AI Response generated (${response.text.length} chars)`);
    
    // Send text response (split if too long for Telegram)
    console.log(`[Telegram] 📤 Sending response to ${chatId}...`);
    await sendLongMessage(chatId, response.text);

    // Send any PDF attachments from tool results
    if (response.attachments && response.attachments.length > 0) {
      for (const attachment of response.attachments) {
        try {
          console.log(`[Telegram] 📎 Sending attachment "${attachment.filename}" to ${chatId}...`);
          await sendDocument(chatId, attachment.buffer, attachment.filename, attachment.caption);
        } catch (attachErr: any) {
          console.error(`[Telegram] ❌ Failed to send attachment "${attachment.filename}":`, attachErr.message);
          await sendMessage(chatId, `⚠️ No pude enviar el archivo "${attachment.filename}". Puedes descargarlo desde el panel de Betsy.`);
        }
      }
    }

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
 * Handle /start command - NEW CODE-BASED flow
 */
async function handleStartCommand(
  chatId: string,
  text: string,
  userInfo: { displayName: string; username?: string }
) {
  const { validateBotAccessCode } = await import('@/lib/bot/access-code');
  
  // Check if there's an access code
  const parts = text.split(' ');
  const code = parts[1]?.trim().toUpperCase(); // /start ABC123XYZ789
  
  if (code) {
    // Validate the access code
    const tenant = await validateBotAccessCode(code);
    
    if (!tenant) {
      await sendMessage(chatId, `⚠️ <b>Código inválido</b>

El código <code>${escapeHtml(code)}</code> no existe o ha expirado.

Por favor verifica el código e intenta de nuevo.`);
      return;
    }
    
    // Code is valid! Ask for their name for audit trail
    const { setConversationState } = await import('@/lib/bot/conversation-memory');
    await setConversationState('telegram', chatId, {
      awaitingName: true,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });
    
    await sendMessage(chatId, `✅ <b>Código válido!</b>

Estás conectando a: <b>${escapeHtml(tenant.name)}</b>

Para el registro de auditoría, ¿cuál es tu nombre completo?

<i>Ejemplo: Juan Pérez o María González</i>`);
    
    return;
  }
  
  // No code - check if already connected
  const existingSession = await findBotSession('telegram', chatId);
  
  if (existingSession) {
    // Already connected
    const { prisma } = await import('@/lib/db');
    const tenant = await prisma.tenant.findUnique({
      where: { id: existingSession.tenantId },
      select: { name: true },
    });
    
    const userName = existingSession.providedName || existingSession.displayName || userInfo.displayName;
    
    await sendMessage(chatId, `👋 <b>¡Hola de nuevo, ${escapeHtml(userName)}!</b>

✅ <b>Tu sesión está activa y lista</b>

Conectado a: <b>${escapeHtml(tenant?.name || 'Betsy')}</b>

━━━━━━━━━━━━━━━━━━━━

<b>💬 ¿En qué puedo ayudarte hoy?</b>

Ejemplos rápidos:
• "Cuántas órdenes tengo pendientes?"
• "Crea una orden para..."
• "Muéstrame el inventario"
• "Estadísticas del día"

Usa /help para ver todos los comandos.`);
    return;
  }
  
  // Not connected and no code
  await sendMessage(chatId, `👋 <b>¡Bienvenido a Betsy AI Assistant!</b>

Para conectarte, necesitas un código de acceso de 12 caracteres.

<b>¿Cómo obtener tu código?</b>

1. Pide a tu administrador el código de acceso
2. Envía: <code>/start CODIGO123ABC</code>

<b>¿Eres administrador?</b>
Encuentra tu código en: https://www.betsycrm.com/config/ai-assistant`);
}

/**
 * Handle /help command
 */
async function handleHelpCommand(chatId: string) {
  const helpMessage = `📚 <b>Guía Rápida de Betsy AI</b>

✅ <b>Tu bot está listo para:</b>

━━━━━━━━━━━━━━━━━━━━

📦 <b>GESTIONAR ÓRDENES</b>
• "Muéstrame las órdenes de hoy"
• "Crea orden para María García, 1 camiseta talla M, ₡12000, San José"
• "Cambia estado de orden #123 a Enviado"
• "Órdenes pendientes de esta semana"

📊 <b>REVISAR INVENTARIO</b>
• "Cuánto stock tengo de hoodie negro talla L?"
• "Productos con menos de 10 unidades"
• "Busca producto camiseta blanca"

📈 <b>VER ESTADÍSTICAS</b>
• "Cuánto vendí hoy?"
• "Ventas de esta semana"
• "Top 5 productos más vendidos"
• "Resumen del mes"

🚚 <b>GESTIONAR ENVÍOS</b>
• "Genera guía de envío para orden #456"
• "Órdenes listas para enviar"

👥 <b>BUSCAR CLIENTES</b>
• "Busca cliente Juan Pérez"
• "Clientes con más compras"

━━━━━━━━━━━━━━━━━━━━

<b>⚡ COMANDOS RÁPIDOS</b>
/start - Reconectar
/status - Ver tu conexión
/clear - Limpiar conversación
/help - Esta ayuda

💡 <b>Tips:</b>
• Escribe en lenguaje natural
• Sé específico con los detalles
• Incluye toda la info en un mensaje

<b>🚀 ¡Ya puedes empezar a trabajar!</b>`;

  await sendMessage(chatId, helpMessage);
}

/**
 * Handle /status command
 */
async function handleStatusCommand(chatId: string) {
  const session = await getBotSessionWithContext('telegram', chatId);
  
  if (!session) {
    await sendMessage(chatId, `❌ <b>No estás conectado</b>

Para conectarte, necesitas un código de acceso.

Pide el código a tu administrador y envía:
<code>/start CODIGO123ABC</code>`);
    return;
  }
  
  const userName = escapeHtml(session.user.name || session.user.email);
  const connectedDate = session.session.connectedAt.toLocaleDateString('es-CR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const statusMessage = `✅ <b>Tu sesión está ACTIVA</b>

━━━━━━━━━━━━━━━━━━━━

👤 <b>Usuario:</b> ${userName}
🏢 <b>Empresa:</b> ${escapeHtml(session.tenant.name)}
📊 <b>Plan:</b> ${escapeHtml(session.tenant.plan)}
🔑 <b>Rol:</b> ${escapeHtml(session.role)}
⏰ <b>Conectado:</b> ${connectedDate}

━━━━━━━━━━━━━━━━━━━━

🚀 <b>Estado:</b> Listo para recibir comandos

<b>Puedes:</b>
• Crear y gestionar órdenes
• Consultar inventario
• Ver estadísticas
• Generar guías de envío
• Buscar clientes

Escribe cualquier consulta o usa /help para ejemplos.`;

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

