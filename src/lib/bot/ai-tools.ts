/**
 * AI Tools for Betsy Sales Assistant
 * 
 * Defines all the tools (function calls) that the AI can use to interact
 * with Betsy's backend APIs. Each tool maps to existing API routes.
 * 
 * Tools are executed in the context of the user's tenant.
 */

import { z } from 'zod';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { prisma } from '@/lib/db';
import { checkOrderLimit } from '@/lib/plan-enforcement';
import {
  addDaysToStatsDateKey,
  buildStatsDateRange,
  buildStatsOrderDateWhere,
  getCurrentStatsDateKey,
  normalizeStatsDateInput,
} from '@/lib/statistics-dates';
import { 
  getTenantCustomFields, 
  extractCustomFields, 
  validateCustomFields,
  formatCustomFieldsForTelegram,
  getCustomFieldsSchema,
  CustomFieldsData 
} from '@/lib/customFields';

// Tool execution context
export interface ToolContext {
  tenantId: string;
  tenantName?: string;
  userId: string;
  userName: string;
  userRole: string;
}

// Attachment returned by tools (e.g. PDF guía)
export interface ToolAttachment {
  type: 'pdf';
  buffer: Buffer;
  filename: string;
  caption?: string;
}

// Tool result type
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  attachments?: ToolAttachment[];
  needsConfirmation?: boolean;
  confirmationType?: 'no_match' | 'zero_stock' | 'multiple_matches';
  pendingOrderData?: Record<string, unknown>;
}

// ============================================================================
// TOOL SCHEMAS (for AI function calling)
// ============================================================================

// Base order schema without custom fields
const baseOrderSchema = {
  customerName: z.string().describe('Nombre completo del cliente'),
  phone: z.string().optional().describe('Número de teléfono del cliente'),
  email: z.union([z.string().email(), z.literal('')]).optional().describe('Email del cliente'),
  product: z.string().describe('Nombre o descripción del producto'),
  quantity: z.number().int().min(1).default(1).describe('Cantidad del producto'),
  total: z.number().min(0).describe('Total de la orden en colones'),
  address: z.string().optional().describe('Dirección de entrega completa'),
  province: z.string().optional().describe('Provincia de Costa Rica'),
  canton: z.string().optional().describe('Cantón'),
  district: z.string().optional().describe('Distrito'),
  courier: z.string().optional().describe('Método de envío o courier'),
  paymentMethod: z.string().optional().describe('Método de pago del cliente (SINPE Móvil, transferencia, efectivo, etc). NO es el método de envío/courier.'),
  comments: z.string().optional().describe('Comentarios o notas adicionales'),
  orderType: z.enum(['EA', 'RA']).describe('REQUERIDO: Tipo de orden. EA = Envío a Domicilio (requiere dirección), RA = Retiro en Local (NO requiere dirección). SIEMPRE debe especificarse.'),
  size: z.string().optional().describe('Talla o tamaño del producto (si está configurado)'),
  color: z.string().optional().describe('Color del producto (si está configurado)'),
  contraEntrega: z.boolean().optional().default(false).describe('Si el pedido es contra entrega (pago al recibir). Marcar como true cuando el cliente dice "contra entrega", "pago contra entrega", "COD", "paga al recibir", "pagar al recibir" o similar.'),
  skipInventoryCheck: z.boolean().optional().default(false).describe('Poner en true SOLO cuando el usuario ya confirmó explícitamente que desea proceder sin que el producto esté en inventario. Nunca activar por defecto.'),
};

// Dynamic schema generator that includes custom fields
function createOrderSchemaWithCustomFields(customFieldsConfig: CustomFieldsData) {
  const customFieldsSchema = getCustomFieldsSchema(customFieldsConfig);
  
  return {
    description: 'Crear una nueva orden de venta. Úsalo cuando el usuario quiera registrar una nueva venta o pedido.',
    parameters: z.object({
      ...baseOrderSchema,
      ...customFieldsSchema,
    }),
  };
}

// Dynamic update_order schema that includes custom fields inside the updates object
function updateOrderSchemaWithCustomFields(customFieldsConfig: CustomFieldsData) {
  const customFieldsSchema = getCustomFieldsSchema(customFieldsConfig);

  // All custom fields are optional for updates
  const optionalCustomFields: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(customFieldsSchema)) {
    optionalCustomFields[key] = schema instanceof z.ZodOptional ? schema : schema.optional();
  }

  return {
    description: 'Actualizar campos de una orden existente.',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden a actualizar'),
      updates: z.object({
        customerName: z.string().optional(),
        phone: z.string().optional(),
        email: z.union([z.string().email(), z.literal('')]).optional(),
        product: z.string().optional(),
        quantity: z.number().int().min(1).optional(),
        size: z.string().optional(),
        color: z.string().optional(),
        total: z.number().min(0).optional(),
        address: z.string().optional(),
        province: z.string().optional(),
        canton: z.string().optional(),
        district: z.string().optional(),
        courier: z.string().optional(),
        comments: z.string().optional(),
        ...optionalCustomFields,
      }).describe('Campos a actualizar (incluye campos personalizados del negocio)'),
    }),
  };
}

