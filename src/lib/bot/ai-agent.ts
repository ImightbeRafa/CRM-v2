/**
 * Betsy AI Agent
 * 
 * The main AI agent that processes user messages, decides which tools to use,
 * and generates natural Spanish responses. Uses xAI Grok with function calling.
 * 
 * xAI API is OpenAI-compatible, using the same SDK with a different base URL.
 */

import OpenAI from 'openai';
import {
  toolSchemas,
  executeTool,
  ToolContext,
  ToolResult,
  ToolName,
  ToolAttachment,
  updateToolSchemasWithCustomFields,
  getFormattedCustomFieldsForOrder,
} from './ai-tools';

export type { ToolAttachment };

export interface MessageResponse {
  text: string;
  attachments?: ToolAttachment[];
}
import {
  getFormattedHistory,
  addUserMessage,
  addAssistantMessage,
  peekPendingConfirmation,
  setPendingConfirmation,
  clearPendingConfirmation,
  removeLastUserMessage,
} from './conversation-memory';
import { formatOrderForTelegram, formatInventoryForTelegram, formatStatsForTelegram } from './telegram';
import { formatOrderForWhatsApp, formatInventoryForWhatsApp, formatStatsForWhatsApp } from './whatsapp';
import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import {
  getTenantCustomFields,
  formatCustomFieldsForTelegram,
  extractCustomFields,
  validateCustomFields,
  type CustomFieldsData,
} from '@/lib/customFields';
import { getCurrentStatsDateKey, STATS_TIME_ZONE } from '@/lib/statistics-dates';
import { validateLocation } from '@/lib/locationValidator';

// xAI client (OpenAI-compatible API)
const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
  timeout: Number(process.env.XAI_TIMEOUT_MS || 15_000),
});

// Model configuration
// IMPORTANT: For deterministic tool-calling, keep TEMPERATURE low (0.0-0.2).
// REASONING_EFFORT is supported by grok-4.3 and dramatically improves rule
// adherence on a long system prompt. MAX_TOKENS must be large enough to fit
// multi-product tool-call JSON without truncation.
const MODEL = process.env.XAI_MODEL || 'grok-4.3';
const MAX_TOKENS = Number(process.env.XAI_MAX_TOKENS || 2000);
const TEMPERATURE = (() => {
  const raw = process.env.XAI_TEMPERATURE;
  if (raw === undefined || raw === '') return 0.1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0.1;
})();
const REASONING_EFFORT: 'low' | 'medium' | 'high' = (() => {
  const raw = (process.env.XAI_REASONING_EFFORT || 'medium').toLowerCase();
  if (raw === 'low' || raw === 'high') return raw;
  return 'medium';
})();

console.log('[AI Agent] xAI model config:', {
  model: MODEL,
  maxTokens: MAX_TOKENS,
  temperature: TEMPERATURE,
  reasoningEffort: REASONING_EFFORT,
});

// Action keywords that require tool calls (to prevent AI hallucination)
// When these keywords are detected, we force tool_choice: 'required'
const ACTION_KEYWORDS = [
  // Order creation
  'crear', 'crea', 'creame', 'créame', 'nueva orden', 'nuevo pedido', 'recrear',
  'registrar', 'registra', 'agregar orden', 'añadir orden', 'hacer orden',
  // Order updates
  'actualizar', 'actualiza', 'modificar', 'modifica', 'cambiar', 'cambia',
  'editar', 'edita', 'corregir', 'corrige',
  // Status updates
  'marcar como', 'cambiar estado', 'actualizar estado', 'pasar a',
  // Deletion
  'eliminar', 'elimina', 'borrar', 'borra', 'cancelar orden',
  // Inventory
  'agregar stock', 'añadir stock', 'reducir stock', 'aumentar stock',
  'descontar', 'restar', 'sumar al inventario',
  'reconoces este codigo', 'reconoce este codigo', 'reconoces este cÃ³digo',
  'reconoce este cÃ³digo', 'buscar codigo', 'buscar cÃ³digo',
  'buscar sku', 'precio de', 'stock de',
  // Shipping — individual and bulk guía generation
  'generar guía', 'genera guía', 'crear guía', 'guía de envío',
  'generar guia', 'genera guia', 'crear guia', 'guia de envio',
  'guías en bulk', 'guías masivas', 'guias en bulk', 'guias masivas',
  'guías de correos', 'guias de correos', 'generar guías', 'generar guias',
  // Location validation
  'verificar ubicación', 'verificar ubicacion', 'validar ubicación', 'validar ubicacion',
  'verificar dirección', 'verificar direccion', 'validar provincia', 'validar cantón',
  'validar canton', 'verificar distrito',
  // Statistics and reporting queries must use tools instead of model memory.
  'ventas de hoy', 'venta de hoy', 'ventas del dia',
  'total en ventas', 'total de ventas', 'resumen de ventas', 'ingresos de hoy',
  'cuanto vend',
];

function normalizeSpanishText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function decodeEscapedUnicodeText(value: string): string {
  if (!/\\u[0-9a-fA-F]{4}/.test(value)) return value;
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * Check if a message looks like an action request that requires tool execution
 */
function isActionRequest(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  return ACTION_KEYWORDS.some(keyword => normalized.includes(normalizeSpanishText(keyword)));
}

function hasInventoryLookupIntent(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  return /\b(reconoces?|buscar|busca|stock|precio|inventario|sku|codigo)\b/.test(normalized);
}

const ORDER_CREATION_KEYWORDS = [
  'nueva orden', 'nuevo pedido', 'crear orden', 'crear pedido',
  'agregar orden', 'agregar pedido', 'añadir orden',
  'deseo agregar', 'quiero agregar', 'registrar orden', 'registrar pedido',
  'crear', 'crea', 'creame', 'créame', 'registrar', 'registra',
  'hacer orden', 'hacer pedido', 'recrear',
];

function hasOrderCreationIntent(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  return ORDER_CREATION_KEYWORDS.some(keyword => normalized.includes(normalizeSpanishText(keyword)));
}

const MUTATING_TOOLS = new Set<ToolName>([
  'create_order',
  'update_order',
  'update_order_status',
  'update_inventory_stock',
  'generate_shipping_guia',
  'generate_guias_bulk',
]);

function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName as ToolName);
}

function redactToolArgsForLog(toolName: string, toolArgs: any) {
  if (!toolArgs || typeof toolArgs !== 'object') return toolArgs;
  if (toolName !== 'create_order' && toolName !== 'update_order') return toolArgs;

  const redacted = { ...toolArgs };
  for (const key of ['customerName', 'phone', 'email', 'address', 'comments']) {
    if (key in redacted) redacted[key] = '[redacted]';
  }
  return redacted;
}

type PreparedToolCall = {
  id: string;
  name: ToolName;
  args: any;
  original: OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeToolText(value: unknown): string {
  return normalizeSpanishText(String(value || '')).replace(/\s+/g, ' ');
}

function createOrderIdentity(args: any): string {
  return [
    normalizeToolText(args.customerName),
    String(args.phone || '').replace(/\D/g, ''),
    normalizeToolText(args.address),
    normalizeToolText(args.province),
    normalizeToolText(args.canton),
    normalizeToolText(args.district),
    normalizeToolText(args.orderType),
    normalizeToolText(args.paymentMethod),
    String(args.contraEntrega === true),
  ].join('|');
}

function orderProductsFromArgs(args: any): Array<{ name?: string; sku?: string; quantity: number }> {
  if (Array.isArray(args.products) && args.products.length > 0) {
    return args.products
      .map((product: any) => ({
        name: typeof product?.name === 'string' ? product.name.trim() : undefined,
        sku: typeof product?.sku === 'string' ? product.sku.trim() : undefined,
        quantity: Math.max(1, Number(product?.quantity) || 1),
      }))
      .filter((product: { name?: string; sku?: string; quantity: number }) => product.name || product.sku);
  }

  return [{
    name: typeof args.product === 'string' ? args.product.trim() : undefined,
    quantity: Math.max(1, Number(args.quantity) || 1),
  }].filter((product: { name?: string; quantity: number }) => product.name);
}

function hasCreateOrderProduct(args: any): boolean {
  if (typeof args.product === 'string' && args.product.trim()) return true;
  return Array.isArray(args.products) && args.products.some((product: any) =>
    product && typeof product === 'object' && (
      (typeof product.name === 'string' && product.name.trim()) ||
      (typeof product.sku === 'string' && product.sku.trim())
    )
  );
}

function stripChatMarkdown(value: string): string {
  return value
    .replace(/^[\s>*_~-]+|[\s*_~]+$/g, '')
    .replace(/\*/g, '')
    .trim();
}

function isOrderSectionLabel(line: string): boolean {
  const normalized = normalizeSpanishText(stripChatMarkdown(line));
  return /^(cantidad(\s+total)?|total(\s+en\s+\w+)?|tipo\s+de\s+orden|metodo\s+de\s+pago|metodo\s+de\s+envio|entrega|comentario|comentarios?|cliente|nombre|telefono|direccion|provincia|canton|distrito)\b/.test(normalized);
}

function extractProductTextFromMessage(message: string): string | undefined {
  const lines = message.split(/\r?\n/);
  const products: string[] = [];
  let collecting = false;

  for (const rawLine of lines) {
    const line = stripChatMarkdown(rawLine);
    if (!line) {
      if (collecting && products.length > 0) break;
      continue;
    }

    const inlineProduct = line.match(/^productos?\s*(?:\([^)]*\))?\s*:\s*(.+)$/i)
      || line.match(/^producto\s*(?:\([^)]*\))?\s*:\s*(.+)$/i);
    if (inlineProduct) {
      collecting = true;
      const value = stripChatMarkdown(inlineProduct[1]);
      if (value) products.push(value);
      continue;
    }

    const productLabelOnly = /^productos?\s*(?:\([^)]*\))?\s*:?\s*$/i.test(line)
      || /^producto\s*(?:\([^)]*\))?\s*:?\s*$/i.test(line);
    if (productLabelOnly) {
      collecting = true;
      continue;
    }

    if (collecting) {
      if (isOrderSectionLabel(line)) break;
      products.push(line);
    }
  }

  return products.length > 0 ? products.join('\n') : undefined;
}

function extractPhoneFromMessage(message: string): string | undefined {
  const match = message.match(/\b(?:\+?506[\s-]?)?(\d{4})[\s-]?(\d{4})\b/);
  return match ? `${match[1]}${match[2]}` : undefined;
}

