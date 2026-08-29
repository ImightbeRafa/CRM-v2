/**
 * Betsy AI Agent
 *
 * The main AI agent that processes user messages, decides which tools to use,
 * and generates natural Spanish responses. Uses xAI Grok via the Responses API.
 *
 * xAI is OpenAI-compatible (OpenAI SDK + https://api.x.ai/v1). Chat Completions
 * is legacy. Requests use store:false; tool follow-ups replay encrypted
 * reasoning + function_call_output in-process (no previous_response_id).
 */

import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
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
import {
  buildPromptCacheKey,
  buildToolFollowUpInput,
  buildXaiResponseBody,
  parseResponseFunctionCalls,
  parseResponseText,
  toFunctionCallOutputs,
  toResponsesInputMessages,
  type NormalizedFunctionCall,
  type ResponsesFunctionTool,
} from './xai-responses';

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
  type ConversationMessage,
} from './conversation-memory';
import { formatOrderForTelegram, formatInventoryForTelegram, formatStatsForTelegram } from './telegram';
import { formatOrderForWhatsApp, formatInventoryForWhatsApp, formatStatsForWhatsApp } from './whatsapp';
import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import {
  formatCustomFieldsForTelegram,
  extractCustomFields,
  validateCustomFields,
  type CustomFieldsData,
} from '@/lib/customFields';
import { getTenantCustomFields } from '@/lib/customFields-server';
import { getCurrentStatsDateKey, STATS_TIME_ZONE } from '@/lib/statistics-dates';
import { normalizeLocationForOrderCapture } from '@/lib/locationValidator';

const XAI_TIMEOUT_MS = Number(process.env.XAI_TIMEOUT_MS || 15_000);
const XAI_EXTRACTION_TIMEOUT_MS = Number(process.env.XAI_EXTRACTION_TIMEOUT_MS || 10_000);
const XAI_MAX_RETRIES = Number(process.env.XAI_MAX_RETRIES || 0);
const XAI_EXTRACTION_REASONING_EFFORT: 'low' | 'medium' | 'high' = (() => {
  const raw = (process.env.XAI_EXTRACTION_REASONING_EFFORT || 'low').toLowerCase();
  if (raw === 'medium' || raw === 'high') return raw;
  return 'low';
})();

// xAI client (OpenAI-compatible API)
const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
  timeout: XAI_TIMEOUT_MS,
  // The SDK retries timeouts by default. For WhatsApp webhooks that turns a
  // 15s timeout into ~45-50s. Keep retries explicit and bounded.
  maxRetries: XAI_MAX_RETRIES,
});

// Model configuration
// IMPORTANT: For deterministic tool-calling, keep TEMPERATURE low (0.0-0.2).
// REASONING_EFFORT defaults to low for WhatsApp latency (15s timeout).
// grok-4.6 defaults to high if omitted — do not drop this field.
// MAX_TOKENS must be large enough to fit multi-product tool-call JSON.
const MODEL = process.env.XAI_MODEL || 'grok-4.6';
const MAX_TOKENS = Number(process.env.XAI_MAX_TOKENS || 2000);
const TEMPERATURE = (() => {
  const raw = process.env.XAI_TEMPERATURE;
  if (raw === undefined || raw === '') return 0.1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0.1;
})();
const REASONING_EFFORT: 'low' | 'medium' | 'high' = (() => {
  const raw = (process.env.XAI_REASONING_EFFORT || 'low').toLowerCase();
  if (raw === 'medium' || raw === 'high') return raw;
  return 'low';
})();

// Avoid top-level console noise during `next build` page-data collection.
if (process.env.NEXT_PHASE !== 'phase-production-build') {
  console.log('[AI Agent] xAI model config:', {
    model: MODEL,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    reasoningEffort: REASONING_EFFORT,
    extractionReasoningEffort: XAI_EXTRACTION_REASONING_EFFORT,
    timeoutMs: XAI_TIMEOUT_MS,
    extractionTimeoutMs: XAI_EXTRACTION_TIMEOUT_MS,
    maxRetries: XAI_MAX_RETRIES,
    api: 'responses',
  });
}

async function createXaiResponse(
  args: Omit<Parameters<typeof buildXaiResponseBody>[0], 'model'> & { model?: string },
  requestOptions?: { timeout?: number; maxRetries?: number },
): Promise<OpenAI.Responses.Response> {
  const startedAt = Date.now();
  const body = buildXaiResponseBody({
    ...args,
    model: args.model || MODEL,
  });

  const response = await xai.responses.create(
    body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
    {
      ...(requestOptions?.timeout ? { timeout: requestOptions.timeout } : {}),
      maxRetries: requestOptions?.maxRetries ?? 0,
    },
  );

  console.info('[AI Agent] xAI responses call', {
    elapsedMs: Date.now() - startedAt,
    store: body.store,
    hasTools: Boolean(body.tools?.length),
    toolChoice: body.tool_choice || 'none',
    inputTokens: response.usage?.input_tokens,
    cachedTokens: response.usage?.input_tokens_details?.cached_tokens,
    outputTokens: response.usage?.output_tokens,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
  });

  return response;
}

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
  'reconoces este codigo', 'reconoce este codigo', 'reconoces este código',
  'reconoce este código', 'buscar codigo', 'buscar código',
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
  'registrar orden', 'registrar pedido',
  'hacer orden', 'hacer pedido', 'recrear orden', 'recrear pedido',
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
  'generate_invoice',
]);

function hasConfirmedInvoiceIntent(message: string) {
  const normalized = normalizeSpanishText(message);
  return /\b(genera|generar|crea|crear|confirma|confirmo)\b/.test(normalized)
    && /\b(factura|invoice)\b/.test(normalized);
}

function hasConfirmedInvoiceEmailIntent(message: string) {
  const normalized = normalizeSpanishText(message);
  return hasConfirmedInvoiceIntent(message)
    && /\b(email|correo|envia|enviar|manda|mandar)\b/.test(normalized);
}

function isMutatingTool(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName as ToolName);
}

const SENSITIVE_TOOL_LOG_KEY = /(customer|client|phone|email|address|comment|note|name|query|search|message|text|code)/i;

function redactToolArgsForLog(_toolName: string, toolArgs: unknown, key = ''): unknown {
  if (SENSITIVE_TOOL_LOG_KEY.test(key)) return '[redacted]';
  if (Array.isArray(toolArgs)) return toolArgs.map(item => redactToolArgsForLog(_toolName, item));
  if (toolArgs && typeof toolArgs === 'object') {
    return Object.fromEntries(
      Object.entries(toolArgs as Record<string, unknown>)
        .map(([nestedKey, value]) => [nestedKey, redactToolArgsForLog(_toolName, value, nestedKey)]),
    );
  }
  return toolArgs;
}

type PreparedToolCall = {
  id: string;
  name: ToolName;
  args: any;
  original: NormalizedFunctionCall;
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
  '_locationReviewWarning',
  '_locationCaptureAction',
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

/**
 * Map raw "missing field" error strings (from getCreateOrderReviewMissingFields
 * and validateCustomFields) into natural Spanish phrases the bot can stitch
 * into a single conversational question. Replaces the old templated bullet
 * list which read like a form rather than a chat.
 */
function buildConversationalMissingFieldsAsk(missing: string[]): string {
  if (!missing || missing.length === 0) return '¿Me podés enviar los datos que faltan?';

  const articleMap: Record<string, string> = {
    'Nombre del cliente': 'el nombre del cliente',
    'Telefono': 'el teléfono',
    'Teléfono': 'el teléfono',
    'Producto(s)': 'el producto',
    'Total': 'el total',
    'Tipo de orden (EA o RA)': 'el tipo de orden (EA para envío o RA para retiro)',
    'Tipo de orden': 'el tipo de orden (EA o RA)',
    'Direccion': 'la dirección',
    'Dirección': 'la dirección',
    'Direccion o ubicacion': 'la dirección o ubicación de entrega',
    'Dirección o ubicación': 'la dirección o ubicación de entrega',
    'Provincia': 'la provincia',
    'Canton': 'el cantón',
    'Cantón': 'el cantón',
    'Distrito': 'el distrito',
  };

  const friendly: string[] = missing.map((entry) => {
    const customMatch = entry.match(/^El campo "([^"]+)"\s+es\s+requerido/i);
    if (customMatch) return `el campo "${customMatch[1]}"`;
    if (articleMap[entry]) return articleMap[entry];
    // Strip a trailing parenthetical hint like "(EA o RA)" to reuse map.
    const stripped = entry.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (articleMap[stripped]) return articleMap[stripped];
    return entry.toLowerCase();
  });

  const join = (parts: string[]): string => {
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} y ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
  };

  if (friendly.length === 1) {
    return `Solo me falta ${friendly[0]}. ¿Me lo podés indicar?`;
  }
  return `Me falta ${join(friendly)}. ¿Me los podés enviar?`;
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
    const hasDeliveryDetail = [args.address, args.province, args.canton, args.district]
      .some((value) => typeof value === 'string' && value.trim() !== '');
    if (!hasDeliveryDetail) missing.push('Direccion o ubicacion');
  }

  return missing;
}

/**
 * Render the order data we've already captured as human-readable lines.
 * Used by the order_repair message so the user can confirm we didn't lose
 * the rest of their order while they fill in what's missing.
 *
 * Only emits a line when the field has a real value. Custom fields are
 * appended last so tenant-specific data shows up in the summary too.
 */
function getCreateOrderReviewCapturedFields(
  args: any,
  customFieldsConfig?: CustomFieldsData,
): string[] {
  const lines: string[] = [];

  if (args.customerName) lines.push(`Cliente: ${formatReviewValue(args.customerName)}`);
  if (args.phone) lines.push(`Telefono: ${formatReviewValue(args.phone)}`);
  if (args.email) lines.push(`Email: ${formatReviewValue(args.email)}`);

  const productLines = getCreateOrderReviewProductLines(args);
  if (productLines.length > 0) {
    if (productLines.length === 1) {
      lines.push(`Producto(s): ${productLines[0]}`);
    } else {
      lines.push('Producto(s):');
      for (const line of productLines) lines.push(`  - ${line}`);
    }
  }

  if (args.total !== undefined && args.total !== null && args.total !== '' && Number.isFinite(Number(args.total))) {
    lines.push(`Total: ${formatCrcAmount(args.total)}`);
  }
  if (args.orderType) lines.push(`Tipo de orden: ${formatReviewValue(args.orderType)}`);
  if (args.paymentMethod) lines.push(`Metodo de pago: ${formatReviewValue(args.paymentMethod)}`);

  const courier = args.courier || args.metodoEnvio || args.shippingMethod || args.mensajeria;
  if (courier) lines.push(`Metodo de envio: ${formatReviewValue(courier)}`);

  if (args.province) lines.push(`Provincia: ${formatReviewValue(args.province)}`);
  if (args.canton) lines.push(`Canton: ${formatReviewValue(args.canton)}`);
  if (args.district) lines.push(`Distrito: ${formatReviewValue(args.district)}`);
  if (args.address) lines.push(`Direccion: ${formatReviewValue(args.address)}`);
  if (args.comments) lines.push(`Comentarios: ${formatReviewValue(args.comments)}`);
  if (args.contraEntrega === true) lines.push('Contra entrega: Si');

  // Tenant-configured custom fields, if any made it through the parser.
  if (customFieldsConfig) {
    try {
      const extracted = extractCustomFields(args, customFieldsConfig);
      const extra = formatCustomFieldsForTelegram(extracted, customFieldsConfig)
        .map((line) => line.replace(/\*/g, '').trim())
        .filter(Boolean);
      for (const line of extra) lines.push(line);
    } catch (error) {
      console.warn('[AI Agent] Failed to format captured custom fields:', error);
    }
  }

  return lines;
}

