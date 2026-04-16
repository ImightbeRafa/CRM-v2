import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import ExcelJS from 'exceljs';
import { parseExcelSheet, mapInventoryRow } from '@/lib/import-helpers';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant ID' }, { status: 400 });
    }

    // Get form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sheetIndexParam = formData.get('sheetIndex') as string;
    const sheetIndex = sheetIndexParam ? parseInt(sheetIndexParam, 10) : 0;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el tamaño máximo de 10MB' }, { status: 400 });
    }

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (file.type && !allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Solo se permiten archivos Excel (.xlsx, .xls)' }, { status: 400 });
    }

    // Read file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Get sheet names
    const sheets = workbook.worksheets.map((ws, idx) => ({
      index: idx,
      name: ws.name,
      rowCount: ws.rowCount,
    }));

    if (sheets.length === 0) {
      return NextResponse.json({ error: 'El archivo Excel no contiene hojas' }, { status: 400 });
    }

    // Select sheet
    const selectedIndex = Math.min(sheetIndex, sheets.length - 1);
    const worksheet = workbook.worksheets[selectedIndex];

    // Parse sheet
    const { headers, rows } = parseExcelSheet(worksheet);

    if (rows.length === 0) {
      return NextResponse.json({
        sheets,
        selectedSheet: selectedIndex,
        headers,
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        preview: [],
      });
    }

    // Validate each row using shared helper
    const preview = rows.map((row, idx) => mapInventoryRow(row, idx));

    const validRows = preview.filter(r => r.isValid).length;
    const errorRows = preview.filter(r => !r.isValid).length;

    return NextResponse.json({
      sheets,
      selectedSheet: selectedIndex,
      headers,
      totalRows: rows.length,
      validRows,
      errorRows,
      preview: preview.map(r => ({
        rowIndex: r.rowIndex,
        mapped: r.mapped,
        errors: r.errors,
        isValid: r.isValid,
      })),
    });

  } catch (error: any) {
    console.error('Preview error:', error);
    return NextResponse.json({
      error: 'Error procesando el archivo Excel para vista previa'
    }, { status: 500 });
  }
}
