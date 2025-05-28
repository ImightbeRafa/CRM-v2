const SPREADSHEET_ID = '1Kj82-Z0OYAmhRi03jbYtt2a9K2M9NhjoVwWD6GpB7MM';

const VALID_STATUSES = [
  'Pendiente',
  'Enviado',
  'En Proceso',
  'Completado',
  'Entregado',
  'Cancelado',
  'Drive',
  'Impreso',
  'PendienteDiseño'
];

const CACHE_TTL = 30; // Cache duration in seconds

function getCachedData(key) {
  const cache = CacheService.getScriptCache();
  const data = cache.get(key);
  return data ? JSON.parse(data) : null;
}

function setCachedData(key, data) {
  const cache = CacheService.getScriptCache();
  cache.put(key, JSON.stringify(data), CACHE_TTL);
}

function logToSheet(message) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const logSheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
  logSheet.appendRow([new Date(), message]);
}

// Process EA (Shipping) Orders
function processEAOrder(rawData, sheet) {
  logToSheet('Processing EA Order - Start');
  logToSheet('Raw data received: ' + JSON.stringify(rawData));
  
  const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  const orderId = 'EA' + new Date().getTime().toString().slice(-4);
  
  try {
    if (!data.customerInfo || !data.productInfo) {
      throw new Error('Invalid data structure: ' + JSON.stringify(data));
    }

    const rowData = [
      orderId,                           // Order ID (Column 1)
      'Pendiente',                       // Status (Column 2)
      '-',                              // Delivery (Column 3)
      data.customerInfo.fechaEsperada,   // Expected Date (Column 4)
      data.customerInfo.diaVenta,        // Sale Date (Column 5)
      data.productInfo.mensajeria,       // Courier (Column 6)
      data.productInfo.vendedor,         // Seller (Column 7)
      data.customerInfo.name,            // Customer Name (Column 8)
      data.customerInfo.username,        // Username (Column 9)
      data.customerInfo.phone,           // Phone (Column 10)
      data.customerInfo.email,           // Email (Column 11)
      data.customerInfo.province,        // Province (Column 12)
      data.customerInfo.canton,          // Canton (Column 13)
      data.customerInfo.district,        // District (Column 14)
      data.customerInfo.address,         // Address (Column 15)
      data.customerInfo.business || 'No especificado', // Business (Column 16)
      data.productInfo.type,             // Product Type (Column 17)
      data.productInfo.cantidad,         // Quantity (Column 18)
      data.productInfo.tamano,           // Size (Column 19)
      data.productInfo.color,            // Color (Column 20)
      data.productInfo.packaging,        // Packaging (Column 21)
      data.productInfo.personalizado,    // Customization (Column 22)
      data.productInfo.comments,         // Comments (Column 23)
      data.productInfo.productCost,      // Product Cost (Column 24)
      data.productInfo.shippingCost,     // Shipping Cost (Column 25)
      data.productInfo.iva,              // IVA (Column 26)
      data.productInfo.total,            // Total (Column 27)
      Utilities.formatDate(new Date(), "America/Costa_Rica", "dd/MM/yyyy HH:mm:ss"),  // Timestamp (Column 28)
      data.customerInfo.funnel || 'No especificado' // Funnel (Column 29)
    ];
    
    logToSheet('EA Order Data prepared: ' + JSON.stringify(rowData));
    sheet.appendRow(rowData);
    logToSheet('EA Order processed successfully: ' + orderId);
    return orderId;
  } catch (error) {
    logToSheet('Error processing EA Order: ' + error.toString());
    throw error;
  }
}

// Process RA (Pickup) Orders
// Add this debug function specifically for RA orders
function debugRAOrder(data, sheet) {
  logToSheet('=== Debug RA Order ===');
  logToSheet(`Incoming funnel value: ${data.customerInfo?.funnel}`);
  
  // Check sheet structure
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  logToSheet('RA Sheet Headers: ' + JSON.stringify(headers));
  logToSheet('Total columns in RA sheet: ' + sheet.getLastColumn());
  logToSheet('Last column header: ' + headers[headers.length - 1]);
  
  return {
    headers: headers,
    columnCount: sheet.getLastColumn(),
    lastColumnHeader: headers[headers.length - 1]
  };
}