function getCreateOrderReviewProductLines(args: any): string[] {
  const products = orderProductsFromArgs(args);
  if (products.length === 0 && typeof args.product === 'string' && args.product.trim()) {
    return [args.product.trim()];
  }

  return products.map((product) => {
    // Strip a trailing "xN" / "(N)" from the name if it's already there.
    // Real failure case the regex path used to produce: the parsed product
    // text was "dopamine patch x2" AND args.quantity was 2 too, so the
    // review printed "dopamine patch x2 x2". Be tolerant on both sides:
    // accept whichever quantity is highest, and never repeat the suffix.
    const cleanName = (product.name || '')
      .replace(/\s*[x×]\s*\d+\s*$/i, '')
      .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
      .trim();
    const nameWithSku = [cleanName, product.sku ? `(SKU: ${product.sku})` : ''].filter(Boolean).join(' ');
    return `${nameWithSku || 'Producto'} x${product.quantity}`;
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
    if (args._locationReviewWarning) {
      lines.push(`Nota ubicacion: ${formatReviewValue(args._locationReviewWarning)}`);
    }
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
  args = stripOrderExtractionMetadata(args);

  const customFieldsConfig = await getTenantCustomFields(context.tenantId);

  // Canonicalize province/canton/district to the spellings stored in the DB
  // BEFORE we render the review or report missing fields. Without this, a
  // user who typed "Sanjose, Alajuelita, Sanjosecito" would see exactly
  // those raw strings echoed back, even though the validator can correct
  // them to "San José, Alajuelita, San Josecito".
  applyOrderCaptureLocationNormalization(args);

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

    const captured = getCreateOrderReviewCapturedFields(args, customFieldsConfig);
    const conversationalAsk = buildConversationalMissingFieldsAsk(missing);

    const textLines: string[] = [];

    if (captured.length > 0) {
      textLines.push(
        'Casi todo listo. Ya tengo:',
        '',
        ...captured.map((line) => `- ${line}`),
        '',
        conversationalAsk,
      );
    } else {
      textLines.push(conversationalAsk);
    }

    return { text: textLines.join('\n') };
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

// Mechanical email cleanup only. This must not infer order meaning.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function isTemplatePlaceholderValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^["']?\s*e\.?\s*g\.?\b/i.test(trimmed)) return true;
  if (/^["']?\s*ej\.?\s*[:.]/i.test(trimmed)) return true;
  if (/^["']?\s*ejemplo\s*[:.]/i.test(trimmed)) return true;
  if (/^\(opcional\)$/i.test(trimmed)) return true;
  if (/^\(optional\)$/i.test(trimmed)) return true;
  if (/^<[^>]*>$/.test(trimmed)) return true;
  if (/^\[[^\]]*\]$/.test(trimmed)) return true;
  // Common literal placeholders from order templates we ourselves shipped.
  if (/^(tu|su)\s+(nombre|correo|email|telefono|tel[eé]fono|direcci[oó]n)\b/i.test(trimmed)) return true;
  // Template choice lines like `"EA" o "RA"` / `"EA" o "envío a domicilio"`.
  if (/^["']?\s*(ea|ra)\s*["']?\s*o\s*["']?\s*(ea|ra|envio|retiro)/i.test(trimmed)) return true;
  return false;
}

/**
 * Build a compact, prompt-friendly description of the tenant's custom-field
 * schema so the AI extractor knows which keys to populate inside
 * `customFields` and how to interpret each label.
 */
function describeCustomFieldsForAIExtraction(customFieldsConfig: CustomFieldsData | undefined): string {
  if (!customFieldsConfig) return '';
  const all: Array<{ key: string; label: string; type?: string; required?: boolean; options?: string[] }> = [
    ...customFieldsConfig.productFields.map((f: any) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      options: Array.isArray(f.options) ? f.options : undefined,
    })),
    ...customFieldsConfig.businessInfoFields.map((f: any) => ({
      key: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      options: Array.isArray(f.options) ? f.options : undefined,
    })),
  ].filter((f) => f.key && f.label);

  if (all.length === 0) return '';

  const lines = all.map((f) => {
    const req = f.required ? ' [requerido]' : '';
    return `- ${f.key}: "${f.label}"${req}`;
  });
  return lines.join('\n');
}

const OrderCorrectionActionSchema = z.enum([
  'none',
  'replace_product',
  'append_product',
  'update_quantity',
  'replace_location',
  'replace_customer',
  'replace_total',
  'replace_payment',
  'replace_shipping',
  'replace_comment',
  'replace_custom_fields',
  'mixed',
]);

const OrderExtractionProductSchema = z.object({
  name: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().nullable(),
});

const OrderExtractionCustomFieldSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const OrderExtractionSchema = z.object({
  intent: z.enum(['new_order', 'order_correction', 'not_order']).nullable(),
  confidence: z.number().nullable(),
  correctionAction: OrderCorrectionActionSchema.nullable(),
  customerName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  products: z.array(OrderExtractionProductSchema).nullable(),
  quantity: z.number().nullable(),
  total: z.union([z.number(), z.string()]).nullable(),
  orderType: z.enum(['EA', 'RA']).nullable(),
  paymentMethod: z.string().nullable(),
  courier: z.string().nullable(),
  address: z.string().nullable(),
  province: z.string().nullable(),
  canton: z.string().nullable(),
  district: z.string().nullable(),
  comments: z.string().nullable(),
  customFields: z.array(OrderExtractionCustomFieldSchema).nullable(),
});

type AIOrderExtraction = z.infer<typeof OrderExtractionSchema>;

async function extractOrderArgsWithGrok(
  userMessage: string,
  customFieldsConfig?: CustomFieldsData,
): Promise<Record<string, any> | null> {
  const customFieldsBlock = describeCustomFieldsForAIExtraction(customFieldsConfig);
  const systemPrompt = [
    'Extract order data for Betsy CRM from messy WhatsApp Spanish. Return only the structured schema fields.',
    'Do not invent. If unclear, use null or empty arrays. Never duplicate the same text into multiple fields.',
    'Order fields: customerName, phone, email, products, quantity, total, orderType, paymentMethod, courier, province, canton, district, address, comments, customFields.',
    'Costa Rica rules: phone is 8 digits, optionally with +506. Never use a cedula/ID as phone. EA means delivery/Correos/guia/domicilio. RA means pickup/retiro/local.',
    'Location: province/canton/district are Costa Rica places. Accept comma OR slash separators: "Heredia/Barva/San Pablo" => province=Heredia, canton=Barva, district=San Pablo. If labels exist, trust labels. If a user writes "Canton:Mora Colon" and also "Distrito:Brasil de Mora", use canton="Mora", district="Brasil de Mora". A product or total is never district/address.',
    'Unlabeled lines: a person full name on its own line is customerName. A street/reference line ("175 metros oeste de la escuela...") is address. Do not leave them null when clearly present.',
    'Address is the detailed street/reference only. Product lines like "1 sleeping patches" go to products, not location. Payment/total lines like "Pago 12,900CRC" go to total/payment, not address.',
    'paymentMethod vs courier: "Método de pago SINPE CONFIRMADO" => paymentMethod=SINPE, comments=SINPE CONFIRMADO. "Método envío CORREOS DE CR" => courier=Correos de CR (strip the label words). Never put the label text into the field value.',
    'Products: ALWAYS return products as an array with ONE entry per SKU/line. Never mash multiple items into products[0].name.',
    'Products examples: "1 sleeping patches" => [{name:"sleeping patches", quantity:1}]. "dopamine patch x2" => [{name:"dopamine patch", quantity:2}].',
    'Multi-product: "DOPAMINE PATCH X1, ENERGY PATCH X1, GLP PATCH X2, STRESS PATCH X1" => four products array entries with quantities 1,1,2,1. Same for multi-line PRODUCTO blocks.',
    'SKU: if the text has "(SKU: 6942042)" put sku="6942042" and strip it from name. Never leave SKU only inside the name string.',
    'quantity field = sum of all product line quantities. Do not invent a single product when several are listed.',
    'Total: return CRC number. "12,900CRC", "12.900", "Pago 12900" => 12900.',
    'Email: return only the email substring, e.g. "karo84zz@gmail.com", no trailing phone or punctuation.',
    'Corrections: if correcting a pending review, intent="order_correction" and set correctionAction. Use replace_product, append_product, update_quantity, replace_location, replace_customer, replace_total, replace_payment, replace_shipping, replace_comment, replace_custom_fields, or mixed.',
    'If the message is only one loose field with no order context, intent="not_order".',
    customFieldsBlock ? 'Tenant custom fields. If present in the message, return customFields with these exact keys:' : '',
    customFieldsBlock,
  ].filter(Boolean).join('\n');

  const startedAt = Date.now();
  console.info('[AI Agent] extractOrderArgsWithGrok: calling Grok structured parser', {
    model: MODEL,
    messageLength: userMessage.length,
    promptLength: systemPrompt.length,
    hasCustomFieldsSchema: !!customFieldsBlock,
    timeoutMs: XAI_EXTRACTION_TIMEOUT_MS,
    reasoningEffort: XAI_EXTRACTION_REASONING_EFFORT,
    maxRetries: 0,
  });

  try {
    const format = zodResponseFormat(OrderExtractionSchema, 'betsy_order_extraction');
    const response = await createXaiResponse({
      input: [{ role: 'user', content: userMessage }],
      instructions: systemPrompt,
      promptCacheKey: 'betsy:order-extraction',
      maxOutputTokens: 900,
      temperature: 0,
      reasoningEffort: XAI_EXTRACTION_REASONING_EFFORT,
      textFormat: {
        name: format.json_schema.name,
        schema: format.json_schema.schema as Record<string, unknown>,
        strict: format.json_schema.strict ?? true,
      },
    }, {
      timeout: XAI_EXTRACTION_TIMEOUT_MS,
      maxRetries: 0,
    });

    const rawText = parseResponseText(response);
    let parsed: AIOrderExtraction | null = null;
    if (rawText) {
      try {
        const json = JSON.parse(rawText);
        const checked = OrderExtractionSchema.safeParse(json);
        parsed = checked.success ? checked.data : (json as AIOrderExtraction);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      console.warn('[AI Agent] extractOrderArgsWithGrok: structured parse returned empty', {
        elapsedMs: Date.now() - startedAt,
      });
      return null;
    }

    console.info('[AI Agent] extractOrderArgsWithGrok: success', {
      elapsedMs: Date.now() - startedAt,
      intent: parsed.intent,
      correctionAction: parsed.correctionAction,
      confidence: parsed.confidence,
      province: parsed.province,
      canton: parsed.canton,
      district: parsed.district,
      productCount: Array.isArray(parsed.products) ? parsed.products.length : 0,
      customFieldKeys: Array.isArray(parsed.customFields) ? parsed.customFields.map((f) => f.key) : [],
    });

    return parsed as unknown as Record<string, any>;
  } catch (e) {
    console.error('[AI Agent] extractOrderArgsWithGrok: Grok call FAILED', {
      error: e instanceof Error ? e.message : String(e),
      elapsedMs: Date.now() - startedAt,
    });
    return null;
  }
}

function normalizeCostaRicaPhone(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value);
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('506')) return digits.slice(3);
  if (digits.length === 8) return digits;

  const phoneCandidateRe = /(?<!\d)(?:\+?506\D*)?(\d{4})\D?(\d{4})(?!\d)/g;
  for (const match of raw.matchAll(phoneCandidateRe)) {
    return `${match[1]}${match[2]}`;
  }

  return undefined;
}

function parseCrcAmount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  }
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const numberText = raw
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/[.,](?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(numberText);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

/**
 * Convert the AI extractor's JSON output into the internal create_order args
 * shape used by the rest of the pipeline. Drops template-placeholder values,
 * normalizes the total to a number, and ensures `products` is the canonical
 * `[{ name, quantity }]` array shape.
 */
function sanitizeAIExtractedArgs(
  aiArgs: Record<string, any>,
  customFieldsConfig?: CustomFieldsData,
): Record<string, any> {
  const out: Record<string, any> = {};

  const setIfReal = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (isTemplatePlaceholderValue(trimmed)) return;
      out[key] = trimmed;
      return;
    }
    out[key] = value;
  };

  setIfReal('customerName', aiArgs.customerName ?? aiArgs.customer_name);
  const normalizedPhone = normalizeCostaRicaPhone(aiArgs.phone);
  if (normalizedPhone) setIfReal('phone', normalizedPhone);
  // Defensive email cleanup: even if the model leaks trailing whitespace,
  // emojis, or a phone number after the address, recover only the valid
  // email substring. Real failure case the AI produced:
  //   "karo84zz@gmail.com.    ☎️84492744"
  // The user explicitly entered "correo: karo84zz@gmail.com" but a sloppy
  // extraction kept the trailing decoration. We always re-validate.
  if (typeof aiArgs.email === 'string') {
    const emailMatch = aiArgs.email.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (emailMatch) setIfReal('email', emailMatch[0]);
  }
  setIfReal('paymentMethod', aiArgs.paymentMethod ?? aiArgs.payment_method);
  setIfReal('courier', aiArgs.courier ?? aiArgs.shippingMethod ?? aiArgs.shipping_method ?? aiArgs.metodoEnvio);
  setIfReal('address', aiArgs.address);
  setIfReal('province', aiArgs.province);
  setIfReal('canton', aiArgs.canton);
  setIfReal('district', aiArgs.district);
  setIfReal('comments', aiArgs.comments);

  // Defensive label-leak cleanup: Grok sometimes returns "Método envío CORREOS DE CR".
  if (typeof out.paymentMethod === 'string') {
    out.paymentMethod = canonicalizePaymentMethod(out.paymentMethod);
  }
  if (typeof out.courier === 'string') {
    out.courier = canonicalizeCourier(out.courier);
  }
  if (typeof out.comments === 'string') {
    out.comments = stripOrderMetaLabel(out.comments) || out.comments;
  }

  if (typeof aiArgs.orderType === 'string') {
    const ot = aiArgs.orderType.trim().toUpperCase();
    if (ot === 'EA' || ot === 'RA') {
      out.orderType = ot;
    } else {
      const inferred = extractOrderTypeFromText(aiArgs.orderType);
      if (inferred) out.orderType = inferred;
    }
  }

  const total = parseCrcAmount(aiArgs.total);
  if (total !== undefined) out.total = total;

  if (aiArgs.quantity !== undefined && aiArgs.quantity !== null) {
    const quantity = Math.max(1, Math.floor(Number(aiArgs.quantity) || 0));
    if (quantity > 0) out.quantity = quantity;
  }

  if (Array.isArray(aiArgs.products)) {
    const seed = aiArgs.products
      .filter((p: any) => p && typeof p === 'object')
      .map((p: any) => ({
        name: typeof p.name === 'string' ? p.name.trim() : undefined,
        quantity: Math.max(1, Math.floor(Number(p.quantity) || 1)),
        ...(typeof p.sku === 'string' && p.sku.trim() ? { sku: String(p.sku).trim() } : {}),
      }))
      .filter((p: any) => (p.name && !isTemplatePlaceholderValue(p.name)) || p.sku);

    const products = expandMashedProductEntries(seed)
      .filter((p) => p.name && !isTemplatePlaceholderValue(p.name));
    if (products.length > 0) {
      out.products = products;
      out.quantity = products.reduce((sum, product) => sum + product.quantity, 0);
    }
  } else if (typeof aiArgs.product === 'string' && aiArgs.product.trim()) {
    // Legacy single-string product field — expand multi-line / comma lists.
    const products = parseLocalProducts(aiArgs.product);
    if (products.length > 0) {
      out.products = products;
      out.quantity = products.reduce((sum, product) => sum + product.quantity, 0);
    }
  }

  const customFieldEntries = Array.isArray(aiArgs.customFields)
    ? aiArgs.customFields
    : aiArgs.customFields && typeof aiArgs.customFields === 'object'
      ? Object.entries(aiArgs.customFields).map(([key, value]) => ({ key, value }))
      : [];

  if (customFieldEntries.length > 0) {
    const allowedKeys = new Set<string>();
    if (customFieldsConfig) {
      for (const f of customFieldsConfig.productFields) allowedKeys.add(f.key);
      for (const f of customFieldsConfig.businessInfoFields) allowedKeys.add(f.name);
    }
    const cleaned: Record<string, any> = {};
    for (const entry of customFieldEntries) {
      const key = String((entry as any)?.key || '').trim();
      const value = (entry as any)?.value;
      if (!key) continue;
      // Skip keys the tenant doesn't actually have configured.
      if (allowedKeys.size > 0 && !allowedKeys.has(key)) continue;
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') {
        const t = value.trim();
        if (!t || isTemplatePlaceholderValue(t)) continue;
        cleaned[key] = t;
      } else {
        cleaned[key] = value;
      }
    }
    if (Object.keys(cleaned).length > 0) out.customFields = cleaned;
  }

  if (typeof aiArgs.correctionAction === 'string') {
    out._correctionAction = aiArgs.correctionAction;
  }
  if (typeof aiArgs.intent === 'string') {
    out._intent = aiArgs.intent;
  }

  return out;
}