function extractTotalFromMessage(message: string): number | undefined {
  const explicitTotal = extractExplicitTotalFromMessage(message);
  if (explicitTotal !== undefined) return explicitTotal;

  const match = message.match(/\btotal(?:\s+en\s+\w+)?\s*[:=]?\s*(?:CRC|₡|¢)?\s*([\d.,]+)/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : undefined;
}

function extractExplicitTotalFromMessage(message: string): number | undefined {
  const parseAmount = (value: string): number | undefined => {
    const amount = Number(value.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    return Number.isFinite(amount) ? amount : undefined;
  };

  for (const rawLine of message.split(/\r?\n/)) {
    const line = stripChatMarkdown(rawLine);
    const separatorIndex = line.search(/[:=]/);
    if (separatorIndex < 0) continue;

    const label = normalizeSpanishText(line.slice(0, separatorIndex)).replace(/\s+/g, ' ');
    if (!/^total(?:\s+en\s+\w+)?$/.test(label)) continue;

    const valueMatch = line.slice(separatorIndex + 1).match(/(\d[\d.,]*)/);
    if (valueMatch) return parseAmount(valueMatch[1]);
  }

  const match = message.match(/\btotal(?:\s+en\s+\w+)?\b[^\d\r\n]*(\d[\d.,]*)/i);
  if (!match) return undefined;
  return parseAmount(match[1]);
}

function inferCreateOrderArgsFromMessage(args: any, userMessage: string): any {
  const inferred = { ...args };
  const repairedFields: string[] = [];

  if (!hasCreateOrderProduct(inferred)) {
    const product = extractProductTextFromMessage(userMessage);
    if (product) {
      inferred.product = product;
      repairedFields.push('product');
    }
  }

  if (!inferred.phone) {
    const phone = extractPhoneFromMessage(userMessage);
    if (phone) {
      inferred.phone = phone;
      repairedFields.push('phone');
    }
  }

  if (/\btotal\b/i.test(userMessage)) {
    const total = extractTotalFromMessage(userMessage);
    if (total !== undefined) {
      inferred.total = total;
      delete inferred._totalsMismatch;
      repairedFields.push('total');
    }
  } else if (Array.isArray(inferred._totalsMismatch) && /^\s*[¢₡$]?\s*\d[\d.,]*\s*$/.test(userMessage.trim())) {
    // User is replying to a totals-mismatch question with a bare number.
    const bareMatch = userMessage.match(/(\d[\d.,]*)/);
    if (bareMatch) {
      const parsed = Number(bareMatch[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) {
        inferred.total = parsed;
        delete inferred._totalsMismatch;
        repairedFields.push('total');
      }
    }
  }

  const normalizedMessage = normalizeSpanishText(userMessage);
  if (!inferred.orderType) {
    if (/\bra\b/.test(normalizedMessage) || normalizedMessage.includes('retiro')) {
      inferred.orderType = 'RA';
      repairedFields.push('orderType');
    } else if (/\bea\b/.test(normalizedMessage) || normalizedMessage.includes('envio')) {
      inferred.orderType = 'EA';
      repairedFields.push('orderType');
    }
  }

  if (!inferred.paymentMethod) {
    const paymentMatch = userMessage.match(/m[eé]todo\s+de\s+pago\s*:\s*([^\n\r]+)/i);
    if (paymentMatch?.[1]) {
      inferred.paymentMethod = stripChatMarkdown(paymentMatch[1]);
      repairedFields.push('paymentMethod');
    }
  }

  if (inferred.contraEntrega !== true && normalizedMessage.includes('contra entrega')) {
    inferred.contraEntrega = true;
    repairedFields.push('contraEntrega');
  }

  const location = extractLocationFromMessage(userMessage);
  for (const field of ['province', 'canton', 'district', 'address'] as const) {
    if (!inferred[field] && location[field]) {
      inferred[field] = location[field];
      repairedFields.push(field);
    } else if (typeof inferred[field] === 'string') {
      const decoded = decodeEscapedUnicodeText(inferred[field]);
      if (decoded !== inferred[field]) {
        inferred[field] = decoded;
        repairedFields.push(field);
      }
    }
  }

  if (repairedFields.length > 0) {
    console.info('[AI Agent] Repaired create_order args from user message:', repairedFields);
  }

  return inferred;
}

function looksLikeOrderFieldReply(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  const trimmed = message.trim();
  return /^productos?\s*(?:\([^)]*\))?\s*:/im.test(message)
    || /^producto\s*(?:\([^)]*\))?\s*:/im.test(message)
    || /\btotal(?:\s+en\s+\w+)?\s*[:=]/i.test(message)
    || /m[eé]todo\s+de\s+pago\s*:/i.test(message)
    || /\b(?:\+?506[\s-]?)?\d{4}[\s-]?\d{4}\b/.test(message)
    || /\b(ra|ea)\b/.test(normalized)
    || normalized.includes('contra entrega')
    // Location labels with OR without colons — WhatsApp users often skip the colon.
    || /^\s*provincia[\s:]/im.test(message)
    || /^\s*cant[óo]n[\s:]/im.test(message)
    || /^\s*distrito[\s:]/im.test(message)
    || /^\s*direccion[\s:]/im.test(normalized)
    // Bare numeric reply (e.g. answering a totals-mismatch question with "47900").
    || /^[¢₡$]?\s*\d[\d.,]*\s*$/.test(trimmed);
}

/**
 * Phrases users send when they want to reject the bot's pending review because
 * the bot mixed in old data. `isDenial` only catches short single-word "no"
 * replies; this catches longer rejections like:
 *   "no esos datos son de la orden pasada"
 *   "esos datos están equivocados"
 *   "no, son de la orden anterior"
 *   "esa no es la orden"
 */
const EXPLICIT_REJECTION_PATTERNS: RegExp[] = [
  /\bno\b[^.\n]*\b(?:esos?|estos?|esa)\b[^.\n]*\bdatos?\b/i,
  /\bdatos?\b[^.\n]*\b(?:incorrect[ao]s?|equivocad[ao]s?|err[oó]ne[ao]s?|mal[eo]?s?)\b/i,
  /\b(?:son|es)\s+de\s+(?:la|otra|una|esa|esta|el|otro)\s+(?:orden|pedido)\s+(?:pasad[ao]|anterior|previ[ao]|antigu[ao])\b/i,
  /\b(?:de|son\s+de)\s+(?:la\s+)?orden\s+(?:pasada|anterior|previa|antigua)\b/i,
  /\beso(?:s)?\s+no\s+(?:es|son)\s+(?:la|los?|las?)\b/i,
  /\b(?:descart[ae]|cancel[ae]|olvid[ae])\s+(?:esa|esta|esos?|estos?)\s+(?:orden|revisi|datos?)/i,
];

function isExplicitRejection(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  // Quick gate: must contain a negation word or "incorrect" / "wrong" word to
  // avoid false positives on neutral messages.
  if (!/\bno\b/.test(normalized) && !/\b(?:incorrect|equivocad|errone|otra|pasad|anterior|previa|descart|cancel|olvid)/.test(normalized)) {
    return false;
  }
  return EXPLICIT_REJECTION_PATTERNS.some((re) => re.test(message));
}

/**
 * Sanitize a successful-order message before persisting it to conversation
 * history. The user still sees the full detailed confirmation in the chat,
 * but the LLM should only see a minimal trace on later turns so it cannot
 * borrow customer name / products / total from a previously-created order.
 *
 * If the message contains an order id pattern (e.g. "Orden #BOT-123 creada
 * exitosamente"), we keep the order id and a generic success line, and drop
 * everything else.
 */
function sanitizeOrderSuccessForHistory(text: string): string {
  const orderIdMatch = text.match(/Orden\s+(#?[\w-]+)\s+creada\s+exitosamente/i);
  if (orderIdMatch) {
    const orderId = orderIdMatch[1].startsWith('#') ? orderIdMatch[1] : `#${orderIdMatch[1]}`;
    return `✅ Orden ${orderId} creada exitosamente. (Detalles del cliente y productos enviados al usuario; no se conservan en el historial para evitar que se reutilicen en órdenes futuras.)`;
  }
  return text;
}

function shouldStoreCreateOrderRepair(result: ToolResult): boolean {
  const error = result.error || '';
  return /producto es requerido|campos faltantes|campos personalizados faltantes/i.test(error);
}

const CREATE_ORDER_REVIEW_FIELDS = new Set([
  'customerName',
  'phone',
  'email',
  'product',
  'products',
  'quantity',
  'total',
  'address',
  'province',
  'canton',
  'district',
  'courier',
  'metodoEnvio',
  'shippingMethod',
  'mensajeria',
  'paymentMethod',
  'comments',
  'orderType',
  'size',
  'color',
  'contraEntrega',
  'skipInventoryCheck',
  '_forceWithoutInventory',
  '_finalReviewConfirmed',
]);

function formatCrcAmount(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'SIN TOTAL';
  return `CRC ${amount.toLocaleString('es-CR')}`;
}

function formatReviewValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  return String(value);
}

function getCreateOrderReviewMissingFields(args: any): string[] {
  const missing: string[] = [];

  if (!args.customerName || !String(args.customerName).trim()) missing.push('Nombre del cliente');
  if (!hasCreateOrderProduct(args)) missing.push('Producto(s)');
  if (args.total === undefined || args.total === null || Number(args.total) < 0 || !Number.isFinite(Number(args.total))) {
    missing.push('Total');
  }
  if (!args.orderType) missing.push('Tipo de orden (EA o RA)');

  if (args.orderType === 'EA') {
    if (!args.address || !String(args.address).trim()) missing.push('Direccion');
    if (!args.province || !String(args.province).trim()) missing.push('Provincia');
    if (!args.canton || !String(args.canton).trim()) missing.push('Canton');
    if (!args.district || !String(args.district).trim()) missing.push('Distrito');
  }

  return missing;
}

function getCreateOrderReviewProductLines(args: any): string[] {
  const products = orderProductsFromArgs(args);
  if (products.length === 0 && typeof args.product === 'string' && args.product.trim()) {
    return [args.product.trim()];
  }

  return products.map((product) => {
    const name = [product.name, product.sku ? `(SKU: ${product.sku})` : ''].filter(Boolean).join(' ');
    return `${name || 'Producto'} x${product.quantity}`;
  });
}

function buildCreateOrderFinalReview(args: any, customFieldsConfig?: CustomFieldsData): string {
  const productLines = getCreateOrderReviewProductLines(args);
  const totalQuantity = productLines.length > 0
    ? orderProductsFromArgs(args).reduce((sum, product) => sum + product.quantity, 0)
    : Number(args.quantity) || 0;

  const lines = [
    'Revision final antes de crear la orden.',
    '',
    'Estos son los datos que se enviaran a Betsy:',
    `Cliente: ${formatReviewValue(args.customerName)}`,
    `Telefono: ${formatReviewValue(args.phone)}`,
    'Producto(s):',
    ...(productLines.length > 0 ? productLines.map((line) => `- ${line}`) : ['- SIN PRODUCTO']),
    `Cantidad total: ${totalQuantity || '-'}`,
    `Total: ${formatCrcAmount(args.total)}`,
    `Tipo de orden: ${formatReviewValue(args.orderType)}`,
    `Metodo de pago: ${formatReviewValue(args.paymentMethod)}`,
  ];

  if (args.orderType === 'EA') {
    lines.push(
      `Metodo de envio: ${formatReviewValue(args.courier || args.metodoEnvio || args.shippingMethod || args.mensajeria)}`,
      `Provincia: ${formatReviewValue(args.province)}`,
      `Canton: ${formatReviewValue(args.canton)}`,
      `Distrito: ${formatReviewValue(args.district)}`,
      `Direccion: ${formatReviewValue(args.address)}`,
    );
  }

  if (args.comments) lines.push(`Comentarios: ${formatReviewValue(args.comments)}`);
  if (args.contraEntrega === true) lines.push('Contra entrega: Si');

  // Prefer the tenant's configured field labels for custom fields. Falls back
  // to raw key:value pairs when the config is not provided.
  let extraFields: string[] = [];
  if (customFieldsConfig) {
    try {
      const extracted = extractCustomFields(args, customFieldsConfig);
      // formatCustomFieldsForTelegram returns lines like "*Negocio:* ACME" —
      // strip the markdown asterisks so the plain final review reads cleanly.
      extraFields = formatCustomFieldsForTelegram(extracted, customFieldsConfig)
        .map((line) => line.replace(/\*/g, '').trim())
        .filter(Boolean);
    } catch (error) {
      console.warn('[AI Agent] Failed to format custom fields for review:', error);
    }
  }

  if (extraFields.length === 0) {
    extraFields = Object.entries(args)
      .filter(([key, value]) =>
        !CREATE_ORDER_REVIEW_FIELDS.has(key)
        && !key.startsWith('_')
        && value !== undefined && value !== null && value !== ''
      )
      .map(([key, value]) => `${key}: ${formatReviewValue(value)}`);
  }

  if (extraFields.length > 0) {
    lines.push('', 'Campos adicionales:', ...extraFields);
  }

  lines.push('', 'Responde SI para crear la orden, NO para cancelarla, o envia la correccion exacta.');
  return lines.join('\n');
}

async function requestCreateOrderFinalConfirmation(
  args: any,
  context: ToolContext,
  platform: string,
  platformId: string,
): Promise<MessageResponse> {
  const customFieldsConfig = await getTenantCustomFields(context.tenantId);

  // If the model emitted multiple create_order calls with diverging totals,
  // mergeCreateOrderCalls flagged it instead of silently summing. Refuse to
  // commit and ask the user which total is correct.
  const totalsMismatch = Array.isArray((args as any)._totalsMismatch)
    ? ((args as any)._totalsMismatch as number[])
    : null;

  // IMPORTANT: We intentionally DO NOT add the review / missing-fields /
  // totals-mismatch messages to conversation history. The user still sees them
  // in the chat (they're the function's return value), but the LLM should not
  // remember them. The pending order data lives in Redis (setPendingConfirmation),
  // not in chat history. Persisting these messages in history caused the bot to
  // leak Customer/Product/Total data from a stale review into a follow-up order
  // when the LLM was later consulted with that history visible.

  if (totalsMismatch && totalsMismatch.length > 1) {
    await setPendingConfirmation(platform, platformId, {
      type: 'order_repair',
      data: {
        toolName: 'create_order',
        toolArgs: args,
      },
      expiresAt: Date.now() + 120_000,
    });

    const text = [
      'Detecté varios totales en tu mensaje y no quiero adivinar:',
      ...totalsMismatch.map((t) => `- ${formatCrcAmount(t)}`),
      '',
      '¿Cuál es el total correcto? Envíame el número y preparo la revisión final.',
    ].join('\n');

    return { text };
  }

  const extractedCustomFields = extractCustomFields(args, customFieldsConfig);
  const customValidation = validateCustomFields(extractedCustomFields, customFieldsConfig);
  const missing = [
    ...getCreateOrderReviewMissingFields(args),
    ...customValidation.errors,
  ];

  if (missing.length > 0) {
    await setPendingConfirmation(platform, platformId, {
      type: 'order_repair',
      data: {
        toolName: 'create_order',
        toolArgs: args,
      },
      expiresAt: Date.now() + 120_000,
    });

    const text = [
      'No creare la orden todavia. Faltan campos requeridos:',
      ...missing.map((field) => `- ${field}`),
      '',
      'Enviame esos datos y preparo la revision final antes de crearla.',
    ].join('\n');

    return { text };
  }

  await setPendingConfirmation(platform, platformId, {
    type: 'order_final_confirm',
    data: {
      toolName: 'create_order',
      toolArgs: args,
    },
    expiresAt: Date.now() + 120_000,
  });

  const text = buildCreateOrderFinalReview(args, customFieldsConfig);
  return { text };
}

function getLabelValue(message: string, labels: string[]): string | undefined {
  const lines = message.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = stripChatMarkdown(rawLine).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) continue;

    const key = normalizeSpanishText(line.slice(0, separatorIndex)).replace(/\s+/g, ' ');
    const value = stripChatMarkdown(line.slice(separatorIndex + 1));
    if (!value) continue;

    if (labels.some((label) => key.includes(normalizeSpanishText(label)))) {
      return value;
    }
  }
  return undefined;
}