export const toolSchemas = {
  // Order Management - will be dynamically updated with custom fields
  create_order: {
    description: 'Crear una nueva orden de venta. Úsalo cuando el usuario quiera registrar una nueva venta o pedido.',
    parameters: z.object({
      ...baseOrderSchema,
      // Custom fields will be added dynamically based on tenant configuration
    }),
  },

  get_orders: {
    description: 'Obtener lista de órdenes con filtros opcionales. Úsalo para buscar o listar órdenes existentes.',
    parameters: z.object({
      status: z.string().optional().describe('Filtrar por estado (Pendiente, En Proceso, Completado, etc)'),
      search: z.string().optional().describe('Buscar por nombre de cliente, ID de orden, o producto'),
      dateFrom: z.string().optional().describe('Fecha inicial del rango (YYYY-MM-DD)'),
      dateTo: z.string().optional().describe('Fecha final del rango (YYYY-MM-DD)'),
      limit: z.number().int().min(1).max(50).default(10).describe('Cantidad máxima de resultados'),
      orderType: z.enum(['EA', 'RA']).optional().describe('Filtrar por tipo de orden'),
      seller: z.string().optional().describe('Filtrar por vendedor'),
    }),
  },

  get_order_details: {
    description: 'Obtener detalles completos de una orden específica.',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden (ej: ORDER-123 o 123)'),
    }),
  },

  update_order: {
    description: 'Actualizar campos de una orden existente.',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden a actualizar'),
      updates: z.object({
        customerName: z.string().optional(),
        phone: z.string().optional(),
        email: z.union([z.string().email(), z.literal('')]).optional(),
        product: z.string().optional(),
        quantity: z.number().int().min(1).optional(),
        size: z.string().optional(),
        color: z.string().optional(),
        total: z.number().min(0).optional(),
        address: z.string().optional(),
        province: z.string().optional(),
        canton: z.string().optional(),
        district: z.string().optional(),
        courier: z.string().optional(),
        comments: z.string().optional(),
      }).describe('Campos a actualizar'),
    }),
  },

  update_order_status: {
    description: 'Cambiar el estado de una orden. SOLO usa esta herramienta cuando el usuario EXPLÍCITAMENTE pide cambiar el estado de una orden. NUNCA cambies el estado como efecto secundario de otra acción (crear, consultar, etc).',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden'),
      status: z.enum(['Pendiente', 'En Proceso', 'Completado', 'Enviado', 'Entregado', 'Cancelado']).describe('Nuevo estado de la orden'),
    }),
  },

  // Inventory Management
  get_inventory_item: {
    description: 'Obtener detalles de un ítem específico de inventario.',
    parameters: z.object({
      sku: z.string().optional().describe('SKU del producto'),
      name: z.string().optional().describe('Nombre del producto'),
    }),
  },

  search_inventory: {
    description: 'Buscar productos en el inventario. Devuelve como máximo 15 ítems por llamada — NUNCA listes el catálogo completo al cliente: si tiene cientos de productos, pide que refine la búsqueda por nombre, SKU o categoría. Si el usuario pide "todo el inventario", responde con un resumen por categoría en vez de listar todos los productos.',
    parameters: z.object({
      query: z.string().optional().describe('Término de búsqueda (nombre, SKU, categoría). Vacío devuelve solo los primeros resultados.'),
      category: z.string().optional().describe('Filtrar por categoría'),
      lowStock: z.boolean().optional().describe('Solo mostrar productos con stock bajo'),
      limit: z.number().int().min(1).max(15).default(5).describe('Cantidad máxima de resultados (máx 15). Mantener bajo para no saturar el chat.'),
    }),
  },

  update_inventory_stock: {
    description: 'Actualizar el stock de un producto. Úsalo cuando el usuario diga "agregar X al stock" o "reducir stock en Y".',
    parameters: z.object({
      productId: z.string().describe('ID del producto o nombre del producto'),
      change: z.number().int().describe('Cantidad a cambiar (positivo para agregar, negativo para reducir)'),
      reason: z.string().optional().describe('Razón del cambio (restock, venta, daño, etc)'),
    }),
  },

  // Statistics
  get_statistics_summary: {
    description: 'Obtener resumen de estadísticas de ventas.',
    parameters: z.object({
      dateFrom: z.string().optional().describe('Fecha inicial (YYYY-MM-DD). Si no se especifica, usa los últimos 30 días'),
      dateTo: z.string().optional().describe('Fecha final (YYYY-MM-DD)'),
    }),
  },

  // Client Management
  search_clients: {
    description: 'Buscar clientes en la base de datos.',
    parameters: z.object({
      query: z.string().describe('Buscar por nombre, teléfono o email'),
      limit: z.number().int().min(1).max(20).default(5).describe('Cantidad máxima de resultados'),
    }),
  },

  // Shipping
  generate_shipping_guia: {
    description: 'Generar guía de envío para una orden. Modo "auto" genera guía real de Correos de Costa Rica con PDF y tracking. Modo "manual" genera una guía simple con PDF de etiqueta (sin Correos WS, sin tracking).',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden para generar guía'),
      mode: z.enum(['auto', 'manual']).default('auto').describe('auto = Correos CR con PDF y tracking, manual = etiqueta PDF simple sin tracking'),
    }),
  },

  // Bulk shipping
  generate_guias_bulk: {
    description: 'Generar guías de envío de Correos de Costa Rica para múltiples órdenes a la vez. Devuelve los PDFs de las guías generadas.',
    parameters: z.object({
      orderIds: z.array(z.string()).min(1).max(10).describe('Lista de IDs de órdenes (máximo 10)'),
    }),
  },

  // Location validation (standalone only — create_order validates internally)
  validate_order_location: {
    description: 'SOLO para consultas de ubicación independientes. NO uses esta herramienta si vas a crear una orden — create_order ya valida la ubicación internamente. Úsalo ÚNICAMENTE cuando el usuario pide verificar una ubicación SIN crear orden, o necesita ver las opciones disponibles de cantones/distritos.',
    parameters: z.object({
      province: z.string().describe('Provincia de Costa Rica'),
      canton: z.string().optional().describe('Cantón (opcional, se valida dentro de la provincia)'),
      district: z.string().optional().describe('Distrito (opcional, se valida dentro del cantón)'),
    }),
  },
};

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * Update tool schemas with tenant-specific custom fields
 * This should be called when initializing the AI tools for a specific tenant
 */
export async function updateToolSchemasWithCustomFields(tenantId: string) {
  try {
    const customFieldsConfig = await getTenantCustomFields(tenantId);
    const dynamicCreateSchema = createOrderSchemaWithCustomFields(customFieldsConfig);
    const dynamicUpdateSchema = updateOrderSchemaWithCustomFields(customFieldsConfig);
    
    return {
      customFieldsConfig,
      tenantToolSchemas: {
        ...toolSchemas,
        create_order: dynamicCreateSchema,
        update_order: dynamicUpdateSchema,
      },
    };
  } catch (error) {
    console.error('[AI Tools] Failed to update schemas with custom fields:', error);
    return { customFieldsConfig: { productFields: [], businessInfoFields: [] }, tenantToolSchemas: toolSchemas };
  }
}

/**
 * Get formatted custom fields for order display in Telegram
 */
export async function getFormattedCustomFieldsForOrder(orderId: string, tenantId: string): Promise<string[]> {
  try {
    const customFieldsConfig = await getTenantCustomFields(tenantId);
    const tenantPrisma = getTenantPrisma(tenantId);
    
    const order = await tenantPrisma.order.findFirst({
      where: {
        OR: [
          { orderId },
          { id: orderId },
        ],
      },
    });
    
    if (!order) {
      return [];
    }
    
    // Extract custom fields from the order
    const customFields = extractCustomFields(order, customFieldsConfig);
    
    return formatCustomFieldsForTelegram(customFields, customFieldsConfig);
  } catch (error) {
    console.error('[AI Tools] Failed to get formatted custom fields:', error);
    return [];
  }
}

/**
 * Validate base order fields and return specific errors
 */
