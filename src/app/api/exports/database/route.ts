import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';
    const includeUsers = searchParams.get('includeUsers') === 'true';
    const includeSystemData = searchParams.get('includeSystemData') === 'true';

    if (!['json', 'csv', 'xlsx', 'sql'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format. Supported: json, csv, xlsx, sql' },
        { status: 400 }
      );
    }

    const prisma = getTenantPrisma(auth.tenantId);
    const MAX_EXPORT_ROWS = 10000;

    const [orders, clients, sellers, inventoryItems] = await Promise.all([
      prisma.order.findMany({ take: MAX_EXPORT_ROWS, orderBy: { timestamp: 'desc' } }),
      prisma.client.findMany({ take: MAX_EXPORT_ROWS, orderBy: { name: 'asc' } }),
      prisma.seller.findMany({ take: MAX_EXPORT_ROWS, orderBy: { name: 'asc' } }),
      prisma.inventoryItem.findMany({ take: MAX_EXPORT_ROWS, orderBy: { name: 'asc' } }),
    ]);

    const exportData: any = {
      metadata: {
        tenantId: auth.tenantId,
        exportedAt: new Date().toISOString(),
        exportedBy: auth.session?.user?.email || auth.userId,
        format,
        version: '1.0',
      },
      data: {
        orders,
        clients,
        sellers,
        inventoryItems,
      },
    };

    if (includeUsers) {
      exportData.data.users = await prisma.user.findMany({
        where: {
          memberships: {
            some: { tenantId: auth.tenantId },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          active: true,
          isLogisticsAdmin: true,
          createdAt: true,
          updatedAt: true,
          memberships: {
            where: { tenantId: auth.tenantId },
            select: {
              role: true,
              isActive: true,
              joinedAt: true,
            },
          },
        },
        take: MAX_EXPORT_ROWS,
      });
    }

    if (includeSystemData) {
      const [orderStatuses, productFields, optionSets, shippingMethods] = await Promise.all([
        prisma.orderStatus.findMany({ orderBy: { order: 'asc' } }),
        prisma.productField.findMany({ orderBy: { order: 'asc' } }),
        prisma.productOptionSet.findMany({ include: { options: true }, orderBy: { name: 'asc' } }),
        prisma.shippingMethod.findMany({ orderBy: { name: 'asc' } }),
      ]);

      exportData.data.system = {
        orderStatuses,
        productFields,
        optionSets,
        shippingMethods,
      };
    }

    const timestamp = new Date().toISOString().split('T')[0];
    let exportContent: string | Buffer;
    let contentType: string;
    let filename: string;

    switch (format) {
      case 'json':
        exportContent = JSON.stringify(exportData, null, 2);
        contentType = 'application/json';
        filename = `database-export-${timestamp}.json`;
        break;

      case 'csv': {
        const csvData = flattenDatabaseData(exportData.data);
        const csvParser = new Parser();
        exportContent = csvParser.parse(csvData);
        contentType = 'text/csv';
        filename = `database-export-${timestamp}.csv`;
        break;
      }

      case 'xlsx': {
        const workbook = new ExcelJS.Workbook();
        addJsonSheet(workbook, 'Metadata', [exportData.metadata]);
        addJsonSheet(workbook, 'Orders', exportData.data.orders);
        addJsonSheet(workbook, 'Clients', exportData.data.clients);
        addJsonSheet(workbook, 'Sellers', exportData.data.sellers);
        addJsonSheet(workbook, 'Inventory', exportData.data.inventoryItems);

        if (exportData.data.users) {
          addJsonSheet(workbook, 'Users', exportData.data.users);
        }

        if (exportData.data.system) {
          addJsonSheet(workbook, 'Order Statuses', exportData.data.system.orderStatuses);
          addJsonSheet(workbook, 'Product Fields', exportData.data.system.productFields);
          addJsonSheet(workbook, 'Option Sets', exportData.data.system.optionSets);
          addJsonSheet(workbook, 'Shipping Methods', exportData.data.system.shippingMethods);
        }

        exportContent = Buffer.from(await workbook.xlsx.writeBuffer());
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `database-export-${timestamp}.xlsx`;
        break;
      }

      case 'sql':
        exportContent = generateSQLDump(exportData);
        contentType = 'application/sql';
        filename = `database-export-${timestamp}.sql`;
        break;

      default:
        throw new Error('Unsupported format');
    }

    return new NextResponse(exportContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': exportContent.length.toString(),
        ...PII_NO_STORE_HEADERS,
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

function flattenDatabaseData(data: any): any[] {
  const flattened: any[] = [];

  data.orders.forEach((order: any) => {
    flattened.push({
      type: 'order',
      id: order.id,
      orderNumber: order.orderId,
      status: order.status,
      customerName: order.customerName,
      total: order.total,
      createdAt: order.timestamp,
    });
  });

  data.clients.forEach((client: any) => {
    flattened.push({
      type: 'client',
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      isActive: client.isActive,
      createdAt: client.createdAt,
      updatedAt: client.lastUpdated,
    });
  });

  data.sellers.forEach((seller: any) => {
    flattened.push({
      type: 'seller',
      id: seller.id,
      name: seller.name,
      isActive: seller.active,
    });
  });

  data.inventoryItems.forEach((item: any) => {
    flattened.push({
      type: 'inventory_item',
      id: item.id,
      name: item.name,
      sku: item.sku,
      category: item.category,
      currentStock: item.currentStock,
      sellingPrice: item.sellingPrice,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.lastUpdated,
    });
  });

  return flattened;
}

function generateSQLDump(data: any): string {
  let sql = '-- Betsy CRM Database Export\n';
  sql += `-- Exported: ${data.metadata.exportedAt}\n`;
  sql += `-- Tenant: ${data.metadata.tenantId}\n`;
  sql += `-- Exported by: ${data.metadata.exportedBy}\n\n`;

  Object.keys(data.data).forEach(tableName => {
    const tableData = data.data[tableName];
    if (Array.isArray(tableData) && tableData.length > 0) {
      sql += `-- ${tableName.toUpperCase()} DATA\n`;
      sql += `-- ${tableData.length} records\n`;
      sql += `/*\n${JSON.stringify(tableData, null, 2)}\n*/\n\n`;
    }
  });

  return sql;
}

function addJsonSheet(workbook: ExcelJS.Workbook, name: string, data: any[]) {
  const worksheet = workbook.addWorksheet(name);
  if (data.length === 0) return;

  const normalized = data.map(row => normalizeRow(row));
  worksheet.columns = Object.keys(normalized[0]).map(key => ({ header: key, key, width: 18 }));
  normalized.forEach(row => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
}

function normalizeRow(row: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : value,
    ])
  );
}