function looksLikeNonAddressOrderLine(line: string): boolean {
  if (!line) return true;
  if (extractPhoneFromMessage(line)) return true;
  if (hasOrderCreationIntent(line)) return true;
  if (isOrderSectionLabel(line)) return true;
  if (/^productos?\s*(?:\([^)]*\))?\s*:?/i.test(line)) return true;
  if (/^producto\s*(?:\([^)]*\))?\s*:?/i.test(line)) return true;
  if (/^[-*•]?\s*[\w\s]+(?:patch|producto|sku)\b/i.test(line) && /\bx\s*\d+\b/i.test(line)) return true;
  return false;
}

function splitDistrictAndAddress(rawDistrictPart: string, matchedDistrict: string): { district: string; address?: string } {
  const districtPart = stripChatMarkdown(decodeEscapedUnicodeText(rawDistrictPart));
  const sentenceSplit = districtPart.match(/^(.+?)\.\s*(.+)$/);
  if (sentenceSplit?.[2]) {
    return {
      district: matchedDistrict,
      address: stripChatMarkdown(sentenceSplit[2]),
    };
  }

  const normalizedPart = normalizeSpanishText(districtPart);
  const normalizedDistrict = normalizeSpanishText(matchedDistrict);
  if (normalizedPart.startsWith(normalizedDistrict) && normalizedPart.length > normalizedDistrict.length) {
    const districtWords = matchedDistrict.trim().split(/\s+/).length;
    const words = districtPart.trim().split(/\s+/);
    const rest = words.slice(districtWords).join(' ').replace(/^[,.;:\s-]+/, '').trim();
    if (rest) return { district: matchedDistrict, address: rest };
  }

  return { district: matchedDistrict };
}

/**
 * Extract Provincia/Cantón/Distrito from lines that omit the colon, like:
 *   Provincia San José
 *   Cantón Desamparados
 *   Distrito San Antonio
 * `getLabelValue` requires `:`, so without this fallback the structured
 * fast-path silently drops the location and the bot incorrectly reports the
 * fields as missing. We require the label to be the FIRST word of the line
 * and we skip lines that already have a colon (those are handled upstream).
 */
function extractColonlessLocationFromMessage(message: string): {
  province?: string;
  canton?: string;
  district?: string;
} {
  const result: { province?: string; canton?: string; district?: string } = {};
  const lines = message
    .split(/\r?\n/)
    .map((line) => stripChatMarkdown(line))
    .filter(Boolean);

  for (const line of lines) {
    if (line.includes(':')) continue;

    const provMatch = line.match(/^\s*provincia\s+(.+)$/i);
    if (provMatch && !result.province) {
      result.province = decodeEscapedUnicodeText(stripChatMarkdown(provMatch[1]));
      continue;
    }

    const cantMatch = line.match(/^\s*cant[óo]n\s+(.+)$/i);
    if (cantMatch && !result.canton) {
      result.canton = decodeEscapedUnicodeText(stripChatMarkdown(cantMatch[1]));
      continue;
    }

    const distMatch = line.match(/^\s*distrito\s+(.+)$/i);
    if (distMatch && !result.district) {
      result.district = decodeEscapedUnicodeText(stripChatMarkdown(distMatch[1]));
      continue;
    }
  }

  return result;
}

function extractLocationFromMessage(message: string): {
  province?: string;
  canton?: string;
  district?: string;
  address?: string;
} {
  const labeledProvince = getLabelValue(message, ['provincia']);
  const labeledCanton = getLabelValue(message, ['canton']);
  const labeledDistrict = getLabelValue(message, ['distrito']);
  const labeledAddress = getLabelValue(message, ['direccion exacta', 'direccion', 'address']);

  const result: { province?: string; canton?: string; district?: string; address?: string } = {};
  if (labeledProvince) result.province = decodeEscapedUnicodeText(labeledProvince);
  if (labeledCanton) result.canton = decodeEscapedUnicodeText(labeledCanton);
  if (labeledDistrict) result.district = decodeEscapedUnicodeText(labeledDistrict);
  if (labeledAddress) result.address = decodeEscapedUnicodeText(labeledAddress);

  // Fallback: capture colonless location labels (very common in WhatsApp messages).
  if (!result.province || !result.canton || !result.district) {
    const colonless = extractColonlessLocationFromMessage(message);
    if (!result.province && colonless.province) result.province = colonless.province;
    if (!result.canton && colonless.canton) result.canton = colonless.canton;
    if (!result.district && colonless.district) result.district = colonless.district;
  }

  const lines = message
    .split(/\r?\n/)
    .map((line) => stripChatMarkdown(line))
    .filter(Boolean);

  for (const line of lines) {
    if (looksLikeNonAddressOrderLine(line)) continue;
    if (!line.includes(',')) continue;

    const parts = line.split(',').map((part) => stripChatMarkdown(part)).filter(Boolean);
    if (parts.length < 3) continue;

    const provinceCandidate = decodeEscapedUnicodeText(parts[0]);
    const cantonCandidate = decodeEscapedUnicodeText(parts[1]);
    const districtCandidate = decodeEscapedUnicodeText(parts.slice(2).join(', '));
    const validation = validateLocation(provinceCandidate, cantonCandidate, districtCandidate);
    if (!validation.province.valid || !validation.canton.valid) continue;

    result.province ||= validation.correctedProvince || validation.province.match || provinceCandidate;
    result.canton ||= validation.correctedCanton || validation.canton.match || cantonCandidate;

    const matchedDistrict = validation.correctedDistrict || validation.district.match;
    if (matchedDistrict) {
      const split = splitDistrictAndAddress(districtCandidate, matchedDistrict);
      result.district ||= split.district;
      if (!result.address && split.address) result.address = split.address;
    } else {
      result.district ||= districtCandidate;
    }

    if (!result.address) result.address = line;
    break;
  }

  return result;
}