function validateBaseOrderFields(params: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required fields
  if (!params.customerName || params.customerName.trim() === '') {
    errors.push('Nombre del cliente es requerido');
  }
  
  if (!params.product || params.product.trim() === '') {
    errors.push('Producto es requerido');
  }
  
  if (params.total === undefined || params.total === null || params.total < 0) {
    errors.push('Total es requerido y debe ser mayor o igual a 0');
  }
  
  // Validate orderType is explicitly provided
  if (!params.orderType) {
    errors.push('Tipo de orden no especificado. Pregunta al usuario: ¿Es envío a domicilio (EA) o retiro en local (RA)?');
  }
  
  // For EA (shipping orders), address fields are important
  const orderType = params.orderType;
  if (orderType === 'EA') {
    if (!params.province || params.province.trim() === '') {
      errors.push('Provincia es requerida para envío a domicilio (EA). Pregunta la provincia al cliente.');
    }
    if (!params.address || params.address.trim() === '') {
      errors.push('Dirección es requerida para envío a domicilio (EA). Pregunta la dirección al cliente.');
    }
  }
  
  // Phone validation (optional but should be valid format if provided)
  if (params.phone && params.phone.trim() !== '') {
    const cleanPhone = params.phone.replace(/\D/g, '');
    if (cleanPhone.length < 8) {
      errors.push('Teléfono debe tener al menos 8 dígitos');
    }
  }
  
  // Email validation (optional but should be valid format if provided)
  if (params.email && params.email.trim() !== '') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(params.email)) {
      errors.push('Email tiene formato inválido');
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

// ============================================================================
// CLIENT SYNC FOR BOT ORDERS
// ============================================================================

async function syncClientFromOrder(
  tenantPrisma: ReturnType<typeof getTenantPrisma>,
  ctx: ToolContext,
  orderData: {
    customerName: string;
    phone: string;
    email: string;
    address: string;
    province: string;
    canton: string;
    district: string;
    total: number;
  }
): Promise<void> {
  const phone = orderData.phone?.trim();
  if (!phone) return;

  const existingClient = await tenantPrisma.client.findFirst({
    where: { phone, isActive: true },
  });

  if (existingClient) {
    const newTotalOrders = existingClient.totalOrders + 1;
    const newTotalSpent = existingClient.totalSpent + (orderData.total || 0);

    await tenantPrisma.client.update({
      where: { id: existingClient.id },
      data: {
        name: orderData.customerName || existingClient.name,
        email: orderData.email || existingClient.email,
        province: orderData.province || existingClient.province,
        canton: orderData.canton || existingClient.canton,
        district: orderData.district || existingClient.district,
        address: orderData.address || existingClient.address,
        totalOrders: newTotalOrders,
        totalSpent: newTotalSpent,
        averageOrderValue: newTotalOrders > 0 ? newTotalSpent / newTotalOrders : 0,
        lastOrder: new Date(),
        lastUpdated: new Date(),
      },
    });
    console.log(`[AI Tool] syncClient - Updated existing client: ${existingClient.id} (${phone})`);
  } else {
    await tenantPrisma.client.create({
      data: {
        tenantId: ctx.tenantId,
        name: orderData.customerName || 'Cliente sin nombre',
        phone,
        email: orderData.email || '',
        province: orderData.province || '',
        canton: orderData.canton || '',
        district: orderData.district || '',
        address: orderData.address || '',
        totalOrders: 1,
        totalSpent: orderData.total || 0,
        averageOrderValue: orderData.total || 0,
        firstOrder: new Date(),
        lastOrder: new Date(),
        isActive: true,
        isFavorite: false,
        isAutoGenerated: true,
        createdBy: ctx.userId,
      },
    });
    console.log(`[AI Tool] syncClient - Created new client for phone: ${phone}`);
  }
}

// ============================================================================
// INVENTORY MATCHING FOR BOT ORDERS
// ============================================================================

interface InventoryMatch {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string | null;
  currentStock: number;
  sellingPrice: number;
  confidence: number; // 1 = exact SKU, 2 = exact name, 3 = partial name, 4 = category, 5 = description
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Search inventory items for matches against a product string.
 * Returns matches sorted by confidence (lower = better).
 */
async function findInventoryMatches(
  productQuery: string,
  tenantPrisma: any
): Promise<InventoryMatch[]> {
  const items = await tenantPrisma.inventoryItem.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      description: true,
      currentStock: true,
      sellingPrice: true,
    },
  });

  if (items.length === 0) return [];

  const query = normalizeText(productQuery);
  const matches: InventoryMatch[] = [];

  for (const item of items) {
    const sku = normalizeText(item.sku || '');
    const name = normalizeText(item.name);
    const category = normalizeText(item.category || '');
    const description = normalizeText(item.description || '');

    let confidence = 0;

    if (sku && sku === query) {
      confidence = 1; // exact SKU
    } else if (name === query) {
      confidence = 2; // exact name
    } else if (name.includes(query) || query.includes(name)) {
      confidence = 3; // partial name
    } else if (category && (category.includes(query) || query.includes(category))) {
      confidence = 4; // category
    } else if (description && (description.includes(query) || query.includes(description))) {
      confidence = 5; // description
    }

    if (confidence > 0) {
      matches.push({
        id: item.id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        description: item.description,
        currentStock: item.currentStock,
        sellingPrice: item.sellingPrice,
        confidence,
      });
    }
  }

  matches.sort((a, b) => a.confidence - b.confidence);
  return matches;
}

/**
 * Create a new order with proper custom fields support
 */
