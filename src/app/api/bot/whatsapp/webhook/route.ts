/**
 * WhatsApp Cloud API Webhook Handler
 * 
 * This endpoint receives all incoming messages and updates from WhatsApp.
 * It processes them through the AI agent and sends responses back.
 * 
 * Webhook URL: https://betsycrm.com/api/bot/whatsapp/webhook
 * 
 * Setup in Meta Developer Dashboard:
 * 1. Go to WhatsApp > Configuration
 * 2. Set Callback URL to: https://betsycrm.com/api/bot/whatsapp/webhook
 * 3. Set Verify Token to: (same as WHATSAPP_VERIFY_TOKEN env var)
 * 4. Subscribe to: messages
 */

import { after, NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { 
  sendWhatsAppMessage, 
  sendWhatsAppButtonMessage,
  sendWhatsAppDocument,
  markMessageAsRead,
  transcribeWhatsAppVoice,
  parseWhatsAppWebhook,
  parseWhatsAppWebhooks,
  verifyWebhook,
  type WhatsAppMessage 
} from '@/lib/bot/whatsapp';
import { 
  findBotSession, 
  getBotSessionWithContext,
  createBotSession,
} from '@/lib/bot/bot-session';
import { validateBotAccessCode } from '@/lib/bot/access-code';
import { processMessage } from '@/lib/bot/ai-agent';
import { clearConversationHistory, clearPendingConfirmation, getConversationState, setConversationState, clearConversationState } from '@/lib/bot/conversation-memory';
import { readBotInboxReadiness } from '@/lib/feature-flags';
import {
  deliverBotOutputOnce,
  hashBotDeliveryContent,
  persistBotInboxMessages,
  processBotInboxMessageById,
} from '@/lib/bot/inbox';
import { registerBotInboxProcessor } from '@/lib/bot/processor-registry';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60 * 1000;

function isRateLimited(phoneNumber: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(phoneNumber);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(phoneNumber, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  
  entry.count++;
  return false;
}

// Deduplication - track recently processed message IDs to prevent Meta retries
const processedMessages = new Map<string, number>();
const DEDUP_WINDOW = 5 * 60 * 1000;
const DEDUP_CLEANUP_INTERVAL = 60 * 1000;
const DEDUP_MAX_SIZE = 10000;
let lastDedupCleanup = Date.now();

function isDuplicateMessage(messageId: string): boolean {
  const now = Date.now();

  if (now - lastDedupCleanup > DEDUP_CLEANUP_INTERVAL) {
    lastDedupCleanup = now;
    for (const [id, timestamp] of processedMessages.entries()) {
      if (now - timestamp > DEDUP_WINDOW) {
        processedMessages.delete(id);
      }
    }
  }

  if (processedMessages.has(messageId)) {
    return true;
  }

  if (processedMessages.size >= DEDUP_MAX_SIZE) {
    const oldest = processedMessages.entries().next().value;
    if (oldest) processedMessages.delete(oldest[0]);
  }

  processedMessages.set(messageId, now);
  return false;
}

// Per-chat processing lock to prevent concurrent processing for the same phone
const chatProcessingLocks = new Map<string, Promise<void>>();

const MAX_MESSAGE_LENGTH = 4000;

function logConversationRef(value: string) {
  return crypto.createHash('sha256').update(`whatsapp:${value}`).digest('hex').slice(0, 12);
}

/**
 * GET handler - Webhook verification (required by Meta)
 * Meta sends a GET request to verify your webhook endpoint
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  
  console.log('[WhatsApp Webhook] 🔐 Verification request received');
  console.log(`[WhatsApp Webhook] Mode: ${mode}, Token: ${token ? '***' : 'null'}`);
  
  const result = verifyWebhook(mode, token, challenge);
  
  if (result.valid) {
    console.log('[WhatsApp Webhook] ✅ Verification successful');
    // Must return the challenge as plain text
    return new NextResponse(result.challenge, { status: 200 });
  }
  
  console.warn('[WhatsApp Webhook] ❌ Verification failed');
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

/**
 * POST handler - Receive messages and events from WhatsApp
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify Meta HMAC signature
    const appSecret = (process.env.META_APP_SECRET || '').trim();
    const signature = request.headers.get('x-hub-signature-256') || '';
    if (process.env.NODE_ENV === 'production' && !appSecret) {
      console.error('[WhatsApp Webhook] META_APP_SECRET not configured in production');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    if (appSecret && signature.startsWith('sha256=')) {
      const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
      const expectedBuf = Buffer.from(expected);
      const providedBuf = Buffer.from(signature.trim());
      if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
        console.error('[WhatsApp Webhook] Signature verification failed');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[WhatsApp Webhook] Missing signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
    }

    const body = JSON.parse(rawBody);
    
    console.log('[WhatsApp Webhook] Authenticated provider update received');
    
    const messages = parseWhatsAppWebhooks(body);
    if (messages.length === 0) {
      return NextResponse.json({ status: 'ok' });
    }

    // Resolve every message before acknowledging a batched Meta envelope. Queue
    // rows are then inserted atomically so a failure cannot persist only the
    // first message and silently lose the rest.
    const resolved = await Promise.all(messages.map(async message => {
      const session = await findBotSession('whatsapp', message.from);
      const queueEnabled = session
        ? (await readBotInboxReadiness(session.tenantId)).enabled
        : false;
      return { message, session, queueEnabled };
    }));
    const queued = resolved.filter(item => item.session && item.queueEnabled);
    let persistedRows: Awaited<ReturnType<typeof persistBotInboxMessages>> = [];
    if (queued.length > 0) {
      try {
        persistedRows = await persistBotInboxMessages(queued.map(item => ({
          tenantId: item.session!.tenantId,
          platform: 'whatsapp' as const,
          providerMessageId: item.message.messageId,
          conversationKey: item.message.from,
          // Store only the authenticated message needed by this row instead of
          // redundantly copying the complete batched envelope into every row.
          payload: { version: 1, message: item.message },
        })));
      } catch (persistError) {
        console.error('[WhatsApp Webhook] Durable persistence failed', persistError instanceof Error ? persistError.name : 'unknown');
        return NextResponse.json({ error: 'Persistence unavailable' }, { status: 503 });
      }
    }

    for (const row of persistedRows) {
      if (row.status === 'pending' || row.status === 'retry') {
        after(() => processBotInboxMessageById(row.id));
      }
    }

    const legacy = resolved.filter(item => !item.queueEnabled);
    for (const { message } of legacy) {
      if (isDuplicateMessage(message.messageId)) continue;
      console.log('[WhatsApp Webhook] Message accepted', { conversationRef: logConversationRef(message.from), type: message.type });
      const phoneNumber = message.from;
      const existingLock = chatProcessingLocks.get(phoneNumber);
      if (existingLock) await existingLock.catch(() => {});

      let resolveLock: () => void;
      const lockPromise = new Promise<void>((resolve) => { resolveLock = resolve; });
      chatProcessingLocks.set(phoneNumber, lockPromise);
      try {
        await handleWhatsAppMessage(message);
      } catch (error) {
        // Delivery/processing failed before acknowledgement. Let Meta retry the
        // complete envelope and do not let the in-memory duplicate window eat it.
        processedMessages.delete(message.messageId);
        throw error;
      } finally {
        resolveLock!();
        chatProcessingLocks.delete(phoneNumber);
      }
    }

    return NextResponse.json({ status: 'accepted', queued: persistedRows.length, legacy: legacy.length });
  } catch (error: any) {
    console.error('[WhatsApp Webhook] Processing failed', { errorName: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

/**
 * Handle incoming WhatsApp message
 */
async function handleWhatsAppMessage(
  message: WhatsAppMessage,
  operation?: { inboxMessageId: string; providerMessageId: string; tenantId: string },
) {
  const phoneNumber = message.from;
  const displayName = message.contact?.name || phoneNumber;
  
  try {
    // Mark message as read
    await markMessageAsRead(message.messageId);
    
    // Rate limiting
    if (isRateLimited(phoneNumber)) {
      console.log('[WhatsApp] Rate limited', { conversationRef: logConversationRef(phoneNumber) });
      await sendWhatsAppMessage(phoneNumber, '⏳ Has enviado muchos mensajes. Por favor espera un momento.');
      return;
    }
    
    // Get message text (handle different message types)
    let text = '';
    
    switch (message.type) {
      case 'text':
        text = message.text || '';
        break;
        
      case 'voice':
      case 'audio':
        if (message.mediaId) {
          console.log('[WhatsApp] Processing voice message', { conversationRef: logConversationRef(phoneNumber) });
          await sendWhatsAppMessage(phoneNumber, '🎤 Procesando tu mensaje de voz...');
          
          const transcription = await transcribeWhatsAppVoice(message.mediaId);
          if (transcription) {
            text = transcription;
            console.log('[WhatsApp] Voice transcription completed', { characterCount: text.length });
          } else {
            await sendWhatsAppMessage(phoneNumber, '❌ No pude procesar tu mensaje de voz. Por favor intenta de nuevo o escribe tu mensaje.');
            return;
          }
        }
        break;
        
      case 'interactive':
        // Button or list reply
        if (message.interactiveReply) {
          text = message.interactiveReply.id; // Use the button/list ID as command
          console.log('[WhatsApp] Interactive reply received');
        }
        break;
        
      case 'button':
        text = message.text || '';
        break;
        
      default:
        await sendWhatsAppMessage(phoneNumber, '⚠️ Por el momento solo puedo procesar mensajes de texto y voz. ¿Puedes escribir o grabar tu mensaje?');
        return;
    }
    
    if (!text.trim()) {
      return;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      console.log('[WhatsApp] Message too long', { conversationRef: logConversationRef(phoneNumber), characterCount: text.length });
      await sendWhatsAppMessage(phoneNumber, `⚠️ Tu mensaje es demasiado largo (${text.length} caracteres). El máximo es ${MAX_MESSAGE_LENGTH}. Por favor acorta tu mensaje.`);
      return;
    }
    
    console.log('[WhatsApp] Message ready for command processing', { conversationRef: logConversationRef(phoneNumber), characterCount: text.length });
    
    // Handle special commands
    const lowerText = text.toLowerCase().trim();
    
    if (lowerText.startsWith('/start') || lowerText === 'hola' || lowerText === 'hi' || lowerText === 'hello') {
      await handleStartCommand(phoneNumber, text, displayName);
      return;
    }
    
    if (lowerText === '/help' || lowerText === 'ayuda') {
      await handleHelpCommand(phoneNumber);
      return;
    }
    
    if (lowerText === '/clear' || lowerText === 'limpiar') {
      await clearConversationHistory('whatsapp', phoneNumber);
      await sendWhatsAppMessage(phoneNumber, '🗑️ Historial de conversación limpiado. ¡Empecemos de nuevo!');
      return;
    }
    
    if (lowerText === '/new' || lowerText === '/nuevo' || lowerText === 'nuevo' || lowerText === 'nueva conversacion' || lowerText === 'nueva conversación') {
      await clearConversationHistory('whatsapp', phoneNumber);
      await clearPendingConfirmation('whatsapp', phoneNumber);
      await sendWhatsAppMessage(phoneNumber, '🆕 *Nueva conversación iniciada*\n\nEl historial anterior fue limpiado. ¿En qué puedo ayudarte?');
      return;
    }
    
    if (lowerText === '/status') {
      await handleStatusCommand(phoneNumber);
      return;
    }
    
    // Check if user is in setup flow (awaiting name)
    const state = await getConversationState('whatsapp', phoneNumber);
    
    if (state?.awaitingName) {
      await handleNameProvided(phoneNumber, text, displayName, state);
      return;
    }
    
    // Check if awaiting connection code
    if (state?.awaitingCode) {
      await handleCodeProvided(phoneNumber, text, displayName);
      return;
    }
    
    // Check for session
    console.log('[WhatsApp] Checking session', { conversationRef: logConversationRef(phoneNumber) });
    const session = await findBotSession('whatsapp', phoneNumber);
    
    if (!session) {
      console.log('[WhatsApp] No active session', { conversationRef: logConversationRef(phoneNumber) });
      await handleUnauthorized(phoneNumber, displayName);
      return;
    }
    
    console.log('[WhatsApp] Active session found', { conversationRef: logConversationRef(phoneNumber) });
    
    // Get full session context
    const sessionContext = await getBotSessionWithContext('whatsapp', phoneNumber);
    
    if (!sessionContext) {
      console.error('[WhatsApp] Failed to get session context', { conversationRef: logConversationRef(phoneNumber) });
      await sendWhatsAppMessage(phoneNumber, '❌ Error al obtener tu sesión. Por favor intenta reconectarte con /start');
      return;
    }
    
    // Extract values from session context
    const userId = sessionContext.user?.id || sessionContext.session.userId || null;
    const tenantId = sessionContext.tenant?.id || sessionContext.session.tenantId;
    const userName = sessionContext.user?.name || sessionContext.session.providedName || sessionContext.session.displayName || displayName;
    const userRole = sessionContext.role || 'VIEWER';
    
    // Process through AI agent
    console.log(`[WhatsApp] 🤖 Processing message through AI agent...`);
    
    const response = await processMessage(
      'whatsapp',
      phoneNumber,
      text,
      {
        tenantId: tenantId,
        tenantName: sessionContext.tenant?.name,
        userId: userId || `whatsapp-${phoneNumber}`,
        userName: userName,
        userRole: userRole,
        operationKey: operation ? `whatsapp:${operation.providerMessageId}` : undefined,
        inboxMessageId: operation?.inboxMessageId,
      }
    );
    
    await sendLongWhatsAppMessage(phoneNumber, response.text, operation?.inboxMessageId);

    // Send any PDF attachments from tool results
    if (response.attachments && response.attachments.length > 0) {
      for (const [index, attachment] of response.attachments.entries()) {
        console.log('[WhatsApp] Sending attachment', { conversationRef: logConversationRef(phoneNumber) });
        if (operation) {
          await deliverBotOutputOnce({
            inboxMessageId: operation.inboxMessageId,
            deliveryKey: `document:${index}`,
            kind: 'document',
            contentHash: hashBotDeliveryContent(Buffer.concat([
              Buffer.from(`${attachment.filename}\n${attachment.caption || ''}\n`),
              attachment.buffer,
            ])),
            send: async () => {
              const result = await sendWhatsAppDocument(
                phoneNumber,
                attachment.buffer,
                attachment.filename,
                attachment.caption,
              );
              if (!result.success) throw new Error('WHATSAPP_DOCUMENT_DELIVERY_FAILED');
              return result;
            },
          });
        } else {
          const docResult = await sendWhatsAppDocument(phoneNumber, attachment.buffer, attachment.filename, attachment.caption);
          if (!docResult.success) {
            console.error('[WhatsApp] Attachment delivery failed');
            await sendWhatsAppMessage(phoneNumber, `⚠️ No pude enviar el archivo "${attachment.filename}". Puedes descargarlo desde el panel de Betsy.`);
          }
        }
      }
    }

    console.log('[WhatsApp] Response sent', { conversationRef: logConversationRef(phoneNumber) });
    
  } catch (error: any) {
    console.error('[WhatsApp] Message handling failed', { conversationRef: logConversationRef(phoneNumber), errorName: error?.name || 'unknown' });
    if (operation) throw error;
    await sendWhatsAppMessage(phoneNumber, '❌ Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.');
  }
}

async function processQueuedWhatsAppPayload(
  payload: unknown,
  operation: { inboxMessageId: string; providerMessageId: string; tenantId: string },
) {
  const queuedPayload = payload as { version?: unknown; message?: unknown };
  const message = queuedPayload?.version === 1
    ? queuedPayload.message as WhatsAppMessage
    : parseWhatsAppWebhook(payload);
  if (!message || message.messageId !== operation.providerMessageId) {
    throw new Error('WHATSAPP_PAYLOAD_INVALID');
  }
  const session = await findBotSession('whatsapp', message.from);
  if (!session) throw new Error('BOT_SESSION_INACTIVE');
  if (session.tenantId !== operation.tenantId) throw new Error('BOT_SESSION_TENANT_CHANGED');
  await handleWhatsAppMessage(message, operation);
}

registerBotInboxProcessor('whatsapp', processQueuedWhatsAppPayload);

/**
 * Send a long message by splitting it if necessary.
 * WhatsApp has a 4096 character limit per text message.
 */
async function sendLongWhatsAppMessage(phoneNumber: string, text: string, inboxMessageId?: string) {
  const MAX_LENGTH = 4000; // Leave margin below 4096
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > MAX_LENGTH) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = paragraph + '\n\n';
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (inboxMessageId) {
      await deliverBotOutputOnce({
        inboxMessageId,
        deliveryKey: `text:${index}`,
        kind: 'text',
        contentHash: hashBotDeliveryContent(chunk),
        send: () => sendWhatsAppMessage(phoneNumber, chunk),
        providerDeliveryId: result => result.messageId,
      });
    } else {
      await sendWhatsAppMessage(phoneNumber, chunk);
    }
  }
}

