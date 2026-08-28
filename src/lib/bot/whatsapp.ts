/**
 * WhatsApp Cloud API Integration for Betsy AI Assistant
 * 
 * This module provides the core WhatsApp functionality using Meta's Cloud API.
 * 
 * Required Environment Variables:
 * - WHATSAPP_ACCESS_TOKEN: Permanent or temporary access token from Meta
 * - WHATSAPP_PHONE_NUMBER_ID: The Phone Number ID from WhatsApp Business
 * - WHATSAPP_VERIFY_TOKEN: Custom token for webhook verification
 * - WHATSAPP_BUSINESS_ACCOUNT_ID: (Optional) Business Account ID
 * 
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const WHATSAPP_API_VERSION = 'v24.0';
const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

/**
 * Send a text message to a WhatsApp user
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  options?: {
    previewUrl?: boolean;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  if (!accessToken || !phoneNumberId) {
    console.error('[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
    throw new Error('WHATSAPP_DELIVERY_UNAVAILABLE');
  }
  
  try {
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: options?.previewUrl ?? false,
          body: text,
        },
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[WhatsApp] sendMessage failed', {
        status: response.status,
        providerCode: data?.error?.code ?? null,
      });
      throw new Error('WHATSAPP_DELIVERY_FAILED');
    }
    
    console.log('[WhatsApp] Message delivered');
    return { 
      success: true, 
      messageId: data.messages?.[0]?.id 
    };
  } catch (error: any) {
    if (error instanceof Error && error.message.startsWith('WHATSAPP_DELIVERY_')) throw error;
    console.error('[WhatsApp] sendMessage transport error', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    throw new Error('WHATSAPP_DELIVERY_FAILED');
  }
}

/**
 * Send a message with interactive buttons
 */
export async function sendWhatsAppButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
  headerText?: string,
  footerText?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  if (!accessToken || !phoneNumberId) {
    console.error('[WhatsApp] Missing credentials');
    throw new Error('WHATSAPP_DELIVERY_UNAVAILABLE');
  }
  
  // WhatsApp allows max 3 buttons
  const validButtons = buttons.slice(0, 3).map(btn => ({
    type: 'reply',
    reply: {
      id: btn.id,
      title: btn.title.slice(0, 20), // Max 20 chars
    },
  }));
  
  try {
    const message: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: { buttons: validButtons },
      },
    };
    
    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }
    
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[WhatsApp] sendButtonMessage failed', {
        status: response.status,
        providerCode: data?.error?.code ?? null,
      });
      throw new Error('WHATSAPP_DELIVERY_FAILED');
    }
    
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error: any) {
    if (error instanceof Error && error.message.startsWith('WHATSAPP_DELIVERY_')) throw error;
    console.error('[WhatsApp] sendButtonMessage transport error', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    throw new Error('WHATSAPP_DELIVERY_FAILED');
  }
}

/**
 * Send a list message (for menus with more options)
 */