function extractQuantityFromMessage(message: string): number | undefined {
  const explicit = message.match(/cantidad(?:\s+total)?\s*[:=]?\s*(\d+)/i);
  if (explicit) {
    const quantity = Number(explicit[1]);
    if (Number.isInteger(quantity) && quantity > 0) return quantity;
  }

  const product = extractProductTextFromMessage(message);
  const productQuantity = product?.match(/\b(?:x|\*)\s*(\d+)\b/i);
  if (productQuantity) {
    const quantity = Number(productQuantity[1]);
    if (Number.isInteger(quantity) && quantity > 0) return quantity;
  }

  return undefined;
}

function inferCustomerNameFromMessage(message: string): string | undefined {
  const labeled = getLabelValue(message, ['nombre completo', 'cliente', 'nombre']);
  if (labeled) return labeled;

  const lines = message
    .split(/\r?\n/)
    .map((line) => stripChatMarkdown(line))
    .filter(Boolean);

  const firstOrderLineIndex = lines.findIndex((line) => hasOrderCreationIntent(line));
  const startIndex = firstOrderLineIndex >= 0 ? firstOrderLineIndex + 1 : 0;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (extractPhoneFromMessage(line)) continue;
    if (/^productos?\s*(?:\([^)]*\))?\s*:?$/i.test(line)) break;
    if (/^producto\s*(?:\([^)]*\))?\s*:?$/i.test(line)) break;
    if (isOrderSectionLabel(line)) continue;
    if (/[:=]/.test(line)) continue;
    return line;
  }

  return undefined;
}

function buildStructuredOrderArgs(userMessage: string): any | null {
  if (!hasOrderCreationIntent(userMessage)) return null;

  const normalized = normalizeSpanishText(userMessage);
  const hasOrderTemplateSignal =
    /^productos?\s*(?:\([^)]*\))?\s*:/im.test(userMessage)
    || /^producto\s*(?:\([^)]*\))?\s*:/im.test(userMessage)
    || normalized.includes('nombre completo')
    || normalized.includes('telefono')
    || /\btotal(?:\s+en\s+\w+)?\b/i.test(userMessage)
    || /\bdeseo crear una nueva orden\b/i.test(userMessage);

  if (!hasOrderTemplateSignal) return null;

  const args: any = {};
  const customerName = inferCustomerNameFromMessage(userMessage);
  const product = extractProductTextFromMessage(userMessage);
  const phone = extractPhoneFromMessage(userMessage);
  const total = extractTotalFromMessage(userMessage);
  const quantity = extractQuantityFromMessage(userMessage);

  if (customerName) args.customerName = customerName;
  if (product) args.product = product;
  if (phone) args.phone = phone;
  if (total !== undefined) args.total = total;
  if (quantity !== undefined) args.quantity = quantity;

  if (/\bra\b/.test(normalized) || normalized.includes('retiro')) {
    args.orderType = 'RA';
  } else if (/\bea\b/.test(normalized) || normalized.includes('envio')) {
    args.orderType = 'EA';
  }

  const paymentMethod = getLabelValue(userMessage, ['metodo de pago', 'forma de pago', 'pago']);
  if (paymentMethod) args.paymentMethod = paymentMethod;

  const comments = getLabelValue(userMessage, ['comentario', 'comentarios', 'observacion', 'nota']);
  if (comments) args.comments = comments;

  const location = extractLocationFromMessage(userMessage);
  if (location.address) args.address = location.address;
  if (location.province) args.province = location.province;
  if (location.canton) args.canton = location.canton;
  if (location.district) args.district = location.district;

  const courier = getLabelValue(userMessage, ['metodo de envio', 'mensajeria', 'courier', 'entrega']);
  if (courier) args.courier = courier;

  if (normalized.includes('contra entrega') || normalized.includes('paga contra entrega')) {
    args.contraEntrega = true;
  }

  return Object.keys(args).length > 0 ? args : null;
}

async function executeStructuredCreateOrder(
  args: any,
  context: ToolContext,
  platform: string,
  platformId: string,
): Promise<MessageResponse> {
  console.info('[AI Agent] Structured order fast path detected', {
    hasCustomer: !!args.customerName,
    hasProduct: !!args.product,
    hasTotal: args.total !== undefined,
    orderType: args.orderType,
  });

  return requestCreateOrderFinalConfirmation(args, context, platform, platformId);
}

function mergeCreateOrderCalls(calls: PreparedToolCall[]): PreparedToolCall[] {
  const result: PreparedToolCall[] = [];
  const createOrderGroups = new Map<string, PreparedToolCall[]>();
  const seenCreateOrderSignatures = new Set<string>();

  for (const call of calls) {
    if (call.name !== 'create_order') {
      result.push(call);
      continue;
    }

    const signature = stableStringify(call.args);
    if (seenCreateOrderSignatures.has(signature)) {
      console.warn('[AI Agent] Skipping duplicate create_order tool call in same model response');
      continue;
    }
    seenCreateOrderSignatures.add(signature);

    const identity = createOrderIdentity(call.args);
    const group = createOrderGroups.get(identity) || [];
    group.push(call);
    createOrderGroups.set(identity, group);
  }

  for (const group of createOrderGroups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const base = { ...group[0].args };
    const productsByKey = new Map<string, { name?: string; sku?: string; quantity: number }>();
    for (const call of group) {
      for (const product of orderProductsFromArgs(call.args)) {
        const key = `${normalizeToolText(product.sku)}|${normalizeToolText(product.name)}`;
        const existing = productsByKey.get(key);
        productsByKey.set(key, {
          name: product.name,
          sku: product.sku,
          quantity: (existing?.quantity || 0) + product.quantity,
        });
      }
    }

    const totals = group.map((call) => Number(call.args.total)).filter((t) => Number.isFinite(t) && t > 0);
    const uniqueTotals = Array.from(new Set(totals));
    base.products = Array.from(productsByKey.values());
    base.product = base.products
      .map((product: any) => [product.name, product.sku].filter(Boolean).join(' '))
      .join('\n');
    base.quantity = base.products.reduce((sum: number, product: any) => sum + product.quantity, 0);

    if (uniqueTotals.length <= 1) {
      base.total = uniqueTotals[0] ?? 0;
      delete base._totalsMismatch;
    } else {
      // Don't silently sum diverging totals — flag for user clarification.
      base.total = uniqueTotals[0];
      base._totalsMismatch = uniqueTotals;
      console.warn('[AI Agent] Merged create_order had divergent totals; asking user to clarify', uniqueTotals);
    }

    console.warn('[AI Agent] Merged multiple create_order tool calls into one multi-product order', {
      mergedCalls: group.length,
      productLines: base.products.length,
      totalsMismatch: uniqueTotals.length > 1,
    });

    result.push({
      ...group[0],
      args: base,
    });
  }

  return result;
}

const TODAY_QUERY_RE = /\b(hoy|dia de hoy|del dia)\b/i;

function applyRelativeDateGuards(toolName: ToolName, toolArgs: any, userMessage: string): any {
  if (!toolArgs || typeof toolArgs !== 'object') return toolArgs;
  if (toolName !== 'get_statistics_summary' && toolName !== 'get_orders') return toolArgs;
  const normalizedMessage = normalizeSpanishText(userMessage);
  const isTodayQuery =
    TODAY_QUERY_RE.test(normalizedMessage) ||
    normalizedMessage.includes('dia de hoy') ||
    normalizedMessage.includes('del dia');
  if (!isTodayQuery) return toolArgs;

  const todayKey = getCurrentStatsDateKey();
  return {
    ...toolArgs,
    dateFrom: todayKey,
    dateTo: todayKey,
  };
}

