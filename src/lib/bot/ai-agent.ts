/**
 * Betsy AI Agent
 * 
 * The main AI agent that processes user messages, decides which tools to use,
 * and generates natural Spanish responses. Uses OpenAI GPT-4o with function calling.
 */

import OpenAI from 'openai';
import {
  toolSchemas,
  executeTool,
  ToolContext,
  ToolResult,
  ToolName,
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
import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configuration
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.7;

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
- **EA (Envío a Domicilio)**: El pedido se ENVÍA a la dirección del cliente. Requiere generar guía de envío.
- **RA (Retiro en Local)**: El cliente RECOGE el pedido en tu ubicación. NO requiere envío.
- NUNCA confundas EA con RA. Siempre pregunta si no estás seguro del método de entrega.

REGLAS DE COMPORTAMIENTO:
- Sé profesional, amable y eficiente. Tu nombre es Betsy.
- Usa un tono cordial pero no excesivamente casual. Evita jerga o bromas.
- Sé concisa en tus respuestas pero completa en la información.
- Confirma detalles importantes antes de ejecutar acciones.
- Usa emojis con moderación (solo para categorizar información).
- Si falta información, pregunta de forma clara y directa.
- Para acciones irreversibles (eliminar), siempre pide confirmación explícita.

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
 * Fetch tenant's custom fields configuration
 */
async function getTenantCustomFields(tenantId: string): Promise<string> {
  try {
    const tenantPrisma = getTenantPrisma(tenantId);
    
    // Fetch product fields (Campos Personalizados)
    const productFields = await tenantPrisma.productField.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      include: { 
        optionSet: { 
          include: { options: { where: { active: true } } } 
        } 
      },
    });
    
    // Fetch business info fields
    const businessFields = await tenantPrisma.businessInfo.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });
    
    if (productFields.length === 0 && businessFields.length === 0) {
      return '';
    }
    
    let section = `\nCAMPOS PERSONALIZADOS DEL NEGOCIO:
Este negocio tiene campos personalizados configurados. Cuando crees órdenes, incluye estos campos si el usuario los menciona:\n`;
    
    if (productFields.length > 0) {
      section += '\n**Campos de Producto:**\n';
      productFields.forEach(f => {
        let fieldDesc = `- ${f.label} (${f.key})`;
        if (f.required) fieldDesc += ' [REQUERIDO]';
        if (f.optionSet?.options?.length) {
          const options = f.optionSet.options.map((o: any) => o.label).join(', ');
          fieldDesc += ` - Opciones: ${options}`;
        }
        section += fieldDesc + '\n';
      });
    }
    
    if (businessFields.length > 0) {
      section += '\n**Campos de Negocio:**\n';
      businessFields.forEach((f: any) => {
        let fieldDesc = `- ${f.label} (${f.name})`;
        if (f.required) fieldDesc += ' [REQUERIDO]';
        if (f.type === 'dropdown' && f.options) {
          try {
            const options = JSON.parse(f.options);
            if (Array.isArray(options)) {
              fieldDesc += ` - Opciones: ${options.join(', ')}`;
            }
          } catch {}
        }
        section += fieldDesc + '\n';
      });
    }
    
    section += '\nUsa el parámetro "customFields" en create_order para incluir estos campos adicionales.';
    
    return section;
  } catch (error) {
    console.error('[AI Agent] Error fetching custom fields:', error);
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

// Build tools array for OpenAI
const openaiTools = Object.entries(toolSchemas).map(([name, schema]) =>
  zodToOpenAITool(name, schema)
);

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
        const result = await executePendingAction(pending, context);
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
    const customFieldsSection = await getTenantCustomFields(context.tenantId);
    
    const systemPromptWithDate = SYSTEM_PROMPT
      .replace('{{CURRENT_DATE}}', currentDate)
      .replace('{{CURRENT_TIME}}', currentTime)
      .replace('{{CUSTOM_FIELDS_SECTION}}', customFieldsSection);
    
    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptWithDate },
      ...history.slice(-20), // Keep last 20 messages for context
    ];
    
    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });
    
    const message = response.choices[0]?.message;
    
    if (!message) {
      throw new Error('No response from AI');
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
        
        console.log(`[AI Agent] Executing tool: ${toolName}`, toolArgs);
        
        const result = await executeTool(toolName, context, toolArgs);
        
        toolCallsLog.push({
          name: toolName,
          args: toolArgs,
          result: result.success ? 'success' : 'error',
        });
        
        if (result.success) {
          // Format the result based on tool type
          const formatted = formatToolResult(toolName, result);
          toolResults.push(formatted);
        } else {
          toolResults.push(`❌ Error: ${result.error}`);
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
        ...message.tool_calls.map((tc, i) => ({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: toolResults[i] || 'Tool execution completed',
        })),
      ];
      
      const followUp = await openai.chat.completions.create({
        model: MODEL,
        messages: followUpMessages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      });
      
      const finalResponse = followUp.choices[0]?.message?.content || toolResults.join('\n\n');
      
      // Save assistant response
      await addAssistantMessage(platform, platformId, finalResponse, toolCallsLog);
      
      return finalResponse;
    }
    
    // No tool calls, just return the text response
    const textResponse = message.content || 'Lo siento, no pude procesar tu mensaje.';
    
    // Save assistant response
    await addAssistantMessage(platform, platformId, textResponse);
    
    return textResponse;
  } catch (error: any) {
    console.error('[AI Agent] Error processing message:', error);
    
    // Return a friendly error message
    if (error.code === 'insufficient_quota') {
      return '⚠️ El servicio de AI está temporalmente no disponible. Por favor, intenta más tarde.';
    }
    
    return '😅 Ups, algo salió mal al procesar tu mensaje. ¿Podrías intentar de nuevo?';
  }
}

