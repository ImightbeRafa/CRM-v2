import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Template definitions with examples
const templates = {
  orders: {
    filename: 'plantilla_pedidos.xlsx',
    headers: [
      'Número Orden', 'Tipo', 'Estado', 'Cliente', 'Teléfono', 'Email', 'Empresa',
      'Producto', 'Cantidad', 'Tamaño', 'Color', 'Total', 'Costo Envío',
      'Dirección', 'Provincia', 'Cantón', 'Distrito', 'Courier',
      'Fecha Esperada', 'Fecha Retirada', 'Vendedor', 'Comentarios'
    ],
    example: [
      'EA-001', 'EA', 'Pendiente', 'Juan Pérez', '8888-8888', 'juan@example.com', 'Empresa XYZ',
      'Camiseta Azul', '2', 'M', 'Azul', '15000', '2000',
      'Calle 123, Casa 5', 'San José', 'Central', 'Carmen', 'Correos CR',
      '2025-11-15', '', 'María López', 'Entregar por la tarde'
    ]
  },
  customers: {
    filename: 'plantilla_clientes.xlsx',
    headers: [
      'Nombre', 'Teléfono', 'Email', 'Dirección', 'Provincia', 'Cantón',
      'Distrito', 'Cédula', 'Empresa', 'Notas'
    ],
    example: [
      'Ana García', '8777-7777', 'ana@empresa.com', 'Avenida 10', 'Heredia', 'Heredia',
      'San Francisco', '1-1234-5678', 'Empresa XYZ', 'Cliente VIP'
    ]
  },
  products: {
    filename: 'plantilla_productos.xlsx',
    headers: [
      'Nombre', 'Descripción', 'Precio', 'Costo', 'SKU', 'Categoría', 'Stock'
    ],
    example: [
      'Camiseta Básica', 'Camiseta 100% algodón', '8500', '4000', 'CAM-001', 'Ropa', '50'
    ]
  }
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as 'orders' | 'customers' | 'products';

    if (!type || !templates[type]) {
      return NextResponse.json({ 
        error: 'Tipo de plantilla inválido. Use: orders, customers, o products' 
      }, { status: 400 });
    }

    const template = templates[type];

    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Create data with headers and example row
    const data = [
      template.headers,
      template.example
    ];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = template.headers.map(() => ({ wch: 15 }));
    ws['!cols'] = colWidths;

    // Style header row (make bold if possible - note: XLSX doesn't support styling in free version)
    // But we can add instructions sheet
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    // Add instructions sheet
    const instructions = [
      ['═══════════════════════════════════════════════════════════'],
      ['INSTRUCCIONES PARA IMPORTAR PEDIDOS'],
      ['═══════════════════════════════════════════════════════════'],
      [''],
      ['📋 PASOS BÁSICOS:'],
      ['1. Complete los datos en la hoja "Datos"'],
      ['2. Los nombres de columnas son flexibles (vea sección de COLUMNAS)'],
      ['3. La primera fila (ejemplo) puede eliminarse o reemplazarse'],
      ['4. Guarde el archivo como .xlsx o .xls'],
      ['5. Importe el archivo desde: Config → Importar Excel'],
      [''],
      ['═══════════════════════════════════════════════════════════'],
      ['TIPOS DE PEDIDOS: EA vs RA'],
      ['═══════════════════════════════════════════════════════════'],
      [''],
      ['EA (Envío a Domicilio):'],
      ['  - Use "EA" en la columna "Tipo"'],
      ['  - Complete: Dirección, Provincia, Cantón, Distrito'],
      ['  - Opcional: Courier, Fecha Esperada'],
      ['  - Ejemplo: Pedido que se envía a casa del cliente'],
      [''],
      ['RA (Retiro en Tienda):'],
      ['  - Use "RA" en la columna "Tipo"'],
      ['  - Complete: Fecha Retirada (cuando recogerá)'],
      ['  - La dirección NO es necesaria'],
      ['  - Ejemplo: Cliente recoge en tienda'],
      [''],
      ['🤖 DETECCIÓN AUTOMÁTICA:'],
      ['Si no especifica "Tipo", el sistema lo detecta automáticamente:'],
      ['  - Si tiene dirección → EA'],
      ['  - Si tiene fecha de retiro → RA'],
      [''],
      ['═══════════════════════════════════════════════════════════'],
      ['COLUMNAS FLEXIBLES'],
      ['═══════════════════════════════════════════════════════════'],
      [''],
      ['✅ PUEDE USAR SUS PROPIOS NOMBRES DE COLUMNAS:'],
      [''],
      ['Cliente: "Cliente", "Nombre", "Nombre Cliente", "Comprador"'],
      ['Teléfono: "Teléfono", "Phone", "Tel", "Celular"'],
      ['Email: "Email", "Correo", "Correo Electrónico"'],
      ['Producto: "Producto", "Artículo", "Item"'],
      ['Cantidad: "Cantidad", "Qty", "Cant"'],
      ['Total: "Total", "Precio", "Monto"'],
      ['Vendedor: "Vendedor", "Usuario", "Vendedora"'],
      [''],
      ['¡Y muchas más variaciones! El sistema entiende español.'],
      ['']
    ];

    if (type === 'orders') {
      instructions.push(
        ['═══════════════════════════════════════════════════════════'],
        ['CAMPOS OBLIGATORIOS'],
        ['═══════════════════════════════════════════════════════════'],
        [''],
        ['✅ Cliente: Nombre del cliente (requerido)'],
        [''],
        ['═══════════════════════════════════════════════════════════'],
        ['CAMPOS OPCIONALES'],
        ['═══════════════════════════════════════════════════════════'],
        [''],
        ['Información del Cliente:'],
        ['  - Teléfono, Email, Empresa/Negocio'],
        [''],
        ['Detalles del Producto:'],
        ['  - Producto, Cantidad, Tamaño, Color'],
        ['  - Personalización, Empaque'],
        [''],
        ['Precios:'],
        ['  - Total (sin símbolos: ₡, $)'],
        ['  - Costo Envío, IVA, Costo Producto'],
        [''],
        ['Ubicación (para EA):'],
        ['  - Dirección completa'],
        ['  - Provincia, Cantón, Distrito'],
        ['  - Courier/Mensajería'],
        [''],
        ['Fechas:'],
        ['  - Formato: YYYY-MM-DD (2025-11-15)'],
        ['  - O: DD/MM/YYYY (15/11/2025)'],
        ['  - Fecha Esperada: cuándo debe llegar'],
        ['  - Fecha Retirada: cuándo recoge (RA)'],
        [''],
        ['Otros:'],
        ['  - Estado: Pendiente, Completado, etc.'],
        ['  - Vendedor: quién hizo la venta'],
        ['  - Comentarios/Notas'],
        [''],
        ['═══════════════════════════════════════════════════════════'],
        ['EJEMPLOS DE USO'],
        ['═══════════════════════════════════════════════════════════'],
        [''],
        ['EJEMPLO 1 - Pedido con envío (EA):'],
        ['  Tipo: EA'],
        ['  Cliente: María Rodríguez'],
        ['  Teléfono: 8765-4321'],
        ['  Producto: Blusa Roja'],
        ['  Cantidad: 1'],
        ['  Total: 12500'],
        ['  Dirección: Avenida Central 45'],
        ['  Provincia: Heredia'],
        ['  Fecha Esperada: 2025-11-20'],
        [''],
        ['EJEMPLO 2 - Retiro en tienda (RA):'],
        ['  Tipo: RA'],
        ['  Cliente: Carlos Méndez'],
        ['  Teléfono: 8888-1234'],
        ['  Producto: Zapatos Deportivos'],
        ['  Cantidad: 1'],
        ['  Total: 35000'],
        ['  Fecha Retirada: 2025-11-18'],
        ['  (NO necesita dirección)'],
        [''],
        ['═══════════════════════════════════════════════════════════'],
        ['CONSEJOS'],
        ['═══════════════════════════════════════════════════════════'],
        [''],
        ['✓ Puede tener columnas adicionales, serán ignoradas'],
        ['✓ Puede eliminar columnas que no use'],
        ['✓ Puede cambiar el orden de las columnas'],
        ['✓ Si falta el Número de Orden, se genera automáticamente'],
        ['✓ Si importa datos duplicados, revise los números de orden'],
        [''],
        ['═══════════════════════════════════════════════════════════'],
        ['¿NECESITA AYUDA?'],
        ['═══════════════════════════════════════════════════════════'],
        [''],
        ['El sistema es MUY flexible con nombres de columnas.'],
        ['Si su Excel existente usa otros nombres, probablemente funcione.'],
        [''],
        ['Si tiene problemas:'],
        ['1. Revise el reporte de errores después de importar'],
        ['2. Corrija las filas con errores'],
        ['3. Vuelva a importar'],
        [''],
        ['¡Puede importar cientos de pedidos en minutos!']
      );
    } else if (type === 'customers') {
      instructions.push(
        ['- Nombre: Nombre completo del cliente'],
        [''],
        ['CAMPOS OPCIONALES:'],
        ['- Todos los demás campos son opcionales'],
        ['- Teléfono: Formato 8888-8888 o 88888888'],
        ['- Email: Debe ser un correo válido']
      );
    } else if (type === 'products') {
      instructions.push(
        ['- Nombre: Nombre del producto'],
        [''],
        ['CAMPOS OPCIONALES:'],
        ['- Precio y Costo: Solo números, sin símbolos'],
        ['- Stock: Número entero de unidades disponibles']
      );
    }

    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    wsInstructions['!cols'] = [{ wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instrucciones');

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Return file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${template.filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Template generation error:', error);
    return NextResponse.json({ 
      error: 'Error generando plantilla',
      details: error.message 
    }, { status: 500 });
  }
}