export async function createOrder(
  ctx: ToolContext,
  params: any // Use any to accept dynamic custom fields
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const planCheck = await checkOrderLimit(ctx.tenantId);
        if (!planCheck.allowed) {
          return {
            success: false,
            error: `❌ ${planCheck.message}`,
          };
        }

        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const timestamp = Date.now();
        const orderId = `BOT-${timestamp}`;
        
        // STEP 1: Validate base order fields first
        const baseValidation = validateBaseOrderFields(params);
        if (!baseValidation.isValid) {
          const errorMessage = `❌ Campos faltantes o inválidos:\n${baseValidation.errors.map(e => `• ${e}`).join('\n')}`;
          console.log('[AI Tool] createOrder - Base validation failed:', baseValidation.errors);
          return {
            success: false,
            error: errorMessage,
          };
        }

        // STEP 1.5: Validate location hierarchy for EA orders
        const locationCorrections: string[] = [];
        if (params.orderType === 'EA' && params.province) {
          const { validateLocation, formatValidationMessage } = await import('@/lib/locationValidator');
          const locResult = validateLocation(params.province, params.canton, params.district);

          if (!locResult.valid) {
            const msg = formatValidationMessage(locResult);
            console.log('[AI Tool] createOrder - Location validation failed:', msg);
            return {
              success: false,
              error: `❌ Ubicación inválida:\n${msg}`,
            };
          }

          if (locResult.correctedProvince) {
            locationCorrections.push(`Provincia: "${params.province}" → "${locResult.correctedProvince}"`);
            params.province = locResult.correctedProvince;
          }
          if (locResult.correctedCanton) {
            locationCorrections.push(`Cantón: "${params.canton}" → "${locResult.correctedCanton}"`);
            params.canton = locResult.correctedCanton;
          }
          if (locResult.correctedDistrict) {
            locationCorrections.push(`Distrito: "${params.district}" → "${locResult.correctedDistrict}"`);
            params.district = locResult.correctedDistrict;
          }
        }
        
        // STEP 2: Get tenant custom fields configuration
        const customFieldsConfig = await getTenantCustomFields(ctx.tenantId);
        console.log('[AI Tool] createOrder - Custom fields config:', {
          productFields: customFieldsConfig.productFields.length,
          businessInfoFields: customFieldsConfig.businessInfoFields.length
        });
        
        // STEP 3: Extract and validate custom fields
        const extractedCustomFields = extractCustomFields(params, customFieldsConfig);
        console.log('[AI Tool] createOrder - Extracted customFields:', JSON.stringify(extractedCustomFields, null, 2));
        
        // Validate required custom fields
        const customValidation = validateCustomFields(extractedCustomFields, customFieldsConfig);
        if (!customValidation.isValid) {
          const errorMessage = `❌ Campos personalizados faltantes:\n${customValidation.errors.map(e => `• ${e}`).join('\n')}`;
          console.log('[AI Tool] createOrder - Custom fields validation failed:', customValidation.errors);
          return {
            success: false,
            error: errorMessage,
          };
        }
        
        // STEP 4: Inventory lookup (unless forced to skip)
        let matchedInventoryItem: InventoryMatch | null = null;
        const quantity = params.quantity || 1;

        if (!params._forceWithoutInventory && !params.skipInventoryCheck) {
          const matches = await findInventoryMatches(params.product, tenantPrisma);
          console.log('[AI Tool] createOrder - Inventory matches:', matches.length, 'for product:', params.product);

          if (matches.length === 0) {
            console.log('[AI Tool] createOrder - No inventory match, requesting confirmation');
            return {
              success: false,
              needsConfirmation: true,
              confirmationType: 'no_match',
              message: `No se encontró "${params.product}" en el inventario. ¿Deseas registrar esta venta de todas maneras?`,
              pendingOrderData: { ...params },
            };
          }

          const bestConfidence = matches[0].confidence;
          const topMatches = matches.filter(m => m.confidence === bestConfidence);

          if (topMatches.length === 1) {
            const match = topMatches[0];

            if (match.currentStock <= 0) {
              console.log('[AI Tool] createOrder - Match found but zero stock:', match.name);
              return {
                success: false,
                needsConfirmation: true,
                confirmationType: 'zero_stock',
                message: `"${match.name}" (SKU: ${match.sku}) tiene 0 unidades en stock. ¿Deseas registrar esta venta de todas maneras?`,
                pendingOrderData: { ...params },
              };
            }

            if (match.currentStock < quantity) {
              console.log('[AI Tool] createOrder - Insufficient stock:', match.currentStock, 'requested:', quantity);
              return {
                success: false,
                needsConfirmation: true,
                confirmationType: 'zero_stock',
                message: `"${match.name}" solo tiene ${match.currentStock} unidad(es) en stock pero se solicitan ${quantity}. ¿Deseas registrar esta venta de todas maneras?`,
                pendingOrderData: { ...params },
              };
            }

            matchedInventoryItem = match;
          } else {
            // Cap at top-3 to keep WhatsApp messages short and model context small.
            // Catalogs of 300+ items would otherwise produce unreadable menus and
            // risk exceeding platform message limits.
            const TOP_MATCHES_LIMIT = 3;
            const shown = topMatches.slice(0, TOP_MATCHES_LIMIT);
            const optionsList = shown.map((m, i) =>
              `${i + 1}. ${m.name} (SKU: ${m.sku}) — Stock: ${m.currentStock} — ₡${m.sellingPrice.toLocaleString('es-CR')}`
            ).join('\n');

            const moreCount = topMatches.length - shown.length;
            const tail = moreCount > 0
              ? `\n\nHay ${moreCount} coincidencia(s) más. Si ninguna de arriba es la correcta, dame más detalles (SKU, color, capacidad, etc).`
              : '';

            console.log(
              '[AI Tool] createOrder - Multiple matches, asking user to pick (showing top',
              shown.length,
              'of',
              topMatches.length,
              ')'
            );
            return {
              success: false,
              needsConfirmation: true,
              confirmationType: 'multiple_matches',
              message: `Encontré varios productos similares a "${params.product}". Estas son las ${shown.length} mejores coincidencias:\n\n${optionsList}${tail}\n\n¿Cuál es el producto correcto?`,
              pendingOrderData: { ...params },
            };
          }
        }

        // Build comments including payment method (Order model has no paymentMethod column)
        const commentParts: string[] = [];
        if (params.paymentMethod) {
          commentParts.push(`Pago: ${params.paymentMethod}`);
        }
        if (params.comments) {
          commentParts.push(params.comments);
        }
        const finalComments = commentParts.join('\n');

        // Prepare order data with proper field mapping
        const orderData: any = {
          tenantId: ctx.tenantId,
          orderId,
          orderType: params.orderType,
          status: 'Pendiente',
          customerName: params.customerName,
          phone: params.phone || '',
          email: params.email || '',
          product: matchedInventoryItem ? matchedInventoryItem.name : params.product,
          quantity,
          size: params.size || '',
          color: params.color || '',
          packaging: '',
          customization: '',
          total: params.total || 0,
          address: params.address || '',
          province: params.province || '',
          canton: params.canton || '',
          district: params.district || '',
          courier: params.courier || '',
          shippingCost: undefined,
          comments: finalComments,
          seller: ctx.userName,
          timestamp: new Date(),
          customFields: Object.keys(extractedCustomFields).length > 0 ? extractedCustomFields : undefined,
          contraEntrega: params.contraEntrega === true,
          cePaymentConfirmed: false,
        };

        // Populate productDetails for consistency with web UI orders
        if (matchedInventoryItem) {
          orderData.productDetails = JSON.stringify([{
            type: matchedInventoryItem.name,
            cantidad: quantity,
            color: params.color || '',
            tamano: params.size || '',
            inventoryItemId: matchedInventoryItem.id,
            inventoryItemSku: matchedInventoryItem.sku,
          }]);
        }
        
        // Extract known fields from custom fields if they exist
        const knownFieldMappings = {
          packaging: ['packaging', 'empaque'],
          customization: ['customization', 'personalizacion'],
          shippingCost: ['shippingCost', 'costoEnvio'],
        };
        
        Object.entries(knownFieldMappings).forEach(([targetField, possibleKeys]) => {
          for (const key of possibleKeys) {
            if (extractedCustomFields[key] !== undefined) {
              orderData[targetField] = extractedCustomFields[key];
              delete extractedCustomFields[key];
              break;
            }
          }
        });
        
        orderData.customFields = Object.keys(extractedCustomFields).length > 0 ? extractedCustomFields : undefined;
        
        console.log('[AI Tool] createOrder - Final order data:', {
          orderId: orderData.orderId,
          customerName: orderData.customerName,
          inventoryMatch: matchedInventoryItem?.name || 'none',
          customFieldsCount: Object.keys(orderData.customFields || {}).length,
        });
        
        const order = await tenantPrisma.order.create({
          data: orderData,
        });

        console.log('[AI Tool] createOrder - Persisted:', {
          dbId: order.id, orderId: order.orderId, tenantId: order.tenantId,
        });

        // Sync client record (create or update) so bot clients appear in Config > Clientes
        try {
          await syncClientFromOrder(tenantPrisma, ctx, {
            customerName: orderData.customerName,
            phone: orderData.phone,
            email: orderData.email,
            address: orderData.address,
            province: orderData.province,
            canton: orderData.canton,
            district: orderData.district,
            total: orderData.total,
          });
        } catch (clientSyncError) {
          console.error('[AI Tool] createOrder - Client sync failed (order still created):', clientSyncError);
        }

        // Deduct inventory stock if we matched an item
        let inventoryMessage = '';
        if (matchedInventoryItem) {
          try {
            const oldStock = matchedInventoryItem.currentStock;
            const newStock = Math.max(0, oldStock - quantity);
            await tenantPrisma.inventoryItem.update({
              where: { id: matchedInventoryItem.id },
              data: {
                currentStock: newStock,
                totalSold: { increment: quantity },
                lastSold: new Date(),
                lastUpdated: new Date(),
              },
            });
            inventoryMessage = `\n📦 Inventario: "${matchedInventoryItem.name}" ${oldStock} → ${newStock}`;
            console.log(`[AI Tool] createOrder - Stock updated: ${matchedInventoryItem.name} ${oldStock} → ${newStock}`);
          } catch (invError) {
            console.error('[AI Tool] createOrder - Failed to deduct inventory:', invError);
            inventoryMessage = `\n⚠️ No se pudo actualizar inventario para "${matchedInventoryItem.name}"`;
          }
        }
        
        // Format custom fields for success message
        const customFieldsLines = formatCustomFieldsForTelegram(
          orderData.customFields || {}, 
          customFieldsConfig
        );
        
        let successMessage = `✅ Orden #${order.orderId} creada exitosamente para ${params.customerName}`;
        if (locationCorrections.length > 0) {
          successMessage += `\n📍 Correcciones de ubicación aplicadas:\n${locationCorrections.map(c => `  - ${c}`).join('\n')}`;
        }
        if (customFieldsLines.length > 0) {
          successMessage += `\n\nCampos personalizados:\n${customFieldsLines.join('\n')}`;
        }
        successMessage += inventoryMessage;
        
        return {
          success: true,
          data: order,
          message: successMessage,
        };
      } catch (error: any) {
        console.error('[AI Tool] createOrder error:', error);
        console.error('[AI Tool] createOrder params:', JSON.stringify(params, null, 2));
        console.error('[AI Tool] createOrder error details:', {
          name: error.name,
          message: error.message,
          code: error.code,
          meta: error.meta,
        });
        
        // Parse Prisma errors to provide specific field information
        let userFriendlyError = 'Error al crear la orden';
        
        if (error.code === 'P2002') {
          // Unique constraint violation
          const field = error.meta?.target?.[0] || 'campo';
          userFriendlyError = `❌ Error: Ya existe una orden con este ${field}. Por favor verifica los datos.`;
        } else if (error.code === 'P2003') {
          // Foreign key constraint
          userFriendlyError = `❌ Error: Referencia inválida. Verifica que todos los campos relacionados existan.`;
        } else if (error.code === 'P2011' || error.code === 'P2012') {
          // Null constraint violation
          const field = error.meta?.constraint || error.meta?.column || 'campo requerido';
          userFriendlyError = `❌ Error: El campo "${field}" es requerido y no fue proporcionado.`;
        } else if (error.name === 'PrismaClientValidationError') {
          // Validation error - parse the message for field info
          const fieldMatch = error.message.match(/Argument `(\w+)` is missing/);
          if (fieldMatch) {
            userFriendlyError = `❌ Error: El campo "${fieldMatch[1]}" es requerido.`;
          } else {
            userFriendlyError = `❌ Error de validación al crear la orden. Verifica los datos e intenta de nuevo.`;
          }
        } else if (error.message) {
          console.error('[AI Tool] createOrder - Unhandled error:', error.message);
          userFriendlyError = `❌ Error al crear la orden. Por favor intenta de nuevo o contacta a soporte.`;
        }
        
        return {
          success: false,
          error: userFriendlyError,
        };
      }
    }
  );
}

