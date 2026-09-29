import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { parseExcelSheet, mapInventoryRow, validateXlsxUpload } from '@/lib/import-helpers';
import { acquireXlsxParseSlot, xlsxArchiveProblem } from '@/lib/xlsx-guard';
import { rateLimit } from '@/lib/rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PREVIEW_RESPONSE_ROW_LIMIT = 500;

export async function POST(request: NextRequest) {
  try {
    // Same permission as the import itself (any signed-in role could parse uploads before).
    const auth = await authenticateAPIWithPermission(request, 'create_sales');
    if (!auth.ok) return auth.response;

    // Get form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const sheetIndexParam = formData.get('sheetIndex') as string;
    const sheetIndex = sheetIndexParam ? parseInt(sheetIndexParam, 10) : 0;

    const uploadError = validateXlsxUpload(file);
    if (uploadError) {
      return NextResponse.json({ error: uploadError }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el tamaño máximo de 10MB' }, { status: 400 });
    }

    // Read file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (!rateLimit(`xlsx:${auth.tenantId}`, { windowMs: 60_000, maxRequests: 10, identifier: 'xlsx-import' }).allowed) {
      return NextResponse.json({ error: 'Demasiadas importaciones seguidas. Espera un minuto.' }, { status: 429 });
    }
    const archiveProblem = xlsxArchiveProblem(buffer);
    if (archiveProblem) {
      return NextResponse.json({ error: archiveProblem }, { status: 400 });
    }

    // Parse Excel
    const workbook = new ExcelJS.Workbook();
    // Bounded parallel parsing per process (memory), whatever the number of businesses.
    const releaseSlot = acquireXlsxParseSlot();
    if (!releaseSlot) {
      return NextResponse.json({ error: 'Hay otras importaciones en curso. Intenta de nuevo en unos segundos.' }, { status: 503 });
    }
    try {
      await workbook.xlsx.load(buffer as any);
    } finally {
      releaseSlot();
    }

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
    const selectedIndex = Number.isFinite(sheetIndex)
      ? Math.max(0, Math.min(sheetIndex, sheets.length - 1))
      : 0;
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
    const responsePreview = preview.slice(0, PREVIEW_RESPONSE_ROW_LIMIT);

    return NextResponse.json({
      sheets,
      selectedSheet: selectedIndex,
      headers,
      totalRows: rows.length,
      validRows,
      errorRows,
      preview: responsePreview.map(r => ({
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
