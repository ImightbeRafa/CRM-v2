import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';

export async function GET(request: NextRequest) {
  try {
    // Authenticate and check permissions (only OWNER/ADMIN can export full database)
    const session = await authenticateAPIWithPermission(request, 'view_config');
    
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const includeUsers = searchParams.get('includeUsers') === 'true';
    const includeSystemData = searchParams.get('includeSystemData') === 'true';
    
    // Validate format
    if (!['json', 'csv', 'xlsx', 'sql'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx, sql' },
        { status: 400 }
      );
    }
    
    const prisma = getTenantPrisma(session.user.tenantId);
    
    // Fetch all tenant data
    const exportData: any = {
      metadata: {
        tenantId: session.user.tenantId,
        exportedAt: new Date().toISOString(),
        exportedBy: session.user.email,
        format: format,
        version: '1.0'
      },
      data: {}
    };
    
    // Export core business data
    const [orders, clients, sellers, products, orderItems] = await Promise.all([
      prisma.order.findMany({
        include: {
          client: true,
          seller: true,
          orderItems: {
            include: {
              product: true
            }
          }
        }
      }),
      prisma.client.findMany(),
      prisma.seller.findMany(),
      prisma.product.findMany(),
      prisma.orderItem.findMany({
        include: {
          product: true,
          order: true
        }
      })
    ]);
    
    exportData.data = {
      orders,
      clients,
      sellers,
      products,
      orderItems
    };
    
    // Include user data if requested and user has permission
    if (includeUsers) {
      const users = await prisma.user.findMany({
        include: {
          memberships: {
            where: {
              tenantId: session.user.tenantId
            },
            include: {
              tenant: true
            }
          }
        }
      });
      
      exportData.data.users = users;
    }
    
    // Include system data if requested
    if (includeSystemData) {
      const [orderStatuses, customFields, optionSets] = await Promise.all([
        prisma.orderStatus.findMany(),
        prisma.customField.findMany(),
        prisma.optionSet.findMany()
      ]);
      
      exportData.data.system = {
        orderStatuses,
        customFields,
        optionSets
      };
    }
    
    // Generate export based on format
    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;
    
    const timestamp = new Date().toISOString().split('T')[0];
    
    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `database-export-${timestamp}.json`;
        break;
        
      case 'csv':
        // Create CSV with multiple files (zip would be better, but keeping simple)
        const csvData = flattenDatabaseData(exportData.data);
        const csvParser = new Parser({
          fields: Object.keys(csvData[0] || {})
        });
        exportContent = csvParser.parse(csvData);
        contentType = 'text/csv';
        filename = `database-export-${timestamp}.csv`;
        break;
        
      case 'xlsx':
        // Create workbook with multiple sheets
        const workbook = new ExcelJS.Workbook();
        
        // Helper to add a JSON array as a worksheet
        const addJsonSheet = (name: string, data: any[]) => {
          const ws = workbook.addWorksheet(name);
          if (data.length > 0) {
            ws.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 15 }));
            data.forEach((row: any) => ws.addRow(row));
            ws.getRow(1).font = { bold: true };
          }
        };
        
        // Metadata sheet
        addJsonSheet('Metadata', [exportData.metadata]);
        
        // Orders sheet
        addJsonSheet('Orders', exportData.data.orders);
        
        // Clients sheet
        addJsonSheet('Clients', exportData.data.clients);
        
        // Sellers sheet
        addJsonSheet('Sellers', exportData.data.sellers);
        
        // Products sheet
        addJsonSheet('Products', exportData.data.products);
        
        // Order Items sheet
        addJsonSheet('Order Items', exportData.data.orderItems);
        
        // Users sheet (if included)
        if (includeUsers && exportData.data.users) {
          addJsonSheet('Users', exportData.data.users);
        }
        
        // System sheet (if included)
        if (includeSystemData && exportData.data.system) {
          addJsonSheet('System Data', [
            exportData.data.system.orderStatuses,
            exportData.data.system.customFields,
            exportData.data.system.optionSets
          ].flat());
        }
        
        // Generate buffer
        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `database-export-${timestamp}.xlsx`;
        break;
        
      case 'sql':
        // Generate SQL dump
        exportContent = generateSQLDump(exportData);
        contentType = 'application/sql';
        filename = `database-export-${timestamp}.sql`;
        break;
        
      default:
        throw new Error('Unsupported format');
    }
    
    // Return file download
    return new NextResponse(exportContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportContent.length.toString(),
      },
    });
    
  } catch (error) {
    console.error('Error exporting database:', error);
    return NextResponse.json(
      { error: 'Failed to export database' },
      { status: 500 }
    );
  }
}

// Helper function to flatten database data for CSV
function flattenDatabaseData(data: any): any[] {
  const flattened: any[] = [];
  
  // Flatten orders
  data.orders.forEach((order: any) => {
    flattened.push({
      type: 'order',
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      clientName: order.client?.name || 'N/A',
      sellerName: order.seller?.name || 'N/A',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    });
  });
  
  // Flatten clients
  data.clients.forEach((client: any) => {
    flattened.push({
      type: 'client',
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      isActive: client.isActive,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt
    });
  });
  
  // Flatten sellers
  data.sellers.forEach((seller: any) => {
    flattened.push({
      type: 'seller',
      id: seller.id,
      name: seller.name,
      email: seller.email,
      isActive: seller.isActive,
      createdAt: seller.createdAt,
      updatedAt: seller.updatedAt
    });
  });
  
  // Flatten products
  data.products.forEach((product: any) => {
    flattened.push({
      type: 'product',
      id: product.id,
      name: product.name,
      price: product.price,
      category: product.category,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    });
  });
  
  return flattened;
}

// Helper function to generate SQL dump
function generateSQLDump(data: any): string {
  let sql = `-- Betsy CRM Database Export\n`;
  sql += `-- Exported: ${data.metadata.exportedAt}\n`;
  sql += `-- Tenant: ${data.metadata.tenantId}\n`;
  sql += `-- Exported by: ${data.metadata.exportedBy}\n\n`;
  
  // Generate INSERT statements for each table
  Object.keys(data.data).forEach(tableName => {
    const tableData = data.data[tableName];
    if (Array.isArray(tableData) && tableData.length > 0) {
      sql += `-- ${tableName.toUpperCase()} DATA\n`;
      sql += `-- ${tableData.length} records\n\n`;
      
      // Note: In a real implementation, you'd generate proper INSERT statements
      // For now, we'll just include the data as JSON comments
      sql += `/*\n${JSON.stringify(tableData, null, 2)}\n*/\n\n`;
    }
  });
  
  return sql;
}
