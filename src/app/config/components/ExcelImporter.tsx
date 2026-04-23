'use client';

import { Fragment, useState, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/app/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/app/components/ui/alert';
import { Badge } from '@/app/components/ui/badge';
import { Progress } from '@/app/components/ui/progress';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/app/components/ui/table';
import {
  FileSpreadsheet,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  X,
} from 'lucide-react';

interface SheetInfo {
  index: number;
  name: string;
  rowCount: number;
}

interface RowError {
  field: string;
  message: string;
}

interface PreviewRow {
  rowIndex: number;
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
  errors: RowError[];
  isValid: boolean;
}

interface PreviewData {
  sheets: SheetInfo[];
  selectedSheet: number;
  headers: string[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  preview: PreviewRow[];
}

interface ImportResult {
  success: boolean;
  message: string;
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  duration: string;
}

type Step = 'upload' | 'preview' | 'importing' | 'results';

const PREVIEW_COLUMNS = [
  { key: 'sku', label: 'Código' },
  { key: 'tipo', label: 'Tipo' },
  { key: 'color', label: 'Color' },
  { key: 'capacidad', label: 'Capacidad' },
  { key: 'currentStock', label: 'Cant' },
  { key: 'category', label: 'Categoría' },
  { key: 'sellingPrice', label: 'Precio Venta' },
  { key: 'location', label: 'Ubicación' },
  { key: 'unitCost', label: 'Costo' },
  { key: 'description', label: 'Descripción' },
  { key: 'supplier', label: 'Proveedor' },
] as const;

const MAX_PREVIEW_ROWS = 100;

async function readJsonResponse(res: Response) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: res.ok
        ? 'Respuesta inesperada del servidor'
        : 'Error inesperado del servidor al procesar el archivo',
    };
  }
}

