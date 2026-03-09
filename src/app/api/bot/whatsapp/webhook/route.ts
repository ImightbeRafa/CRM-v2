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

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { 
  sendWhatsAppMessage, 
  sendWhatsAppButtonMessage,
  markMessageAsRead,
  transcribeWhatsAppVoice,
  parseWhatsAppWebhook,
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
import { clearConversationHistory, getConversationState, setConversationState, clearConversationState } from '@/lib/bot/conversation-memory';

console.log('🚀 WhatsApp Webhook module loaded');

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    
    console.log('[WhatsApp Webhook] Received:', JSON.stringify(body).slice(0, 500));
    
    // Parse the webhook payload
    const message = parseWhatsAppWebhook(body);
    
    if (!message) {
      // No message to process (might be a status update)
      return NextResponse.json({ status: 'ok' });
    }
    
    console.log(`[WhatsApp Webhook] 📩 Message from ${message.from}: type=${message.type}`);
    
    // Process the message
    await handleWhatsAppMessage(message);
    
    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: 'ok' });
  } catch (error: any) {
    console.error('[WhatsApp Webhook] ❌ Error:', error);
    // Still return 200 to prevent retries
    return NextResponse.json({ status: 'error' });
  }
}

/**
 * Handle incoming WhatsApp message
 */
async function handleWhatsAppMessage(message: WhatsAppMessage) {
  const phoneNumber = message.from;
  const displayName = message.contact?.name || phoneNumber;
  
  try {
    // Mark message as read
    await markMessageAsRead(message.messageId);
    
    // Rate limiting
    if (isRateLimited(phoneNumber)) {
      console.log(`[WhatsApp] ⏳ Rate limited: ${phoneNumber}`);
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
          console.log(`[WhatsApp] 🎤 Processing voice message from ${phoneNumber}`);
          await sendWhatsAppMessage(phoneNumber, '🎤 Procesando tu mensaje de voz...');
          
          const transcription = await transcribeWhatsAppVoice(message.mediaId);
          if (transcription) {
            text = transcription;
            console.log(`[WhatsApp] 📝 Transcribed: "${text.slice(0, 100)}"`);
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
          console.log(`[WhatsApp] 🔘 Interactive reply: ${text}`);
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
    
    console.log(`[WhatsApp] 📩 Message from ${displayName} (${phoneNumber}): ${text.slice(0, 100)}`);
    
    // Handle special commands
    const lowerText = text.toLowerCase().trim();
    
    if (lowerText === '/start' || lowerText === 'hola' || lowerText === 'hi' || lowerText === 'hello') {
      await handleStartCommand(phoneNumber, displayName);
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
    console.log(`[WhatsApp] 🔍 Checking session for ${phoneNumber}...`);
    const session = await findBotSession('whatsapp', phoneNumber);
    
    if (!session) {
      console.log(`[WhatsApp] ❌ No session found for ${phoneNumber}`);
      await handleUnauthorized(phoneNumber, displayName);
      return;
    }
    
    console.log(`[WhatsApp] ✅ Session found for ${phoneNumber} - Tenant: ${session.tenantId}`);
    
    // Get full session context
    const sessionContext = await getBotSessionWithContext('whatsapp', phoneNumber);
    
    if (!sessionContext) {
      console.error(`[WhatsApp] ❌ Failed to get session context for ${phoneNumber}`);
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
        userId: userId || `whatsapp-${phoneNumber}`, // Fallback ID for team members without Betsy accounts
        userName: userName,
        userRole: userRole,
      }
    );
    
    // Send response
    await sendWhatsAppMessage(phoneNumber, response);
    console.log(`[WhatsApp] ✅ Response sent to ${phoneNumber}`);
    
  } catch (error: any) {
    console.error(`[WhatsApp] ❌ Error handling message from ${phoneNumber}:`, error);
    await sendWhatsAppMessage(phoneNumber, '❌ Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.');
  }
}

/**
 * Handle /start or greeting command
 */
async function handleStartCommand(phoneNumber: string, displayName: string) {
  // Check if already has a session
  const existingSession = await findBotSession('whatsapp', phoneNumber);
  
  if (existingSession) {
    const sessionContext = await getBotSessionWithContext('whatsapp', phoneNumber);
    const tenantName = sessionContext?.tenant?.name || 'tu negocio';
    const welcome = `¡Hola ${displayName}! 👋\n\nYa estás conectado a *${tenantName}*.\n\n¿En qué puedo ayudarte hoy?\n\nEscribe tu consulta o usa /help para ver los comandos disponibles.`;
    await sendWhatsAppMessage(phoneNumber, welcome);
    return;
  }
  
  // No session - start connection flow
  const welcome = `¡Hola ${displayName}! 👋\n\nSoy *Betsy AI*, tu asistente de ventas inteligente.\n\nPara empezar, necesito conectarte con tu negocio en Betsy.\n\n📱 *¿Tienes un código de acceso?*\nEscríbelo aquí para conectarte.\n\n🆕 *¿Eres nuevo en Betsy?*\nVisita betsycrm.com para crear tu cuenta gratuita.`;
  
  await sendWhatsAppButtonMessage(
    phoneNumber,
    welcome,
    [
      { id: 'enter_code', title: 'Tengo un código' },
      { id: 'new_user', title: 'Soy nuevo' },
    ]
  );
  
  // Set state to await code
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
  console.log(`[WhatsApp] 🔑 Verifying code for ${phoneNumber}: ${code}`);
  const tenant = await validateBotAccessCode(code.trim().toUpperCase());
  
  if (!tenant) {
    await sendWhatsAppMessage(
      phoneNumber,
      '❌ Código no válido.\n\nPor favor verifica tu código e intenta de nuevo, o genera uno nuevo en Betsy > Configuración > AI Assistant.'
    );
    return;
  }
  
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
    console.log(`[WhatsApp] 🔧 Creating session for ${phoneNumber} in tenant ${state.tenantId}`);
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
    
    // Clear setup state
    await clearConversationState('whatsapp', phoneNumber);
    
    // Send welcome
    await sendWhatsAppMessage(
      phoneNumber,
      `🎉 *¡Listo, ${name}!*\n\nYa estás conectado a *${state.tenantName}*.\n\nAhora puedes:\n• 📦 Crear y consultar órdenes\n• 📊 Ver inventario y estadísticas\n• 🚚 Gestionar envíos\n• Y mucho más...\n\n¿En qué puedo ayudarte hoy?`
    );
    
    console.log(`[WhatsApp] ✅ Session created for ${phoneNumber} in tenant ${state.tenantId}`);
    
  } catch (error: any) {
    console.error(`[WhatsApp] ❌ Error creating session:`, error);
    await sendWhatsAppMessage(phoneNumber, '❌ Error al conectar. Por favor intenta de nuevo con /start');
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