const ORDER_DETAILS_REQUIRED_TEXT = 'Claro. Enviame los datos de la orden en un solo mensaje: cliente, producto, total, tipo de orden y direccion si es EA.';
const FIELD_ONLY_WITHOUT_PENDING_TEXT = 'Recibi ese dato, pero no tengo una orden pendiente para aplicarlo. Reenviame la orden completa en un solo mensaje y preparo la revision final.';

function hasSubstantiveOrderFields(args: Record<string, any>): boolean {
  return !!(
    args.customerName
    || args.phone
    || args.email
    || (Array.isArray(args.products) && args.products.length > 0)
    || args.quantity
    || args.total !== undefined
    || args.address
    || args.province
    || args.canton
    || args.district
    || args.orderType
    || args.paymentMethod
    || args.courier
    || args.comments
    || (args.customFields && Object.keys(args.customFields).length > 0)
  );
}

function looksLikeOrderPayload(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  if (hasOrderCreationIntent(message)) return true;
  if (normalized.includes('datos para guia') || normalized.includes('datos para guia correos')) return true;
  if (normalized.includes('contra entrega')) return true;

  let score = 0;
  if (/\bproductos?\b/i.test(normalized)) score += 1;
  if (/\btotal\b|\bpago\b|crc|₡|¢/i.test(message)) score += 1;
  if (/\b(ea|ra)\b/i.test(normalized) || /\b(envio|retiro|correos|guia|mensajeria)\b/i.test(normalized)) score += 1;
  if (/\b(cliente|nombre|telefono|correo|email)\b/i.test(normalized)) score += 1;
  if (/\b(provincia|canton|distrito|direccion)\b/i.test(normalized)) score += 1;
  if (/\b(?:\+?506[\s-]?)?\d{4}[\s-]?\d{4}\b/.test(message)) score += 1;
  if (message.split(/\r?\n/).some((line) => line.split(',').filter(Boolean).length >= 3)) score += 1;

  return score >= 3;
}

function looksLikeFieldOnlyOrderFragment(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (looksLikeOrderPayload(trimmed)) return false;
  if (EMAIL_RE.test(trimmed)) return true;
  if (/^(?:\+?506[\s-]?)?\d{4}[\s-]?\d{4}$/.test(trimmed)) return true;
  if (/^(?:total|pago)\s*[:=]?\s*(?:crc|₡|¢)?\s*\d[\d.,]*$/i.test(trimmed)) return true;
  if (/^(?:producto|productos?|cantidad|provincia|canton|distrito|direccion|correo|email|telefono)\s*[:=]\s*\S+/i.test(trimmed)) return true;
  return false;
}

