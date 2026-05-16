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
} from './conversation-memory';
import { formatOrderForTelegram, formatInventoryForTelegram, formatStatsForTelegram } from './telegram';
import { formatOrderForWhatsApp, formatInventoryForWhatsApp, formatStatsForWhatsApp } from './whatsapp';
import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getTenantCustomFields, formatCustomFieldsForTelegram } from '@/lib/customFields';
import { getCurrentStatsDateKey, STATS_TIME_ZONE } from '@/lib/statistics-dates';

// xAI client (OpenAI-compatible API)
const xai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

// Model configuration
const MODEL = process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.7;

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
  const match = message.match(/\btotal(?:\s+en\s+\w+)?\s*[:=]?\s*(?:CRC|₡|¢)?\s*([\d.,]+)/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : undefined;
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

  if ((inferred.total === undefined || inferred.total === null) && /\btotal\b/i.test(userMessage)) {
    const total = extractTotalFromMessage(userMessage);
    if (total !== undefined) {
      inferred.total = total;
      repairedFields.push('total');
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

  if (repairedFields.length > 0) {
    console.info('[AI Agent] Repaired create_order args from user message:', repairedFields);
  }

  return inferred;
}

function looksLikeOrderFieldReply(message: string): boolean {
  const normalized = normalizeSpanishText(message);
  return /^productos?\s*(?:\([^)]*\))?\s*:/im.test(message)
    || /^producto\s*(?:\([^)]*\))?\s*:/im.test(message)
    || /\btotal(?:\s+en\s+\w+)?\s*[:=]/i.test(message)
    || /m[eé]todo\s+de\s+pago\s*:/i.test(message)
    || /\b(?:\+?506[\s-]?)?\d{4}[\s-]?\d{4}\b/.test(message)
    || /\b(ra|ea)\b/.test(normalized)
    || normalized.includes('contra entrega');
}

function shouldStoreCreateOrderRepair(result: ToolResult): boolean {
  const error = result.error || '';
  return /producto es requerido|campos faltantes|campos personalizados faltantes/i.test(error);
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

    const totals = group.map((call) => Number(call.args.total) || 0);
    const uniqueTotals = Array.from(new Set(totals));
    base.products = Array.from(productsByKey.values());
    base.product = base.products
      .map((product: any) => [product.name, product.sku].filter(Boolean).join(' '))
      .join('\n');
    base.quantity = base.products.reduce((sum: number, product: any) => sum + product.quantity, 0);
    base.total = uniqueTotals.length === 1 ? uniqueTotals[0] : totals.reduce((sum, total) => sum + total, 0);

    console.warn('[AI Agent] Merged multiple create_order tool calls into one multi-product order', {
      mergedCalls: group.length,
      productLines: base.products.length,
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
  try {
    // Check for pending confirmations first (non-destructive peek)
    const pending = await peekPendingConfirmation(platform, platformId);
    if (pending) {
      if (pending.type === 'order_repair') {
        if (isDenial(userMessage)) {
          await clearPendingConfirmation(platform, platformId);
          return { text: 'Entendido, deje la orden sin procesar.' };
        }

        if (isConfirmation(userMessage)) {
          const responseText = 'Para completar la orden necesito el dato faltante. Enviamelo asi: producto: ENERGY PATCH X1';
          await addAssistantMessage(platform, platformId, responseText);
          return { text: responseText };
        }

        if (isActionRequest(userMessage)) {
          console.info(`[AI Agent] Clearing pending order repair because user started a new action: "${userMessage.substring(0, 60)}"`);
          await clearPendingConfirmation(platform, platformId);
        } else if (looksLikeOrderFieldReply(userMessage)) {
          await clearPendingConfirmation(platform, platformId);
          await addUserMessage(platform, platformId, userMessage);

          const repairedArgs = inferCreateOrderArgsFromMessage(pending.data?.toolArgs || {}, userMessage);
          const repairResponse = await executeCreateOrderRepair(repairedArgs, context, platform, platformId);
          await addAssistantMessage(platform, platformId, repairResponse);
          return { text: repairResponse };
        }
      }

      const confirmed = isConfirmation(userMessage);
      const denied = isDenial(userMessage);

      if (confirmed) {
        await clearPendingConfirmation(platform, platformId);
        const result = await executePendingAction(pending, context, platform);
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
    } else if (isConfirmation(userMessage)) {
      console.warn(`[AI Agent] ⚠️ Confirmation-like message "${userMessage}" received but no pending confirmation found. Pending may have expired or been lost. Falling through to AI with conversation context.`);
    }

    // Add user message to history
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

      for (const toolCall of preparedToolCalls) {
        const toolName = toolCall.name;
        const toolArgs = toolCall.args;

        console.log('[AI Agent] Executing tool: ' + toolName, redactToolArgsForLog(toolName, toolArgs));

        const result = await executeTool(toolName, context, toolArgs, tenantToolSchemas);

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
          let formatted = formatToolResult(toolName, result, platform);

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
        await addAssistantMessage(platform, platformId, directResponse);
        return { text: directResponse, attachments: allAttachments.length > 0 ? allAttachments : undefined };
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

  return `Error: ${error}`;
}

/**
 * Check if message is a confirmation
 */
function isConfirmation(message: string): boolean {
  const confirmations = [
    'sí', 'si', 'sí!', 'si!', 'yes', 'y', 'confirmar', 'confirmado',
    'aceptar', 'aceptado', 'proceder', 'continuar', 'ok', 'de acuerdo'
  ];
  return confirmations.includes(message.toLowerCase().trim());
}

/**
 * Check if message is a denial
 */
function isDenial(message: string): boolean {
  const denials = [
    'no', 'no!', 'cancelar', 'cancelado', 'anular', 'anulado',
    'detener', 'detener', 'parar', 'alto', 'negar', 'negado'
  ];
  return denials.includes(message.toLowerCase().trim());
}

async function executeCreateOrderRepair(
  toolArgs: any,
  context: ToolContext,
  platform: string,
  platformId: string,
): Promise<string> {
  const { tenantToolSchemas } = await updateToolSchemasWithCustomFields(context.tenantId);
  const result = await executeTool('create_order', context, toolArgs, tenantToolSchemas);

  if (result.success) {
    return formatToolResult('create_order', result, platform);
  }

  if (result.needsConfirmation && result.message) {
    const cType = result.confirmationType;
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
    return result.message;
  }

  if (shouldStoreCreateOrderRepair(result)) {
    await setPendingConfirmation(platform, platformId, {
      type: 'order_repair',
      data: {
        toolName: 'create_order',
        toolArgs,
      },
      expiresAt: Date.now() + 120_000,
    });
  }

  return formatToolError('create_order', result);
}

/**
 * Execute a pending action.
 * Pending confirmations are stored as { type, data: { toolName, toolArgs }, expiresAt }.
 */
async function executePendingAction(pending: any, context: ToolContext, platform: string): Promise<string> {
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
      const formatted = formatToolResult(toolName as ToolName, result, platform);
      return '✅ Acción confirmada:\n\n' + formatted;
    } else {
      return formatToolError(toolName as ToolName, result);
    }
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