/**
 * Format tool result for display
 */
function formatToolResult(toolName: ToolName, result: ToolResult): string {
  if (!result.success) {
    return result.error || 'Error desconocido';
  }
  
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
        return formatOrderForTelegram(result.data);
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
        return formatInventoryForTelegram(result.data);
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
        let response = formatStatsForTelegram(stats);
        
        if (stats.topProducts && stats.topProducts.length > 0) {
          response += '\n\n🏆 **Top Productos:**\n';
          response += stats.topProducts
            .map((p: any, i: number) => `${i + 1}. ${p.product} (${p.count} ventas)`)
            .join('\n');
        }
        
        return response;
      }
      return 'No hay estadísticas disponibles.';
      
    case 'search_clients':
      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data
          .map((client: any) =>
            `👤 ${client.name}\n   📱 ${client.phone || 'N/A'} | 🛒 ${client.totalOrders} órdenes | ₡${(client.totalSpent || 0).toLocaleString('es-CR')}`
          )
          .join('\n\n');
      }
      return 'No se encontraron clientes.';
      
    default:
      return result.message || JSON.stringify(result.data, null, 2);
  }
}

/**
 * Check if a message is a confirmation
 */
function isConfirmation(message: string): boolean {
  const confirmWords = ['sí', 'si', 'yes', 'confirmar', 'confirmo', 'dale', 'ok', 'okay', 'claro', 'adelante', 'hazlo', 'procede'];
  const lower = message.toLowerCase().trim();
  return confirmWords.some((word) => lower === word || lower.startsWith(word + ' '));
}

/**
 * Check if a message is a denial
 */
function isDenial(message: string): boolean {
  const denyWords = ['no', 'cancelar', 'cancela', 'detener', 'para', 'stop', 'mejor no', 'dejalo'];
  const lower = message.toLowerCase().trim();
  return denyWords.some((word) => lower === word || lower.startsWith(word + ' '));
}

/**
 * Execute a pending action after confirmation
 */
async function executePendingAction(
  pending: { type: string; data: Record<string, unknown> },
  context: ToolContext
): Promise<string> {
  // This would handle confirmed destructive actions
  // For now, we don't have any that require confirmation
  return '✅ Acción ejecutada.';
}

/**
 * Generate a welcome message for newly connected users
 */
export function generateWelcomeMessage(userName: string, tenantName: string): string {
  return `🎉 **¡Hola ${userName}!**

¡Pura vida! Ya estás conectado a **${tenantName}** en Betsy AI.

Ahora puedes gestionar tu negocio con comandos naturales. Por ejemplo:

📦 "Muéstrame las órdenes pendientes"
➕ "Crea una orden para Juan, 2 camisetas, ₡15000"
📊 "¿Cuánto vendí esta semana?"
📋 "Busca el stock del producto X"
👤 "Busca al cliente María López"

¿En qué puedo ayudarte hoy?`;
}

/**
 * Generate an error message for unauthorized users
 */
export function generateUnauthorizedMessage(): string {
  return `⚠️ <b>No estás conectado</b>

Para conectarte, necesitas un código de acceso de 12 caracteres.

<b>¿Cómo conectarse?</b>

1. Pide a tu administrador el código de acceso
2. Envía: <code>/start CODIGO123ABC</code>
3. Proporciona tu nombre cuando te lo pida
4. ¡Listo!

<b>¿Eres administrador?</b>
Obtén tu código en: https://www.betsycrm.com/config/ai-assistant

¿Necesitas ayuda? Contacta soporte en support@betsycrm.com`;
}