// Updated processRAOrder function with enhanced debugging
function processRAOrder(rawData, sheet) {
  logToSheet('Processing RA Order - Start');
  logToSheet('Raw data received: ' + JSON.stringify(rawData));
  
  const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  const orderId = 'RA' + new Date().getTime().toString().slice(-4);
  
  try {
    if (!data.customerInfo || !data.productInfo) {
      throw new Error('Invalid data structure: ' + JSON.stringify(data));
    }

    // Extract funnel value first
    const funnelValue = data.customerInfo.funnel || 'No especificado';
    logToSheet('Funnel value to be used: ' + funnelValue);

    const rowData = [
      orderId,                           // Order ID (Column 1)
      'Pendiente',                       // Status (Column 2)
      '-',                              // Delivery (Column 3)
      data.productInfo.vendedor,         // Seller (Column 4)
      data.customerInfo.name,            // Name (Column 5)
      data.customerInfo.username,        // Username (Column 6)
      data.customerInfo.phone,           // Phone (Column 7)
      data.customerInfo.email,           // Email (Column 8)
      data.customerInfo.fechaAcordada,   // Agreed Date (Column 9)
      data.customerInfo.fechaRetirada,   // Pickup Date (Column 10)
      data.customerInfo.business || 'No especificado', // Business (Column 11)
      data.productInfo.type,             // Type (Column 12)
      data.productInfo.cantidad,         // Quantity (Column 13)
      data.productInfo.tamano,           // Size (Column 14)
      data.productInfo.color,            // Color (Column 15)
      data.productInfo.packaging,        // Packaging (Column 16)
      data.productInfo.personalizado,    // Customization (Column 17)
      data.productInfo.comments,         // Comments (Column 18)
      data.productInfo.productCost,      // Product Cost (Column 19)
      data.productInfo.iva,              // IVA (Column 20)
      data.productInfo.total,            // Total (Column 21)
      Utilities.formatDate(new Date(), "America/Costa_Rica", "dd/MM/yyyy HH:mm:ss"),  // Timestamp (Column 22)
      funnelValue                        // Funnel (Column 23)
    ];
    
    // Verify row data before saving
    logToSheet('Row data length: ' + rowData.length);
    logToSheet('Funnel column index: ' + (rowData.length - 1));
    logToSheet('Funnel value in row data: ' + rowData[rowData.length - 1]);
    
    // Save the data
    sheet.appendRow(rowData);
    
    // Verify saved data
    const lastRow = sheet.getLastRow();
    const savedData = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    logToSheet('Saved data verification:');
    logToSheet('- Total columns: ' + savedData.length);
    logToSheet('- Saved funnel value: ' + savedData[savedData.length - 1]);
    
    logToSheet('RA Order processed successfully: ' + orderId);
    return orderId;
  } catch (error) {
    logToSheet('Error processing RA Order: ' + error.toString());
    throw error;
  }
}