// System prompt in Spanish
const SYSTEM_PROMPT = `Eres Betsy, una asistente virtual profesional para Betsy CRM, una plataforma de gestión de pedidos para negocios en Costa Rica.

NEGOCIO ACTUAL: {{TENANT_NAME}}
FECHA ACTUAL: {{CURRENT_DATE}}
HORA ACTUAL: {{CURRENT_TIME}}
ZONA HORARIA: Costa Rica (America/Costa_Rica)

AISLAMIENTO DE DATOS:
- Todos los datos que consultes y devuelvas pertenecen EXCLUSIVAMENTE al negocio "{{TENANT_NAME}}".
- NUNCA hagas referencia a datos, órdenes, clientes o productos de conversaciones anteriores que no correspondan al negocio actual.
- Si no encuentras información, consulta las herramientas disponibles. NUNCA inventes datos basándote en el historial de conversación.

Tu rol es ayudar a los usuarios a gestionar su negocio de manera eficiente y profesional. Puedes:

1. **Crear órdenes**: Registrar ventas con información completa del cliente, productos, precios y dirección de entrega.
2. **Consultar órdenes**: Buscar y filtrar órdenes por estado, fecha, cliente, o cualquier criterio.
3. **Actualizar órdenes**: Modificar información o cambiar estados de órdenes existentes.
4. **Gestionar inventario**: Consultar stock, agregar o reducir cantidades de productos.
5. **Ver estadísticas y reportes**: Mostrar resúmenes de ventas, ingresos, productos más vendidos, etc.
6. **Buscar clientes**: Encontrar información de clientes y su historial de compras.
7. **Generar guías de envío**: Crear guías de Correos de Costa Rica (automáticas con tracking) o guías manuales (etiqueta PDF simple), individuales o en bulk.

CONCEPTOS IMPORTANTES DE ENVÍO:
- **EA (Envío a Domicilio)**: El pedido se ENVÍA a la dirección del cliente. Requiere dirección, provincia, cantón, distrito, y generar guía de envío.
- **RA (Retiro en Local)**: El cliente RECOGE el pedido en tu ubicación. NO requiere dirección, provincia, cantón, distrito, ni envío.
- NUNCA confundas EA con RA. Siempre pregunta si no estás seguro del método de entrega.
- **CRÍTICO**: Siempre pasa el campo orderType al crear una orden. Si el usuario dice "RA", "retiro", o "retiro en local", usa orderType="RA". Si dice "EA", "envío", o "envío a domicilio", usa orderType="EA". Si no lo especifica, PREGUNTA antes de crear la orden.
- Cuando orderType es "RA", NO incluyas ni pidas dirección, provincia, cantón, distrito, ni método de envío.

VALIDACIÓN DE UBICACIÓN (Costa Rica):
- Para órdenes EA, SIEMPRE recopila provincia, cantón Y distrito. Los tres son necesarios para generar guías de Correos de Costa Rica.
- Costa Rica tiene 7 provincias, cada una con cantones, y cada cantón con distritos. La jerarquía es: Provincia → Cantón → Distrito.
- **CRÍTICO**: La herramienta **create_order** YA valida y corrige la ubicación automáticamente. NO llames a validate_order_location por separado cuando vayas a crear una orden. Llama directamente a create_order y el sistema se encarga de validar y corregir errores menores (tildes, mayúsculas, etc.).
- Usa **validate_order_location** ÚNICAMENTE cuando:
  1. El usuario pide explícitamente verificar una ubicación SIN crear orden (ej: "verificar dirección", "¿es válido este cantón?").
  2. El usuario solo proporciona datos parciales de ubicación (solo provincia, o provincia y cantón) y necesitas mostrarle las opciones disponibles para el siguiente nivel.
- Si create_order devuelve un error de ubicación inválida, presenta las opciones al usuario como lista numerada para que elija.
- Si el usuario solo da la provincia, pregunta por el cantón. Si da provincia y cantón, pregunta por el distrito mostrando las opciones disponibles.

CREACIÓN DE ÓRDENES — FLUJO EFICIENTE:
- **REGLA ABSOLUTA**: Cuando el usuario quiere crear una orden y proporciona datos (nombre, producto, precio, dirección, etc.) EN SU MENSAJE ACTUAL, llama a **create_order** DIRECTAMENTE. NUNCA llames a validate_order_location primero. NUNCA. La herramienta create_order ya valida la ubicación internamente.
- **PROHIBIDO**: Responder con mensajes de validación como "Ubicación válida", "Ubicación válida (con correcciones)", o cualquier reporte técnico de validación. El usuario quiere que CREES la orden, no que le reportes si la dirección es válida.
- Si la orden se crea exitosamente y hubo correcciones de ubicación, menciónalas brevemente dentro del mensaje de confirmación (ej: "Se creó la orden. Nota: se corrigió el cantón a 'Aserrí'").
- El objetivo es que el usuario envíe UN mensaje con los datos y reciba UNA respuesta con la confirmación de la orden creada. Minimiza los pasos intermedios.
- Si el mensaje del usuario dice "nueva orden", "agregar orden", "crear orden", "deseo agregar" o similar Y contiene datos del cliente/producto EN ESE MISMO MENSAJE, SIEMPRE llama a create_order. Sin excepciones.
- Si una sola orden contiene varios productos, varias lineas o varios SKU, llama a create_order UNA SOLA VEZ usando products: [{ name, sku, quantity }]. NUNCA crees una orden separada por cada SKU del mismo cliente/pedido.
- **CRÍTICO — DATOS FRESCOS**: Si el usuario pide crear una "nueva orden" o "agregar orden" pero NO proporciona datos del cliente/producto en su mensaje actual, SIEMPRE pregunta: "¡Claro! Por favor proporciona los datos de la nueva orden (nombre del cliente, producto, cantidad, precio, dirección si aplica)." NUNCA reutilices datos de órdenes anteriores del historial.
- **PROHIBIDO REUTILIZAR DATOS**: Cada orden es independiente. NUNCA copies nombre, teléfono, producto, dirección ni ningún dato de una orden que ya fue creada exitosamente (marcada con "Orden #... creada exitosamente"). Esos datos son de una orden COMPLETADA y no deben reciclarse para nuevas órdenes.

CAMBIO DE ESTADO DE ÓRDENES:
- **REGLA ABSOLUTA**: NUNCA cambies el estado de una orden a menos que el usuario lo pida EXPLÍCITA y CLARAMENTE (ej: "cambia el estado a Completado", "marca como enviado", "pasar a En Proceso").
- NUNCA cambies el estado como efecto secundario de otra acción. Crear una orden, consultar órdenes, actualizar campos, o cualquier otra operación NO debe disparar un cambio de estado.
- Antes de ejecutar un cambio de estado, confirma con el usuario: "Voy a cambiar el estado de la orden #X de '[estado actual]' a '[nuevo estado]'. ¿Confirmas?"
- Estados válidos: Pendiente, En Proceso, Completado, Enviado, Entregado, Cancelado.

REGLAS DE COMPORTAMIENTO:
- Sé profesional, amable y eficiente. Tu nombre es Betsy.
- Usa un tono cordial pero no excesivamente casual. Evita jerga o bromas.
- Sé concisa en tus respuestas pero completa en la información.
- Usa emojis con moderación (solo para categorizar información).
- Si falta información, pregunta de forma clara y directa.
- Para acciones irreversibles o de estado (eliminar, cambiar estado), siempre pide confirmación explícita.

MANEJO DE ERRORES Y REINTENTOS:
- **CRÍTICO**: Cuando una herramienta falla, SIEMPRE explica el error al usuario y pregunta por la información faltante o incorrecta. NUNCA respondas solo con "Procesando..." o mensajes vagos.
- **NUNCA reintentes automáticamente** una creación de orden que falló anteriormente. Si una orden falló en un mensaje previo, NO la vuelvas a crear a menos que el usuario lo pida explícitamente.
- Si el usuario envía un mensaje casual (como "hola") después de un error, responde normalmente sin reintentar acciones fallidas.
- Cuando falte información para crear una orden, lista claramente qué campos necesitas y espera la respuesta del usuario.

DIFERENCIA ENTRE CAMPOS:
- **paymentMethod** = Método de PAGO del cliente (SINPE Móvil, transferencia, efectivo, etc.)
- **courier / metodoEnvio** = Empresa de MENSAJERÍA o envío (Correos de CR, etc.) - solo aplica para EA
- NUNCA confundas método de pago con método de envío. Son campos completamente diferentes.

FECHAS Y TIEMPOS:
- **CRÍTICO**: Cuando el usuario diga "hoy", usa la FECHA ACTUAL proporcionada arriba.
- "Esta semana" = últimos 7 días desde hoy
- "Este mes" = desde el día 1 del mes actual hasta hoy
- NUNCA uses fechas del 2023 o anteriores. Siempre usa el año actual.

FORMATO DE RESPUESTAS:
- **Órdenes**: Muestra ID, cliente, productos, total, estado y método de entrega (EA/RA)
- **Inventario**: Muestra producto, SKU, stock actual, precio, y alertas de stock bajo
- **Reportes**: Usa tablas o listas claras con totales y resúmenes
- **Estadísticas**: Incluye comparaciones y porcentajes cuando sea relevante
- Usa negritas (**texto**) para datos importantes
- Usa viñetas para listas
- Separa secciones claramente

GUÍAS DE ENVÍO:
- Hay dos modos de generación de guías, AMBOS generan un PDF adjunto:
  - **auto** (por defecto): Genera guía real de Correos de Costa Rica con número de tracking y PDF oficial. Requiere credenciales configuradas en Configuración > Envíos.
  - **manual**: Genera una etiqueta de envío PDF simple con los datos de la orden (sin Correos WS, sin tracking). NO requiere credenciales. Útil cuando no se usa Correos de Costa Rica o las credenciales no están configuradas.
- Usa modo "manual" si el usuario lo pide explícitamente o si las credenciales de Correos no están configuradas y el usuario necesita una guía rápida.
- Para generar guías de varias órdenes a la vez, usa la herramienta generate_guias_bulk con los IDs de las órdenes.
- El PDF se envía directamente al usuario en el chat.
- Confirma el número de guía generado y que el PDF está adjunto.

INTEGRACIÓN CON INVENTARIO AL CREAR ÓRDENES:
- Al crear una orden, el sistema automáticamente busca el producto en el inventario del negocio.
- Si el producto se encuentra y hay stock suficiente, se descuenta automáticamente del inventario. No necesitas hacer nada adicional.
- Si NO se encuentra en inventario, el sistema preguntará al usuario si desea registrar la venta de todas maneras. Transmite esa pregunta al usuario y espera su respuesta.
- Si el producto tiene stock insuficiente o en 0, el sistema preguntará al usuario si desea continuar. Transmite la pregunta al usuario.
- Si hay múltiples productos similares en inventario, el sistema mostrará las opciones. Presenta la lista al usuario y pídele que elija el correcto. Cuando el usuario elija, vuelve a llamar create_order con el nombre EXACTO del producto elegido por el usuario.
- NUNCA inventes o asumas un nombre de producto. Usa el nombre exacto que el usuario proporciona.
- Cuando el usuario confirme que desea proceder sin inventario (respondiendo "sí" o similar), el sistema crea la orden automáticamente. No necesitas hacer nada — el sistema maneja la confirmación internamente.
- **PROHIBIDO**: NUNCA llames a create_order con skipInventoryCheck: true por tu cuenta. El sistema maneja las confirmaciones de inventario automáticamente. Si ves en el historial que una confirmación de inventario quedó pendiente, NO la reintentes — pídele al usuario que lo intente de nuevo.

GESTIÓN DE STOCK:
- Cuando el usuario diga "agregar X al stock de [producto]", actualiza el inventario
- Cuando diga "reducir stock de [producto] en Y", resta del inventario
- Confirma los cambios realizados con el stock anterior y nuevo

CONTRA ENTREGA (Pago al recibir):
- Cuando el usuario mencione "contra entrega", "pago contra entrega", "COD", "paga al recibir", "pagar al recibir", "pago al recibir", "cobrar al entregar", o frases similares, establece contraEntrega: true al crear la orden.
- Si dicen "este pedido es contra entrega" o "la orden es contra entrega", confirma que lo marcas como contra entrega.
- Las órdenes contra entrega significan que el cliente paga al momento de recibir el producto, NO está prepagada.
- Las órdenes contra entrega NO se contabilizan en las estadísticas de ventas hasta que el pago sea confirmado.
- Al confirmar la creación de una orden contra entrega, indica claramente al usuario que la orden fue marcada como contra entrega.

Recuerda: Eres una asistente profesional de ventas. Mantén el enfoque en la eficiencia y precisión.

{{CUSTOM_FIELDS_SECTION}}`;

/**
 * Generate custom fields section for system prompt
 */
async function getCustomFieldsSection(tenantId: string): Promise<string> {
  try {
    const customFieldsConfig = await getTenantCustomFields(tenantId);

    if (customFieldsConfig.productFields.length === 0 && customFieldsConfig.businessInfoFields.length === 0) {
      return '';
    }

    let section = '\n\nCAMPOS PERSONALIZADOS DISPONIBLES:\nCuando crees una orden, DEBES incluir estos campos (especialmente los requeridos).\n';

    if (customFieldsConfig.productFields.length > 0) {
      section += '\n**Campos de Producto:**\n';
      customFieldsConfig.productFields.forEach(field => {
        const required = field.required ? ' (REQUERIDO)' : ' (opcional)';
        let line = '- ' + field.label + ' (key: ' + field.key + ')' + required + ': tipo ' + field.type;
        // Include options for select fields so AI knows valid values
        if ((field.type === 'select' || field.type === 'multiselect') && field.options && field.options.length > 0) {
          const optionValues = field.options.map((o: any) => o.value || o.label).join(', ');
          line += ' — opciones válidas: [' + optionValues + ']';
        }
        section += line + '\n';
      });
    }

    if (customFieldsConfig.businessInfoFields.length > 0) {
      section += '\n**Campos de Información del Negocio:**\n';
      customFieldsConfig.businessInfoFields.forEach(field => {
        const required = field.required ? ' (REQUERIDO)' : ' (opcional)';
        let line = '- ' + field.label + ' (key: ' + field.name + ')' + required + ': tipo ' + field.type;
        // Include options for select fields
        if ((field.type === 'select' || field.type === 'multiselect') && field.options) {
          try {
            const opts = typeof field.options === 'string' ? JSON.parse(field.options) : field.options;
            if (Array.isArray(opts) && opts.length > 0) {
              const optionValues = opts.map((o: any) => typeof o === 'string' ? o : (o.value || o.label)).join(', ');
              line += ' — opciones válidas: [' + optionValues + ']';
            }
          } catch { }
        }
        section += line + '\n';
      });
    }

    section += '\nIMPORTANTE: Siempre pregunta por los valores de los campos requeridos al crear una orden. Para campos de tipo select, usa SOLO los valores de las opciones listadas arriba.';

    return section;
  } catch (error) {
    console.error('[AI Agent] Error generating custom fields section:', error);
    return '';
  }
}