/**
 * Get orders with filters
 */
export async function getOrders(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.get_orders.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const whereClause: any = {};
        
        if (params.status) {
          whereClause.status = { contains: params.status, mode: 'insensitive' };
        }
        
        if (params.orderType) {
          whereClause.orderType = params.orderType;
        }
        
        if (params.seller) {
          whereClause.seller = { contains: params.seller, mode: 'insensitive' };
        }
        
        if (params.search) {
          whereClause.OR = [
            { customerName: { contains: params.search, mode: 'insensitive' } },
            { orderId: { contains: params.search, mode: 'insensitive' } },
            { product: { contains: params.search, mode: 'insensitive' } },
            { phone: { contains: params.search } },
          ];
        }
        
        if (params.dateFrom || params.dateTo) {
          const range = buildStatsDateRange(params.dateFrom, params.dateTo);
          whereClause.timestamp = {};
          if (range.start) {
            whereClause.timestamp.gte = range.start;
          }
          if (range.end) {
            whereClause.timestamp.lte = range.end;
          }
        }
        
        const orders = await tenantPrisma.order.findMany({
          where: whereClause,
          orderBy: { timestamp: 'desc' },
          take: params.limit || 10,
          select: {
            id: true,
            orderId: true,
            orderType: true,
            status: true,
            timestamp: true,
            customerName: true,
            phone: true,
            product: true,
            quantity: true,
            total: true,
            province: true,
          },
        });
        
        return {
          success: true,
          data: orders,
          message: `Encontré ${orders.length} orden(es)`,
        };
      } catch (error: any) {
        console.error('[AI Tool] getOrders error:', error);
        return {
          success: false,
          error: error.message || 'Error al buscar órdenes',
        };
      }
    }
  );
}

/**
 * Get order details
 */
export async function getOrderDetails(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.get_order_details.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const order = await tenantPrisma.order.findFirst({
          where: {
            OR: [
              { orderId: params.orderId },
              { orderId: { contains: params.orderId } },
              { id: params.orderId },
            ],
          },
        });
        
        if (!order) {
          return {
            success: false,
            error: `No encontré ninguna orden con ID "${params.orderId}"`,
          };
        }

        let customFieldLines: string[] = [];
        try {
          const customFieldsConfig = await getTenantCustomFields(ctx.tenantId);
          const extracted = extractCustomFields(order, customFieldsConfig);
          customFieldLines = formatCustomFieldsForTelegram(extracted, customFieldsConfig);
        } catch {
          // Non-critical: order details still returned without custom field labels
        }
        
        return {
          success: true,
          data: { ...order, _customFieldLines: customFieldLines },
        };
      } catch (error: any) {
        console.error('[AI Tool] getOrderDetails error:', error);
        return {
          success: false,
          error: error.message || 'Error al obtener detalles de la orden',
        };
      }
    }
  );
}

/**
 * Update order
 */
export async function updateOrder(
  ctx: ToolContext,
  params: any
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const existingOrder = await tenantPrisma.order.findFirst({
          where: {
            OR: [
              { orderId: params.orderId },
              { orderId: { contains: params.orderId } },
            ],
          },
        });
        
        if (!existingOrder) {
          return {
            success: false,
            error: `No encontré ninguna orden con ID "${params.orderId}"`,
          };
        }

        const baseUpdateKeys = new Set([
          'customerName', 'phone', 'email', 'product', 'quantity',
          'size', 'color', 'total', 'address', 'province', 'canton',
          'district', 'courier', 'comments',
        ]);

        const baseUpdates: Record<string, unknown> = {};
        const customFieldUpdates: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(params.updates as Record<string, unknown>)) {
          if (baseUpdateKeys.has(key)) {
            baseUpdates[key] = value;
          } else {
            customFieldUpdates[key] = value;
          }
        }

        if (Object.keys(customFieldUpdates).length > 0) {
          const existingCustomFields = (existingOrder.customFields as Record<string, unknown>) || {};
          baseUpdates.customFields = { ...existingCustomFields, ...customFieldUpdates };
        }
        
        const order = await tenantPrisma.order.update({
          where: { id: existingOrder.id },
          data: baseUpdates,
        });
        
        const updatedFields = Object.keys(params.updates).join(', ');
        
        return {
          success: true,
          data: order,
          message: `✅ Orden #${order.orderId} actualizada (${updatedFields})`,
        };
      } catch (error: any) {
        console.error('[AI Tool] updateOrder error:', error);
        return {
          success: false,
          error: error.message || 'Error al actualizar la orden',
        };
      }
    }
  );
}

const VALID_ORDER_STATUSES = [
  'Pendiente', 'En Proceso', 'Completado', 'Enviado', 'Entregado', 'Cancelado',
] as const;

/**
 * Update order status
 */