/**
 * Handle /start or greeting command
 * Mirrors Telegram's handleStartCommand: supports /start CODE in one message,
 * tenant switching, and falls back to button flow for bare /start.
 */
async function handleStartCommand(phoneNumber: string, text: string, displayName: string) {
  // Parse code from "/start CODE" (same as Telegram)
  const parts = text.split(/\s+/);
  const code = parts.length > 1 ? parts[1]?.trim().toUpperCase() : null;

  if (code) {
    // Validate the access code (works for new connections AND tenant switching)
    console.log('[WhatsApp] Verifying access code from start command', { conversationRef: logConversationRef(phoneNumber) });
    const tenant = await validateBotAccessCode(code);

    if (!tenant) {
      await sendWhatsAppMessage(
        phoneNumber,
        `❌ *Código inválido*\n\nEl código *${code}* no existe o ha expirado.\n\nPor favor verifica el código e intenta de nuevo.`
      );
      return;
    }

    // Wipe prior conversation data to prevent cross-tenant leakage (matching Telegram)
    await clearConversationHistory('whatsapp', phoneNumber);
    await clearPendingConfirmation('whatsapp', phoneNumber);

    // Code valid — ask for name for audit trail (same as Telegram)
    await setConversationState('whatsapp', phoneNumber, {
      awaitingName: true,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });

    await sendWhatsAppMessage(
      phoneNumber,
      `✅ *¡Código válido!*\n\nEstás conectando a: *${tenant.name}*\n\nPara el registro de auditoría, ¿cuál es tu nombre completo?\n\n_Ejemplo: Juan Pérez o María González_`
    );
    return;
  }

  // No code provided — check if already connected
  const existingSession = await findBotSession('whatsapp', phoneNumber);

  if (existingSession) {
    const sessionContext = await getBotSessionWithContext('whatsapp', phoneNumber);
    const tenantName = sessionContext?.tenant?.name || 'tu negocio';
    const userName = existingSession.providedName || existingSession.displayName || displayName;
    const welcome = `👋 *¡Hola de nuevo, ${userName}!*\n\n✅ *Tu sesión está activa*\n\nConectado a: *${tenantName}*\n\n¿En qué puedo ayudarte hoy?\n\nEscribe tu consulta o usa /help para ver los comandos disponibles.`;
    await sendWhatsAppMessage(phoneNumber, welcome);
    return;
  }

  // Not connected and no code — show button flow (WhatsApp-specific UX)
  const welcome = `¡Hola ${displayName}! 👋\n\nSoy *Betsy AI*, tu asistente de ventas inteligente.\n\nPara empezar, necesito conectarte con tu negocio en Betsy.\n\n📱 *¿Tienes un código de acceso?*\nEscríbelo aquí para conectarte.\n\n🆕 *¿Eres nuevo en Betsy?*\nVisita betsycrm.com para crear tu cuenta gratuita.`;

  await sendWhatsAppButtonMessage(
    phoneNumber,
    welcome,
    [
      { id: 'enter_code', title: 'Tengo un código' },
      { id: 'new_user', title: 'Soy nuevo' },
    ]
  );

  await setConversationState('whatsapp', phoneNumber, { awaitingCode: true });
}