function cleanLocalOrderLine(line: string): string {
  return line
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocalLabel(value: string): string {
  return normalizeSpanishText(value)
    .replace(/[^a-z0-9/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLocalLabelValue(line: string): { label: string; value: string } | null {
  const idx = line.search(/[:=]/);
  if (idx < 0) return null;
  const label = cleanLocalOrderLine(line.slice(0, idx));
  const value = line.slice(idx + 1).trim();
  if (!label) return null;
  return { label, value };
}

function splitLocationTriplet(value: string): { province: string; canton: string; district: string } | null {
  const parts = value
    .split(/\s*(?:,|\/|\|)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  return {
    province: parts[0],
    canton: parts[1],
    district: parts.slice(2).join(', '),
  };
}

function looksLikeLocationTripletLine(line: string): boolean {
  return /\S+\s*[,|/]\s*\S+\s*[,|/]\s*\S+/.test(line);
}

/** Strip leading "Método de pago", "Método envío", "COMENTARIO", etc. from a value. */
function stripOrderMetaLabel(value: string): string {
  return value
    .replace(
      /^(?:[-*•]\s*)?(?:m[eé]todo(?:\s+de)?\s+pago|m[eé]todo(?:\s+de)?\s+envio|m[eé]todo\s+envio|forma\s+de\s+pago|comentario(?:s)?|nota|observaci[oó]n(?:es)?|tipo\s+de\s+orden)\s*[:.\-]?\s*/i,
      '',
    )
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function canonicalizePaymentMethod(value: string): string {
  const cleaned = stripOrderMetaLabel(value);
  const normalized = normalizeSpanishText(cleaned);
  if (/\bsinpe\b/.test(normalized)) return 'SINPE';
  if (/\btransferencia\b/.test(normalized)) return 'Transferencia';
  if (/\befectivo\b/.test(normalized)) return 'Efectivo';
  if (/\btarjeta\b/.test(normalized)) return 'Tarjeta';
  return cleaned || value.trim();
}

function canonicalizeCourier(value: string): string {
  const cleaned = stripOrderMetaLabel(value);
  const normalized = normalizeSpanishText(cleaned);
  if (/\bcorreos\b/.test(normalized)) {
    // Keep Ana-style full phrase when present; otherwise short canonical form.
    if (/costa\s*rica/.test(normalized)) return cleaned;
    return 'Correos de CR';
  }
  return cleaned || value.trim();
}

function extractOrderTypeFromText(value: string): 'EA' | 'RA' | undefined {
  if (isTemplatePlaceholderValue(value)) return undefined;
  const normalized = normalizeSpanishText(value);
  const hasEa = /(?:^|[^a-z])ea(?:[^a-z]|$)/.test(normalized)
    || /\benvio\b|\bdomicilio\b|\bcorreos\b|\bmensajeria\b|\bguia\b/.test(normalized);
  const hasRa = /(?:^|[^a-z])ra(?:[^a-z]|$)/.test(normalized)
    || /\bretiro\b|\bpickup\b/.test(normalized);
  if (hasEa && !hasRa) return 'EA';
  if (hasRa && !hasEa) return 'RA';
  // Ambiguous EA+RA together (template leftovers) — do not guess.
  if (hasEa && hasRa) return undefined;
  if (hasEa) return 'EA';
  return undefined;
}

const PERSON_NAME_NOISE_RE = /\b(producto|productos|total|pago|sinpe|correos|metodo|comentario|cantidad|sku|deseo|orden|pedido|email|correo|telefono|direccion|provincia|canton|distrito|envio|retiro|cliente|crear|nueva)\b/i;
const CR_PLACE_NAME_RE = /^(san jose|san josé|alajuela|cartago|heredia|guanacaste|puntarenas|limon|limón|montes de oca|brasil de mora)$/i;

function looksLikePersonNameLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;
  if (EMAIL_RE.test(trimmed)) return false;
  if (normalizeCostaRicaPhone(trimmed) && trimmed.replace(/\D/g, '').length === 8) return false;
  if (looksLikeLocationTripletLine(trimmed)) return false;
  if (PERSON_NAME_NOISE_RE.test(trimmed)) return false;
  if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  const normalized = normalizeSpanishText(trimmed);
  if (CR_PLACE_NAME_RE.test(normalized)) return false;
  // Place-like "X de Y" (Brasil de Mora, Montes de Oca) — not a person name.
  if (words.length === 3 && normalizeSpanishText(words[1]) === 'de') return false;
  return true;
}

const STREET_ADDRESS_CUE_RE = /\b(calle|metros?|oeste|este|norte|sur|de la|escuela|iglesia|barrio|casa|porton|portón|edificio|avenida|av\.|from|frente|costado|diagonal)\b/i;

function looksLikeStreetAddressLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (EMAIL_RE.test(trimmed)) return false;
  if (normalizeCostaRicaPhone(trimmed) && trimmed.replace(/\D/g, '').length <= 11) return false;
  if (looksLikeLocationTripletLine(trimmed)) return false;
  if (looksLikePersonNameLine(trimmed)) return false;
  const normalized = normalizeSpanishText(trimmed);
  if (/\b(total|pago|sinpe|transferencia|efectivo|crc|colones?|correos|mensajeria|metodo|comentario|producto|sku|cantidad)\b/i.test(normalized)) {
    return false;
  }
  if (STREET_ADDRESS_CUE_RE.test(trimmed)) return true;
  // Long free-text delivery notes without an explicit cue.
  return trimmed.length >= 35 && /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(trimmed);
}

/**
 * Detect "Método de pago SINPE CONFIRMADO" style lines that have a known
 * label prefix but no colon/equals separator.
 */
function splitImplicitOrderMetaLine(line: string): { label: string; value: string } | null {
  const match = line.match(
    /^(?:[-*•]\s*)?(m[eé]todo(?:\s+de)?\s+pago|m[eé]todo(?:\s+de)?\s+envio|m[eé]todo\s+envio|forma\s+de\s+pago|comentario(?:s)?|nota|observaci[oó]n(?:es)?|tipo\s+de\s+orden)\s+(.+)$/i,
  );
  if (!match) return null;
  const value = match[2].trim();
  if (!value) return null;
  return { label: match[1].trim(), value };
}

function parseOrderAmountFromText(value: string): number | undefined {
  const match = value.match(/(?:crc|colones?|[₡¢])?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6})(?:\s*(?:crc|colones?))?/i);
  return match ? parseCrcAmount(match[0]) : undefined;
}

type ParsedLocalProduct = { name: string; quantity: number; sku?: string };

/**
 * Split a product blob into line items. Handles:
 * - newlines / semicolons
 * - comma-separated multi-SKU lists ("DOPAMINE PATCH X1, ENERGY PATCH X1")
 * - "(SKU: 123)" / "SKU: 123" extraction into `.sku`
 */
function splitProductBlobParts(value: string): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  // Prefer newline / semicolon splits first.
  const primary = raw
    .split(/\r?\n|;/g)
    .map((part) => part.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const chunk of primary) {
    // Comma-separated multi-product lines (WhatsApp paste style).
    // Only split on commas when segments look like distinct product tokens
    // (qty suffix/prefix or multiple named items), not "Patch, noche".
    if (/,/.test(chunk) && looksLikeCommaSeparatedProductList(chunk)) {
      for (const segment of chunk.split(',')) {
        const cleaned = segment.replace(/^[-*•]\s*/, '').trim();
        if (cleaned) parts.push(cleaned);
      }
    } else {
      parts.push(chunk);
    }
  }
  return parts;
}

function looksLikeCommaSeparatedProductList(value: string): boolean {
  const segments = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return false;
  const productish = segments.filter((segment) =>
    /(?:^|\s)(?:x|×|\*)\s*\d+\s*$/i.test(segment)
    || /^\d+\s+\S+/.test(segment)
    || /\bsku\b/i.test(segment)
    || /\bpatch\b/i.test(segment)
    || /\b(producto|product)\b/i.test(segment)
  );
  // Require a majority of segments to look like product tokens (qty/SKU/name cues).
  // Do NOT treat "any 3+ commas" as productish — that over-splits addresses.
  return productish.length >= Math.ceil(segments.length * 0.6);
}

function parseSingleLocalProduct(part: string): ParsedLocalProduct | null {
  let name = part.replace(/^[-*•]\s*/, '').trim();
  if (!name) return null;

  let sku: string | undefined;
  const skuParen = name.match(/\(\s*sku\s*[:#]?\s*([^)]+)\)/i);
  const skuInline = name.match(/\bsku\s*[:#]?\s*([A-Za-z0-9._-]+)/i);
  if (skuParen) {
    sku = skuParen[1].trim();
    name = name.replace(skuParen[0], ' ').replace(/\s+/g, ' ').trim();
  } else if (skuInline) {
    sku = skuInline[1].trim();
    name = name.replace(skuInline[0], ' ').replace(/\s+/g, ' ').trim();
  }

  let quantity = 1;
  const trailing = name.match(/^(.*?)(?:\s*[xX×*]\s*(\d+)|\s+\(\s*(\d+)\s*\))\s*$/);
  const leading = name.match(/^(\d+)\s+(.+)$/);
  if (trailing && trailing[1].trim()) {
    name = trailing[1].trim();
    quantity = Math.max(1, Number(trailing[2] || trailing[3]) || 1);
  } else if (leading) {
    quantity = Math.max(1, Number(leading[1]) || 1);
    name = leading[2].trim();
  }

  if (!name || isTemplatePlaceholderValue(name)) return null;
  return sku ? { name, quantity, sku } : { name, quantity };
}

function parseLocalProducts(value: string): ParsedLocalProduct[] {
  return splitProductBlobParts(value)
    .map(parseSingleLocalProduct)
    .filter((product): product is ParsedLocalProduct => !!product);
}

function productIdentityKey(product: { name?: string; sku?: string }): string {
  const sku = normalizeToolText(product.sku);
  if (sku) return `sku:${sku}`;
  return `name:${normalizeToolText(product.name)}`;
}

function appendLocalProducts(
  existing: ParsedLocalProduct[] | undefined,
  incoming: ParsedLocalProduct[],
): ParsedLocalProduct[] {
  const merged = [...(existing || [])];
  for (const product of incoming) {
    const key = productIdentityKey(product);
    const index = merged.findIndex((item) => productIdentityKey(item) === key);
    if (index >= 0) {
      // Same SKU/name repeated in the paste → sum quantities.
      merged[index] = {
        ...merged[index],
        quantity: merged[index].quantity + product.quantity,
        ...(product.sku && !merged[index].sku ? { sku: product.sku } : {}),
      };
    } else {
      merged.push(product);
    }
  }
  return merged;
}

function expandMashedProductEntries(
  products: Array<{ name?: string; sku?: string; quantity?: number }>,
): ParsedLocalProduct[] {
  const expanded: ParsedLocalProduct[] = [];
  for (const product of products) {
    const name = typeof product?.name === 'string' ? product.name.trim() : '';
    const sku = typeof product?.sku === 'string' ? product.sku.trim() : '';
    const quantity = Math.max(1, Math.floor(Number(product?.quantity) || 1));

    if (!name && !sku) continue;

    // If the name itself is a multi-product blob, expand it.
    if (name && (/,/.test(name) || /\n|;/.test(name))) {
      const parts = parseLocalProducts(name);
      if (parts.length > 1) {
        for (const part of parts) expanded.push(part);
        continue;
      }
    }

    expanded.push({
      name: name || sku,
      quantity,
      ...(sku ? { sku } : {}),
    });
  }
  return expanded;
}

function shouldPreferLocalProducts(
  current: ParsedLocalProduct[] | undefined,
  local: ParsedLocalProduct[] | undefined,
): boolean {
  if (!local || local.length === 0) return false;
  if (!current || current.length === 0) return true;
  if (local.length <= current.length) return false;

  // Prefer local when every currently captured product still appears in the
  // richer local list (AI/local under-capture of multi-line PRODUCTO blocks).
  return current.every((currentProduct) => {
    const currentKey = productIdentityKey(currentProduct);
    const currentName = normalizeToolText(currentProduct.name);
    return local.some((product) => {
      if (productIdentityKey(product) === currentKey) return true;
      const localName = normalizeToolText(product.name);
      return !!currentName && !!localName && (
        localName === currentName
        || localName.includes(currentName)
        || currentName.includes(localName)
      );
    });
  });
}

function isProductBlockBoundaryLine(line: string): boolean {
  const normalized = normalizeSpanishText(line);
  if (!normalized) return true;
  if (EMAIL_RE.test(line)) return true;
  if (normalizeCostaRicaPhone(line) && line.replace(/\D/g, '').length <= 11 && line.replace(/\D/g, '').length >= 8) {
    // Bare phone lines end a product block.
    if (/^(?:\+?506[\s-]?)?\d{4}[\s-]?\d{4}$/.test(line.trim())) return true;
  }
  if (/\b(total|pago|sinpe|transferencia|efectivo|crc|colones?|cantidad)\b/i.test(normalized)) return true;
  if (/\b(correos|mensajeria|metodo de (?:pago|envio)|tipo de orden|comentario|direccion|provincia|canton|distrito|cliente|nombre|telefono|correo|email)\b/i.test(normalized)) {
    // Labeled meta lines end the block; bare product names do not.
    if (splitLocalLabelValue(line) || splitImplicitOrderMetaLine(line)) return true;
  }
  return false;
}

function looksLikeLocalProductLine(line: string): boolean {
  const normalized = normalizeSpanishText(line);
  if (!line || line.length > 90) return false;
  if (EMAIL_RE.test(line)) return false;
  if (normalizeCostaRicaPhone(line) && line.replace(/\D/g, '').length === 8) return false;
  if (/\b(total|pago|sinpe|transferencia|efectivo|crc|colones?)\b/i.test(normalized)) return false;
  if (/\b(correos|mensajeria|envio|retiro|direccion|provincia|canton|distrito)\b/i.test(normalized)) return false;
  return /(?:^|\s)(?:x|×|\*)\s*\d+\s*$/i.test(line) || /^\d+\s+\S+/.test(line);
}

function assignLocalCustomField(
  label: string,
  value: string,
  raw: Record<string, any>,
  customFieldsConfig?: CustomFieldsData,
): boolean {
  if (!customFieldsConfig || !value) return false;
  const normalizedLabel = normalizeLocalLabel(label);
  const customFields: Array<{ key: string; value: string }> = Array.isArray(raw.customFields) ? raw.customFields : [];
  const allFields = [
    ...customFieldsConfig.productFields.map((field: any) => ({ key: field.key, label: field.label })),
    ...customFieldsConfig.businessInfoFields.map((field: any) => ({ key: field.name, label: field.label })),
  ];

  for (const field of allFields) {
    const candidates = [field.key, field.label].filter(Boolean).map((candidate) => normalizeLocalLabel(String(candidate)));
    if (candidates.some((candidate) => candidate && (normalizedLabel === candidate || normalizedLabel.includes(candidate)))) {
      customFields.push({ key: field.key, value });
      raw.customFields = customFields;
      return true;
    }
  }

  return false;
}

function assignLocalLabeledField(
  label: string,
  value: string,
  raw: Record<string, any>,
  customFieldsConfig?: CustomFieldsData,
): boolean {
  const normalized = normalizeLocalLabel(label);
  if (!value && !/producto/.test(normalized)) return false;

  if (assignLocalCustomField(label, value, raw, customFieldsConfig)) return true;

  if (normalized.includes('provincia') && normalized.includes('canton') && normalized.includes('distrito')) {
    const triplet = splitLocationTriplet(value);
    if (triplet) {
      Object.assign(raw, triplet);
      return true;
    }
  }

  if (/\bnombre\b|\bcliente\b/.test(normalized)) {
    raw.customerName = value;
    return true;
  }
  if (/\btelefono\b|\btel\b|\bcelular\b|\bwhatsapp\b/.test(normalized)) {
    raw.phone = value;
    return true;
  }
  if (/\bcorreo\b|\bemail\b|\be mail\b/.test(normalized)) {
    raw.email = value;
    return true;
  }
  if (/\bdireccion\b|\bdireccion exacta\b|\bdir\b/.test(normalized)) {
    raw.address = value;
    return true;
  }
  if (/\bprovincia\b/.test(normalized)) {
    raw.province = value;
    return true;
  }
  if (/\bcanton\b/.test(normalized)) {
    raw.canton = value;
    return true;
  }
  if (/\bdistrito\b/.test(normalized)) {
    raw.district = value;
    return true;
  }
  if (/\bproducto\b|\bproductos\b/.test(normalized)) {
    const products = parseLocalProducts(value);
    if (products.length > 0) {
      raw.products = appendLocalProducts(raw.products, products);
      return true;
    }
    // Empty "Producto:" / "Producto(s):" label — caller will enter product-block mode.
    return true;
  }
  if (/\btotal\b|\bmonto\b|\bprecio\b/.test(normalized)) {
    const total = parseOrderAmountFromText(value);
    if (total !== undefined) raw.total = total;
    return total !== undefined;
  }
  if (/\bpago\b|\bmetodo de pago\b|\bforma de pago\b/.test(normalized)) {
    const cleaned = stripOrderMetaLabel(value);
    const total = parseOrderAmountFromText(cleaned);
    if (total !== undefined) raw.total = total;
    raw.paymentMethod = canonicalizePaymentMethod(cleaned);
    if (/\bconfirmado\b/i.test(cleaned) && !raw.comments) {
      raw.comments = cleaned;
    }
    return true;
  }
  if (/\bcourier\b|\bmensajeria\b|\bmetodo de envio\b|\bmetodo envio\b|\benvio\b/.test(normalized)) {
    raw.courier = canonicalizeCourier(value);
    raw.orderType = 'EA';
    return true;
  }
  if (/\btipo de orden\b|\btipo orden\b/.test(normalized)) {
    const orderType = extractOrderTypeFromText(value);
    if (orderType) {
      raw.orderType = orderType;
      return true;
    }
  }
  if (/\bcomentario\b|\bnota\b|\bobservacion\b/.test(normalized)) {
    raw.comments = stripOrderMetaLabel(value);
    return true;
  }

  return false;
}

function collectLocalOrderFields(
  message: string,
  customFieldsConfig?: CustomFieldsData,
  options: { allowProductLineInference: boolean } = { allowProductLineInference: true },
): Record<string, any> {
  const raw: Record<string, any> = {};
  const lines = message
    .split(/\r?\n/g)
    .map(cleanLocalOrderLine)
    .filter(Boolean);
  let inProductBlock = false;

  for (const line of lines) {
    const normalized = normalizeSpanishText(line);
    const labeled = splitLocalLabelValue(line) || splitImplicitOrderMetaLine(line);

    if (labeled) {
      const labelNorm = normalizeLocalLabel(labeled.label);
      const isProductLabel = /\bproducto\b/.test(labelNorm);

      // A non-product labeled field ends an open product block.
      if (inProductBlock && !isProductLabel && isProductBlockBoundaryLine(line)) {
        inProductBlock = false;
      }

      const assigned = assignLocalLabeledField(labeled.label, labeled.value, raw, customFieldsConfig);
      if (isProductLabel) {
        // Keep consuming following product lines until a meta boundary.
        inProductBlock = true;
      }
      if (assigned) continue;
    }

    if (/^productos?$/.test(normalized)) {
      inProductBlock = true;
      continue;
    }

    if (inProductBlock) {
      if (isProductBlockBoundaryLine(line)) {
        inProductBlock = false;
        // Fall through so this boundary line is still processed as meta.
      } else {
        const products = parseLocalProducts(line);
        if (products.length > 0) {
          raw.products = appendLocalProducts(raw.products, products);
          continue;
        }
        // Non-parseable line inside a product block ends the block.
        inProductBlock = false;
      }
    }

    const emailMatch = line.match(EMAIL_RE);
    if (emailMatch) {
      raw.email = emailMatch[0];
      continue;
    }

    const phone = normalizeCostaRicaPhone(line);
    if (phone && line.replace(/\D/g, '').length <= 11) {
      raw.phone = phone;
      continue;
    }

    const triplet = splitLocationTriplet(line);
    if (triplet && looksLikeLocationTripletLine(line)) {
      Object.assign(raw, triplet);
      continue;
    }

    if (/\bsinpe\b/i.test(normalized)) {
      raw.paymentMethod = 'SINPE';
      const cleaned = stripOrderMetaLabel(line);
      raw.comments = raw.comments || cleaned || line;
      const total = parseOrderAmountFromText(line);
      if (total !== undefined) raw.total = total;
      continue;
    }

    if (/\b(transferencia|efectivo|tarjeta)\b/i.test(normalized)) {
      raw.paymentMethod = canonicalizePaymentMethod(line);
      const total = parseOrderAmountFromText(line);
      if (total !== undefined) raw.total = total;
      continue;
    }

    if (/\b(correos|mensajeria|envio a domicilio|domicilio)\b/i.test(normalized)) {
      raw.courier = canonicalizeCourier(line);
      raw.orderType = 'EA';
      continue;
    }

    if (/\b(retiro|retira|pickup)\b/i.test(normalized)) {
      raw.orderType = 'RA';
      continue;
    }

    if (/\b(total|pago|crc|colones?)\b/i.test(normalized)) {
      const total = parseOrderAmountFromText(line);
      if (total !== undefined) {
        raw.total = total;
        continue;
      }
    }

    if (!raw.customerName && looksLikePersonNameLine(line)) {
      raw.customerName = line.trim();
      continue;
    }

    if (!raw.address && looksLikeStreetAddressLine(line)) {
      raw.address = line.trim();
      continue;
    }

    if (options.allowProductLineInference && looksLikeLocalProductLine(line)) {
      const products = parseLocalProducts(line);
      if (products.length > 0) {
        raw.products = appendLocalProducts(raw.products, products);
        continue;
      }
    }
  }

  if (!raw.orderType && (raw.courier || raw.address || raw.province || raw.canton || raw.district)) {
    raw.orderType = 'EA';
  }

  // Catch "Deseo crear una nueva orden de EA" style intent lines.
  if (!raw.orderType) {
    const orderType = extractOrderTypeFromText(message);
    if (orderType) raw.orderType = orderType;
  }

  return raw;
}

function inferLocalCorrectionAction(args: Record<string, any>): string {
  const keys = Object.keys(stripOrderExtractionMetadata(args))
    .filter((key) => !['quantity', 'intent', 'correctionAction', 'confidence'].includes(key));
  const hasOnly = (allowed: string[]) => keys.length > 0 && keys.every((key) => allowed.includes(key));
  if (hasOnly(['province', 'canton', 'district', 'orderType'])) return 'replace_location';
  if (hasOnly(['products'])) return 'replace_product';
  if (hasOnly(['total'])) return 'replace_total';
  if (hasOnly(['paymentMethod'])) return 'replace_payment';
  if (hasOnly(['courier', 'orderType'])) return 'replace_shipping';
  if (hasOnly(['comments'])) return 'replace_comment';
  if (hasOnly(['customerName', 'phone', 'email'])) return 'replace_customer';
  if (hasOnly(['customFields'])) return 'replace_custom_fields';
  return 'mixed';
}

function parseLocalStructuredOrderArgs(
  message: string,
  customFieldsConfig?: CustomFieldsData,
): Record<string, any> | null {
  const raw = collectLocalOrderFields(message, customFieldsConfig);
  raw.intent = 'new_order';
  const sanitized = sanitizeAIExtractedArgs(raw, customFieldsConfig);

  const identityFields = Number(Boolean(sanitized.customerName))
    + Number(Boolean(sanitized.phone))
    + Number(Boolean(sanitized.email));
  const orderFields = Number(Array.isArray(sanitized.products) && sanitized.products.length > 0)
    + Number(sanitized.total !== undefined)
    + Number(Boolean(sanitized.orderType))
    + Number(Boolean(sanitized.address || sanitized.province || sanitized.canton || sanitized.district || sanitized.courier));

  if (!hasSubstantiveOrderFields(sanitized) || identityFields + orderFields < 3) return null;
  return sanitized;
}

function parseMissingFieldsCorrection(
  message: string,
  existingArgs: Record<string, any>,
): Record<string, any> | null {
  const missing = getCreateOrderReviewMissingFields(existingArgs);
  if (missing.length === 0) return null;

  const value = message.trim();
  if (!value) return null;

  // Prefer structured local extraction when the correction itself looks rich.
  const localRaw = collectLocalOrderFields(message, undefined, { allowProductLineInference: true });
  if (hasSubstantiveOrderFields(localRaw)) {
    const patch: Record<string, any> = {};
    const missingNorm = missing.map((entry) => normalizeSpanishText(entry));
    const wants = (needle: string) => missingNorm.some((entry) => entry.includes(needle));

    if (wants('nombre') && localRaw.customerName) patch.customerName = localRaw.customerName;
    if (wants('telefono') && localRaw.phone) patch.phone = localRaw.phone;
    if (wants('producto') && Array.isArray(localRaw.products) && localRaw.products.length > 0) {
      patch.products = localRaw.products;
    }
    if (wants('total') && localRaw.total !== undefined) patch.total = localRaw.total;
    if (wants('tipo') && localRaw.orderType) patch.orderType = localRaw.orderType;
    if (wants('direccion') || wants('ubicacion')) {
      if (localRaw.province) patch.province = localRaw.province;
      if (localRaw.canton) patch.canton = localRaw.canton;
      if (localRaw.district) patch.district = localRaw.district;
      if (localRaw.address) patch.address = localRaw.address;
    }

    if (Object.keys(patch).length > 0) return patch;
  }

  if (missing.length === 1) {
    const field = normalizeSpanishText(missing[0]);
    if (field.includes('producto')) {
      const products = parseLocalProducts(value);
      return products.length > 0 ? { products } : null;
    }
    if (field.includes('total')) {
      const total = parseOrderAmountFromText(value);
      return total !== undefined ? { total } : null;
    }
    if (field.includes('nombre')) {
      return { customerName: value };
    }
    if (field.includes('telefono')) return { phone: value };
    if (field.includes('direccion') || field.includes('ubicacion')) {
      const triplet = splitLocationTriplet(value);
      return triplet || { address: value };
    }
    if (field.includes('tipo')) {
      const orderType = extractOrderTypeFromText(value);
      return orderType ? { orderType } : null;
    }
    return null;
  }

  // Multi-missing: map a single unlabeled heuristic line to one missing field.
  if (looksLikePersonNameLine(value) && missing.some((entry) => /nombre/i.test(entry))) {
    return { customerName: value };
  }
  if (looksLikeLocationTripletLine(value) && missing.some((entry) => /direccion|ubicacion/i.test(entry))) {
    return splitLocationTriplet(value);
  }
  if (looksLikeStreetAddressLine(value) && missing.some((entry) => /direccion|ubicacion/i.test(entry))) {
    return { address: value };
  }
  const phone = normalizeCostaRicaPhone(value);
  if (phone && missing.some((entry) => /telefono/i.test(entry))) {
    return { phone };
  }
  const emailMatch = value.match(EMAIL_RE);
  if (emailMatch) {
    return { email: emailMatch[0] };
  }

  return null;
}

function parseLocalOrderCorrectionArgs(
  message: string,
  existingArgs: Record<string, any>,
  customFieldsConfig?: CustomFieldsData,
): Record<string, any> | null {
  const freshOrder = looksLikeOrderPayload(message)
    ? parseLocalStructuredOrderArgs(message, customFieldsConfig)
    : null;
  if (freshOrder && shouldReplacePendingWithFreshOrder(message, freshOrder)) {
    return freshOrder;
  }

  const raw = collectLocalOrderFields(message, customFieldsConfig);
  const singleMissing = hasSubstantiveOrderFields(raw) ? null : parseMissingFieldsCorrection(message, existingArgs);
  const candidate = singleMissing || raw;
  if (!hasSubstantiveOrderFields(candidate)) return null;

  candidate.intent = 'order_correction';
  candidate.correctionAction = inferLocalCorrectionAction(candidate);
  const sanitized = sanitizeAIExtractedArgs(candidate, customFieldsConfig);
  return hasSubstantiveOrderFields(sanitized) ? sanitized : null;
}

function buildOrderCorrectionRetryText(
  existingArgs: Record<string, any>,
  customFieldsConfig?: CustomFieldsData,
): string {
  const captured = getCreateOrderReviewCapturedFields(existingArgs, customFieldsConfig);
  const lines = [
    'No pude aplicar esa corrección.',
  ];

  if (captured.length > 0) {
    lines.push('', 'Orden pendiente:', ...captured.map((line) => `- ${line}`));
  }

  lines.push(
    '',
    'Decime el dato así: nombre, dirección, o provincia/cantón/distrito.',
  );

  return lines.join('\n');
}

function shouldReplacePendingWithFreshOrder(message: string, args: Record<string, any>): boolean {
  if (args._intent !== 'new_order') return false;
  if (!looksLikeOrderPayload(message)) return false;

  const identityFields = Number(Boolean(args.customerName))
    + Number(Boolean(args.phone))
    + Number(Boolean(args.email));
  const orderFields = Number(Array.isArray(args.products) && args.products.length > 0)
    + Number(args.total !== undefined)
    + Number(Boolean(args.orderType))
    + Number(Boolean(args.address || args.province || args.canton || args.district));

  return identityFields >= 1 && orderFields >= 2;
}

function mergeProductsForCorrection(
  existingArgs: Record<string, any>,
  correctionArgs: Record<string, any>,
  action: string,
): Array<{ name?: string; sku?: string; quantity: number }> | undefined {
  const existingProducts = orderProductsFromArgs(existingArgs);
  const correctionProducts = orderProductsFromArgs(correctionArgs);
  const correctionQuantity = Number(correctionArgs.quantity);

  if (action === 'append_product') {
    if (correctionProducts.length === 0) return existingProducts.length > 0 ? existingProducts : undefined;
    return [...existingProducts, ...correctionProducts];
  }

  if (action === 'update_quantity') {
    const nextProducts = existingProducts.length > 0 ? [...existingProducts] : correctionProducts;
    const quantity = Number.isFinite(correctionQuantity) && correctionQuantity > 0
      ? Math.floor(correctionQuantity)
      : correctionProducts[0]?.quantity;
    if (!quantity) return nextProducts.length > 0 ? nextProducts : undefined;

    if (nextProducts.length === 1) {
      nextProducts[0] = { ...nextProducts[0], quantity };
      return nextProducts;
    }

    if (correctionProducts.length === 1) {
      const correctionName = normalizeToolText(correctionProducts[0].name);
      const correctionSku = normalizeToolText(correctionProducts[0].sku);
      const index = nextProducts.findIndex((product) =>
        (correctionSku && normalizeToolText(product.sku) === correctionSku)
        || (correctionName && normalizeToolText(product.name) === correctionName)
      );
      if (index >= 0) {
        nextProducts[index] = { ...nextProducts[index], quantity };
        return nextProducts;
      }
    }

    return nextProducts.length > 0 ? nextProducts : undefined;
  }

  if (correctionProducts.length > 0) return correctionProducts;
  return undefined;
}

function stripOrderExtractionMetadata(args: Record<string, any>): Record<string, any> {
  const cleaned = { ...args };
  delete cleaned._correctionAction;
  delete cleaned._intent;
  delete cleaned._locationReviewWarning;
  delete cleaned._locationCaptureAction;
  return cleaned;
}

function mergeOrderCorrectionArgs(
  existingArgs: Record<string, any>,
  correctionArgs: Record<string, any>,
): Record<string, any> {
  const action = String(correctionArgs._correctionAction || 'mixed');
  const sanitizedCorrection = stripOrderExtractionMetadata(correctionArgs);

  const products = mergeProductsForCorrection(existingArgs, sanitizedCorrection, action);
  const mergedCustomFields = {
    ...(existingArgs.customFields && typeof existingArgs.customFields === 'object' ? existingArgs.customFields : {}),
    ...(sanitizedCorrection.customFields && typeof sanitizedCorrection.customFields === 'object' ? sanitizedCorrection.customFields : {}),
  };

  const merged = { ...stripOrderExtractionMetadata(existingArgs), ...sanitizedCorrection };
  if (products) {
    merged.products = products;
    delete merged.product;
    merged.quantity = products.reduce((sum, product) => sum + product.quantity, 0);
  }
  if (Object.keys(mergedCustomFields).length > 0) {
    merged.customFields = mergedCustomFields;
  }

  return merged;
}

export const __grokFirstOrderTestInternals = {
  normalizeCostaRicaPhone,
  parseCrcAmount,
  sanitizeAIExtractedArgs,
  hasSubstantiveOrderFields,
  looksLikeOrderPayload,
  looksLikeFieldOnlyOrderFragment,
  parseLocalStructuredOrderArgs,
  parseLocalOrderCorrectionArgs,
  applyOrderCaptureLocationNormalization,
  shouldReplacePendingWithFreshOrder,
  mergeOrderCorrectionArgs,
  gapFillEmptyOrderFieldsFromMessage,
  collectLocalOrderFields,
  parseLocalProducts,
  expandMashedProductEntries,
  appendLocalProducts,
  resolveInventoryMatchPick,
  applyInventoryMatchPickToOrderArgs,
};

/**
 * Fill only EMPTY fields from local heuristics. Never overwrites values the
 * AI (or a prior merge) already set — respects the "no regex layered on AI
 * output" rule while fixing partial Grok misses (Abigail case).
 */
function gapFillEmptyOrderFieldsFromMessage(
  args: Record<string, any>,
  message: string,
  customFieldsConfig?: CustomFieldsData,
): Record<string, any> {
  const local = sanitizeAIExtractedArgs(
    { ...collectLocalOrderFields(message, customFieldsConfig), intent: 'new_order' },
    customFieldsConfig,
  );
  if (!hasSubstantiveOrderFields(local)) return args;

  const out = { ...args };
  const fillKeys = [
    'customerName',
    'phone',
    'email',
    'address',
    'province',
    'canton',
    'district',
    'products',
    'total',
    'orderType',
    'paymentMethod',
    'courier',
    'comments',
  ] as const;

  const filledKeys: string[] = [];
  for (const key of fillKeys) {
    const current = out[key];
    const isEmpty = current === undefined
      || current === null
      || current === ''
      || (Array.isArray(current) && current.length === 0);
    const candidate = local[key];
    const hasCandidate = candidate !== undefined
      && candidate !== null
      && candidate !== ''
      && !(Array.isArray(candidate) && candidate.length === 0);

    if (key === 'products' && shouldPreferLocalProducts(current as any, candidate as any)) {
      out.products = candidate;
      out.quantity = (candidate as ParsedLocalProduct[]).reduce((sum, product) => sum + product.quantity, 0);
      filledKeys.push('products');
      continue;
    }

    if (isEmpty && hasCandidate) {
      out[key] = candidate;
      filledKeys.push(key);
      if (key === 'products' && Array.isArray(candidate)) {
        out.quantity = (candidate as ParsedLocalProduct[]).reduce((sum, product) => sum + product.quantity, 0);
      }
    }
  }

  if (local.customFields && typeof local.customFields === 'object') {
    const existing = (out.customFields && typeof out.customFields === 'object') ? out.customFields : {};
    const merged: Record<string, any> = { ...existing };
    let customFilled = false;
    for (const [key, value] of Object.entries(local.customFields)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
        merged[key] = value;
        customFilled = true;
      }
    }
    if (customFilled) {
      out.customFields = merged;
      filledKeys.push('customFields');
    }
  }

  if (filledKeys.length > 0) {
    console.info('[AI Agent] gap-filled empty order fields from local heuristics', {
      filledKeys,
    });
  }

  return out;
}

function applyOrderCaptureLocationNormalization(args: Record<string, any>): void {
  try {
    const result = normalizeLocationForOrderCapture(args);
    delete args._locationReviewWarning;
    delete args._locationCaptureAction;

    if (result.warning) args._locationReviewWarning = result.warning;
    if (result.action !== 'none') args._locationCaptureAction = result.action;

    if (result.action !== 'none') {
      console.info('[AI Agent] location capture normalization', {
        action: result.action,
        validForGuia: result.validForGuia,
        correctionCount: result.corrections.length,
      });
    }
  } catch (e) {
    console.warn('[AI Agent] applyOrderCaptureLocationNormalization failed:', e);
  }
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
- NUNCA metas varios productos en un solo string (ej: "A x1, B x1"). Siempre products[] con una entrada por item.
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

// Convert Zod schemas to xAI Responses function tools (flat, not Chat Completions nested).
function zodToOpenAITool(name: string, schema: { description: string; parameters: z.ZodType<any> }): ResponsesFunctionTool {
  const zodSchema = schema.parameters;

  // Convert Zod to JSON Schema manually for the fields we use
  const jsonSchema: Record<string, unknown> = {
    type: 'object',
    properties: {},
    required: [],
  };

  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodField = value as z.ZodTypeAny;
      const typeName = zodField._def.typeName;
      if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') {
        required.push(key);
      }
      properties[key] = zodFieldToJsonSchema(zodField);
    }

    jsonSchema.properties = properties;
    jsonSchema.required = required;
  }

  return {
    type: 'function',
    name,
    description: schema.description,
    parameters: jsonSchema,
    strict: false,
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
  context = {
    ...context,
    confirmedInvoiceIntent: hasConfirmedInvoiceIntent(userMessage),
    confirmedInvoiceEmailIntent: hasConfirmedInvoiceEmailIntent(userMessage),
  };
  const addAssistantTurn = (
    content: string,
    toolCalls?: ConversationMessage['toolCalls'],
  ) => addAssistantMessage(
    platform,
    platformId,
    content,
    toolCalls,
    context.operationKey ? `${context.operationKey}:assistant` : undefined,
  );
  // Tracks whether a mutating tool already committed during this turn. If so,
  // and a later step throws, the global catch surfaces the success message
  // instead of a misleading "ocurrió un error" that would contradict reality
  // (the order is already in the DB).
  let mutationSuccessText: string | null = null;
  let mutationSuccessAttachments: ToolAttachment[] | undefined;

  try {
    // Load tenant custom-fields config once per turn so every downstream code
    // path (Grok extraction, pending repair flow, pending final-confirm
    // flow, and the LLM tool path) can use the same shape. Without
    // this, the LLM path would silently drop custom-field values the user
    // already typed in their message and the validator would report every
    // required custom field as missing.
    let customFieldsConfig: CustomFieldsData | undefined;
    try {
      customFieldsConfig = await getTenantCustomFields(context.tenantId);
    } catch (e) {
      console.warn('[AI Agent] Failed to load tenant custom fields config:', e);
    }

    // Check for pending confirmations first (non-destructive peek)
    const pending = await peekPendingConfirmation(platform, platformId);
    if (pending) {
      if (pending.type === 'order_repair') {
        if (isDenial(userMessage) || isExplicitRejection(userMessage)) {
          console.info('[AI Agent] User rejected pending order_repair — clearing.');
          await clearPendingConfirmation(platform, platformId);
          const text = 'Entendido, descarté esa orden. Cuando quieras crear una nueva, envíame los datos completos.';
          await addAssistantTurn(text);
          return { text };
        }

        if (isConfirmation(userMessage)) {
          const responseText = 'Para completar la orden necesito el dato faltante. Enviamelo asi: producto: ENERGY PATCH X1';
          await addAssistantTurn(responseText);
          return { text: responseText };
        }

        // Only an explicit new-order intent clears the repair. Correction
        // wording like "cambie el distrito" stays here and Grok interprets it.
        if (hasOrderCreationIntent(userMessage)) {
          console.info('[AI Agent] Clearing pending order repair because the user started a new order');
          await clearPendingConfirmation(platform, platformId);
          // Fall through to normal processing; Grok extraction or the LLM will
          // pick up the fresh order data below.
        } else {
          // Otherwise treat ANY remaining message as a repair attempt. This is
          // important: prior versions gated this on a field-reply detector,
          // which missed valid corrections like "Provincia San José / Cantón
          // Desamparados / Distrito San Antonio" (no colons) and let them fall
          // through to the LLM, where it would borrow data from history.
          //
          // We use Grok on the correction message so phrases like
          // "no, el distrito es Brasil de Mora, el producto es 1 sleeping
          // patches" get understood as field updates. If Grok fails, we ask
          // for the correction again instead of guessing with regex.
          await clearPendingConfirmation(platform, platformId);

          const existingArgs = (pending.data?.toolArgs as Record<string, any>) || {};
          let repairedArgs: Record<string, any> = existingArgs;

          const localCorrection = parseLocalOrderCorrectionArgs(userMessage, existingArgs, customFieldsConfig);
          if (localCorrection) {
            console.info('[AI Agent] order_repair correction source=local_correction', {
              correctionKeys: Object.keys(localCorrection),
              correctionAction: localCorrection._correctionAction,
            });
            if (shouldReplacePendingWithFreshOrder(userMessage, localCorrection)) {
              const freshArgs = stripOrderExtractionMetadata(localCorrection);
              applyOrderCaptureLocationNormalization(freshArgs);
              return requestCreateOrderFinalConfirmation(freshArgs, context, platform, platformId);
            }
            repairedArgs = mergeOrderCorrectionArgs(existingArgs, localCorrection);
            applyOrderCaptureLocationNormalization(repairedArgs);
          } else {
            console.info('[AI Agent] order_repair correction source=grok');
            const aiCorrection = await extractOrderArgsWithGrok(userMessage, customFieldsConfig);
            if (aiCorrection && Object.keys(aiCorrection).length > 0) {
              let sanitized = sanitizeAIExtractedArgs(aiCorrection, customFieldsConfig);
              if (!hasSubstantiveOrderFields(sanitized)) {
                console.warn('[AI Agent] order_repair: Grok returned no substantive correction fields');
                await setPendingConfirmation(platform, platformId, pending as any);
                return { text: buildOrderCorrectionRetryText(existingArgs, customFieldsConfig) };
              }
              if (shouldReplacePendingWithFreshOrder(userMessage, sanitized)) {
                console.info('[AI Agent] order_repair: Grok detected a fresh order; replacing pending repair');
                // Full fresh order paste — gap-fill empties on the new payload only.
                const freshArgs = stripOrderExtractionMetadata(
                  gapFillEmptyOrderFieldsFromMessage(sanitized, userMessage, customFieldsConfig),
                );
                applyOrderCaptureLocationNormalization(freshArgs);
                return requestCreateOrderFinalConfirmation(freshArgs, context, platform, platformId);
              }
              // Gap-fill AFTER merge so heuristics cannot invent fields that
              // overwrite already-good pending values via the sparse correction.
              repairedArgs = mergeOrderCorrectionArgs(existingArgs, sanitized);
              repairedArgs = gapFillEmptyOrderFieldsFromMessage(repairedArgs, userMessage, customFieldsConfig);
              applyOrderCaptureLocationNormalization(repairedArgs);
              console.info('[AI Agent] order_repair: AI applied corrections', {
                correctionKeys: Object.keys(sanitized),
                correctionAction: sanitized._correctionAction,
              });
            } else {
              console.warn('[AI Agent] order_repair: Grok extraction failed/null after local correction miss');
              await setPendingConfirmation(platform, platformId, pending as any);
              return { text: buildOrderCorrectionRetryText(existingArgs, customFieldsConfig) };
            }
          }

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
          await addAssistantTurn(text);
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
          await addAssistantTurn(sanitizeOrderSuccessForHistory(result));
          return { text: result };
        }

        // If the user is starting a brand-new order rather than correcting the
        // pending one, discard the pending review entirely so old fields don't
        // leak into the new order. Falls through to normal processing, which
        // will use Grok extraction or call the LLM.
        const looksLikeNewOrder = hasOrderCreationIntent(userMessage);

        if (looksLikeNewOrder) {
          console.info('[AI Agent] 🧹 Discarding pending order_final_confirm — user started a new order');
          await clearPendingConfirmation(platform, platformId);
          // Do NOT return; fall through to normal processing below.
        } else {
          await clearPendingConfirmation(platform, platformId);

          const existingArgs = (pending.data?.toolArgs as Record<string, any>) || {};
          const localCorrection = parseLocalOrderCorrectionArgs(userMessage, existingArgs, customFieldsConfig);
          if (localCorrection) {
            console.info('[AI Agent] order_final_confirm correction source=local_correction', {
              correctionKeys: Object.keys(localCorrection),
              correctionAction: localCorrection._correctionAction,
            });
            if (shouldReplacePendingWithFreshOrder(userMessage, localCorrection)) {
              const freshArgs = stripOrderExtractionMetadata(localCorrection);
              applyOrderCaptureLocationNormalization(freshArgs);
              return requestCreateOrderFinalConfirmation(freshArgs, context, platform, platformId);
            }
            const updatedArgs = mergeOrderCorrectionArgs(existingArgs, localCorrection);
            applyOrderCaptureLocationNormalization(updatedArgs);
            return requestCreateOrderFinalConfirmation(updatedArgs, context, platform, platformId);
          }

          console.info('[AI Agent] order_final_confirm correction source=grok');
          const aiCorrection = await extractOrderArgsWithGrok(userMessage, customFieldsConfig);
          if (!aiCorrection || Object.keys(aiCorrection).length === 0) {
            console.warn('[AI Agent] order_final_confirm: Grok extraction failed/null after local correction miss');
            await setPendingConfirmation(platform, platformId, pending as any);
            return { text: buildOrderCorrectionRetryText(existingArgs, customFieldsConfig) };
          }

          const sanitized = sanitizeAIExtractedArgs(aiCorrection, customFieldsConfig);
          if (!hasSubstantiveOrderFields(sanitized)) {
            console.warn('[AI Agent] order_final_confirm: Grok returned no substantive correction fields');
            await setPendingConfirmation(platform, platformId, pending as any);
            return { text: buildOrderCorrectionRetryText(existingArgs, customFieldsConfig) };
          }

          if (shouldReplacePendingWithFreshOrder(userMessage, sanitized)) {
            console.info('[AI Agent] order_final_confirm: Grok detected a fresh order; replacing pending review');
            const freshArgs = stripOrderExtractionMetadata(
              gapFillEmptyOrderFieldsFromMessage(sanitized, userMessage, customFieldsConfig),
            );
            applyOrderCaptureLocationNormalization(freshArgs);
            return requestCreateOrderFinalConfirmation(freshArgs, context, platform, platformId);
          }

          let updatedArgs = mergeOrderCorrectionArgs(existingArgs, sanitized);
          // Gap-fill only empties on the merged pending order — never invent
          // fields onto a sparse correction that would clobber good pending data.
          updatedArgs = gapFillEmptyOrderFieldsFromMessage(updatedArgs, userMessage, customFieldsConfig);
          applyOrderCaptureLocationNormalization(updatedArgs);
          console.info('[AI Agent] order_final_confirm: Grok applied correction', {
            correctionKeys: Object.keys(sanitized),
            correctionAction: sanitized._correctionAction,
          });
          return requestCreateOrderFinalConfirmation(updatedArgs, context, platform, platformId);
        }
      }

      if (pending.type === 'inventory_match_pick') {
        if (isDenial(userMessage) || isExplicitRejection(userMessage)) {
          console.info('[AI Agent] User cancelled inventory_match_pick');
          await clearPendingConfirmation(platform, platformId);
          const text = 'Entendido, cancelé la selección de producto. La orden no se creó. Cuando quieras, envíame los datos de nuevo.';
          await addAssistantTurn(text);
          return { text };
        }

        const matchOptions = Array.isArray(pending.data?.matchOptions) ? pending.data.matchOptions : [];
        const productIndex = typeof pending.data?.productIndex === 'number' ? pending.data.productIndex : 0;
        const chosen = resolveInventoryMatchPick(userMessage, matchOptions);

        if (!chosen) {
          // Keep pending alive and re-prompt.
          await setPendingConfirmation(platform, platformId, pending as any);
          const optionsList = matchOptions.map((m: any, idx: number) =>
            `${idx + 1}. ${m.name} (SKU: ${m.sku})`
          ).join('\n');
          const text = [
            'No pude identificar cuál opción elegiste.',
            '',
            optionsList || 'No hay opciones disponibles.',
            '',
            'Respondé con el número, el SKU, o el nombre exacto. O escribí Cancelar.',
          ].join('\n');
          await addAssistantTurn(text);
          return { text };
        }

        await clearPendingConfirmation(platform, platformId);
        const existingArgs = { ...(pending.data?.toolArgs || {}) };
        const patchedArgs = applyInventoryMatchPickToOrderArgs(existingArgs, productIndex, chosen);
        console.info('[AI Agent] inventory_match_pick resolved', {
          productIndex,
          chosenName: chosen.name,
          chosenSku: chosen.sku,
          productCount: orderProductsFromArgs(patchedArgs).length,
        });

        // Re-enter create_order with the disambiguated line; siblings preserved.
        const confirmedPending = {
          type: 'inventory_confirm',
          data: {
            toolName: 'create_order',
            toolArgs: {
              ...patchedArgs,
              _finalReviewConfirmed: true,
            },
          },
          expiresAt: Date.now() + 120_000,
        };
        const result = await executePendingAction(confirmedPending, context, platform, platformId);
        await addAssistantTurn(sanitizeOrderSuccessForHistory(result));
        return { text: `Seleccionaste *${chosen.name}* (SKU: ${chosen.sku}).\n\n${result}` };
      }

      const confirmed = isConfirmation(userMessage);
      const denied = isDenial(userMessage);

      if (confirmed) {
        await clearPendingConfirmation(platform, platformId);
        const result = await executePendingAction(pending, context, platform, platformId);
        await addAssistantTurn(sanitizeOrderSuccessForHistory(result));
        return { text: result };
      } else if (denied) {
        await clearPendingConfirmation(platform, platformId);
        return { text: '✅ Entendido, acción cancelada.' };
      }
      // Not a confirmation/denial — check if this is a new action request
      if (isActionRequest(userMessage)) {
        console.info('[AI Agent] Clearing stale pending confirmation because the user started a new action');
        await clearPendingConfirmation(platform, platformId);
      }
      // Fall through to normal AI processing
    } else if (isConfirmation(userMessage) || isDenial(userMessage)) {
      // The user sent a bare yes/no but there's no pending action. The most
      // common cause is that a final review expired (2 min TTL). We must NOT
      // fall through to the LLM here: history still contains the assistant's
      // review message, and the model might helpfully re-invoke create_order
      // using that stale data. Give the user a clear, friendly stop instead.
      console.warn('[AI Agent] Yes/no message received without a pending confirmation; stopping safely');
      const text = isConfirmation(userMessage)
        ? 'No tengo nada pendiente que confirmar en este momento. La revisión anterior caducó. Si querés crear la orden, envíame los datos completos de nuevo y preparo la revisión final.'
        : 'No hay ninguna acción pendiente que cancelar. Si necesitás algo más, decime qué hacemos.';
      await addAssistantTurn(text);
      return { text };
    }

    // ── AI-first order extraction ───────────────────────────────────────
    // Grok 4.6 is the brain. When the message looks like an order-creation
    // request, we let the model read it the way a human would and produce
    // the structured fields. The regex parser is NOT layered on top of the
    // AI output — that was actively limiting the model and producing bugs
    // like "dopamine patch x2 x2" (regex doubling the quantity).
    //
    // The only post-processing we do on the AI result is:
    //   - `sanitizeAIExtractedArgs`: drops placeholder values, coerces types.
    //   - `gapFillEmptyOrderFieldsFromMessage`: fills ONLY empty fields from
    //     local heuristics (never overwrites successful AI values).
    //   - `applyOrderCaptureLocationNormalization`: canonicalizes CR province/canton/
    //     district names against the DB (uses the validator's fuzzy matcher,
    //     which also handles "Sanjose" → "San José" etc.).
    //
    // We deliberately do NOT write the message to history before this —
    // same history-safety reason: an expired pending review can't
    // cause the LLM to re-create the order from leftover history.
    if (looksLikeFieldOnlyOrderFragment(userMessage)) {
      console.warn('[AI Agent] Field-only order fragment received with no pending order; refusing LLM reuse');
      await addAssistantTurn(FIELD_ONLY_WITHOUT_PENDING_TEXT);
      return { text: FIELD_ONLY_WITHOUT_PENDING_TEXT };
    }

    if (looksLikeOrderPayload(userMessage)) {
      console.info('[AI Agent] Order-creation intent detected → AI extraction path');
      const aiExtracted = await extractOrderArgsWithGrok(userMessage, customFieldsConfig);

      if (aiExtracted && Object.keys(aiExtracted).length > 0) {
        let args = sanitizeAIExtractedArgs(aiExtracted, customFieldsConfig);
        // Gap-fill ONLY empty fields from local heuristics. Never overwrites
        // AI values — fixes partial Grok misses (unlabeled name, slash location).
        args = gapFillEmptyOrderFieldsFromMessage(args, userMessage, customFieldsConfig);
        if (hasSubstantiveOrderFields(args)) {
          applyOrderCaptureLocationNormalization(args);
          console.info('[AI Agent] Order extraction source=grok -> routing to final review', {
            hasCustomer: !!args.customerName,
            hasProducts: !!args.products,
            hasTotal: args.total !== undefined,
            orderType: args.orderType,
            hasLocation: !!(args.province && args.canton && args.district),
            customFieldKeys: args.customFields ? Object.keys(args.customFields) : [],
          });
          return requestCreateOrderFinalConfirmation(args, context, platform, platformId);
        }

        console.warn('[AI Agent] Grok extraction returned no substantive fields; trying local_order_fallback');
      } else {
        console.warn('[AI Agent] Grok extraction failed/null; trying local_order_fallback');
      }

      const localFallbackArgs = parseLocalStructuredOrderArgs(userMessage, customFieldsConfig);
      if (localFallbackArgs) {
        applyOrderCaptureLocationNormalization(localFallbackArgs);
        console.info('[AI Agent] Order extraction source=local_order_fallback -> routing to final review', {
          hasCustomer: !!localFallbackArgs.customerName,
          hasProducts: !!localFallbackArgs.products,
          hasTotal: localFallbackArgs.total !== undefined,
          orderType: localFallbackArgs.orderType,
          hasLocation: !!(localFallbackArgs.province && localFallbackArgs.canton && localFallbackArgs.district),
          customFieldKeys: localFallbackArgs.customFields ? Object.keys(localFallbackArgs.customFields) : [],
        });
        return requestCreateOrderFinalConfirmation(localFallbackArgs, context, platform, platformId);
      }

      console.warn('[AI Agent] local_order_fallback could not extract enough order fields');
      await addAssistantTurn(ORDER_DETAILS_REQUIRED_TEXT);
      return { text: ORDER_DETAILS_REQUIRED_TEXT };
    }

    // Non-order messages go to the LLM, which needs them in history.
    await addUserMessage(platform, platformId, userMessage, context.operationKey);

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

    const availableToolSchemas = context.operationKey
      ? tenantToolSchemas
      : Object.fromEntries(
          Object.entries(tenantToolSchemas).filter(([name]) => name !== 'generate_invoice'),
        ) as typeof tenantToolSchemas;
    const currentTools = buildToolsArray(availableToolSchemas);

    const tenantName = context.tenantName || 'Negocio';
    const systemPromptWithDate = SYSTEM_PROMPT
      .replace(/\{\{TENANT_NAME\}\}/g, tenantName)
      .replace('{{CURRENT_DATE}}', currentDate)
      .replace('{{CURRENT_TIME}}', currentTime)
      .replace('{{CUSTOM_FIELDS_SECTION}}', customFieldsSection);

    const promptCacheKey = buildPromptCacheKey({
      tenantId: context.tenantId,
      platform,
      platformId,
    });
    const input = toResponsesInputMessages(history.slice(-20));

    // Detect if this is an action request that should require tool execution
    const requiresToolCall = isActionRequest(userMessage);

    if (requiresToolCall) {
      console.log('[AI Agent] 🔧 Action request detected, forcing tool_choice: required');
    }

    // Call xAI Responses API. store:false — do not retain PII on xAI.
    // Tool follow-up replays this response.output in-process; never persist
    // previous_response_id across WhatsApp turns (history sanitization).
    const response = await createXaiResponse({
      input,
      instructions: systemPromptWithDate,
      tools: currentTools,
      toolChoice: requiresToolCall ? 'required' : 'auto',
      promptCacheKey,
      maxOutputTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      reasoningEffort: REASONING_EFFORT,
      includeEncryptedReasoning: true,
    });

    const functionCalls = parseResponseFunctionCalls(response);
    const responseText = parseResponseText(response);

    if (functionCalls.length === 0 && !responseText) {
      throw new Error('No response from AI');
    }

    // SECURITY CHECK: Detect when AI should have called a tool but didn't
    if (requiresToolCall && functionCalls.length === 0) {
      console.warn('[AI Agent] ⚠️ ACTION REQUEST BUT NO TOOL CALLS!');
      console.warn('[AI Agent] Model response failed for a user message', { characterCount: userMessage.length });
      console.warn('[AI Agent] AI returned text instead of the required tool call', {
        characterCount: responseText.length,
      });

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

      await addAssistantTurn(safeResponse);
      return { text: safeResponse };
    }

    // Handle tool calls
    if (functionCalls.length > 0) {
      const toolResults: string[] = [];
      const toolCallsLog: any[] = [];
      const allAttachments: ToolAttachment[] = [];
      const preparedToolCalls = mergeCreateOrderCalls(functionCalls.map((toolCall) => {
        const toolName = toolCall.name as ToolName;
        let toolArgs: any;

        try {
          toolArgs = JSON.parse(toolCall.arguments);
        } catch {
          toolArgs = {};
        }

        const guardedArgs = applyRelativeDateGuards(toolName, toolArgs, userMessage);

        return {
          id: toolCall.id,
          name: toolName,
          args: guardedArgs,
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
          console.error('[AI Agent] Tool failed', { toolName });
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
          } else if (cType === 'multiple_matches') {
            await setPendingConfirmation(platform, platformId, {
              type: 'inventory_match_pick',
              data: {
                toolName: 'create_order',
                toolArgs: {
                  ...(result.pendingOrderData || {}),
                  _finalReviewConfirmed: true,
                },
                productIndex: typeof result.productIndex === 'number' ? result.productIndex : 0,
                matchOptions: result.matchOptions || [],
              },
              expiresAt: Date.now() + 120_000,
            });
          }
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
          await addAssistantTurn(historyText);
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
        await addAssistantTurn(directResponse);
        return { text: directResponse };
      }

      // Stateless follow-up: replay prior output (incl. encrypted reasoning)
      // plus one function_call_output per call_id. No previous_response_id.
      const functionCallOutputs = toFunctionCallOutputs(preparedToolCalls, toolResults);
      const followUpResponse = await createXaiResponse({
        input: buildToolFollowUpInput(response.output, functionCallOutputs),
        instructions: systemPromptWithDate,
        promptCacheKey,
        maxOutputTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        reasoningEffort: REASONING_EFFORT,
        includeEncryptedReasoning: true,
      });

      const finalMessage = parseResponseText(followUpResponse);

      if (finalMessage) {
        await addAssistantTurn(finalMessage);
        return { text: finalMessage, attachments: allAttachments.length > 0 ? allAttachments : undefined };
      }

      const fallback = toolResults.join('\n\n') || 'No pude generar una respuesta. Por favor intenta de nuevo.';
      await addAssistantTurn(fallback);
      return { text: fallback, attachments: allAttachments.length > 0 ? allAttachments : undefined };
    }

    // No tool calls, just return the AI response
    if (responseText) {
      await addAssistantTurn(responseText);
      return { text: responseText };
    }

    return { text: 'Lo siento, no pude procesar tu solicitud.' };

  } catch (error) {
    console.error('[AI Agent] Error processing message', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    if (mutationSuccessText) {
      console.warn('[AI Agent] Surfacing mutation success despite later error in turn.');
      return { text: mutationSuccessText, attachments: mutationSuccessAttachments };
    }
    if (context.operationKey) {
      const retryable = new Error('BOT_PROCESSING_FAILED');
      retryable.name = 'BotProcessingError';
      throw retryable;
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
        .replace(/^âŒ\s*/i, '')
        .replace(/^Error:\s*/i, '')
        + '\n\nEnviame solo los datos faltantes y vuelvo a procesar la orden.';
    }
  }

  // Generic friendly fallback: strip the technical prefixes the executor adds.
  const cleaned = error
    .replace(/^❌\s*/i, '')
    .replace(/^âŒ\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
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

function resolveInventoryMatchPick(
  message: string,
  matchOptions: Array<{ name: string; sku: string; currentStock?: number; sellingPrice?: number }>,
): { name: string; sku: string } | null {
  if (!Array.isArray(matchOptions) || matchOptions.length === 0) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;

  // Numeric pick: "1", "2.", "#3"
  const numeric = trimmed.match(/^[#.]?\s*(\d{1,2})\s*[.)]?$/);
  if (numeric) {
    const index = Number(numeric[1]) - 1;
    if (index >= 0 && index < matchOptions.length) {
      return { name: matchOptions[index].name, sku: matchOptions[index].sku };
    }
    // Bare number outside the option range is not a SKU fragment match.
    return null;
  }

  const normalized = normalizeToolText(trimmed);
  for (const option of matchOptions) {
    const sku = normalizeToolText(option.sku);
    const name = normalizeToolText(option.name);
    if (sku && (normalized === sku || normalized.includes(sku))) {
      return { name: option.name, sku: option.sku };
    }
    if (name && (normalized === name || name.includes(normalized) || normalized.includes(name))) {
      // Avoid tiny fragment matches like "pa" against "patch".
      if (normalized.length >= 3 || normalized === name) {
        return { name: option.name, sku: option.sku };
      }
    }
  }

  return null;
}

function applyInventoryMatchPickToOrderArgs(
  args: Record<string, any>,
  productIndex: number,
  chosen: { name: string; sku: string },
): Record<string, any> {
  const products = orderProductsFromArgs(args);
  if (products.length === 0) {
    return {
      ...args,
      products: [{ name: chosen.name, sku: chosen.sku, quantity: Math.max(1, Number(args.quantity) || 1) }],
      product: chosen.name,
      quantity: Math.max(1, Number(args.quantity) || 1),
    };
  }

  const index = Math.max(0, Math.min(productIndex, products.length - 1));
  const next = products.map((product, i) => {
    if (i !== index) return product;
    return {
      name: chosen.name,
      sku: chosen.sku,
      quantity: Math.max(1, Number(product.quantity) || 1),
    };
  });

  return {
    ...args,
    products: next,
    product: next.map((p) => [p.name, p.sku].filter(Boolean).join(' ')).join('\n'),
    quantity: next.reduce((sum, product) => sum + product.quantity, 0),
  };
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
      if (toolName === 'create_order') {
        return formatted;
      }
      return 'Accion confirmada:\n\n' + formatted;
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
      } else if (toolName === 'create_order' && cType === 'multiple_matches') {
        await setPendingConfirmation(platform, platformId, {
          type: 'inventory_match_pick',
          data: {
            toolName: 'create_order',
            toolArgs: {
              ...(result.pendingOrderData || {}),
              _finalReviewConfirmed: true,
            },
            productIndex: typeof result.productIndex === 'number' ? result.productIndex : 0,
            matchOptions: result.matchOptions || [],
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