export async function updateOrderStatus(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.update_order_status.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        if (!VALID_ORDER_STATUSES.includes(params.status as any)) {
          return {
            success: false,
            error: `Estado inválido: "${params.status}". Estados permitidos: ${VALID_ORDER_STATUSES.join(', ')}`,
          };
        }

        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const existingOrder = await tenantPrisma.order.findFirst({
          where: {
            OR: [
              { orderId: params.orderId },
              { orderId: { contains: params.orderId } },
            ],
          },
        });
        
        if (!existingOrder) {
          return {
            success: false,
            error: `No encontré ninguna orden con ID "${params.orderId}"`,
          };
        }
        
        const oldStatus = existingOrder.status;

        if (oldStatus === params.status) {
          return {
            success: false,
            error: `La orden #${existingOrder.orderId} ya tiene el estado "${params.status}".`,
          };
        }
        
        const order = await tenantPrisma.order.update({
          where: { id: existingOrder.id },
          data: { status: params.status },
        });
        
        return {
          success: true,
          data: order,
          message: `✅ Estado de orden #${order.orderId} cambiado: ${oldStatus} → ${params.status}`,
        };
      } catch (error: any) {
        console.error('[AI Tool] updateOrderStatus error:', error);
        return {
          success: false,
          error: error.message || 'Error al actualizar el estado',
        };
      }
    }
  );
}

/**
 * Get inventory item
 */
export async function getInventoryItem(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.get_inventory_item.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const whereClause: any = { isActive: true };
        
        if (params.sku) {
          whereClause.sku = { contains: params.sku, mode: 'insensitive' };
        } else if (params.name) {
          whereClause.name = { contains: params.name, mode: 'insensitive' };
        }
        
        const item = await tenantPrisma.inventoryItem.findFirst({
          where: whereClause,
        });
        
        if (!item) {
          return {
            success: false,
            error: 'No encontré ningún producto con esos criterios',
          };
        }
        
        return {
          success: true,
          data: item,
        };
      } catch (error: any) {
        console.error('[AI Tool] getInventoryItem error:', error);
        return {
          success: false,
          error: error.message || 'Error al buscar el producto',
        };
      }
    }
  );
}

/**
 * Search inventory
 */
export async function searchInventory(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.search_inventory.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);

        const whereClause: any = { isActive: true };

        if (params.query) {
          whereClause.OR = [
            { name: { contains: params.query, mode: 'insensitive' } },
            { sku: { contains: params.query, mode: 'insensitive' } },
            { category: { contains: params.query, mode: 'insensitive' } },
            { description: { contains: params.query, mode: 'insensitive' } },
          ];
        }

        if (params.category) {
          whereClause.category = { contains: params.category, mode: 'insensitive' };
        }

        if (params.lowStock) {
          // Find items where currentStock <= minStock
          whereClause.currentStock = { lte: prisma.inventoryItem.fields.minStock };
        }

        // Cap the effective page size to protect WhatsApp message length and
        // the LLM context. The schema already enforces max 15, but we re-cap
        // defensively in case an older client sends a higher value.
        const HARD_TAKE_CAP = 15;
        const effectiveLimit = Math.min(params.limit || 5, HARD_TAKE_CAP);

        // Large-catalog guard: if the caller did not provide any filter (no
        // query, no category, no lowStock), we assume the user asked for
        // "todo el inventario". Listing hundreds of products is unreadable in
        // WhatsApp and balloons the model context, so we return a category
        // summary instead and let the LLM prompt the user to refine.
        const noFiltersProvided =
          !params.query && !params.category && !params.lowStock;

        if (noFiltersProvided) {
          const totalActive = await tenantPrisma.inventoryItem.count({
            where: { isActive: true },
          });
          const LARGE_CATALOG_THRESHOLD = 20;

          if (totalActive > LARGE_CATALOG_THRESHOLD) {
            // Cast through `any` because the tenant Prisma proxy loses the
            // overloaded groupBy signature that the base Prisma client exposes.
            const grouped = (await (tenantPrisma.inventoryItem as any).groupBy({
              by: ['category'],
              where: { isActive: true },
              _count: { _all: true },
              orderBy: { _count: { category: 'desc' } },
              take: 10,
            })) as Array<{ category: string | null; _count: { _all: number } }>;

            const categorySummary = grouped
              .map(g => `• ${g.category || 'Sin categoría'}: ${g._count?._all ?? 0}`)
              .join('\n');

            return {
              success: true,
              data: [], // Intentionally empty so platform formatters don't dump items
              message:
                `Tengo ${totalActive} productos en inventario. ` +
                `Son demasiados para listarlos todos aquí. ` +
                `Pídeme que busque por nombre, SKU o categoría.\n\n` +
                `Principales categorías:\n${categorySummary}`,
            };
          }
        }

        const items = await tenantPrisma.inventoryItem.findMany({
          where: whereClause,
          orderBy: { currentStock: 'asc' },
          take: effectiveLimit,
          select: {
            id: true,
            name: true,
            sku: true,
            category: true,
            currentStock: true,
            minStock: true,
            sellingPrice: true,
            unitCost: true,
          },
        });

        return {
          success: true,
          data: items,
          message: `Encontré ${items.length} producto(s)`,
        };
      } catch (error: any) {
        console.error('[AI Tool] searchInventory error:', error);
        return {
          success: false,
          error: error.message || 'Error al buscar en inventario',
        };
      }
    }
  );
}

/**
 * Get statistics summary
 */
export async function getStatisticsSummary(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.get_statistics_summary.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        const orderModel = tenantPrisma.order as any;
        
        const endKey = normalizeStatsDateInput(params.dateTo) || getCurrentStatsDateKey();
        const startKey = normalizeStatsDateInput(params.dateFrom) || addDaysToStatsDateKey(endKey, -29);
        const whereClause = buildStatsOrderDateWhere(startKey, endKey);
        
        const [totalOrders, revenue, uniqueClients] = await Promise.all([
          orderModel.count({ where: whereClause }),
          orderModel.aggregate({
            where: whereClause,
            _sum: { total: true },
          }),
          orderModel.groupBy({
            by: ['customerName'],
            where: whereClause,
          }),
        ]);
        
        const totalRevenue = revenue._sum.total || 0;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        
        // Get top products
        const topProducts = await orderModel.groupBy({
          by: ['product'],
          where: whereClause,
          _count: { product: true },
          _sum: { total: true },
          orderBy: { _count: { product: 'desc' } },
          take: 5,
        });
        
        return {
          success: true,
          data: {
            totalSales: totalOrders,
            totalRevenue,
            averageOrderValue: avgOrderValue,
            activeClients: uniqueClients.length,
            dateRange: {
              from: startKey,
              to: endKey,
            },
            topProducts: topProducts.map((p: { product: string | null; _count: { product: number }; _sum: { total: number | null } }) => ({
              product: p.product,
              count: p._count.product,
              revenue: p._sum.total || 0,
            })),
          },
        };
      } catch (error: any) {
        console.error('[AI Tool] getStatisticsSummary error:', error);
        return {
          success: false,
          error: error.message || 'Error al obtener estadísticas',
        };
      }
    }
  );
}

/**
 * Search clients
 */