// Dashboard data processing
function getAllSales() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const eaSheet = ss.getSheetByName('EA');
    const raSheet = ss.getSheetByName('RA');

    if (!eaSheet || !raSheet) {
      throw new Error('Required sheets not found');
    }

    // Get EA sales with full field mapping
    const eaData = eaSheet.getDataRange().getValues();
    const eaHeaders = eaData[0];
    const eaSales = eaData.slice(1)
      .filter(row => row[0] && String(row[0]).match(/^EA\d{4}$/)) // Validate EA order IDs
      .map(row => ({
        orderId: row[0] || '',                    // Column 1 - EA
        status: row[1] || 'Pendiente',            // Estado
        delivery: row[2] || '',                   // Entrega
        customerName: row[3] || '',               // Nombre
        username: row[4] || '',                   // Usuario
        phone: row[5] || '',                      // Teléfono
        email: row[6] || '',                      // Correo
        expectedDate: row[7] || '',               // Fecha Esperada
        saleDate: row[8] || '',                   // Fecha Venta
        courier: row[9] || '',                    // Mensajería
        seller: row[10] || '',                    // Vendedor
        province: row[11] || '',                  // Provincia
        canton: row[12] || '',                    // Cantón
        district: row[13] || '',                  // Distrito
        address: row[14] || '',                   // Dirección
        business: row[15] || 'No especificado',   // Negocio
        product: row[16] || '',                   // Producto
        quantity: Number(row[17]) || 0,           // Cantidad
        size: row[18] || '',                      // Tamaño
        color: row[19] || '',                     // Color
        packaging: row[20] || '',                 // Empaque
        customization: row[21] || '',             // Personalizado
        comments: row[22] || '',                  // Comentario
        productCost: Number(row[23]) || 0,        // Costo Producto
        shippingCost: Number(row[24]) || 0,       // Costo Envío
        iva: Number(row[25]) || 0,                // IVA
        total: Number(row[26]) || 0,              // Total
        timestamp: row[27] || '',                 // TimeStamp
        funnel: row[28] || 'No especificado',     // Funnel
        orderType: 'EA'                           // Order Type
      }));

    // Get RA sales with full field mapping
    const raData = raSheet.getDataRange().getValues();
    const raHeaders = raData[0];
    const raSales = raData.slice(1)
      .filter(row => row[0] && String(row[0]).match(/^RA\d{4}$/)) // Validate RA order IDs
      .map(row => ({
        orderId: row[0] || '',                    // Column 1 - RA
        status: row[1] || 'Pendiente',            // Estado
        delivery: row[2] || '',                   // Entrega
        seller: row[3] || '',                     // Vendedor
        customerName: row[4] || '',               // Nombre
        username: row[5] || '',                   // Usuario
        phone: row[6] || '',                      // Teléfono
        email: row[7] || '',                      // Correo
        agreedDate: row[8] || '',                 // Fecha Acordada
        pickupDate: row[9] || '',                 // Fecha Retirada
        business: row[10] || 'No especificado',   // Negocio
        product: row[11] || '',                   // Producto
        quantity: Number(row[12]) || 0,           // Cantidad
        size: row[13] || '',                      // Tamaño
        color: row[14] || '',                     // Color
        packaging: row[15] || '',                 // Empaque
        customization: row[16] || '',             // Personalizado
        comments: row[17] || '',                  // Comentario
        productCost: Number(row[18]) || 0,        // Costo Producto
        iva: Number(row[19]) || 0,                // IVA
        total: Number(row[20]) || 0,              // Total
        timestamp: row[21] || '',                 // TimeStamp
        funnel: row[22] || 'No especificado',     // Funnel
        orderType: 'RA'                           // Order Type
      }));

    // Log any invalid orders for debugging
    const invalidEaOrders = eaData.slice(1).filter(row => !row[0] || !String(row[0]).match(/^EA\d{4}$/));
    const invalidRaOrders = raData.slice(1).filter(row => !row[0] || !String(row[0]).match(/^RA\d{4}$/));
    
    if (invalidEaOrders.length > 0) {
      logToSheet('Invalid EA orders found: ' + JSON.stringify(invalidEaOrders));
    }
    if (invalidRaOrders.length > 0) {
      logToSheet('Invalid RA orders found: ' + JSON.stringify(invalidRaOrders));
    }

    // Combine and sort all sales by timestamp
    const allSales = [...eaSales, ...raSales].sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return allSales;
  } catch (error) {
    logToSheet('Error in getAllSales: ' + error.toString());
    throw error;
  }
}

