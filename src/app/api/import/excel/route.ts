import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';
import {
  normalizeKey,
  excelDateToISO,
  toNumber,
  orderHeaderMap,
  parseExcelSheet,
  mapInventoryRow,
  validateXlsxUpload,
  type ImportResult,
} from '@/lib/import-helpers';

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
// INVENTORY/PRODUCTS IMPORT
// ============================================
async function importInventory(rows: any[], tenantId: string): Promise<ImportResult> {
  const result: ImportResult = { success: true, imported: 0, failed: 0, errors: [] };
  
  console.log(`📦 Starting import of ${rows.length} inventory items for tenant ${tenantId}`);
  
  for (let i = 0; i < rows.length; i++) {
    // Log progress every 50 rows
    if (i > 0 && i % 50 === 0) {
      console.log(`⏳ Progress: ${i}/${rows.length} rows processed...`);
    }
    
    try {
      const rawRow = rows[i];

      const validation = mapInventoryRow(rawRow, i);
      if (!validation.isValid) {
        result.failed++;
        result.errors.push({
          row: i + 2,
          message: validation.errors.map(e => `${e.field}: ${e.message}`).join('; '),
        });
        continue;
      }

      const mapped = validation.mapped;
      
      // Build product name from Tipo + Color + Capacidad
      const productName = mapped.productName;
      
      // Process numeric fields
      const currentStock = Math.trunc(toNumber(mapped.currentStock));
      const minStock = 0; // Default
      const maxStock = 100; // Default
      const sellingPrice = toNumber(mapped.sellingPrice);
      const unitCost = toNumber(mapped.unitCost);
      
      // Ensure SKU exists
      const sku = String(mapped.sku).trim();

      // Normalize optional strings. Category MUST be non-empty because
      // the UI feeds it into a Radix <Select>, which crashes on empty-string
      // values. Fall back to "General" when the sheet has no category column.
      const categoryRaw = mapped.category ? String(mapped.category).trim() : '';
      const category = categoryRaw || 'General';
      const location = mapped.location ? String(mapped.location).trim() : '';
      const supplier = mapped.supplier ? String(mapped.supplier).trim() : '';
      const description = mapped.description ? String(mapped.description).trim() : '';

      // Create or update inventory item
      await prisma.inventoryItem.upsert({
        where: {
          tenantId_sku: {
            sku: sku,
            tenantId: tenantId
          }
        },
        update: {
          name: productName,
          category,
          currentStock: currentStock,
          minStock: minStock,
          maxStock: maxStock,
          unitCost: unitCost,
          sellingPrice: sellingPrice,
          location,
          supplier,
          description,
        },
        create: {
          sku: sku,
          name: productName,
          category,
          currentStock: currentStock,
          minStock: minStock,
          maxStock: maxStock,
          reorderPoint: 5, // Default
          reorderQuantity: 20, // Default
          unitCost: unitCost,
          sellingPrice: sellingPrice,
          location,
          supplier,
          description,
          createdBy: 'excel-import', // System identifier for Excel imports
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
  
  console.log(`✅ Inventory import complete: ${result.imported} imported, ${result.failed} failed`);
  return result;
}

// ============================================
// MAIN HANDLER
// ============================================
// Increase timeout for large imports (30 minutes)
export const maxDuration = 300; // 5 minutes for Vercel
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

    const uploadError = validateXlsxUpload(file);
    if (uploadError) {
      return NextResponse.json({ error: uploadError }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el tamaño máximo de 10MB' }, { status: 400 });
    }

    // Validate import type
    if (importType !== 'orders' && importType !== 'inventory' && importType !== 'products') {
      return NextResponse.json({ 
        error: 'Tipo de importación no válido. Use: orders, inventory, o products' 
      }, { status: 400 });
    }

    // Read file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel
    console.log('📄 Parsing Excel file...');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    if (workbook.worksheets.length === 0) {
      return NextResponse.json({ error: 'El archivo Excel no contiene hojas' }, { status: 400 });
    }

    // Support sheet selection via form data
    const sheetIndexParam = formData.get('sheetIndex') as string;
    const sheetIdx = sheetIndexParam ? parseInt(sheetIndexParam, 10) : 0;
    const selectedSheetIndex = Number.isFinite(sheetIdx)
      ? Math.max(0, Math.min(sheetIdx, workbook.worksheets.length - 1))
      : 0;
    const sheet = workbook.worksheets[selectedSheetIndex];
    const sheetName = sheet.name;
    const { rows } = parseExcelSheet(sheet);

    console.log(`📊 Found ${rows.length} rows in sheet "${sheetName}"`);

    if (rows.length === 0) {
      return NextResponse.json({ 
        error: 'El archivo Excel está vacío o no tiene datos' 
      }, { status: 400 });
    }
    
    if (rows.length > 1000) {
      console.warn(`⚠️ Large import: ${rows.length} rows. This may take a few minutes...`);
    }

    // Import based on type
    console.log(`🔄 Starting ${importType} import process...`);
    const startTime = Date.now();
    
    let result: ImportResult;
    let itemType: string;
    
    if (importType === 'orders') {
      result = await importOrders(rows, tenantId);
      itemType = 'pedidos';
    } else if (importType === 'inventory' || importType === 'products') {
      result = await importInventory(rows, tenantId);
      itemType = 'productos';
    } else {
      throw new Error('Invalid import type');
    }
    
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`✅ Import completed in ${durationSeconds}s`);

    return NextResponse.json({
      success: result.success,
      message: `Importación completada en ${durationSeconds}s: ${result.imported} ${itemType} importados, ${result.failed} fallidos`,
      imported: result.imported,
      failed: result.failed,
      errors: result.errors,
      duration: durationSeconds
    });

  } catch (error: any) {
    console.error('Excel import error:', error);
    return NextResponse.json({ 
      error: 'Error procesando el archivo Excel'
    }, { status: 500 });
  }
}