function zodFieldToJsonSchema(zodField: z.ZodTypeAny): any {
  const fieldDef = zodField._def;
  let innerType = zodField;

  if (fieldDef.typeName === 'ZodOptional') {
    innerType = fieldDef.innerType;
  } else if (fieldDef.typeName === 'ZodDefault') {
    innerType = fieldDef.innerType;
    if (innerType._def?.typeName === 'ZodOptional') {
      innerType = innerType._def.innerType;
    }
  }

  const innerDef = innerType._def;
  let fieldSchema: any = { type: 'string' };

  if (innerDef.typeName === 'ZodString' || innerDef.typeName === 'ZodUnion') {
    fieldSchema = { type: 'string' };
  } else if (innerDef.typeName === 'ZodNumber') {
    fieldSchema = { type: 'number' };
  } else if (innerDef.typeName === 'ZodBoolean') {
    fieldSchema = { type: 'boolean' };
  } else if (innerDef.typeName === 'ZodEnum') {
    fieldSchema = { type: 'string', enum: innerDef.values };
  } else if (innerDef.typeName === 'ZodArray') {
    fieldSchema = {
      type: 'array',
      items: zodFieldToJsonSchema(innerDef.type),
    };
  } else if (innerDef.typeName === 'ZodObject') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries((innerType as any).shape)) {
      const child = value as z.ZodTypeAny;
      properties[key] = zodFieldToJsonSchema(child);
      const childType = child._def.typeName;
      if (childType !== 'ZodOptional' && childType !== 'ZodDefault') {
        required.push(key);
      }
    }
    fieldSchema = { type: 'object', properties };
    if (required.length > 0) fieldSchema.required = required;
  }

  if (zodField.description) {
    fieldSchema.description = zodField.description;
  }

  return fieldSchema;
}

// Convert Zod schemas to OpenAI function definitions
function zodToOpenAITool(name: string, schema: { description: string; parameters: z.ZodType<any> }) {
  const zodSchema = schema.parameters;

  // Convert Zod to JSON Schema manually for the fields we use
  const jsonSchema: any = {
    type: 'object',
    properties: {},
    required: [],
  };

  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape;

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodTypeAny;
      const typeName = zodField._def.typeName;
      if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') {
        jsonSchema.required.push(key);
      }
      jsonSchema.properties[key] = zodFieldToJsonSchema(zodField);
    }
  }

  return {
    type: 'function' as const,
    function: {
      name,
      description: schema.description,
      parameters: jsonSchema,
    },
  };
}

// Build tools array from per-request schemas (avoids mutating shared global)
function buildToolsArray(schemas: typeof toolSchemas) {
  return Object.entries(schemas).map(([name, schema]) =>
    zodToOpenAITool(name, schema)
  );
}

/**
 * Process a message and get AI response
 */