function getDailyStats() {
  try {
    const allSales = getAllSales();
    const today = new Date().toISOString().split('T')[0];
    logToSheet('Getting daily stats for: ' + today);
    
    const todaySales = allSales.filter(sale => {
      try {
        if (!sale.timestamp) return false;
        const saleDate = new Date(sale.timestamp).toISOString().split('T')[0];
        return saleDate === today;
      } catch (error) {
        logToSheet('Error processing sale timestamp: ' + error.toString());
        return false;
      }
    });

    const eaSales = todaySales.filter(sale => sale.orderType === 'EA');
    const raSales = todaySales.filter(sale => sale.orderType === 'RA');

    const stats = {
      totalSales: todaySales.length,
      totalAmount: todaySales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
      eaSales: eaSales.length,
      eaAmount: eaSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
      raSales: raSales.length,
      raAmount: raSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
      date: today
    };
    
    logToSheet('Daily stats calculated successfully: ' + JSON.stringify(stats));
    return stats;
    
  } catch (error) {
    logToSheet('Error in getDailyStats: ' + error.toString());
    throw error;
  }
}

function doGet(e) {
  try {
    // Check if this is a list request
    if (e?.parameter?.type === 'list') {
      const allSales = getAllSales();
      
      // Format sales as pipe-delimited string with proper field mapping
      const salesText = allSales.map(sale => {
        const commonFields = [
          sale.orderId || '',
          sale.customerName || '',
          String(sale.total || 0),
          sale.timestamp || '',
          sale.orderType || '',
          sale.phone || '',
          sale.email || '',
          sale.orderType === 'EA' ? (sale.address || '') : '',
          sale.product || '',
          sale.status || 'Pendiente',
          sale.business || 'No especificado',
          sale.funnel || 'No especificado',
          String(sale.quantity || 0),
          sale.size || '',
          sale.color || '',
          sale.packaging || '',
          sale.customization || '',
          sale.comments || '',
          String(sale.productCost || 0),
          String(sale.iva || 0),
          sale.username || '',
        ];

        // Add type-specific fields
        if (sale.orderType === 'EA') {
          return [
            ...commonFields,
            sale.expectedDate || '',
            sale.saleDate || '',
            sale.courier || '',
            sale.seller || '',
            sale.province || '',
            sale.canton || '',
            sale.district || '',
            String(sale.shippingCost || 0),
            '', // seller (RA)
            '', // agreedDate
            ''  // pickupDate
          ].join('|');
        } else {
          return [
            ...commonFields,
            '', // expectedDate
            '', // saleDate
            '', // courier
            '', // seller (EA)
            '', // province
            '', // canton
            '', // district
            '', // shippingCost
            sale.seller || '',
            sale.agreedDate || '',
            sale.pickupDate || ''
          ].join('|');
        }
      }).join(';');

      return ContentService.createTextOutput(salesText)
        .setMimeType(ContentService.MimeType.TEXT);
    }
    
    // Handle stats request
    const stats = getDailyStats();
    const responseText = `EA:${stats.eaSales}:${stats.eaAmount},RA:${stats.raSales}:${stats.raAmount}`;
    
    return ContentService.createTextOutput(responseText)
      .setMimeType(ContentService.MimeType.TEXT);
    
  } catch (error) {
    logToSheet('Error in doGet: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      error: error.toString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

// Status Update Functions
function updateOrderStatus(orderId, newStatus) {
  logToSheet('Starting updateOrderStatus');
  logToSheet(`Input orderId: ${orderId}, newStatus: ${newStatus}`);
  
  try {
    // Input validation
    if (!orderId || typeof orderId !== 'string') {
      throw new Error(`Invalid orderId: ${JSON.stringify(orderId)}`);
    }
    if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const orderType = orderId.substring(0, 2).toUpperCase();
    const sheet = orderType === 'EA' ? spreadsheet.getSheetByName('EA') :
                 orderType === 'RA' ? spreadsheet.getSheetByName('RA') : null;
    
    if (!sheet) {
      throw new Error(`Invalid order type or sheet not found: ${orderType}`);
    }
    
    const data = sheet.getDataRange().getValues();
    let rowFound = false;

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === orderId) {
        sheet.getRange(i + 1, 2).setValue(newStatus);
        logToSheet(`Updated status for order ${orderId} at row ${i + 1}`);
        rowFound = true;
        break;
      }
    }
    
    if (!rowFound) {
      throw new Error(`Order not found: ${orderId}`);
    }
    
    return true;
  } catch (error) {
    logToSheet(`Error in updateOrderStatus: ${error.toString()}`);
    throw error;
  }
}

// Add this new function to handle order updates
function updateOrder(orderId, data) {
  logToSheet('Starting updateOrder');
  logToSheet(`Input orderId: ${orderId}, data: ${JSON.stringify(data)}`);
  
  try {
    // Input validation
    if (!orderId || typeof orderId !== 'string') {
      throw new Error(`Invalid orderId: ${JSON.stringify(orderId)}`);
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const orderType = orderId.substring(0, 2).toUpperCase();
    const sheet = orderType === 'EA' ? spreadsheet.getSheetByName('EA') :
                 orderType === 'RA' ? spreadsheet.getSheetByName('RA') : null;
    
    if (!sheet) {
      throw new Error(`Invalid order type or sheet not found: ${orderType}`);
    }
    
    // Get headers and data
    const sheetData = sheet.getDataRange().getValues();
    const headers = sheetData[0];
    let rowFound = false;
    let rowIndex = -1;

    // Log headers for debugging
    logToSheet(`Sheet headers: ${JSON.stringify(headers)}`);

    // Find the row with the matching orderId
    for (let i = 0; i < sheetData.length; i++) {
      if (String(sheetData[i][0]) === orderId) {
        rowIndex = i;
        rowFound = true;
        break;
      }
    }
    
    if (!rowFound) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Log current row data before update
    const currentRow = sheetData[rowIndex];
    logToSheet(`Current row data: ${JSON.stringify(currentRow)}`);

    // Define field mappings based on order type
    const fieldMappings = orderType === 'EA' ? {
      // EA Field mappings
      orderId: 0,
      status: 1,
      delivery: 2,
      expectedDate: 3,
      saleDate: 4,
      courier: 5,
      seller: 6,
      customerName: 7,
      username: 8,
      phone: 9,
      email: 10,
      province: 11,
      canton: 12,
      district: 13,
      address: 14,
      business: 15,
      product: 16,
      quantity: 17,
      size: 18,
      color: 19,
      packaging: 20,
      customization: 21,
      comments: 22,
      productCost: 23,
      shippingCost: 24,
      iva: 25,
      total: 26,
      timestamp: 27,
      funnel: 28
    } : {
      // RA Field mappings
      orderId: 0,
      status: 1,
      delivery: 2,
      seller: 3,
      customerName: 4,
      username: 5,
      phone: 6,
      email: 7,
      agreedDate: 8,
      pickupDate: 9,
      business: 10,
      product: 11,
      quantity: 12,
      size: 13,
      color: 14,
      packaging: 15,
      customization: 16,
      comments: 17,
      productCost: 18,
      iva: 19,
      total: 20,
      timestamp: 21,
      funnel: 22
    };

    // Create a new row array based on current data
    let updatedRowData = [...currentRow];

    // Update fields using the mappings
    Object.entries(data).forEach(([field, value]) => {
      if (field in fieldMappings) {
        const colIndex = fieldMappings[field];
        let processedValue = value;

        // Handle different value types
        if (value instanceof Date) {
          processedValue = value.toISOString();
        } else if (typeof value === 'string') {
          processedValue = value.trim();
        } else if (typeof value === 'number') {
          processedValue = Number(value); // Ensure it's a number
        }

        logToSheet(`Updating field ${field} at column ${colIndex + 1} from ${updatedRowData[colIndex]} to ${processedValue}`);
        updatedRowData[colIndex] = processedValue;
      }
    });

    // Update the entire row at once
    sheet.getRange(rowIndex + 1, 1, 1, updatedRowData.length).setValues([updatedRowData]);

    // Verify the update
    const verificationRow = sheet.getRange(rowIndex + 1, 1, 1, headers.length).getValues()[0];
    logToSheet(`Verification row data: ${JSON.stringify(verificationRow)}`);
    
    return {
      success: true,
      message: 'Order updated successfully'
    };
    
  } catch (error) {
    logToSheet(`Error in updateOrder: ${error.toString()}`);
    throw error;
  }
}

// Modify your existing doPost function to handle the new updateOrder action
function doPost(e) {
  const lock = LockService.getUserLock();
  
  try {
    if (!lock.tryLock(5000)) {
      logToSheet('Failed to acquire lock');
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        error: 'Server is busy, please try again',
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }

    if (!e?.postData?.contents) {
      logToSheet('No post data received');
      throw new Error('No data received in request');
    }

    const data = JSON.parse(e.postData.contents);
    logToSheet(`Received request with action: ${data.action}`);

    // Handle status updates
    if (data.action === 'updateStatus') {
      if (!data.orderId || !data.status) {
        throw new Error('Missing required fields: orderId or status');
      }

      lock.releaseLock();
      const result = updateOrderStatus(String(data.orderId), String(data.status));
      
      return ContentService.createTextOutput(JSON.stringify({
        result: 'success',
        message: 'Status updated successfully',
        orderId: data.orderId,
        newStatus: data.status,
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Handle order updates
    if (data.action === 'updateOrder') {
      if (!data.orderId || !data.data) {
        logToSheet('Missing required fields for order update');
        throw new Error('Missing required fields for order update');
      }
      
      logToSheet(`Attempting to update order with data: ${JSON.stringify(data.data)}`);
      const result = updateOrder(data.orderId, data.data);
      
      return ContentService.createTextOutput(JSON.stringify({
        result: 'success',
        message: 'Order updated successfully',
        orderId: data.orderId,
        timestamp: new Date().toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }

    // Handle new orders
    if (!data.customerInfo?.orderType) {
      logToSheet('Missing order type in request');
      throw new Error('Missing order type in request');
    }
    
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let orderId;
    
    if (data.customerInfo.orderType === 'EA') {
      const sheet = spreadsheet.getSheetByName('EA');
      if (!sheet) throw new Error('EA sheet not found');
      
      // Verify sheet structure
      logToSheet(`EA Sheet columns: ${sheet.getLastColumn()}`);
      
      // Process order and verify result
      orderId = processEAOrder(data, sheet);
      
      // Verify saved data
      const lastRow = sheet.getLastRow();
      const lastRowData = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
      logToSheet(`Saved EA order data: ${JSON.stringify(lastRowData)}`);
      logToSheet(`Funnel value saved: ${lastRowData[lastRowData.length - 1] || 'No especificado'}`); // Ensure funnel value is logged
      
    } else if (data.customerInfo.orderType === 'RA') {
      const sheet = spreadsheet.getSheetByName('RA');
      if (!sheet) throw new Error('RA sheet not found');
      
      // Verify sheet structure
      logToSheet(`RA Sheet columns: ${sheet.getLastColumn()}`);
      
      // Process order and verify result
      orderId = processRAOrder(data, sheet);
      
      // Verify saved data
      const lastRow = sheet.getLastRow();
      const lastRowData = sheet.getRange(lastRow, 1, 1, sheet.getLastColumn()).getValues()[0];
      logToSheet(`Saved RA order data: ${JSON.stringify(lastRowData)}`);
      logToSheet(`Funnel value saved: ${lastRowData[lastRowData.length - 1] || 'No especificado'}`); // Ensure funnel value is logged
      
    } else {
      throw new Error('Invalid order type: ' + data.customerInfo.orderType);
    }

    const response = {
      result: 'success',
      orderId: orderId,
      timestamp: new Date().toISOString()
    };
    
    logToSheet('Success response: ' + JSON.stringify(response));
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    logToSheet(`Error in doPost: ${error.toString()}`);
    return ContentService.createTextOutput(JSON.stringify({
      result: 'error',
      error: error.toString(),
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}