export function ExcelImporter() {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setStep('upload');
    setFile(null);
    setPreviewData(null);
    setSelectedSheetIndex(0);
    setImportResult(null);
    setLoading(false);
    setError(null);
    setExpandedErrors(new Set());
    setShowOnlyErrors(false);
  }, []);

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch('/api/import/template?type=products');
      if (!res.ok) throw new Error('Error descargando plantilla');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_inventario.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      setError('Error descargando la plantilla. Intente de nuevo.');
    }
  };

  const handleFileSelect = async (selectedFile: File) => {
    setError(null);

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'application/zip',
    ];
    const lowerName = selectedFile.name.toLowerCase();
    const isValidExtension = lowerName.endsWith('.xlsx');
    if (lowerName.endsWith('.xls')) {
      setError('Los archivos .xls antiguos no son compatibles. Guarde el archivo como .xlsx e intente de nuevo.');
      return;
    }
    if (!isValidExtension || (selectedFile.type && !validTypes.includes(selectedFile.type))) {
      setError('Solo se permiten archivos Excel .xlsx');
      return;
    }

    // Validate file size
    const MAX_SIZE = 10 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      setError('El archivo excede el tamaño máximo de 10MB');
      return;
    }

    setFile(selectedFile);
    await fetchPreview(selectedFile, 0);
  };

  const fetchPreview = async (targetFile: File, sheetIndex: number) => {
    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', targetFile);
      formData.append('sheetIndex', String(sheetIndex));

      const res = await fetch('/api/import/preview', {
        method: 'POST',
        body: formData,
      });

      const data = await readJsonResponse(res);

      if (!res.ok) {
        setError(data.error || 'Error procesando el archivo');
        setLoading(false);
        return;
      }

      setPreviewData(data);
      setSelectedSheetIndex(data.selectedSheet ?? sheetIndex);
      setStep('preview');
    } catch {
      setError('Error de conexión al procesar el archivo');
    } finally {
      setLoading(false);
    }
  };

  const handleSheetChange = async (newIndex: number) => {
    if (!file) return;
    setSelectedSheetIndex(newIndex);
    await fetchPreview(file, newIndex);
  };

  const handleImport = async () => {
    if (!file || !previewData) return;

    setStep('importing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'inventory');
      formData.append('sheetIndex', String(selectedSheetIndex));

      const res = await fetch('/api/import/excel', {
        method: 'POST',
        body: formData,
      });

      const data = await readJsonResponse(res);

      if (!res.ok) {
        setError(data.error || 'Error importando los datos');
        setStep('preview');
        return;
      }

      setImportResult(data);
      setStep('results');
    } catch {
      setError('Error de conexión durante la importación');
      setStep('preview');
    }
  };

  const toggleErrorRow = (rowIndex: number) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  // ---- RENDER: Upload Step ----
  if (step === 'upload') {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <FileSpreadsheet className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Importar Inventario</h2>
                <p className="text-sm text-muted-foreground">
                  Cargue un archivo Excel para agregar productos al inventario de forma masiva
                </p>
              </div>
            </div>

            {/* Template download */}
            <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium mb-1">Plantilla de inventario</p>
                  <p className="text-xs text-muted-foreground">
                    Descargue la plantilla con las columnas correctas y un ejemplo para guiarse
                  </p>
                </div>
                <button
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors shrink-0"
                >
                  <Download className="w-4 h-4" />
                  Descargar plantilla
                </button>
              </div>
            </div>

            {/* File drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
                ${dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Procesando archivo...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-full bg-muted">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Arrastra un archivo Excel aquí o haz clic para seleccionar
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Formato: .xlsx — Máximo 10MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Column reference */}
            <div className="mt-6">
              <p className="text-xs font-medium text-muted-foreground mb-2">Columnas esperadas:</p>
              <div className="flex flex-wrap gap-1.5">
                {['Código*', 'Tipo', 'Color', 'Capacidad (oz)', 'cant', 'Categoría', 'precio de venta', 'Ubicación', 'costo unitario', 'descripción', 'Proveedor'].map(col => (
                  <Badge
                    key={col}
                    variant={col.endsWith('*') ? 'default' : 'secondary'}
                    className="text-[11px]"
                  >
                    {col}
                  </Badge>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">* Campo requerido. El nombre del producto se genera de Tipo + Color + Capacidad.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- RENDER: Preview Step ----
  if (step === 'preview' && previewData) {
    const displayRows = showOnlyErrors
      ? previewData.preview.filter(r => !r.isValid)
      : previewData.preview;
    const truncated = displayRows.length > MAX_PREVIEW_ROWS;
    const visibleRows = truncated ? displayRows.slice(0, MAX_PREVIEW_ROWS) : displayRows;

    return (
      <div className="space-y-4">
        {/* Header with back button */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={resetState}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver
                </button>
                <div className="h-5 w-px bg-border" />
                <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                  {file?.name}
                </span>
              </div>

              {/* Sheet selector */}
              {previewData.sheets.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground whitespace-nowrap">Hoja:</label>
                  <select
                    value={selectedSheetIndex}
                    onChange={(e) => handleSheetChange(Number(e.target.value))}
                    className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background"
                    disabled={loading}
                  >
                    {previewData.sheets.map((s) => (
                      <option key={s.index} value={s.index}>
                        {s.name} ({s.rowCount} filas)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <FileSpreadsheet className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{previewData.totalRows}</p>
                <p className="text-xs text-muted-foreground">Filas totales</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">{previewData.validRows}</p>
                <p className="text-xs text-muted-foreground">Filas válidas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{previewData.errorRows}</p>
                <p className="text-xs text-muted-foreground">Filas con errores</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Error warning */}
        {previewData.errorRows > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Filas con errores</AlertTitle>
            <AlertDescription>
              {previewData.errorRows} fila(s) tienen errores y serán omitidas durante la importación.
              Revise los errores y corrija el archivo Excel si es necesario.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Filter + Import actions */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                {previewData.errorRows > 0 && (
                  <button
                    onClick={() => setShowOnlyErrors(!showOnlyErrors)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      showOnlyErrors
                        ? 'bg-red-500/10 text-red-600 border border-red-200'
                        : 'hover:bg-muted border border-border'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    {showOnlyErrors ? 'Mostrando solo errores' : 'Mostrar solo errores'}
                  </button>
                )}
                {truncated && (
                  <span className="text-xs text-muted-foreground">
                    Mostrando {MAX_PREVIEW_ROWS} de {displayRows.length} filas
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={resetState}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleImport}
                  disabled={previewData.validRows === 0 || loading}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-4 h-4" />
                  Importar {previewData.validRows} producto{previewData.validRows !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Preview table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <span className="ml-2 text-sm text-muted-foreground">Cargando vista previa...</span>
              </div>
            ) : previewData.totalRows === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">La hoja seleccionada no contiene datos</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-14 text-center sticky left-0 bg-muted/50 z-10">Fila</TableHead>
                      <TableHead className="w-14 text-center">Estado</TableHead>
                      {PREVIEW_COLUMNS.map(col => (
                        <TableHead key={col.key} className="whitespace-nowrap">
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row) => {
                      const hasErrors = !row.isValid;
                      const isExpanded = expandedErrors.has(row.rowIndex);
                      const errorFields = new Set(row.errors.map(e => e.field));

                      return (
                        <Fragment key={row.rowIndex}>
                          <TableRow
                            key={row.rowIndex}
                            className={`${hasErrors ? 'bg-red-50/50 dark:bg-red-950/10 hover:bg-red-50/80 dark:hover:bg-red-950/20' : ''} ${hasErrors ? 'cursor-pointer' : ''}`}
                            onClick={hasErrors ? () => toggleErrorRow(row.rowIndex) : undefined}
                          >
                            <TableCell className="text-center text-xs text-muted-foreground sticky left-0 bg-inherit z-10">
                              {row.rowIndex + 2}
                            </TableCell>
                            <TableCell className="text-center">
                              {hasErrors ? (
                                <div className="flex items-center justify-center gap-1">
                                  <XCircle className="w-4 h-4 text-red-500" />
                                  {isExpanded ? (
                                    <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                  )}
                                </div>
                              ) : (
                                <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                              )}
                            </TableCell>
                            {PREVIEW_COLUMNS.map(col => {
                              const val = row.mapped[col.key as keyof typeof row.mapped];
                              const cellHasError = errorFields.has(col.key);
                              return (
                                <TableCell
                                  key={col.key}
                                  className={`text-sm max-w-[200px] truncate ${
                                    cellHasError ? 'text-red-600 font-medium bg-red-100/50 dark:bg-red-900/20' : ''
                                  }`}
                                  title={cellHasError ? row.errors.find(e => e.field === col.key)?.message : String(val ?? '')}
                                >
                                  {val !== undefined && val !== null && val !== '' ? String(val) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                          {hasErrors && isExpanded && (
                            <TableRow key={`${row.rowIndex}-errors`} className="bg-red-50/80 dark:bg-red-950/20">
                              <TableCell colSpan={PREVIEW_COLUMNS.length + 2} className="py-2 px-4">
                                <div className="flex flex-wrap gap-2">
                                  {row.errors.map((err, eIdx) => (
                                    <div
                                      key={eIdx}
                                      className="inline-flex items-center gap-1.5 text-xs text-red-600 bg-red-100 dark:bg-red-900/30 px-2.5 py-1 rounded-md"
                                    >
                                      <AlertCircle className="w-3 h-3 shrink-0" />
                                      <span className="font-medium">{err.field}:</span> {err.message}
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- RENDER: Importing Step ----
  if (step === 'importing') {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col items-center text-center px-6 py-16">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
            <h2 className="text-lg font-semibold mb-2">Importando productos...</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Esto puede tardar unos momentos dependiendo de la cantidad de productos.
              No cierre esta página.
            </p>
            <Progress value={undefined} className="w-64" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- RENDER: Results Step ----
  if (step === 'results' && importResult) {
    const hasErrors = importResult.failed > 0;

    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center mb-6">
              {importResult.imported > 0 ? (
                <div className="p-3 rounded-full bg-green-500/10 mb-4">
                  <CheckCircle2 className="w-10 h-10 text-green-500" />
                </div>
              ) : (
                <div className="p-3 rounded-full bg-red-500/10 mb-4">
                  <XCircle className="w-10 h-10 text-red-500" />
                </div>
              )}
              <h2 className="text-xl font-semibold mb-1">
                {importResult.imported > 0 ? 'Importación completada' : 'Importación fallida'}
              </h2>
              <p className="text-sm text-muted-foreground">{importResult.message}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold text-green-600">{importResult.imported}</p>
                <p className="text-xs text-muted-foreground">Importados exitosamente</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold text-red-600">{importResult.failed}</p>
                <p className="text-xs text-muted-foreground">Fallidos</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <p className="text-2xl font-bold">{importResult.duration}s</p>
                <p className="text-xs text-muted-foreground">Duración</p>
              </div>
            </div>

            {/* Import errors detail */}
            {hasErrors && importResult.errors.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium mb-2 text-red-600">Errores de importación:</h3>
                <div className="max-h-[300px] overflow-auto rounded-lg border border-red-200 dark:border-red-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Fila</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResult.errors.slice(0, 50).map((err, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm font-medium">{err.row}</TableCell>
                          <TableCell className="text-sm text-red-600">{err.message}</TableCell>
                        </TableRow>
                      ))}
                      {importResult.errors.length > 50 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-xs text-muted-foreground">
                            ... y {importResult.errors.length - 50} errores más
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <button
                onClick={resetState}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Upload className="w-4 h-4" />
                Importar otro archivo
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fallback
  return null;
}