export async function processMessage(
  platform: string,
  platformId: string,
  userMessage: string,
  context: ToolContext
): Promise<MessageResponse> {
  // Tracks whether a mutating tool already committed during this turn. If so,
  // and a later step throws, the global catch surfaces the success message
  // instead of a misleading "ocurrió un error" that would contradict reality
  // (the order is already in the DB).
  let mutationSuccessText: string | null = null;
  let mutationSuccessAttachments: ToolAttachment[] | undefined;

  try {
    // Check for pending confirmations first (non-destructive peek)
    const pending = await peekPendingConfirmation(platform, platformId);
    if (pending) {
      if (pending.type === 'order_repair') {
        if (isDenial(userMessage) || isExplicitRejection(userMessage)) {
          console.info('[AI Agent] User rejected pending order_repair — clearing.');
          await clearPendingConfirmation(platform, platformId);
          const text = 'Entendido, descarté esa orden. Cuando quieras crear una nueva, envíame los datos completos.';
          await addAssistantMessage(platform, platformId, text);
          return { text };
        }

        if (isConfirmation(userMessage)) {
          const responseText = 'Para completar la orden necesito el dato faltante. Enviamelo asi: producto: ENERGY PATCH X1';
          await addAssistantMessage(platform, platformId, responseText);
          return { text: responseText };
        }

        // If the user is clearly starting a NEW order (not repairing the
        // pending one), discard the pending and route the new order through
        // the normal flow downstream. We detect this by both the action
        // keywords AND the structured order template signal.
        const incomingStructured = buildStructuredOrderArgs(userMessage);
        if (isActionRequest(userMessage) || incomingStructured) {
          console.info(`[AI Agent] Clearing pending order_repair — user started a new order: "${userMessage.substring(0, 60)}"`);
          await clearPendingConfirmation(platform, platformId);
          // Fall through to normal processing; structured fast-path or LLM will
          // pick up the fresh order data below.
        } else {
          // Otherwise treat ANY remaining message as a repair attempt. This is
          // important: prior versions gated this on `looksLikeOrderFieldReply`,
          // which missed valid corrections like "Provincia San José / Cantón
          // Desamparados / Distrito San Antonio" (no colons) and let them fall
          // through to the LLM, where it would borrow data from history.
          await clearPendingConfirmation(platform, platformId);
          await addUserMessage(platform, platformId, userMessage);

          const repairedArgs = inferCreateOrderArgsFromMessage(pending.data?.toolArgs || {}, userMessage);
          const repairResponse = await executeCreateOrderRepair(repairedArgs, context, platform, platformId);
          return { text: repairResponse };
        }
      }

      if (pending.type === 'order_final_confirm') {
        if (isDenial(userMessage) || isExplicitRejection(userMessage)) {
          console.info('[AI Agent] User rejected pending order_final_confirm.');
          await clearPendingConfirmation(platform, platformId);
          const text = isExplicitRejection(userMessage)
            ? 'Entendido, descarté esa revisión. Envíame de nuevo los datos correctos de la orden y preparo la revisión final.'
            : 'Entendido, orden cancelada antes de crearla.';
          await addAssistantMessage(platform, platformId, text);
          return { text };
        }

        if (isConfirmation(userMessage)) {
          await clearPendingConfirmation(platform, platformId);
          const confirmedPending = {
            ...pending,
            data: {
              ...pending.data,
              toolArgs: {
                ...(pending.data?.toolArgs || {}),
                _finalReviewConfirmed: true,
              },
            },
          };
          const result = await executePendingAction(confirmedPending, context, platform, platformId);
          // Sanitize the history copy of the success message to prevent the
          // LLM from borrowing customer/products/total data on later turns.
          await addAssistantMessage(platform, platformId, sanitizeOrderSuccessForHistory(result));
          return { text: result };
        }

        // If the user is starting a brand-new order rather than correcting the
        // pending one, discard the pending review entirely so old fields don't
        // leak into the new order. Falls through to normal processing, which
        // will pick up the structured fast-path or call the LLM.
        const incomingStructured = buildStructuredOrderArgs(userMessage);
        const looksLikeNewOrder = !!incomingStructured || hasOrderCreationIntent(userMessage);

        if (looksLikeNewOrder) {
          console.info('[AI Agent] 🧹 Discarding pending order_final_confirm — user started a new order');
          await clearPendingConfirmation(platform, platformId);
          // Do NOT return; fall through to normal processing below.
        } else {
          const updatedArgs = inferCreateOrderArgsFromMessage(pending.data?.toolArgs || {}, userMessage);
          await clearPendingConfirmation(platform, platformId);
          return requestCreateOrderFinalConfirmation(updatedArgs, context, platform, platformId);
        }
      }

      const confirmed = isConfirmation(userMessage);
      const denied = isDenial(userMessage);

      if (confirmed) {
        await clearPendingConfirmation(platform, platformId);
        const result = await executePendingAction(pending, context, platform, platformId);
        await addAssistantMessage(platform, platformId, sanitizeOrderSuccessForHistory(result));
        return { text: result };
      } else if (denied) {
        await clearPendingConfirmation(platform, platformId);
        return { text: '✅ Entendido, acción cancelada.' };
      }
      // Not a confirmation/denial — check if this is a new action request
      if (isActionRequest(userMessage)) {
        console.info(`[AI Agent] 🧹 Clearing stale pending confirmation — user started a new action: "${userMessage.substring(0, 60)}"`);
        await clearPendingConfirmation(platform, platformId);
      }
      // Fall through to normal AI processing
    } else if (isConfirmation(userMessage) || isDenial(userMessage)) {
      // The user sent a bare yes/no but there's no pending action. The most
      // common cause is that a final review expired (2 min TTL). We must NOT
      // fall through to the LLM here: history still contains the assistant's
      // review message, and the model might helpfully re-invoke create_order
      // using that stale data. Give the user a clear, friendly stop instead.
      console.warn(`[AI Agent] ⚠️ Yes/No message "${userMessage}" received with no pending confirmation. Likely an expired review. Stopping safely.`);
      const text = isConfirmation(userMessage)
        ? 'No tengo nada pendiente que confirmar en este momento. La revisión anterior caducó. Si querés crear la orden, envíame los datos completos de nuevo y preparo la revisión final.'
        : 'No hay ninguna acción pendiente que cancelar. Si necesitás algo más, decime qué hacemos.';
      await addAssistantMessage(platform, platformId, text);
      return { text };
    }

    // Detect a structured order BEFORE writing to history: when the message
    // is a structured order template, we route it straight into the final
    // review and do NOT persist the raw order data in conversation history.
    // This way, if the pending review expires before the user confirms, the
    // LLM cannot re-create the order from leftover history on the next turn.
    const structuredOrderArgs = buildStructuredOrderArgs(userMessage);
    if (structuredOrderArgs) {
      return executeStructuredCreateOrder(structuredOrderArgs, context, platform, platformId);
    }

    // Non-structured messages go to the LLM, which needs them in history.
    await addUserMessage(platform, platformId, userMessage);

    // Get conversation history
    const history = await getFormattedHistory(platform, platformId);

    // Inject current date and time into system prompt
    const now = new Date();
    const currentDate = now.toLocaleDateString('es-CR', {
      timeZone: STATS_TIME_ZONE,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const currentTime = now.toLocaleTimeString('es-CR', {
      timeZone: STATS_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit'
    });

    // Fetch tenant's custom fields
    const customFieldsSection = await getCustomFieldsSection(context.tenantId);

    // Build per-request tool schemas with tenant-specific custom fields (no global mutation)
    const { tenantToolSchemas } = await updateToolSchemasWithCustomFields(context.tenantId);

    const currentTools = buildToolsArray(tenantToolSchemas);

    const tenantName = context.tenantName || 'Negocio';
    const systemPromptWithDate = SYSTEM_PROMPT
      .replace(/\{\{TENANT_NAME\}\}/g, tenantName)
      .replace('{{CURRENT_DATE}}', currentDate)
      .replace('{{CURRENT_TIME}}', currentTime)
      .replace('{{CUSTOM_FIELDS_SECTION}}', customFieldsSection);

    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptWithDate },
      ...history.slice(-20),
    ];

    // Detect if this is an action request that should require tool execution
    const requiresToolCall = isActionRequest(userMessage);

    if (requiresToolCall) {
      console.log('[AI Agent] 🔧 Action request detected, forcing tool_choice: required');
    }

    // Call xAI with dynamic tool_choice
    const response = await xai.chat.completions.create({
      model: MODEL,
      messages,
      tools: currentTools,
      tool_choice: requiresToolCall ? 'required' : 'auto',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      reasoning_effort: REASONING_EFFORT,
    });

    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error('No response from AI');
    }

    // SECURITY CHECK: Detect when AI should have called a tool but didn't
    if (requiresToolCall && (!message.tool_calls || message.tool_calls.length === 0)) {
      console.warn('[AI Agent] ⚠️ ACTION REQUEST BUT NO TOOL CALLS!');
      console.warn('[AI Agent] User message:', userMessage);
      console.warn('[AI Agent] AI response (text only):', message.content?.slice(0, 300));

      const safeResponse = `Para ejecutar esta acción, necesito más información. Por favor proporciona en un solo mensaje:

📦 **Para crear orden:**
• Nombre del cliente
• Producto y cantidad
• Precio total
• Dirección de entrega (si es envío)

📊 **Para otras acciones:**
• ID de la orden o producto
• Detalles específicos de lo que deseas hacer

¿Puedes proporcionar estos datos?`;

      await addAssistantMessage(platform, platformId, safeResponse);
      return { text: safeResponse };
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolResults: string[] = [];
      const toolCallsLog: any[] = [];
      const allAttachments: ToolAttachment[] = [];
      const preparedToolCalls = mergeCreateOrderCalls(message.tool_calls.map((toolCall) => {
        const toolName = toolCall.function.name as ToolName;
        let toolArgs: any;

        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          toolArgs = {};
        }

        const guardedArgs = applyRelativeDateGuards(toolName, toolArgs, userMessage);

        return {
          id: toolCall.id,
          name: toolName,
          args: toolName === 'create_order'
            ? inferCreateOrderArgsFromMessage(guardedArgs, userMessage)
            : guardedArgs,
          original: toolCall,
        };
      }));

      const createOrderCalls = preparedToolCalls.filter((toolCall) =>
        toolCall.name === 'create_order' && !toolCall.args?._finalReviewConfirmed
      );

      if (createOrderCalls.length >= 1) {
        // Evict the user message we just added — order data should not linger
        // in conversation history while we wait for the user to confirm the
        // review. If the pending review later expires, the LLM won't be able
        // to re-create the order from leftover history.
        await removeLastUserMessage(platform, platformId);

        if (createOrderCalls.length === 1) {
          console.log('[AI Agent] create_order requires final user review before execution');
          return requestCreateOrderFinalConfirmation(createOrderCalls[0].args, context, platform, platformId);
        }

        // Multiple distinct orders detected — mergeCreateOrderCalls already
        // collapsed same-identity duplicates, so anything left here is a
        // different customer/order. Present all of them and start the review
        // of the first; ask the user to send the others afterwards.
        console.warn(`[AI Agent] Multiple distinct create_order calls detected (${createOrderCalls.length}). Asking user to confirm one by one.`);

        const summaries = createOrderCalls.map((call, idx) => {
          const a = call.args as any;
          const parts: string[] = [`${idx + 1}. ${a.customerName || 'Cliente sin nombre'}`];
          if (a.phone) parts.push(`(${a.phone})`);
          if (a.total !== undefined && a.total !== null) parts.push(`— ${formatCrcAmount(a.total)}`);
          return parts.join(' ');
        });

        const firstReview = await requestCreateOrderFinalConfirmation(
          createOrderCalls[0].args, context, platform, platformId,
        );

        const headerText = [
          `Detecté ${createOrderCalls.length} pedidos diferentes en tu mensaje. Vamos uno a la vez para no equivocarnos.`,
          '',
          'Pedidos detectados:',
          ...summaries,
          '',
          'Cuando terminemos con el primero, envíame los datos del siguiente.',
          '',
          '— — — Primer pedido — — —',
          '',
        ].join('\n');

        return {
          text: headerText + firstReview.text,
          attachments: firstReview.attachments,
        };
      }

      for (const toolCall of preparedToolCalls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args;

        console.log('[AI Agent] Executing tool: ' + toolName, redactToolArgsForLog(toolName, toolArgs));

        const result = await executeTool(toolName as ToolName, context, toolArgs, tenantToolSchemas);

        console.log('[AI Agent] executeTool result:', {
          success: result.success,
          hasData: !!result.data,
          orderId: (result.data as any)?.orderId,
          error: result.error,
          needsConfirmation: result.needsConfirmation,
        });

        if (result.success) {
          console.log(`[AI Agent] ✅ Tool ${toolName} executed successfully`);
          if (result.data && typeof result.data === 'object' && 'orderId' in result.data) {
            console.log(`[AI Agent] 📦 Order created with ID: ${(result.data as any).orderId}`);
          }
        } else if (result.needsConfirmation) {
          console.log(`[AI Agent] 🔄 Tool ${toolName} needs confirmation: ${result.confirmationType}`);
        } else {
          console.error(`[AI Agent] ❌ Tool ${toolName} failed:`, result.error);
        }

        // Handle inventory confirmation flow for create_order
        if (result.needsConfirmation && toolName === 'create_order') {
          const cType = result.confirmationType;
          console.log(`[AI Agent] 🔄 Inventory confirmation needed: ${cType}`);

          if (cType === 'no_match' || cType === 'zero_stock') {
            await setPendingConfirmation(platform, platformId, {
              type: 'inventory_confirm',
              data: {
                toolName: 'create_order',
                toolArgs: { ...result.pendingOrderData, _forceWithoutInventory: true },
              },
              expiresAt: Date.now() + 120_000,
            });
          }
          // For 'multiple_matches' we do NOT store a pending confirmation;
          // the AI will present options and the user picks one, triggering
          // a new create_order call with a more specific product name.
        }

        // Collect attachments (PDFs etc.) from tool results
        if (result.attachments && result.attachments.length > 0) {
          allAttachments.push(...result.attachments);
        }

        toolCallsLog.push({
          name: toolName,
          args: toolArgs,
          result: result.success ? 'success' : (result.needsConfirmation ? 'needs_confirmation' : 'error'),
        });

        if (result.success) {
          // Wrap the formatter so a downstream rendering bug (malformed data,
          // missing field, etc.) cannot mask a successful mutation — the order
          // was already committed by executeTool above.
          let formatted: string;
          try {
            formatted = formatToolResult(toolName, result, platform);
          } catch (formatError) {
            console.error(`[AI Agent] formatToolResult threw for ${toolName} after success:`, formatError);
            formatted = result.message || '✅ Operación completada.';
          }

          if (toolName === 'validate_order_location' && hasOrderCreationIntent(userMessage)) {
            console.warn('[AI Agent] ⚠️ GUARDRAIL: validate_order_location called but user wanted to create an order');
            formatted += '\n\n⚠️ NOTA DEL SISTEMA: El usuario pidió CREAR una orden, no solo validar la ubicación. La ubicación ya fue validada. Responde al usuario diciéndole que para crear la orden necesitas que la envíe de nuevo o confirme, ya que la herramienta create_order no fue llamada en este turno. Discúlpate brevemente por la confusión.';
          }

          toolResults.push(formatted);
        } else if (result.needsConfirmation && result.message) {
          toolResults.push(result.message);
        } else {
          if (toolName === 'create_order' && shouldStoreCreateOrderRepair(result)) {
            await setPendingConfirmation(platform, platformId, {
              type: 'order_repair',
              data: {
                toolName: 'create_order',
                toolArgs,
              },
              expiresAt: Date.now() + 120_000,
            });
          }
          toolResults.push(formatToolError(toolName, result));
        }
      }

      if (toolCallsLog.some((call) => isMutatingTool(call.name))) {
        const directResponse = toolResults.join('\n\n') || 'Operacion procesada.';
        const attachments = allAttachments.length > 0 ? allAttachments : undefined;
        // Persist a SANITIZED version of the success message to history so the
        // LLM cannot borrow customer/product/total data from a previously
        // created order on later turns. The user still sees the full detailed
        // message in the chat reply.
        const historyText = sanitizeOrderSuccessForHistory(directResponse);
        try {
          await addAssistantMessage(platform, platformId, historyText);
        } catch (e) {
          console.error('[AI Agent] addAssistantMessage failed after mutation tool success:', e);
        }
        // Track success so the outer try/catch can surface it instead of a
        // generic error if something later in this turn throws.
        mutationSuccessText = directResponse;
        mutationSuccessAttachments = attachments;
        return { text: directResponse, attachments };
      }

      const inventoryLookupOnly = toolCallsLog.length > 0
        && toolCallsLog.every((call) => call.name === 'get_inventory_item' || call.name === 'search_inventory')
        && !hasOrderCreationIntent(userMessage);

      if (inventoryLookupOnly) {
        const directResponse = toolResults.join('\n\n') || 'No encontre productos con esos criterios.';
        await addAssistantMessage(platform, platformId, directResponse);
        return { text: directResponse };
      }

      // Get a natural language response about the tool results
      const followUpMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: message.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: tc.function,
          })),
        },
        {
          role: 'tool',
          content: toolResults.join('\n\n'),
          tool_call_id: message.tool_calls[0]?.id || '',
        },
      ];

      const followUpResponse = await xai.chat.completions.create({
        model: MODEL,
        messages: followUpMessages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        reasoning_effort: REASONING_EFFORT,
      });

      const finalMessage = followUpResponse.choices[0]?.message?.content;

      if (finalMessage) {
        await addAssistantMessage(platform, platformId, finalMessage);
        return { text: finalMessage, attachments: allAttachments.length > 0 ? allAttachments : undefined };
      }

      const fallback = toolResults.join('\n\n') || 'No pude generar una respuesta. Por favor intenta de nuevo.';
      await addAssistantMessage(platform, platformId, fallback);
      return { text: fallback, attachments: allAttachments.length > 0 ? allAttachments : undefined };
    }

    // No tool calls, just return the AI response
    if (message.content) {
      await addAssistantMessage(platform, platformId, message.content);
      return { text: message.content };
    }

    return { text: 'Lo siento, no pude procesar tu solicitud.' };

  } catch (error) {
    console.error('[AI Agent] Error processing message:', error);
    if (mutationSuccessText) {
      console.warn('[AI Agent] Surfacing mutation success despite later error in turn.');
      return { text: mutationSuccessText, attachments: mutationSuccessAttachments };
    }
    return { text: 'Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta de nuevo.' };
  }
}