export async function searchClients(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.search_clients.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        const clients = await tenantPrisma.client.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: params.query, mode: 'insensitive' } },
              { phone: { contains: params.query } },
              { email: { contains: params.query, mode: 'insensitive' } },
            ],
          },
          orderBy: { totalOrders: 'desc' },
          take: params.limit || 5,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            province: true,
            canton: true,
            totalOrders: true,
            totalSpent: true,
            lastOrder: true,
          },
        });
        
        return {
          success: true,
          data: clients,
          message: `Encontré ${clients.length} cliente(s)`,
        };
      } catch (error: any) {
        console.error('[AI Tool] searchClients error:', error);
        return {
          success: false,
          error: error.message || 'Error al buscar clientes',
        };
      }
    }
  );
}

/**
 * Generate shipping guía — auto mode calls Correos WS and returns PDF,
 * manual mode creates a pending record.
 */
export async function generateShippingGuia(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.generate_shipping_guia.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        const order = await tenantPrisma.order.findFirst({
          where: {
            OR: [
              { orderId: params.orderId },
              { id: params.orderId },
            ],
          },
        });

        if (!order) {
          return { success: false, error: `No se encontró la orden ${params.orderId}` };
        }

        const addressParts = [order.province, order.canton, order.district].filter(Boolean).join(', ');

        // ── Auto mode: generate via Correos WS ──
        if (params.mode === 'auto') {
          // Pre-validate location before calling Correos WS
          if (order.province) {
            const { validateLocation, formatValidationMessage } = await import('@/lib/locationValidator');
            const locResult = validateLocation(order.province, order.canton, order.district);

            if (!locResult.valid) {
              const msg = formatValidationMessage(locResult);
              return {
                success: false,
                error: `❌ La ubicación de la orden #${order.orderId} no es válida para Correos CR:\n${msg}\n\nCorrige la ubicación con update_order antes de generar la guía.`,
              };
            }

            // Auto-correct fuzzy matches on the order
            const updates: Record<string, string> = {};
            if (locResult.correctedProvince) updates.province = locResult.correctedProvince;
            if (locResult.correctedCanton) updates.canton = locResult.correctedCanton;
            if (locResult.correctedDistrict) updates.district = locResult.correctedDistrict;

            if (Object.keys(updates).length > 0) {
              try {
                await tenantPrisma.order.update({
                  where: { tenantId_orderId: { tenantId: ctx.tenantId, orderId: order.orderId } },
                  data: updates,
                });
                console.log(`[AI Tool] Auto-corrected location for ${order.orderId}:`, updates);
              } catch (e) {
                console.warn(`[AI Tool] Failed to auto-correct location for ${order.orderId}:`, e);
              }
            }
          }

          const { generateGuiasForOrders } = await import('./guia-service');
          const batch = await generateGuiasForOrders(ctx.tenantId, [order.orderId]);
          const result = batch.results[0];

          if (!result || !result.success) {
            return {
              success: false,
              error: result?.error || 'Error al generar guía de Correos CR',
            };
          }

          const attachments: ToolAttachment[] = [];
          if (result.pdfBuffer) {
            attachments.push({
              type: 'pdf',
              buffer: result.pdfBuffer,
              filename: result.pdfFileName || `guia-${result.guiaNumber}.pdf`,
              caption: `Guía ${result.guiaNumber} — Orden #${order.orderId}`,
            });
          }

          return {
            success: true,
            data: {
              orderId: order.orderId,
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber,
              hasPdf: !!result.pdfBuffer,
            },
            message: `✅ Guía de Correos CR generada.\n\n📦 **Orden:** #${order.orderId}\n👤 **Cliente:** ${order.customerName}\n🔢 **Guía #:** ${result.guiaNumber}\n📍 **Destino:** ${addressParts || 'No especificado'}\n📄 **PDF:** ${result.pdfBuffer ? 'Adjunto' : 'No disponible'}`,
            attachments,
          };
        }

        // ── Manual mode: generate simple PDF label ──
        const existingGuia = await tenantPrisma.shippingGuia.findFirst({
          where: { orderId: order.orderId, tenantId: ctx.tenantId },
        });

        if (existingGuia && existingGuia.status === 'completed') {
          const hasPdf = !!existingGuia.pdfData;
          const attachments: ToolAttachment[] = [];
          if (hasPdf && existingGuia.pdfData) {
            attachments.push({
              type: 'pdf',
              buffer: Buffer.from(existingGuia.pdfData),
              filename: existingGuia.pdfFileName || `guia-${existingGuia.guiaNumber}.pdf`,
              caption: `Guía ${existingGuia.guiaNumber} — Orden #${order.orderId}`,
            });
          }
          return {
            success: true,
            data: {
              guiaId: existingGuia.id,
              orderId: order.orderId,
              guiaNumber: existingGuia.guiaNumber,
              status: existingGuia.status,
              hasPdf,
            },
            message: `ℹ️ Esta orden ya tiene una guía.\n\n🔢 **Guía #:** ${existingGuia.guiaNumber || 'Manual'}\n📍 **Estado:** ${existingGuia.status}${hasPdf ? '\n📄 PDF adjunto' : ''}`,
            attachments,
          };
        }

        // Generate sequential guia number for manual labels
        const guiaCount = await tenantPrisma.shippingGuia.count({
          where: { tenantId: ctx.tenantId },
        });
        const guiaNumber = String(guiaCount + 1);

        // Build the simple PDF
        const { generateSimpleGuiaPdf } = await import('@/lib/pdf/simpleGuiaPdf');
        const pdfBuffer = await generateSimpleGuiaPdf({
          guiaNumber,
          orderId: order.orderId,
          phone: order.phone || undefined,
          customerName: order.customerName || undefined,
          product: order.product || undefined,
          quantity: order.quantity ?? undefined,
          province: order.province || undefined,
          canton: order.canton || undefined,
          district: order.district || undefined,
          address: order.address || undefined,
          comments: order.comments || undefined,
        });

        // Delete old failed/pending record if exists, then create with PDF
        if (existingGuia) {
          await tenantPrisma.shippingGuia.delete({ where: { id: existingGuia.id } });
        }

        const pdfFileName = `guia-manual-${order.orderId}.pdf`;
        const pdfData = new Uint8Array(pdfBuffer.byteLength);
        pdfData.set(pdfBuffer);
        const guia = await tenantPrisma.shippingGuia.create({
          data: {
            tenantId: ctx.tenantId,
            orderId: order.orderId,
            carrier: 'manual',
            guiaNumber,
            status: 'completed',
            serviceType: 'manual',
            pdfData,
            pdfFileName,
            progress: `Guía manual generada por ${ctx.userName}`,
          },
        });

        // Update order status
        try {
          await tenantPrisma.order.update({
            where: { tenantId_orderId: { tenantId: ctx.tenantId, orderId: order.orderId } },
            data: { status: 'Enviado' },
          });
        } catch (e) {
          console.warn(`[AI Tool] Failed to update order status for ${order.orderId}:`, e);
        }

        const attachments: ToolAttachment[] = [{
          type: 'pdf',
          buffer: pdfBuffer,
          filename: pdfFileName,
          caption: `Guía Manual ${guiaNumber} — Orden #${order.orderId}`,
        }];

        return {
          success: true,
          data: { guiaId: guia.id, orderId: order.orderId, guiaNumber, hasPdf: true },
          message: `✅ Guía manual generada.\n\n📦 **Orden:** #${order.orderId}\n👤 **Cliente:** ${order.customerName}\n🔢 **Guía #:** ${guiaNumber}\n📍 **Destino:** ${addressParts || 'No especificado'}\n📄 **PDF:** Adjunto`,
          attachments,
        };
      } catch (error: any) {
        console.error('[AI Tool] generateShippingGuia error:', error);
        return { success: false, error: error.message || 'Error al generar guía de envío' };
      }
    }
  );
}

