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
      const fieldDef = zodField._def;

      let fieldSchema: any = { type: 'string' };

      // Get the inner type if it's optional
      let innerType = zodField;
      if (fieldDef.typeName === 'ZodOptional') {
        innerType = fieldDef.innerType;
      } else {
        jsonSchema.required.push(key);
      }

      const innerDef = innerType._def;

      // Determine the type
      if (innerDef.typeName === 'ZodString') {
        fieldSchema = { type: 'string' };
      } else if (innerDef.typeName === 'ZodNumber') {
        fieldSchema = { type: 'number' };
      } else if (innerDef.typeName === 'ZodBoolean') {
        fieldSchema = { type: 'boolean' };
      } else if (innerDef.typeName === 'ZodEnum') {
        fieldSchema = { type: 'string', enum: innerDef.values };
      } else if (innerDef.typeName === 'ZodDefault') {
        let defaultInner = innerDef.innerType._def;
        if (defaultInner.typeName === 'ZodOptional') {
          defaultInner = defaultInner.innerType._def;
        }
        if (defaultInner.typeName === 'ZodNumber') {
          fieldSchema = { type: 'number' };
        } else if (defaultInner.typeName === 'ZodString') {
          fieldSchema = { type: 'string' };
        } else if (defaultInner.typeName === 'ZodBoolean') {
          fieldSchema = { type: 'boolean' };
        } else if (defaultInner.typeName === 'ZodEnum') {
          fieldSchema = { type: 'string', enum: defaultInner.values };
        }
        jsonSchema.required = jsonSchema.required.filter((r: string) => r !== key);
      } else if (innerDef.typeName === 'ZodArray') {
        const itemDef = innerDef.type?._def;
        const itemType = itemDef?.typeName === 'ZodNumber' ? 'number' : 'string';
        fieldSchema = { type: 'array', items: { type: itemType } };
      } else if (innerDef.typeName === 'ZodObject') {
        fieldSchema = { type: 'object', properties: {} };
      }

      // Add description if available
      if (zodField.description) {
        fieldSchema.description = zodField.description;
      }

      jsonSchema.properties[key] = fieldSchema;
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

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name as ToolName;
        let toolArgs: any;

        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          toolArgs = {};
        }

        toolArgs = applyRelativeDateGuards(toolName, toolArgs, userMessage);

        console.log('[AI Agent] Executing tool: ' + toolName, toolArgs);

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
          toolResults.push('❌ Error: ' + result.error);
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
      return '❌ Error al ejecutar la acción: ' + result.error;
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
