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
  userId: string;
  userName: string;
  userRole: string;
}

// Tool result type
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
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
  paymentMethod: z.string().optional().describe('Método de pago (contraentrega, transferencia, etc)'),
  comments: z.string().optional().describe('Comentarios o notas adicionales'),
  orderType: z.enum(['EA', 'RA']).default('EA').describe('Tipo de orden: EA = Envío a Domicilio (se envía), RA = Retiro en Local (cliente recoge)'),
  size: z.string().optional().describe('Talla o tamaño del producto (si está configurado)'),
  color: z.string().optional().describe('Color del producto (si está configurado)'),
};

// Dynamic schema generator that includes custom fields
function createOrderSchemaWithCustomFields(customFieldsConfig: CustomFieldsData) {
  const customFieldsSchema = getCustomFieldsSchema(customFieldsConfig);
  
  return {
    description: 'Crear una nueva orden de venta. Úsalo cuando el usuario quiera registrar una nueva venta o pedido.',
    parameters: z.object({
      ...baseOrderSchema,
      ...customFieldsSchema, // Add dynamic custom fields
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
    description: 'Cambiar el estado de una orden.',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden'),
      status: z.string().describe('Nuevo estado (Pendiente, En Proceso, Completado, Enviado, Entregado, etc)'),
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
    description: 'Buscar productos en el inventario. Si el usuario pide "todo el inventario", usa un límite alto (50).',
    parameters: z.object({
      query: z.string().optional().describe('Término de búsqueda (nombre, SKU, categoría). Vacío para listar todo'),
      category: z.string().optional().describe('Filtrar por categoría'),
      lowStock: z.boolean().optional().describe('Solo mostrar productos con stock bajo'),
      limit: z.number().int().min(1).max(100).default(10).describe('Cantidad máxima de resultados. Usa 50+ para "todo el inventario"'),
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
    description: 'Generar guía de envío MANUAL para una orden. SIEMPRE genera guías manuales, nunca automáticas. Proporciona el PDF al usuario.',
    parameters: z.object({
      orderId: z.string().describe('ID de la orden para generar guía'),
      carrier: z.string().default('correos').describe('Carrier de envío (correos, etc). Siempre usa tipo manual'),
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
    const dynamicSchema = createOrderSchemaWithCustomFields(customFieldsConfig);
    
    // Update the create_order schema dynamically
    toolSchemas.create_order = dynamicSchema;
    
    console.log('[AI Tools] Updated schemas with custom fields:', {
      tenantId,
      productFields: customFieldsConfig.productFields.length,
      businessInfoFields: customFieldsConfig.businessInfoFields.length,
    });
    
    return customFieldsConfig;
  } catch (error) {
    console.error('[AI Tools] Failed to update schemas with custom fields:', error);
    // Return empty config on error to prevent breaking the bot
    return { productFields: [], businessInfoFields: [] };
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
  
  // For EA (shipping orders), address fields are important
  const orderType = params.orderType || 'EA';
  if (orderType === 'EA') {
    if (!params.province || params.province.trim() === '') {
      errors.push('Provincia es requerida para envíos (EA)');
    }
    if (!params.address || params.address.trim() === '') {
      errors.push('Dirección es requerida para envíos (EA)');
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
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        // Generate order ID
        const timestamp = Date.now();
        const orderId = `BOT-${timestamp}`;
        
        console.log('[AI Tool] createOrder - Creating order with custom fields support');
        console.log('[AI Tool] createOrder - Raw params:', JSON.stringify(params, null, 2));
        
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
        
        // Prepare order data with proper field mapping
        const orderData: any = {
          tenantId: ctx.tenantId,
          orderId,
          orderType: params.orderType || 'EA',
          status: 'Pendiente',
          customerName: params.customerName,
          phone: params.phone || '',
          email: params.email || '',
          product: params.product,
          quantity: params.quantity || 1,
          size: params.size || '',
          color: params.color || '',
          packaging: '', // Will be extracted from custom fields if present
          customization: '', // Will be extracted from custom fields if present
          total: params.total || 0,
          address: params.address || '',
          province: params.province || '',
          canton: params.canton || '',
          district: params.district || '',
          courier: params.courier || '',
          shippingCost: undefined, // Will be extracted from custom fields if present
          comments: params.comments || '',
          seller: ctx.userName,
          timestamp: new Date(),
          // Store custom fields as JSON
          customFields: Object.keys(extractedCustomFields).length > 0 ? extractedCustomFields : undefined,
        };
        
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
              // Remove from customFields to avoid duplication
              delete extractedCustomFields[key];
              break;
            }
          }
        });
        
        // Update customFields with remaining fields
        orderData.customFields = Object.keys(extractedCustomFields).length > 0 ? extractedCustomFields : undefined;
        
        console.log('[AI Tool] createOrder - Final order data:', {
          orderId: orderData.orderId,
          customerName: orderData.customerName,
          customFieldsCount: Object.keys(orderData.customFields || {}).length,
          customFieldsKeys: Object.keys(orderData.customFields || {})
        });
        
        const order = await tenantPrisma.order.create({
          data: orderData,
        });
        
        // Format custom fields for success message
        const customFieldsLines = formatCustomFieldsForTelegram(
          orderData.customFields || {}, 
          customFieldsConfig
        );
        
        const successMessage = customFieldsLines.length > 0
          ? `✅ Orden #${order.orderId} creada exitosamente para ${params.customerName}\n\nCampos personalizados:\n${customFieldsLines.join('\n')}`
          : `✅ Orden #${order.orderId} creada exitosamente para ${params.customerName}`;
        
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
            userFriendlyError = `❌ Error de validación: ${error.message.slice(0, 200)}`;
          }
        } else if (error.message) {
          // General error - provide the message but keep it user-friendly
          userFriendlyError = `❌ Error: ${error.message.slice(0, 300)}`;
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
          whereClause.timestamp = {};
          if (params.dateFrom) {
            whereClause.timestamp.gte = new Date(params.dateFrom);
          }
          if (params.dateTo) {
            const endDate = new Date(params.dateTo);
            endDate.setHours(23, 59, 59, 999);
            whereClause.timestamp.lte = endDate;
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
        
        // Search by orderId (could be full or partial)
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
        
        return {
          success: true,
          data: order,
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
  params: z.infer<typeof toolSchemas.update_order.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        // Find the order first
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
        
        const order = await tenantPrisma.order.update({
          where: { id: existingOrder.id },
          data: params.updates,
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
        const tenantPrisma = getTenantPrisma(ctx.tenantId);
        
        // Find the order first
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
        
        const items = await tenantPrisma.inventoryItem.findMany({
          where: whereClause,
          orderBy: { currentStock: 'asc' },
          take: params.limit || 5,
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
        
        // Default to last 30 days if no dates provided
        const now = new Date();
        const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        const startDate = params.dateFrom ? new Date(params.dateFrom) : defaultStart;
        const endDate = params.dateTo ? new Date(params.dateTo) : now;
        endDate.setHours(23, 59, 59, 999);
        
        const whereClause = {
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        };
        
        const [totalOrders, revenue, uniqueClients] = await Promise.all([
          tenantPrisma.order.count({ where: whereClause }),
          tenantPrisma.order.aggregate({
            where: whereClause,
            _sum: { total: true },
          }),
          tenantPrisma.order.groupBy({
            by: ['customerName'],
            where: whereClause,
          }),
        ]);
        
        const totalRevenue = revenue._sum.total || 0;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        
        // Get top products
        const topProducts = await tenantPrisma.order.groupBy({
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
              from: startDate.toISOString().split('T')[0],
              to: endDate.toISOString().split('T')[0],
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
 * Generate shipping guía - ALWAYS MANUAL
 */
export async function generateShippingGuia(
  ctx: ToolContext,
  params: z.infer<typeof toolSchemas.generate_shipping_guia.parameters>
): Promise<ToolResult> {
  return withTenantContext(
    { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, userRole: ctx.userRole },
    async () => {
      try {
        // Get order details first
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
          return {
            success: false,
            error: `No se encontró la orden ${params.orderId}`,
          };
        }

        // Check if order already has a guía
        const existingGuia = await tenantPrisma.shippingGuia.findFirst({
          where: { orderId: order.id },
        });

        if (existingGuia) {
          const hasPdf = !!existingGuia.pdfData;
          return {
            success: true,
            data: {
              guiaId: existingGuia.id,
              orderId: order.orderId,
              guiaNumber: existingGuia.guiaNumber,
              status: existingGuia.status,
              hasPdf,
            },
            message: `ℹ️ Esta orden ya tiene una guía generada.\n\n🔢 **Guía #:** ${existingGuia.guiaNumber || 'Manual'}\n📍 **Estado:** ${existingGuia.status}${hasPdf ? '\n📄 **PDF disponible** en el panel de Betsy' : ''}\n\n🔗 Ver en: https://www.betsycrm.com/produccion`,
          };
        }

        // Create manual guía record (no PDF - PDF is generated via Correos integration)
        const guia = await tenantPrisma.shippingGuia.create({
          data: {
            tenantId: ctx.tenantId,
            orderId: order.id,
            carrier: params.carrier || 'correos',
            status: 'pending',
            serviceType: 'manual',
            progress: `Guía manual registrada por ${ctx.userName}`,
          },
        });

        // Build response with order details for context
        const addressParts = [order.province, order.canton, order.district].filter(Boolean).join(', ');

        return {
          success: true,
          data: {
            guiaId: guia.id,
            orderId: order.orderId,
          },
          message: `✅ Guía registrada para envío.\n\n📦 **Orden:** #${order.orderId}\n👤 **Cliente:** ${order.customerName}\n📍 **Destino:** ${addressParts || 'No especificado'}\n📱 **Teléfono:** ${order.phone || 'No especificado'}\n📫 **Dirección:** ${order.address || 'No especificada'}\n\n⚠️ **Siguiente paso:** Ve a Producción en Betsy para generar la guía con Correos de Costa Rica y obtener el PDF.\n\n🔗 https://www.betsycrm.com/produccion`,
        };
      } catch (error: any) {
        console.error('[AI Tool] generateShippingGuia error:', error);
        return {
          success: false,
          error: error.message || 'Error al generar guía de envío',
        };
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
};

/**
 * Execute a tool by name with given parameters
 */
export async function executeTool(
  toolName: ToolName,
  ctx: ToolContext,
  params: unknown
): Promise<ToolResult> {
  const executor = toolExecutors[toolName];
  
  if (!executor) {
    return {
      success: false,
      error: `Tool "${toolName}" not found`,
    };
  }
  
  // Validate parameters
  const schema = toolSchemas[toolName].parameters;
  const parseResult = schema.safeParse(params);
  
  if (!parseResult.success) {
    return {
      success: false,
      error: `Invalid parameters: ${parseResult.error.message}`,
    };
  }
  
  return executor(ctx, parseResult.data);
}