/**
 * Generate guías in bulk via Correos WS for multiple orders at once.
 */
export async function generateGuiasBulk(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.generate_guias_bulk.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const { generateGuiasForOrders } = await import('./guia-service');
        const batch = await generateGuiasForOrders(ctx.tenantId, params.orderIds);

        const attachments: ToolAttachment[] = [];
        for (const r of batch.results) {
          if (r.success && r.pdfBuffer) {
            attachments.push({
              type: 'pdf',
              buffer: r.pdfBuffer,
              filename: r.pdfFileName || `guia-${r.guiaNumber}.pdf`,
              caption: `Guía ${r.guiaNumber} — Orden #${r.orderId}`,
            });
          }
        }

        const lines = batch.results.map(r =>
          r.success
            ? `✅ #${r.orderId} → Guía ${r.guiaNumber}`
            : `❌ #${r.orderId} → ${r.error}`
        );

        return {
          success: batch.successful > 0,
          data: {
            successful: batch.successful,
            failed: batch.failed,
            results: batch.results.map(r => ({
              orderId: r.orderId,
              success: r.success,
              guiaNumber: r.guiaNumber,
              error: r.error,
            })),
          },
          message: `📦 Guías generadas: ${batch.successful}/${batch.results.length}\n\n${lines.join('\n')}${attachments.length > 0 ? `\n\n📄 ${attachments.length} PDF(s) adjuntos` : ''}`,
          attachments,
        };
      } catch (error: any) {
        console.error('[AI Tool] generateGuiasBulk error:', error);
        return { success: false, error: error.message || 'Error al generar guías en bulk' };
      }
    }
  );
}

/**
 * Update inventory stock
 */
export async function updateInventoryStock(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.update_inventory_stock.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);

        // Find product by ID or name
        const product = await tenantPrisma.inventoryItem.findFirst({
          where: {
            OR: [
              { id: params.productId },
              { name: { contains: params.productId, mode: 'insensitive' } },
              { sku: params.productId },
            ],
          },
        });

        if (!product) {
          return {
            success: false,
            error: `No se encontró el producto "${params.productId}"`,
          };
        }

        // Calculate new stock
        const oldStock = product.currentStock || 0;
        const newStock = oldStock + params.change;

        if (newStock < 0) {
          return {
            success: false,
            error: `No se puede reducir el stock a ${newStock}. Stock actual: ${oldStock}`,
          };
        }

        // Update stock
        const updated = await tenantPrisma.inventoryItem.update({
          where: { id: product.id },
          data: { currentStock: newStock },
        });

        const action = params.change > 0 ? 'agregado' : 'reducido';
        const changeAmount = Math.abs(params.change);

        return {
          success: true,
          data: {
            productId: updated.id,
            productName: updated.name,
            oldStock,
            newStock,
            change: params.change,
          },
          message: `✅ Stock ${action} exitosamente.\n\n**Producto:** ${updated.name}\n**Stock anterior:** ${oldStock}\n**Stock nuevo:** ${newStock}\n**Cambio:** ${params.change > 0 ? '+' : ''}${params.change}`,
        };
      } catch (error: any) {
        console.error('[AI Tool] updateInventoryStock error:', error);
        return {
          success: false,
          error: error.message || 'Error al actualizar inventario',
        };
      }
    }
  );
}

/**
 * Validate a Costa Rica location (province / canton / district) against the
 * canonical hierarchy.  Returns whether each level is valid and, when invalid,
 * lists all available options at that level so the AI can present them.
 */
export async function validateOrderLocation(
  _ctx: ToolContext,
  params: z.infer<typeof toolSchemas.validate_order_location.parameters>,
): Promise<ToolResult> {
  try {
    const { validateLocation, formatValidationMessage } = await import('@/lib/locationValidator');
    const result = validateLocation(params.province, params.canton, params.district);
    const message = formatValidationMessage(result);

    return {
      success: result.valid,
      data: result,
      message,
    };
  } catch (error: any) {
    console.error('[AI Tool] validateOrderLocation error:', error);
    return { success: false, error: error.message || 'Error al validar ubicación' };
  }
}

// ============================================================================
// TOOL EXECUTOR
// ============================================================================

export type ToolName = keyof typeof toolSchemas;

const toolExecutors: Record<ToolName, (ctx: ToolContext, params: any) => Promise<ToolResult>> = {
  create_order: createOrder,
  get_orders: getOrders,
  get_order_details: getOrderDetails,
  update_order: updateOrder,
  update_order_status: updateOrderStatus,
  get_inventory_item: getInventoryItem,
  search_inventory: searchInventory,
  update_inventory_stock: updateInventoryStock,
  get_statistics_summary: getStatisticsSummary,
  search_clients: searchClients,
  generate_shipping_guia: generateShippingGuia,
  generate_guias_bulk: generateGuiasBulk,
  validate_order_location: validateOrderLocation,
};

/**
 * Execute a tool by name with given parameters.
 * @param schemaOverrides - Tenant-specific tool schemas (e.g. with custom fields).
 *   When provided, validation uses these instead of the static toolSchemas so that
 *   dynamic keys (custom fields) are not stripped by Zod.
 */
export async function executeTool(
  toolName: ToolName,
  ctx: ToolContext,
  params: unknown,
  schemaOverrides?: Record<string, { description: string; parameters: z.ZodTypeAny }>
): Promise<ToolResult> {
  const WRITE_TOOLS: ToolName[] = [
    'create_order', 'update_order', 'update_order_status',
    'update_inventory_stock', 'generate_shipping_guia', 'generate_guias_bulk',
  ];

  if (WRITE_TOOLS.includes(toolName) && ctx.userRole === 'VIEWER') {
    return {
      success: false,
      error: '❌ No tienes permisos para realizar esta acción. Contacta a un administrador.',
    };
  }

  const executor = toolExecutors[toolName];
  
  if (!executor) {
    return {
      success: false,
      error: `Tool "${toolName}" not found`,
    };
  }
  
  // Coerce string booleans from AI model responses before validation
  const coercedParams = typeof params === 'object' && params !== null
    ? Object.fromEntries(
        Object.entries(params as Record<string, unknown>).map(([k, v]) => [
          k,
          v === 'true' ? true : v === 'false' ? false : v,
        ])
      )
    : params;

  const schema = (schemaOverrides?.[toolName]?.parameters) ?? toolSchemas[toolName].parameters;
  const parseResult = schema.safeParse(coercedParams);
  
  if (!parseResult.success) {
    return {
      success: false,
      error: `Invalid parameters: ${parseResult.error.message}`,
    };
  }
  
  // Preserve internal flags (prefixed with _) that are not part of the schema
  // but needed for internal flows like inventory confirmation bypass.
  const validatedParams = parseResult.data as Record<string, unknown>;
  if (typeof params === 'object' && params !== null) {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (key.startsWith('_') && !(key in validatedParams)) {
        validatedParams[key] = value;
      }
    }
  }
  
  return executor(ctx, validatedParams);
}