export async function sendWhatsAppListMessage(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>,
  headerText?: string,
  footerText?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  if (!accessToken || !phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured' };
  }
  
  try {
    const message: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map(section => ({
            title: section.title,
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title.slice(0, 24), // Max 24 chars
              description: row.description?.slice(0, 72), // Max 72 chars
            })),
          })),
        },
      },
    };
    
    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }
    
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[WhatsApp] sendListMessage failed:', data);
      return { success: false, error: data.error?.message };
    }
    
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error: any) {
    console.error('[WhatsApp] sendListMessage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send a document (PDF, etc.) to a WhatsApp user
 * Two-step: upload media, then send document message referencing the media ID
 */
export async function sendWhatsAppDocument(
  to: string,
  fileBuffer: Buffer,
  filename: string,
  caption?: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.error('[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    // Step 1: Upload media
    console.log(`[WhatsApp] 📎 Uploading document "${filename}" (${fileBuffer.length} bytes)...`);
    const uploadForm = new FormData();
    uploadForm.append('messaging_product', 'whatsapp');
    uploadForm.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), filename);
    uploadForm.append('type', 'application/pdf');

    const uploadResponse = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: uploadForm,
    });

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok || !uploadData.id) {
      console.error('[WhatsApp] Media upload failed', {
        status: uploadResponse.status,
        providerCode: uploadData?.error?.code ?? null,
      });
      return { success: false, error: 'WHATSAPP_MEDIA_UPLOAD_FAILED' };
    }

    const mediaId = uploadData.id;
    console.log(`[WhatsApp] ✅ Media uploaded, id: ${mediaId}`);

    // Step 2: Send document message referencing the uploaded media
    const messagePayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        id: mediaId,
        filename,
      },
    };

    if (caption) {
      messagePayload.document.caption = caption;
    }

    const sendResponse = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagePayload),
    });

    const sendData = await sendResponse.json();

    if (!sendResponse.ok) {
      console.error('[WhatsApp] sendDocument failed', {
        status: sendResponse.status,
        providerCode: sendData?.error?.code ?? null,
      });
      return { success: false, error: 'WHATSAPP_DOCUMENT_DELIVERY_FAILED' };
    }

    console.log('[WhatsApp] Document delivered', { byteLength: fileBuffer.byteLength });
    return { success: true };
  } catch (error) {
    console.error('[WhatsApp] sendDocument transport error', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return { success: false, error: 'WHATSAPP_DOCUMENT_DELIVERY_FAILED' };
  }
}

/**
 * Send a template message (required for initiating conversations outside the 24-hour window).
 * Used for authentication OTPs, notifications, etc.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParameters?: string[],
  buttonParameters?: Array<{ index: number; text: string }>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.error('[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    const components: any[] = [];

    if (bodyParameters && bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParameters.map(text => ({ type: 'text', text })),
      });
    }

    if (buttonParameters && buttonParameters.length > 0) {
      for (const btn of buttonParameters) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: btn.index.toString(),
          parameters: [{ type: 'text', text: btn.text }],
        });
      }
    }

    const payload: any = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    };

    if (components.length > 0) {
      payload.template.components = components;
    }

    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[WhatsApp] sendTemplate failed:', data);
      return {
        success: false,
        error: data.error?.message || 'Failed to send template message',
      };
    }

    console.log('[WhatsApp] Template delivered', { templateName });
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error: any) {
    console.error('[WhatsApp] sendTemplate error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mark a message as read (shows blue checkmarks)
 */
export async function markMessageAsRead(messageId: string): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  if (!accessToken || !phoneNumberId) return false;
  
  try {
    const response = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
    
    return response.ok;
  } catch (error) {
    console.error('[WhatsApp] markAsRead error:', error);
    return false;
  }
}

/**
 * Download media file from WhatsApp (for voice messages, images, etc.)
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  
  if (!accessToken) {
    console.error('[WhatsApp] Missing WHATSAPP_ACCESS_TOKEN');
    return null;
  }
  
  try {
    // First, get the media URL
    console.log(`[WhatsApp] 📥 Getting media URL for: ${mediaId}`);
    const mediaResponse = await fetch(`${WHATSAPP_API_BASE}/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    const mediaData = await mediaResponse.json();
    
    if (!mediaResponse.ok || !mediaData.url) {
      console.error('[WhatsApp] Failed to get media URL:', mediaData);
      return null;
    }
    
    // Download the actual file
    console.log('[WhatsApp] Downloading authenticated media attachment');
    const fileResponse = await fetch(mediaData.url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!fileResponse.ok) {
      console.error('[WhatsApp] Failed to download media');
      return null;
    }
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    console.log(`[WhatsApp] ✅ Downloaded ${arrayBuffer.byteLength} bytes`);
    
    return Buffer.from(arrayBuffer);
  } catch (error: any) {
    console.error('[WhatsApp] downloadMedia error:', error);
    return null;
  }
}

/**
 * Transcribe voice message using OpenAI Whisper
 */