/**
 * Handle code entry during connection
 */
async function handleCodeProvided(phoneNumber: string, code: string, displayName: string) {
  // Check for 'new_user' button click
  if (code === 'new_user') {
    await sendWhatsAppMessage(
      phoneNumber,
      '🆕 *¡Bienvenido a Betsy!*\n\nPara crear tu cuenta:\n\n1️⃣ Ve a *betsycrm.com*\n2️⃣ Crea tu cuenta gratis\n3️⃣ En Configuración > AI Assistant, genera tu código\n4️⃣ Vuelve aquí y escríbelo\n\n¡Te esperamos! 🚀'
    );
    await clearConversationState('whatsapp', phoneNumber);
    return;
  }
  
  // Check for 'enter_code' button click
  if (code === 'enter_code') {
    await sendWhatsAppMessage(phoneNumber, '📝 Por favor escribe tu código de acceso:');
    return;
  }
  
  // Verify the access code (12-character alphanumeric)
  console.log('[WhatsApp] Verifying access code', { conversationRef: logConversationRef(phoneNumber) });
  const tenant = await validateBotAccessCode(code.trim().toUpperCase());
  
  if (!tenant) {
    await sendWhatsAppMessage(
      phoneNumber,
      '❌ Código no válido.\n\nPor favor verifica tu código e intenta de nuevo, o genera uno nuevo en Betsy > Configuración > AI Assistant.'
    );
    return;
  }
  
  // Wipe prior conversation data to prevent cross-tenant leakage
  await clearConversationHistory('whatsapp', phoneNumber);
  await clearPendingConfirmation('whatsapp', phoneNumber);

  // Code is valid - ask for name
  await setConversationState('whatsapp', phoneNumber, { 
    awaitingName: true,
    tenantId: tenant.id,
    tenantName: tenant.name,
  });
  
  await sendWhatsAppMessage(
    phoneNumber,
    `✅ ¡Código válido!\n\nEstás conectándote a *${tenant.name}*.\n\n📝 Por favor escribe tu nombre (como quieres que te llame el equipo):`
  );
}

