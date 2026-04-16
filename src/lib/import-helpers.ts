// Normalize header keys: lowercase, no accents, underscores
export function normalizeKey(key: string): string {
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
export function excelDateToISO(val: any): string {
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

export function toNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(String(val).toString().replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ============================================
// ORDERS IMPORT - Flexible Column Mapping
// ============================================
export const orderHeaderMap: Record<string, string> = {
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

// ============================================
// INVENTORY/PRODUCTS IMPORT - Flexible Column Mapping
// ============================================
export const inventoryHeaderMap: Record<string, string> = {
  // SKU variations
  'codigo': 'sku',
  'sku': 'sku',
  'code': 'sku',
  'id': 'sku',
  'producto_id': 'sku',
  
  // Name components (will be combined)
  'tipo': 'tipo',
  'type': 'tipo',
  'categoria_principal': 'tipo',
  
  'color': 'color',
  'colour': 'color',
  
  'capacidad': 'capacidad',
  'capacidad_oz': 'capacidad',
  'capacity': 'capacidad',
  'size': 'capacidad',
  'tamano': 'capacidad',
  
  // Stock
  'cant': 'currentStock',
  'cantidad': 'currentStock',
  'stock': 'currentStock',
  'stock_actual': 'currentStock',
  'existencia': 'currentStock',
  'qty': 'currentStock',
  
  // Category
  'categoria': 'category',
  'category': 'category',
  'tipo_producto': 'category',
  
  // Pricing
  'precio_de_venta': 'sellingPrice',
  'precio_venta': 'sellingPrice',
  'precio': 'sellingPrice',
  'price': 'sellingPrice',
  'venta': 'sellingPrice',
  
  'costo_unitario': 'unitCost',
  'costo': 'unitCost',
  'cost': 'unitCost',
  'precio_costo': 'unitCost',
  
  // Location
  'ubicacion': 'location',
  'location': 'location',
  'almacen': 'location',
  'bodega': 'location',
  
  // Description
  'descripcion': 'description',
  'description': 'description',
  'detalles': 'description',
  'notas': 'description',
  
  // Supplier
  'proveedor': 'supplier',
  'supplier': 'supplier',
  'vendor': 'supplier',
};

export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export interface InventoryRowValidation {
  rowIndex: number;
  raw: Record<string, any>;
  mapped: {
    sku: string;
    tipo: string;
    color: string;
    capacidad: string;
    currentStock: number;
    category: string;
    sellingPrice: number;
    unitCost: number;
    location: string;
    description: string;
    supplier: string;
    productName: string;
  };
  errors: Array<{ field: string; message: string }>;
  isValid: boolean;
}

export function mapInventoryRow(rawRow: Record<string, any>, rowIndex: number): InventoryRowValidation {
  const mapped: any = {};

  // Map headers using inventoryHeaderMap
  for (const [k, v] of Object.entries(rawRow)) {
    const norm = normalizeKey(k);
    const target = inventoryHeaderMap[norm] || norm;
    mapped[target] = v;
  }

  const errors: Array<{ field: string; message: string }> = [];

  // SKU validation
  const sku = mapped.sku ? String(mapped.sku).trim() : '';
  if (!sku) {
    errors.push({ field: 'sku', message: 'Código/SKU es requerido' });
  }

  // Build product name from Tipo + Color + Capacidad
  const nameParts: string[] = [];
  const tipo = mapped.tipo ? String(mapped.tipo).trim() : '';
  const color = mapped.color ? String(mapped.color).trim() : '';
  const capacidad = mapped.capacidad ? String(mapped.capacidad).trim() : '';

  if (tipo) nameParts.push(tipo);
  if (color) nameParts.push(color);
  if (capacidad) nameParts.push(capacidad);

  let productName = nameParts.join(' ');

  if (!productName && mapped.description) {
    productName = String(mapped.description).trim().substring(0, 100);
  }
  if (!productName && sku) {
    productName = `Producto ${sku}`;
  }
  if (!productName) {
    productName = `Producto ${rowIndex + 1}`;
    errors.push({ field: 'tipo', message: 'Se requiere al menos Tipo, Color o Capacidad para el nombre del producto' });
  }

  // Numeric validations
  const currentStock = toNumber(mapped.currentStock);
  const sellingPrice = toNumber(mapped.sellingPrice);
  const unitCost = toNumber(mapped.unitCost);

  if (mapped.currentStock !== undefined && mapped.currentStock !== '' && isNaN(Number(String(mapped.currentStock).replace(/[^0-9.-]/g, '')))) {
    errors.push({ field: 'currentStock', message: 'Cantidad debe ser un número válido' });
  }

  if (mapped.sellingPrice !== undefined && mapped.sellingPrice !== '' && isNaN(Number(String(mapped.sellingPrice).replace(/[^0-9.-]/g, '')))) {
    errors.push({ field: 'sellingPrice', message: 'Precio de venta debe ser un número válido' });
  }

  if (mapped.unitCost !== undefined && mapped.unitCost !== '' && isNaN(Number(String(mapped.unitCost).replace(/[^0-9.-]/g, '')))) {
    errors.push({ field: 'unitCost', message: 'Costo unitario debe ser un número válido' });
  }

  const category = mapped.category ? String(mapped.category).trim() : '';
  const location = mapped.location ? String(mapped.location).trim() : '';
  const description = mapped.description ? String(mapped.description).trim() : '';
  const supplier = mapped.supplier ? String(mapped.supplier).trim() : '';

  return {
    rowIndex,
    raw: rawRow,
    mapped: {
      sku,
      tipo,
      color,
      capacidad,
      currentStock,
      category,
      sellingPrice,
      unitCost,
      location,
      description,
      supplier,
      productName,
    },
    errors,
    isValid: errors.length === 0,
  };
}

export function parseExcelSheet(
  worksheet: any,
  sheetIndex?: number
): { headers: string[]; rows: Record<string, any>[] } {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
    headers[colNumber - 1] = cell.value?.toString() || '';
  });

  const rows: Record<string, any>[] = [];
  for (let i = 2; i <= worksheet.rowCount; i++) {
    const row = worksheet.getRow(i);
    const rowData: Record<string, any> = {};
    let hasData = false;
    headers.forEach((header, idx) => {
      const cell = row.getCell(idx + 1);
      const value = cell.value;
      rowData[header] = value !== null && value !== undefined ? value : '';
      if (value !== null && value !== undefined && value !== '') hasData = true;
    });
    if (hasData) rows.push(rowData);
  }

  return { headers, rows };
}
