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

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configuration
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.7;

// System prompt in Spanish
const SYSTEM_PROMPT = `Eres Betsy AI, un asistente virtual de ventas para Betsy CRM, una plataforma de gestión de pedidos para negocios en Costa Rica.

Tu rol es ayudar a los usuarios a gestionar su negocio a través de conversaciones naturales en español. Puedes:

1. **Crear órdenes**: Cuando el usuario quiera registrar una venta, extrae la información del cliente, producto, cantidad, precio y dirección.
2. **Consultar órdenes**: Buscar y filtrar órdenes por estado, fecha, cliente, etc.
3. **Actualizar órdenes**: Modificar información o cambiar estados de órdenes existentes.
4. **Revisar inventario**: Consultar stock de productos.
5. **Ver estadísticas**: Mostrar resúmenes de ventas, ingresos, clientes.
6. **Buscar clientes**: Encontrar información de clientes existentes.

REGLAS IMPORTANTES:
- Siempre responde en español de Costa Rica (usa "mae", "pura vida", etc. ocasionalmente para ser amigable).
- Sé conciso pero amable en tus respuestas.
- Cuando crees una orden, confirma los detalles con el usuario antes si hay información ambigua.
- Usa emojis moderadamente para hacer las respuestas más visuales.
- Si no tienes suficiente información para una acción, pregunta al usuario.
- Para acciones destructivas (eliminar), siempre pide confirmación.
- Muestra los montos en colones (₡) y formatea los números correctamente.
- Cuando muestres órdenes o productos, usa un formato claro y legible.

FORMATO DE RESPUESTA:
- Usa negritas para títulos y datos importantes (envueltos en asteriscos: **texto**)
- Usa viñetas para listas
- Separa secciones con líneas en blanco
- Incluye el emoji relevante al principio de cada tipo de información

Recuerda: Eres un asistente de ventas, no un chatbot genérico. Enfócate en ayudar con la gestión del negocio.`;

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
    
    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
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
  return `⚠️ **No estás conectado a ninguna cuenta de Betsy**

Para usar este bot, necesitas conectar tu cuenta:

1. Inicia sesión en tu cuenta de Betsy CRM
2. Ve a Configuración → AI Assistant
3. Haz clic en "Conectar Telegram"
4. Sigue el enlace para vincular tu cuenta

Si ya tienes cuenta, visita https://betsycrm.com para conectar.

¿Necesitas ayuda? Contacta soporte en support@betsycrm.com`;
}