/**
 * Format tool results for display, using platform-appropriate formatting.
 * Telegram uses HTML tags; WhatsApp uses markdown-style (*bold*).
 */
function formatToolResult(toolName: ToolName, result: ToolResult, platform: string): string {
  if (!result.success) {
    return result.error || 'Error desconocido';
  }

  const formatOrder = platform === 'whatsapp' ? formatOrderForWhatsApp : formatOrderForTelegram;
  const formatInventory = platform === 'whatsapp' ? formatInventoryForWhatsApp : formatInventoryForTelegram;
  const formatStats = platform === 'whatsapp' ? formatStatsForWhatsApp : formatStatsForTelegram;

  switch (toolName) {
    case 'get_orders':
      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data
          .map((order: any) =>
            `📦 #${order.orderId} - ${order.customerName}\n   ${order.product} | ₡${(order.total || 0).toLocaleString('es-CR')} | ${order.status}`
          )
          .join('\n\n');
      }
      return 'No se encontraron órdenes con esos criterios.';

    case 'get_order_details':
      if (result.data) {
        const orderData = result.data as any;
        const cfLines: string[] = orderData._customFieldLines || [];
        return formatOrder(orderData, cfLines.length > 0 ? cfLines : undefined);
      }
      return 'Orden no encontrada.';

    case 'create_order':
      if (result.data) {
        return result.message || `✅ Orden creada: #${(result.data as any).orderId}`;
      }
      return 'Error al crear la orden.';

    case 'update_order':
    case 'update_order_status':
      return result.message || '✅ Orden actualizada.';

    case 'get_inventory_item':
      if (result.data) {
        return formatInventory(result.data);
      }
      return 'Producto no encontrado.'; // Changed this line

    case 'search_inventory':
      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data
          .map((item: any) =>
            `📦 ${item.name} (${item.sku})\n   Stock: ${item.currentStock} | ₡${(item.sellingPrice || 0).toLocaleString('es-CR')}`
          )
          .join('\n\n');
      }
      // Empty data with a message means the tool intentionally summarized
      // (e.g. large-catalog guard) — relay that instead of a generic miss.
      if (result.message) return result.message;
      return 'No se encontraron productos.'; // Changed this line

    case 'get_statistics_summary':
      if (result.data) {
        const stats = result.data as any;
        let response = formatStats(stats);

        if (stats.customFields && Object.keys(stats.customFields).length > 0) {
          response += '\n\n**Campos Personalizados:**\n';
          for (const [key, value] of Object.entries(stats.customFields)) {
            response += `• ${key}: ${value}\n`;
          }
        }

        return response;
      }
      return 'No hay estadísticas disponibles.';

    case 'generate_shipping_guia':
      if (result.data) {
        return result.message || '✅ Guía de envío generada correctamente.';
      }
      return 'Error al generar la guía de envío.';

    case 'generate_guias_bulk':
      return result.message || '✅ Guías generadas.';

    default:
      return result.message || 'Operación completada.';
  }
}

function formatToolError(toolName: ToolName, result: ToolResult): string {
  const error = result.error || 'No pude completar la operacion.';

  // Friendly handling for Zod-style validation errors on ANY tool. The raw
  // executeTool message looks like:
  //   "Parametros invalidos:\n- updates.total: Expected number, received string\n- ..."
  // We strip the developer jargon and present the field issues in plain Spanish.
  if (/Par[aá]metros inv[aá]lidos/i.test(error)) {
    const issueLines = error
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

    if (issueLines.length > 0) {
      return [
        'Faltan o son inválidos algunos datos:',
        ...issueLines.map((line) => `- ${line}`),
        '',
        'Envíame los datos correctos y vuelvo a procesar.',
      ].join('\n');
    }
  }

  if (toolName === 'create_order') {
    if (/producto es requerido/i.test(error)) {
      return [
        'No pude identificar el producto de la orden.',
        '',
        'Enviame el producto en una linea clara, por ejemplo:',
        'producto: ENERGY PATCH X1',
        '',
        'Cuando lo reciba, si no aparece en inventario te preguntare si deseas registrar la venta de todas maneras.',
      ].join('\n');
    }

    if (/campos faltantes|campos personalizados faltantes/i.test(error)) {
      return error
        .replace(/^❌\s*/i, '')
        .replace(/^Error:\s*/i, '')
        + '\n\nEnviame solo los datos faltantes y vuelvo a procesar la orden.';
    }
  }

  // Generic friendly fallback: strip the technical prefixes the executor adds.
  const cleaned = error.replace(/^❌\s*/i, '').replace(/^Error:\s*/i, '').trim();
  return cleaned || 'No pude completar la operación. Por favor inténtalo de nuevo.';
}

/**
 * Strict tokens accepted as confirmation. Single-letter or ambiguous words
 * ("y", "ok", "continuar", "proceder") are intentionally excluded — they
 * appear too often inside normal conversation and have caused false-positive
 * order submissions.
 */
const CONFIRMATION_TOKENS = new Set([
  'si', 'sip', 'sii', 'yes', 'yep', 'yeah',
  'confirmar', 'confirmo', 'confirmado', 'confirmada',
  'aceptar', 'acepto', 'aceptado', 'aceptada',
  'dale', 'listo', 'correcto',
]);

const DENIAL_TOKENS = new Set([
  'no', 'nop', 'nope', 'nel',
  'cancelar', 'cancela', 'cancelo', 'cancelado', 'cancelada',
  'anular', 'anulo', 'anulado', 'anulada',
  'rechazar', 'rechazo', 'rechazado',
]);

/**
 * Normalize a short reply for confirmation matching: lowercase, strip
 * accents, trim surrounding punctuation/symbols/whitespace. Returns the
 * cleaned token. Multi-word messages will not match the strict sets, which
 * is intentional.
 */
function normalizeYesNoMessage(message: string): string {
  return message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
}

/**
 * Check if message is a confirmation. Strict: only short single-token
 * affirmations after normalization (max 16 chars).
 */
function isConfirmation(message: string): boolean {
  const normalized = normalizeYesNoMessage(message);
  if (normalized.length === 0 || normalized.length > 16) return false;
  return CONFIRMATION_TOKENS.has(normalized);
}

/**
 * Check if message is a denial. Strict: only short single-token negations
 * after normalization (max 16 chars).
 */
function isDenial(message: string): boolean {
  const normalized = normalizeYesNoMessage(message);
  if (normalized.length === 0 || normalized.length > 16) return false;
  return DENIAL_TOKENS.has(normalized);
}

async function executeCreateOrderRepair(
  toolArgs: any,
  context: ToolContext,
  platform: string,
  platformId: string,
): Promise<string> {
  const response = await requestCreateOrderFinalConfirmation(toolArgs, context, platform, platformId);
  return response.text;
}

/**
 * Execute a pending action.
 * Pending confirmations are stored as { type, data: { toolName, toolArgs }, expiresAt }.
 */
async function executePendingAction(pending: any, context: ToolContext, platform: string, platformId: string): Promise<string> {
  try {
    const toolName = pending.data?.toolName || pending.toolName;
    const toolArgs = pending.data?.toolArgs || pending.toolArgs;

    if (!toolName) {
      console.error('[AI Agent] executePendingAction - No toolName in pending data');
      return '❌ Error: acción pendiente inválida.';
    }

    console.log('[AI Agent] executePendingAction:', {
      toolName,
      tenantId: context.tenantId,
      toolArgsKeys: toolArgs ? Object.keys(toolArgs) : [],
      hasForceFlag: !!(toolArgs as any)?._forceWithoutInventory,
    });

    const { tenantToolSchemas } = await updateToolSchemasWithCustomFields(context.tenantId);
    const result = await executeTool(toolName as ToolName, context, toolArgs, tenantToolSchemas);

    console.log('[AI Agent] executePendingAction result:', {
      success: result.success,
      hasData: !!result.data,
      orderId: (result.data as any)?.orderId,
      error: result.error,
      needsConfirmation: result.needsConfirmation,
    });

    if (result.success) {
      // Protect against any rendering bug after a successful commit. The tool
      // already mutated state (e.g. an order was created); we must NEVER
      // surface a generic "error" message in that case.
      let formatted: string;
      try {
        formatted = formatToolResult(toolName as ToolName, result, platform);
      } catch (formatError) {
        console.error(`[AI Agent] formatToolResult threw for ${toolName} in executePendingAction:`, formatError);
        formatted = result.message || '✅ Operación completada con éxito.';
      }
      return '✅ Acción confirmada:\n\n' + formatted;
    }

    if (result.needsConfirmation && result.message) {
      const cType = result.confirmationType;
      if (toolName === 'create_order' && (cType === 'no_match' || cType === 'zero_stock')) {
        await setPendingConfirmation(platform, platformId, {
          type: 'inventory_confirm',
          data: {
            toolName: 'create_order',
            toolArgs: {
              ...result.pendingOrderData,
              _forceWithoutInventory: true,
              _finalReviewConfirmed: true,
            },
          },
          expiresAt: Date.now() + 120_000,
        });
      }
      return result.message;
    }

    if (toolName === 'create_order' && shouldStoreCreateOrderRepair(result)) {
      await setPendingConfirmation(platform, platformId, {
        type: 'order_repair',
        data: {
          toolName: 'create_order',
          toolArgs,
        },
        expiresAt: Date.now() + 120_000,
      });
    }

    return formatToolError(toolName as ToolName, result);
  } catch (error) {
    console.error('[AI Agent] Error executing pending action:', error);
    return '❌ Error al ejecutar la acción solicitada.';
  }
}

/**
 * Generate welcome message for new users
 */
export function generateWelcomeMessage(): string {
  return `👋 <b>¡Bienvenido a Betsy AI Assistant!</b>

Soy tu asistente inteligente para gestionar tu negocio.

<b>¿Qué puedo hacer por ti?</b>
• 📦 Crear y gestionar órdenes
• 📊 Consultar inventario
• 📈 Ver estadísticas de ventas
• 🚚 Generar guías de envío
• 👥 Buscar clientes

Escribe cualquier consulta en lenguaje natural y te ayudaré.

Usa /help para ver todos los comandos disponibles.`;
}

/**
 * Generate message for unauthorized users
 */
export function generateUnauthorizedMessage(): string {
  return `⚠️ <b>No estás conectado a Betsy</b>

Para usar este bot, necesitas conectar tu cuenta.

<b>¿Cómo conectarse?</b>
1. Pide a tu administrador el código de acceso de 12 caracteres
2. Envía: <code>/start CODIGO123ABC</code>

<b>¿Eres administrador?</b>
Encuentra tu código en: https://www.betsycrm.com/config/ai-assistant`;
}
