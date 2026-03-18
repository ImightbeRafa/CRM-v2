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
  updateToolSchemasWithCustomFields,
  getFormattedCustomFieldsForOrder,
} from './ai-tools';
import {
  getFormattedHistory,
  addUserMessage,
  addAssistantMessage,
  getPendingConfirmation,
  setPendingConfirmation,
  clearPendingConfirmation,
} from './conversation-memory';
import { formatOrderForTelegram, formatInventoryForTelegram, formatStatsForTelegram } from './telegram';
import { formatOrderForWhatsApp, formatInventoryForWhatsApp, formatStatsForWhatsApp } from './whatsapp';
import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getTenantCustomFields, formatCustomFieldsForTelegram } from '@/lib/customFields';

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
  // Shipping
  'generar guía', 'genera guía', 'crear guía', 'guía de envío',
];

/**
 * Check if a message looks like an action request that requires tool execution
 */
function isActionRequest(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return ACTION_KEYWORDS.some(keyword => normalized.includes(keyword));
}

// System prompt in Spanish
const SYSTEM_PROMPT = `Eres Betsy, una asistente virtual profesional para Betsy CRM, una plataforma de gestión de pedidos para negocios en Costa Rica.

FECHA ACTUAL: {{CURRENT_DATE}}
HORA ACTUAL: {{CURRENT_TIME}}

Tu rol es ayudar a los usuarios a gestionar su negocio de manera eficiente y profesional. Puedes:

1. **Crear órdenes**: Registrar ventas con información completa del cliente, productos, precios y dirección de entrega.
2. **Consultar órdenes**: Buscar y filtrar órdenes por estado, fecha, cliente, o cualquier criterio.
3. **Actualizar órdenes**: Modificar información o cambiar estados de órdenes existentes.
4. **Gestionar inventario**: Consultar stock, agregar o reducir cantidades de productos.
5. **Ver estadísticas y reportes**: Mostrar resúmenes de ventas, ingresos, productos más vendidos, etc.
6. **Buscar clientes**: Encontrar información de clientes y su historial de compras.
7. **Generar guías de envío**: Crear guías MANUALES para envíos (siempre manual, nunca automático).

CONCEPTOS IMPORTANTES DE ENVÍO:
- **EA (Envío a Domicilio)**: El pedido se ENVÍA a la dirección del cliente. Requiere dirección, provincia, y generar guía de envío.
- **RA (Retiro en Local)**: El cliente RECOGE el pedido en tu ubicación. NO requiere dirección, provincia, cantón, distrito, ni envío.
- NUNCA confundas EA con RA. Siempre pregunta si no estás seguro del método de entrega.
- **CRÍTICO**: Siempre pasa el campo orderType al crear una orden. Si el usuario dice "RA", "retiro", o "retiro en local", usa orderType="RA". Si dice "EA", "envío", o "envío a domicilio", usa orderType="EA". Si no lo especifica, PREGUNTA antes de crear la orden.
- Cuando orderType es "RA", NO incluyas ni pidas dirección, provincia, cantón, distrito, ni método de envío.

REGLAS DE COMPORTAMIENTO:
- Sé profesional, amable y eficiente. Tu nombre es Betsy.
- Usa un tono cordial pero no excesivamente casual. Evita jerga o bromas.
- Sé concisa en tus respuestas pero completa en la información.
- Confirma detalles importantes antes de ejecutar acciones.
- Usa emojis con moderación (solo para categorizar información).
- Si falta información, pregunta de forma clara y directa.
- Para acciones irreversibles (eliminar), siempre pide confirmación explícita.

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
- Cuando se solicite generar una guía, SIEMPRE genera guía MANUAL (tipo: "manual")
- Proporciona el enlace al PDF generado
- Confirma que la guía está lista para imprimir

GESTIÓN DE STOCK:
- Cuando el usuario diga "agregar X al stock de [producto]", actualiza el inventario
- Cuando diga "reducir stock de [producto] en Y", resta del inventario
- Confirma los cambios realizados con el stock anterior y nuevo

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
        // Handle default values
        const defaultInner = innerDef.innerType._def;
        if (defaultInner.typeName === 'ZodNumber') {
          fieldSchema = { type: 'number' };
        } else if (defaultInner.typeName === 'ZodString') {
          fieldSchema = { type: 'string' };
        } else if (defaultInner.typeName === 'ZodEnum') {
          fieldSchema = { type: 'string', enum: defaultInner.values };
        }
        // Remove from required since it has a default
        jsonSchema.required = jsonSchema.required.filter((r: string) => r !== key);
      } else if (innerDef.typeName === 'ZodObject') {
        // Nested object
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

// Build tools array dynamically (must be called after schema updates)
function buildToolsArray() {
  return Object.entries(toolSchemas).map(([name, schema]) =>
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
): Promise<string> {
  try {
    // Check for pending confirmations first
    const pending = await getPendingConfirmation(platform, platformId);
    if (pending) {
      const confirmed = isConfirmation(userMessage);
      const denied = isDenial(userMessage);

      if (confirmed) {
        // Execute the pending action
        const result = await executePendingAction(pending, context, platform);
        await clearPendingConfirmation(platform, platformId);
        return result;
      } else if (denied) {
        await clearPendingConfirmation(platform, platformId);
        return '✅ Entendido, acción cancelada.';
      }
      // If neither, continue with normal processing
    }

    // Add user message to history
    await addUserMessage(platform, platformId, userMessage);

    // Get conversation history
    const history = await getFormattedHistory(platform, platformId);

    // Inject current date and time into system prompt
    const now = new Date();
    const currentDate = now.toLocaleDateString('es-CR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const currentTime = now.toLocaleTimeString('es-CR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    // Fetch tenant's custom fields
    const customFieldsSection = await getCustomFieldsSection(context.tenantId);

    // Update tool schemas with tenant-specific custom fields
    await updateToolSchemasWithCustomFields(context.tenantId);

    // Build tools array AFTER schema updates to include custom fields
    const currentTools = buildToolsArray();

    const systemPromptWithDate = SYSTEM_PROMPT
      .replace('{{CURRENT_DATE}}', currentDate)
      .replace('{{CURRENT_TIME}}', currentTime)
      .replace('{{CUSTOM_FIELDS_SECTION}}', customFieldsSection);

    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptWithDate },
      ...history.slice(-20), // Keep last 20 messages for context
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
      // Force tool calls for action requests to prevent hallucinated responses
      tool_choice: requiresToolCall ? 'required' : 'auto',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error('No response from AI');
    }

    // SECURITY CHECK: Detect when AI should have called a tool but didn't
    // This prevents the AI from hallucinating success without executing tools
    if (requiresToolCall && (!message.tool_calls || message.tool_calls.length === 0)) {
      console.warn('[AI Agent] ⚠️ ACTION REQUEST BUT NO TOOL CALLS!');
      console.warn('[AI Agent] User message:', userMessage);
      console.warn('[AI Agent] AI response (text only):', message.content?.slice(0, 300));

      // Return a message that asks for more details instead of allowing hallucinated success
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
      return safeResponse;
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolResults: string[] = [];
      const toolCallsLog: any[] = [];

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name as ToolName;
        let toolArgs: any;

        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          toolArgs = {};
        }

        console.log('[AI Agent] Executing tool: ' + toolName, toolArgs);

        const result = await executeTool(toolName, context, toolArgs);

        // Enhanced logging for debugging
        if (result.success) {
          console.log(`[AI Agent] ✅ Tool ${toolName} executed successfully`);
          if (result.data && typeof result.data === 'object' && 'orderId' in result.data) {
            console.log(`[AI Agent] 📦 Order created with ID: ${(result.data as any).orderId}`);
          }
        } else {
          console.error(`[AI Agent] ❌ Tool ${toolName} failed:`, result.error);
        }

        toolCallsLog.push({
          name: toolName,
          args: toolArgs,
          result: result.success ? 'success' : 'error',
        });

        if (result.success) {
          const formatted = formatToolResult(toolName, result, platform);
          toolResults.push(formatted);
        } else {
          toolResults.push('❌ Error: ' + result.error);
        }
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
        return finalMessage;
      }

      // Build a meaningful fallback from tool results instead of generic "Processing..."
      const fallback = toolResults.join('\n\n') || 'No pude generar una respuesta. Por favor intenta de nuevo.';
      await addAssistantMessage(platform, platformId, fallback);
      return fallback;
    }

    // No tool calls, just return the AI response
    if (message.content) {
      await addAssistantMessage(platform, platformId, message.content);
      return message.content;
    }

    return 'Lo siento, no pude procesar tu solicitud.';

  } catch (error) {
    console.error('[AI Agent] Error processing message:', error);
    return 'Lo siento, ocurrió un error al procesar tu mensaje. Por favor, intenta de nuevo.';
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
        return formatOrder(result.data);
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
      return 'Producto no encontrado.';

    case 'search_inventory':
      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data
          .map((item: any) =>
            `📦 ${item.name} (${item.sku})\n   Stock: ${item.currentStock} | ₡${(item.sellingPrice || 0).toLocaleString('es-CR')}`
          )
          .join('\n\n');
      }
      return 'No se encontraron productos.';

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
 * Execute a pending action
 */
async function executePendingAction(pending: any, context: ToolContext, platform: string): Promise<string> {
  try {
    const result = await executeTool(pending.toolName as ToolName, context, pending.toolArgs);

    if (result.success) {
      const formatted = formatToolResult(pending.toolName as ToolName, result, platform);
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