export async function transcribeWhatsAppVoice(mediaId: string): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiKey) {
    console.error('[WhatsApp] Missing OPENAI_API_KEY for voice transcription');
    return null;
  }
  
  try {
    // Download the audio file
    const audioBuffer = await downloadWhatsAppMedia(mediaId);
    
    if (!audioBuffer) {
      console.error('[WhatsApp] Failed to download voice message');
      return null;
    }
    
    // Send to OpenAI Whisper
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', audioBlob, 'voice.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'es'); // Spanish
    
    console.log(`[WhatsApp] 🔄 Sending to Whisper for transcription...`);
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: formData,
    });
    
    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('[WhatsApp] Whisper API error:', errorText);
      return null;
    }
    
    const transcription = await whisperResponse.json();
    console.log('[WhatsApp] Transcription received', {
      characterCount: transcription.text?.length || 0,
    });
    
    return transcription.text || null;
  } catch (error: any) {
    console.error('[WhatsApp] Voice transcription error:', error);
    return null;
  }
}

/**
 * Verify webhook callback (called by Meta during webhook setup)
 */
export function verifyWebhook(
  mode: string | null,
  token: string | null,
  challenge: string | null
): { valid: boolean; challenge?: string } {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  
  if (!verifyToken) {
    console.error('[WhatsApp] WHATSAPP_VERIFY_TOKEN not set');
    return { valid: false };
  }
  
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp] ✅ Webhook verified successfully');
    return { valid: true, challenge: challenge || '' };
  }
  
  console.warn('[WhatsApp] ❌ Webhook verification failed');
  console.warn(`[WhatsApp] Mode: ${mode}, Token match: ${token === verifyToken}`);
  return { valid: false };
}

/**
 * Parse incoming webhook payload
 */
export interface WhatsAppMessage {
  from: string; // Phone number of sender
  messageId: string;
  timestamp: string;
  type: 'text' | 'audio' | 'voice' | 'image' | 'document' | 'interactive' | 'button' | 'unknown';
  text?: string;
  mediaId?: string;
  interactiveReply?: {
    type: 'button_reply' | 'list_reply';
    id: string;
    title: string;
  };
  contact?: {
    name: string;
    waId: string;
  };
}

function parseWhatsAppMessage(message: any, contacts: any[]): WhatsAppMessage | null {
  try {
    if (!message?.id || !message?.from) return null;
    const contact = contacts.find(candidate => candidate?.wa_id === message.from) || contacts[0];
    
    const result: WhatsAppMessage = {
      from: message.from,
      messageId: message.id,
      timestamp: message.timestamp,
      type: 'unknown',
      contact: contact ? {
        name: contact.profile?.name || contact.wa_id,
        waId: contact.wa_id,
      } : undefined,
    };
    
    // Parse message type
    switch (message.type) {
      case 'text':
        result.type = 'text';
        result.text = message.text?.body;
        break;
        
      case 'audio':
        result.type = 'audio';
        result.mediaId = message.audio?.id;
        break;
        
      case 'voice':
        result.type = 'voice';
        result.mediaId = message.voice?.id || message.audio?.id;
        break;
        
      case 'image':
        result.type = 'image';
        result.mediaId = message.image?.id;
        break;
        
      case 'document':
        result.type = 'document';
        result.mediaId = message.document?.id;
        break;
        
      case 'interactive':
        result.type = 'interactive';
        if (message.interactive?.type === 'button_reply') {
          result.interactiveReply = {
            type: 'button_reply',
            id: message.interactive.button_reply?.id,
            title: message.interactive.button_reply?.title,
          };
        } else if (message.interactive?.type === 'list_reply') {
          result.interactiveReply = {
            type: 'list_reply',
            id: message.interactive.list_reply?.id,
            title: message.interactive.list_reply?.title,
          };
        }
        break;
        
      case 'button':
        result.type = 'button';
        result.text = message.button?.text;
        break;
        
      default:
        result.type = 'unknown';
    }
    
    return result;
  } catch (error: any) {
    console.error('[WhatsApp] parseWebhook error:', error);
    return null;
  }
}

/** Meta may batch several entries, changes, and messages in one authenticated
 * envelope. Flatten all of them before the endpoint acknowledges the envelope. */