/**
 * Handle name provided during setup
 */
async function handleNameProvided(phoneNumber: string, name: string, displayName: string, state: any) {
  if (name.length < 2 || name.length > 100) {
    await sendWhatsAppMessage(phoneNumber, '⚠️ Por favor ingresa un nombre válido (entre 2 y 100 caracteres).');
    return;
  }
  
  try {
    // Create bot session
    console.log('[WhatsApp] Creating bot session', { conversationRef: logConversationRef(phoneNumber) });
    const session = await createBotSession(
      'whatsapp',
      phoneNumber,
      null,
      state.tenantId,
      {
        providedName: name.trim(),
        displayName: displayName,
        username: phoneNumber,
      }
    );
    
    if (!session) {
      throw new Error('Failed to create session');
    }
    
    // Clear setup state and ensure fresh conversation for the new tenant
    await clearConversationState('whatsapp', phoneNumber);
    await clearConversationHistory('whatsapp', phoneNumber);
    await clearPendingConfirmation('whatsapp', phoneNumber);
    
    // Send welcome
    await sendWhatsAppMessage(
      phoneNumber,
      `🎉 *¡Listo, ${name}!*\n\nYa estás conectado a *${state.tenantName}*.\n\nAhora puedes:\n• 📦 Crear y consultar órdenes\n• 📊 Ver inventario y estadísticas\n• 🚚 Gestionar envíos\n• Y mucho más...\n\n¿En qué puedo ayudarte hoy?`
    );
    
    console.log('[WhatsApp] Bot session created', { conversationRef: logConversationRef(phoneNumber) });
    
  } catch (error: any) {
    console.error('[WhatsApp] Session creation failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    await sendWhatsAppMessage(
      phoneNumber,
      error?.message === 'BOT_SEAT_LIMIT_REACHED'
        ? '❌ El plan alcanzó su límite de usuarios. El propietario debe liberar un asiento o actualizar el plan.'
        : '❌ Error al conectar. Por favor intenta de nuevo con /start',
    );
    await clearConversationState('whatsapp', phoneNumber);
  }
}

