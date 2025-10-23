import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import * as XLSX from 'xlsx';

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

// Normalize header keys: lowercase, no accents, underscores
function normalizeKey(key: string): string {
  if (!key) return '';
  return key
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_');
}

// Convert Excel date serial to ISO date
function excelDateToISO(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    const ms = Math.round((val - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return '';
}

function toNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(String(val).toString().replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ============================================
// ORDERS IMPORT - Flexible Column Mapping
// ============================================
const orderHeaderMap: Record<string, string> = {
  // Order ID variations
  'orderid': 'orderId',
  'id_pedido': 'orderId',
  'numero_orden': 'orderId',
  'numero_de_orden': 'orderId',
  'orden': 'orderId',
  'pedido': 'orderId',
  'no_orden': 'orderId',
  
  // Order Type (EA/RA)
  'tipo': 'orderType',
  'tipo_pedido': 'orderType',
  'tipo_de_pedido': 'orderType',
  'ea': 'orderType',
  'ra': 'orderType',
  'tipo_orden': 'orderType',
  
  // Status
  'estado': 'status',
  'estatus': 'status',
  'status': 'status',
  'estado_pedido': 'status',
  
  // Delivery
  'entrega': 'delivery',
  'estado_entrega': 'delivery',
  
  // Customer info
  'cliente': 'customerName',
  'nombre_cliente': 'customerName',
  'nombre': 'customerName',
  'nombre_del_cliente': 'customerName',
  'comprador': 'customerName',
  
  'telefono': 'phone',
  'phone': 'phone',
  'tel': 'phone',
  'celular': 'phone',
  'movil': 'phone',
  
  'email': 'email',
  'correo': 'email',
  'correo_electronico': 'email',
  'e_mail': 'email',
  
  'negocio': 'business',
  'empresa': 'business',
  'compania': 'business',
  
  // Product info
  'producto': 'product',
  'articulo': 'product',
  'item': 'product',
  'descripcion': 'product',
  
  'cantidad': 'quantity',
  'qty': 'quantity',
  'cant': 'quantity',
  'unidades': 'quantity',
  
  'tamano': 'size',
  'talla': 'size',
  'medida': 'size',
  
  'color': 'color',
  
  'empaque': 'packaging',
  'packaging': 'packaging',
  'embalaje': 'packaging',
  
  'personalizacion': 'customization',
  'personalizacion_detalle': 'customization',
  'customizacion': 'customization',
  'custom': 'customization',
  
  'comentarios': 'comments',
  'comentario': 'comments',
  'notas': 'comments',
  'observaciones': 'comments',
  
  // Pricing
  'total': 'total',
  'precio': 'total',
  'precio_total': 'total',
  'monto': 'total',
  
  'iva': 'iva',
  'impuesto': 'iva',
  
  'envio': 'shippingCost',
  'costo_envio': 'shippingCost',
  'costo_de_envio': 'shippingCost',
  
  'costo_producto': 'productCost',
  'precio_producto': 'productCost',
  'costo': 'productCost',
  
  // Address (for EA - shipping)
  'direccion': 'address',
  'domicilio': 'address',
  'direccion_entrega': 'address',
  
  'provincia': 'province',
  'canton': 'canton',
  'distrito': 'district',
  'barrio': 'district',
  
  'mensajeria': 'courier',
  'courier': 'courier',
  'paqueteria': 'courier',
  'servicio_envio': 'courier',
  
  // Funnel/Source
  'embudo': 'funnel',
  'funnel': 'funnel',
  'fuente': 'funnel',
  'origen': 'funnel',
  
  // Dates
  'fecha_esperada': 'expectedDate',
  'fecha_entrega': 'expectedDate',
  'fecha_de_entrega': 'expectedDate',
  
  'dia_de_venta': 'saleDate',
  'fecha_venta': 'saleDate',
  'fecha_de_venta': 'saleDate',
  'fecha': 'saleDate',
  
  'timestamp': 'timestamp',
  'fecha_hora': 'timestamp',
  
  'fecha_acordada': 'agreedDate',
  'fecha_retirada': 'pickupDate',
  'fecha_de_retiro': 'pickupDate',
  
  // Seller
  'vendedor': 'seller',
  'vendedora': 'seller',
  'usuario': 'seller',
  'username': 'seller',
};

async function importOrders(rows: any[], tenantId: string): Promise<ImportResult> {
  const result: ImportResult = { success: true, imported: 0, failed: 0, errors: [] };
  
  console.log(`📊 Starting import of ${rows.length} orders for tenant ${tenantId}`);
  
  for (let i = 0; i < rows.length; i++) {
    // Log progress every 50 rows
    if (i > 0 && i % 50 === 0) {
      console.log(`⏳ Progress: ${i}/${rows.length} rows processed...`);
    }
    
    try {
      const rawRow = rows[i];
      const mapped: any = {};
      
      // Map headers
      for (const [k, v] of Object.entries(rawRow)) {
        const norm = normalizeKey(k as string);
        const target = orderHeaderMap[norm] || norm;
        mapped[target] = v;
      }
      
      // Process numeric fields
      const numericFields = ['quantity', 'total', 'iva', 'shippingCost', 'productCost'];
      for (const f of numericFields) {
        if (mapped[f] !== undefined) mapped[f] = toNumber(mapped[f]);
      }
      
      // Process date fields
      mapped.expectedDate = excelDateToISO(mapped.expectedDate);
      mapped.saleDate = excelDateToISO(mapped.saleDate);
      mapped.agreedDate = excelDateToISO(mapped.agreedDate);
      mapped.pickupDate = excelDateToISO(mapped.pickupDate);
      
      // Parse timestamp if provided
      let parsedTimestamp = null;
      if (mapped.timestamp) {
        if (typeof mapped.timestamp === 'number') {
          // Excel serial date
          const ms = Math.round((mapped.timestamp - 25569) * 86400 * 1000);
          parsedTimestamp = new Date(ms);
        } else {
          const dt = new Date(String(mapped.timestamp));
          if (!isNaN(dt.getTime())) parsedTimestamp = dt;
        }
      }
      
      // Smart EA/RA detection if not specified
      if (!mapped.orderType || mapped.orderType === '') {
        // If has pickup date or agreed date = RA (retiro)
        // If has address = EA (envío)
        if (mapped.pickupDate || mapped.agreedDate) {
          mapped.orderType = 'RA';
        } else if (mapped.address) {
          mapped.orderType = 'EA';
        } else {
          // Default to EA if can't determine
          mapped.orderType = 'EA';
        }
      }
      
      // Normalize orderType to uppercase
      if (mapped.orderType) {
        mapped.orderType = String(mapped.orderType).toUpperCase().trim();
        // Handle variations: "EA", "E.A.", "ea", "envío", etc.
        if (mapped.orderType.includes('EA') || mapped.orderType.includes('ENVIO') || mapped.orderType.includes('ENVÍO')) {
          mapped.orderType = 'EA';
        } else if (mapped.orderType.includes('RA') || mapped.orderType.includes('RETIRO') || mapped.orderType.includes('PICKUP')) {
          mapped.orderType = 'RA';
        }
      }
      
      // Set defaults
      if (!mapped.status || mapped.status === '') mapped.status = 'Pendiente';
      if (!mapped.customerName || mapped.customerName === '') mapped.customerName = 'Cliente sin nombre';
      if (!mapped.delivery || mapped.delivery === '') mapped.delivery = 'Pendiente';
      
      // Generate orderId if missing
      if (!mapped.orderId || String(mapped.orderId).trim() === '') {
        const typePrefix = mapped.orderType || 'EA';
        mapped.orderId = `${typePrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      }
      
      // Convert fields that must be strings
      const phoneStr = mapped.phone ? String(mapped.phone).trim() : '';
      const emailStr = mapped.email ? String(mapped.email).trim() : '';
      const businessStr = mapped.business ? String(mapped.business).trim() : '';
      const sellerStr = mapped.seller ? String(mapped.seller).trim() : '';
      
      // Create order with tenantId
      await prisma.order.create({
        data: {
          orderId: String(mapped.orderId).trim(),
          orderType: mapped.orderType,
          status: mapped.status,
          delivery: mapped.delivery || 'Pendiente',
          customerName: String(mapped.customerName).trim(),
          username: sellerStr, // For tracking
          phone: phoneStr,
          email: emailStr,
          business: businessStr,
          product: mapped.product ? String(mapped.product).trim() : '',
          quantity: mapped.quantity || 0,
          size: mapped.size ? String(mapped.size).trim() : '',
          color: mapped.color ? String(mapped.color).trim() : '',
          packaging: mapped.packaging ? String(mapped.packaging).trim() : '',
          customization: mapped.customization ? String(mapped.customization).trim() : '',
          comments: mapped.comments ? String(mapped.comments).trim() : '',
          total: mapped.total || 0,
          iva: mapped.iva || 0,
          shippingCost: mapped.shippingCost || 0,
          productCost: mapped.productCost || 0,
          funnel: mapped.funnel ? String(mapped.funnel).trim() : '',
          address: mapped.address ? String(mapped.address).trim() : '',
          province: mapped.province ? String(mapped.province).trim() : '',
          canton: mapped.canton ? String(mapped.canton).trim() : '',
          district: mapped.district ? String(mapped.district).trim() : '',
          courier: mapped.courier ? String(mapped.courier).trim() : '',
          expectedDate: mapped.expectedDate ? String(mapped.expectedDate).trim() : '',
          saleDate: mapped.saleDate ? String(mapped.saleDate).trim() : '',
          agreedDate: mapped.agreedDate ? String(mapped.agreedDate).trim() : '',
          pickupDate: mapped.pickupDate ? String(mapped.pickupDate).trim() : '',
          seller: sellerStr,
          timestamp: parsedTimestamp || new Date(),
          tenantId: tenantId,
        }
      });
      
      result.imported++;
    } catch (error: any) {
      console.error(`❌ Row ${i + 2} failed:`, error.message);
      result.failed++;
      result.errors.push({ row: i + 2, message: error.message });
    }
  }
  
  console.log(`✅ Import complete: ${result.imported} imported, ${result.failed} failed`);
  return result;
}

// ============================================
// Note: Customers and Products import coming soon
// Will be enabled once database models are ready
// ============================================

// ============================================
// MAIN HANDLER
// ============================================
// Increase timeout for large imports (30 minutes)
export const maxDuration = 300; // 5 minutes for Vercel
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Excel import request received');
    
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant ID' }, { status: 400 });
    }
    
    console.log(`👤 User authenticated, tenantId: ${tenantId}`);

    // Get form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const importType = formData.get('type') as string; // 'orders', 'customers', 'products'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Currently only orders import is supported
    if (importType !== 'orders') {
      return NextResponse.json({ 
        error: 'Por ahora solo se soporta importación de pedidos. Clientes y productos próximamente.' 
      }, { status: 400 });
    }

    // Read file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel
    console.log('📄 Parsing Excel file...');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    console.log(`📊 Found ${rows.length} rows in sheet "${sheetName}"`);

    if (rows.length === 0) {
      return NextResponse.json({ 
        error: 'El archivo Excel está vacío o no tiene datos' 
      }, { status: 400 });
    }
    
    if (rows.length > 1000) {
      console.warn(`⚠️ Large import: ${rows.length} rows. This may take a few minutes...`);
    }

    // Import orders
    console.log('🔄 Starting import process...');
    const startTime = Date.now();
    const result = await importOrders(rows, tenantId);
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`✅ Import completed in ${durationSeconds}s`);

    return NextResponse.json({
      success: result.success,
      message: `Importación completada en ${durationSeconds}s: ${result.imported} pedidos importados, ${result.failed} fallidos`,
      imported: result.imported,
      failed: result.failed,
      errors: result.errors,
      duration: durationSeconds
    });

  } catch (error: any) {
    console.error('Excel import error:', error);
    return NextResponse.json({ 
      error: 'Error procesando el archivo Excel',
      details: error.message 
    }, { status: 500 });
  }
}