export function parseWhatsAppWebhooks(body: any): WhatsAppMessage[] {
  const parsed: WhatsAppMessage[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (!value) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
        const message = parseWhatsAppMessage(rawMessage, contacts);
        if (message) parsed.push(message);
      }
    }
  }
  return parsed;
}

export function parseWhatsAppWebhook(body: any): WhatsAppMessage | null {
  return parseWhatsAppWebhooks(body)[0] || null;
}

/**
 * Format order for WhatsApp display (plain text, no HTML)
 */
export function formatOrderForWhatsApp(order: any, customFieldLines?: string[]): string {
  const lines = [
    `📦 *Orden #${order.orderId}*`,
    ``,
    `👤 *Cliente:* ${order.customerName}`,
    order.phone ? `📱 *Teléfono:* ${order.phone}` : null,
    order.email ? `📧 *Email:* ${order.email}` : null,
    ``,
    `🛍️ *Producto:* ${order.product || 'N/A'}`,
    order.quantity ? `📊 *Cantidad:* ${order.quantity}` : null,
    order.size ? `📏 *Talla:* ${order.size}` : null,
    order.color ? `🎨 *Color:* ${order.color}` : null,
    ``,
    `💰 *Total:* ₡${(order.total || 0).toLocaleString('es-CR')}`,
    `📍 *Estado:* ${order.status}`,
    order.province ? `🌍 *Ubicación:* ${[order.province, order.canton, order.district].filter(Boolean).join(', ')}` : null,
    order.address ? `📫 *Dirección:* ${order.address}` : null,
    order.comments ? `💬 *Comentarios:* ${order.comments}` : null,
  ].filter(Boolean);

  if (customFieldLines && customFieldLines.length > 0) {
    lines.push('', `📋 *Campos personalizados:*`);
    customFieldLines.forEach(line => lines.push(`  • ${line}`));
  }
  
  return lines.join('\n');
}

/**
 * Format inventory item for WhatsApp display
 */
export function formatInventoryForWhatsApp(item: any): string {
  const stockStatus = item.currentStock <= item.minStock 
    ? '🔴 Stock bajo' 
    : item.currentStock <= item.reorderPoint 
      ? '🟡 Reabastecer pronto'
      : '🟢 En stock';
  
  return [
    `📦 *${item.name}*`,
    `SKU: ${item.sku}`,
    ``,
    `📊 *Stock actual:* ${item.currentStock} unidades`,
    `${stockStatus}`,
    ``,
    `💰 *Precio:* ₡${(item.sellingPrice || 0).toLocaleString('es-CR')}`,
    `💵 *Costo:* ₡${(item.unitCost || 0).toLocaleString('es-CR')}`,
    item.category ? `📁 *Categoría:* ${item.category}` : null,
  ].filter(Boolean).join('\n');
}

/**
 * Format statistics summary for WhatsApp display
 */
export function formatStatsForWhatsApp(stats: any): string {
  const dateRange = stats.dateRange
    ? stats.dateRange.from === stats.dateRange.to
      ? stats.dateRange.from
      : `${stats.dateRange.from} a ${stats.dateRange.to}`
    : null;

  return [
    `📊 *Resumen de Ventas*`,
    dateRange ? `*Fecha:* ${dateRange}` : null,
    ``,
    `🛒 *Total Órdenes:* ${stats.totalSales || 0}`,
    `💰 *Ingresos:* ₡${(stats.totalRevenue || 0).toLocaleString('es-CR')}`,
    `📈 *Promedio por orden:* ₡${(stats.averageOrderValue || 0).toLocaleString('es-CR')}`,
    `👥 *Clientes activos:* ${stats.activeClients || 0}`,
    stats.trends ? [
      ``,
      `📈 *Tendencias:*`,
      `Ventas: ${stats.trends.sales > 0 ? '↑' : '↓'} ${Math.abs(stats.trends.sales).toFixed(1)}%`,
      `Ingresos: ${stats.trends.revenue > 0 ? '↑' : '↓'} ${Math.abs(stats.trends.revenue).toFixed(1)}%`,
    ].join('\n') : null,
  ].filter(Boolean).join('\n');
}