/**
 * Handle unauthorized user
 */
async function handleUnauthorized(phoneNumber: string, displayName: string) {
  await sendWhatsAppMessage(
    phoneNumber,
    `¡Hola ${displayName}! 👋\n\nNo encontré una conexión activa para este número.\n\nPara usar Betsy AI, necesitas:\n\n1️⃣ Tener una cuenta en *betsycrm.com*\n2️⃣ Ir a Configuración > AI Assistant\n3️⃣ Generar un código de acceso\n4️⃣ Escribir ese código aquí\n\n¿Tienes un código? Escríbelo ahora.`
  );
  
  // Set state to await code
  await setConversationState('whatsapp', phoneNumber, { awaitingCode: true });
}

/**
 * Handle /help command
 */
async function handleHelpCommand(phoneNumber: string) {
  const helpText = `📚 *Comandos y Ayuda*

*Comandos disponibles:*
• /start - Iniciar o reconectar
• /new o "nuevo" - Nueva conversación (limpia historial)
• /help - Ver esta ayuda
• /status - Ver estado de conexión
• /clear - Limpiar historial

*¿Qué puedo hacer?*

📦 *Órdenes:*
"Crea una orden para Juan, 2 camisetas, ₡15000"
"Muéstrame las órdenes pendientes"
"¿Cuántas órdenes hay hoy?"

📊 *Inventario:*
"¿Cuánto stock hay de camisetas?"
"Muestra productos con stock bajo"

📈 *Estadísticas:*
"¿Cuánto vendimos esta semana?"
"Dame un resumen de ventas"

🚚 *Envíos:*
"Genera guía para la orden #1234"

💬 También puedes enviar *mensajes de voz* y los transcribiré automáticamente.

¿En qué te ayudo?`;
  
  await sendWhatsAppMessage(phoneNumber, helpText);
}

/**
 * Handle /status command
 */
async function handleStatusCommand(phoneNumber: string) {
  const session = await findBotSession('whatsapp', phoneNumber);
  
  if (!session) {
    await sendWhatsAppMessage(
      phoneNumber,
      '❌ *No conectado*\n\nNo tienes una sesión activa. Usa /start para conectarte.'
    );
    return;
  }
  
  const sessionContext = await getBotSessionWithContext('whatsapp', phoneNumber);
  
  const tenantName = sessionContext?.tenant?.name || 'N/A';
  const userName = sessionContext?.user?.name || sessionContext?.session?.providedName || 'N/A';
  const userRole = sessionContext?.role || 'N/A';
  
  const statusText = `✅ *Estado de Conexión*

📱 *Plataforma:* WhatsApp
🏢 *Negocio:* ${tenantName}
👤 *Usuario:* ${userName}
🔑 *Rol:* ${userRole}
📅 *Conectado:* ${session.connectedAt ? new Date(session.connectedAt).toLocaleDateString('es-CR') : 'N/A'}

Todo funcionando correctamente ✓`;
  
  await sendWhatsAppMessage(phoneNumber, statusText);
}
