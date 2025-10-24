'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Alert, AlertDescription } from '@/app/components/ui/alert';
import { 
  Upload, 
  Download, 
  FileSpreadsheet, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Loader2,
  Users,
  Package,
  ShoppingCart,
  FileText,
  Sparkles
} from 'lucide-react';

type ImportType = 'orders' | 'customers' | 'products';

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  message?: string;
}

export function ExcelImporter() {
  const [selectedType, setSelectedType] = useState<ImportType>('orders');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const importTypes = [
    {
      id: 'orders' as ImportType,
      name: 'Pedidos / Orders',
      icon: ShoppingCart,
      description: 'Importa pedidos EA (envío) y RA (retiro). Flexible con nombres de columnas.',
      color: 'blue'
    },
    {
      id: 'products' as ImportType,
      name: 'Inventario / Productos',
      icon: Package,
      description: 'Importa productos al inventario. Columnas: Código, Tipo, Color, Capacidad, Cantidad, Precio, Ubicación.',
      color: 'purple'
    }
    // Coming soon: Customers
    // {
    //   id: 'customers' as ImportType,
    //   name: 'Clientes',
    //   icon: Users,
    //   description: 'Importa información de clientes frecuentes',
    //   color: 'green'
    // }
  ];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        alert('Por favor selecciona un archivo Excel (.xlsx o .xls)');
        return;
      }
      setSelectedFile(file);
      setImportResult(null);
      setShowResult(false);
    }
  };

  const handleDownloadTemplate = async (type: ImportType) => {
    try {
      const response = await fetch(`/api/import/template?type=${type}`);
      if (!response.ok) throw new Error('Error descargando plantilla');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plantilla_${type}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Error descargando la plantilla');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setImportResult(null);
    setShowResult(false);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('type', selectedType);

      const response = await fetch('/api/import/excel', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setImportResult(data);
        setShowResult(true);
        setSelectedFile(null);
        // Reset file input
        const fileInput = document.getElementById('file-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
      } else {
        alert(data.error || 'Error importando archivo');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error subiendo archivo');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
              <FileSpreadsheet className="h-8 w-8 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl text-white">Importador de Excel</CardTitle>
              <CardDescription className="text-white/90">
                Importa datos masivos desde archivos Excel (.xlsx, .xls)
              </CardDescription>
            </div>
            <Badge className="ml-auto bg-yellow-400 text-yellow-900 border-yellow-500">
              <Sparkles className="h-3 w-3 mr-1" />
              Premium
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Import Type Selection */}
      <Card>
        <CardHeader>
          <CardTitle>1. Selecciona el tipo de datos</CardTitle>
          <CardDescription>
            Elige qué tipo de información deseas importar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4">
            {importTypes.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.id;
              const colorClasses = {
                blue: 'border-blue-500 bg-blue-50 text-blue-700',
                green: 'border-green-500 bg-green-50 text-green-700',
                purple: 'border-purple-500 bg-purple-50 text-purple-700'
              };

              return (
                <button
                  key={type.id}
                  onClick={() => setSelectedType(type.id)}
                  className={`p-6 border-2 rounded-lg transition-all ${
                    isSelected
                      ? `${colorClasses[type.color as keyof typeof colorClasses]} shadow-lg scale-105`
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow'
                  }`}
                >
                  <Icon className={`h-10 w-10 mb-3 ${isSelected ? '' : 'text-gray-400'}`} />
                  <h3 className="font-semibold text-lg mb-1">{type.name}</h3>
                  <p className={`text-sm ${isSelected ? 'opacity-90' : 'text-gray-500'}`}>
                    {type.description}
                  </p>
                  {isSelected && (
                    <CheckCircle className="h-5 w-5 absolute top-4 right-4" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Download Template */}
      <Card>
        <CardHeader>
          <CardTitle>2. Descarga la plantilla Excel</CardTitle>
          <CardDescription>
            Usa nuestra plantilla pre-formateada para asegurar una importación exitosa
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-gray-400" />
              <div>
                <p className="font-medium">plantilla_{selectedType}.xlsx</p>
                <p className="text-sm text-gray-500">
                  Incluye ejemplos e instrucciones
                </p>
              </div>
            </div>
            <Button
              onClick={() => handleDownloadTemplate(selectedType)}
              variant="outline"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Descargar Plantilla
            </Button>
          </div>

          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Importante:</strong> No modifiques los nombres de las columnas en la plantilla. 
              Puedes eliminar la fila de ejemplo y agregar tus propios datos.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Upload File */}
      <Card>
        <CardHeader>
          <CardTitle>3. Sube tu archivo Excel</CardTitle>
          <CardDescription>
            Selecciona el archivo Excel con tus datos para importar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
            <input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer flex flex-col items-center gap-3"
            >
              <div className="p-4 bg-gray-100 rounded-full">
                <Upload className="h-8 w-8 text-gray-600" />
              </div>
              {selectedFile ? (
                <div className="text-center">
                  <p className="font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="text-sm text-gray-500">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                  <Button
                    variant="link"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedFile(null);
                      const fileInput = document.getElementById('file-upload') as HTMLInputElement;
                      if (fileInput) fileInput.value = '';
                    }}
                    className="text-red-500 hover:text-red-700"
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="text-center">
                  <p className="font-medium text-gray-700">
                    Haz clic para seleccionar archivo
                  </p>
                  <p className="text-sm text-gray-500">
                    o arrastra y suelta aquí
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Formatos soportados: .xlsx, .xls
                  </p>
                </div>
              )}
            </label>
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="w-full h-12 text-lg gap-2"
            size="lg"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Importando datos...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Importar Datos
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {showResult && importResult && (
        <Card className={importResult.success ? 'border-green-500' : 'border-red-500'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.success ? (
                <>
                  <CheckCircle className="h-6 w-6 text-green-500" />
                  Importación Completada
                </>
              ) : (
                <>
                  <XCircle className="h-6 w-6 text-red-500" />
                  Importación con Errores
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 text-green-700 mb-1">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Importados</span>
                </div>
                <p className="text-3xl font-bold text-green-600">
                  {importResult.imported}
                </p>
              </div>

              {importResult.failed > 0 && (
                <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 mb-1">
                    <XCircle className="h-5 w-5" />
                    <span className="font-semibold">Fallidos</span>
                  </div>
                  <p className="text-3xl font-bold text-red-600">
                    {importResult.failed}
                  </p>
                </div>
              )}
            </div>

            {/* Error Details */}
            {importResult.errors && importResult.errors.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2 text-red-700">
                  Detalles de Errores:
                </h4>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {importResult.errors.map((error, index) => (
                    <Alert key={index} variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Fila {error.row}:</strong> {error.message}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                setShowResult(false);
                setImportResult(null);
              }}
              variant="outline"
              className="w-full"
            >
              Cerrar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Consejos para una importación exitosa
          </CardTitle>
        </CardHeader>
        <CardContent className="text-blue-800 space-y-2">
          <ul className="list-disc list-inside space-y-1">
            <li>Descarga siempre la plantilla más reciente antes de importar</li>
            <li>No cambies los nombres de las columnas en la plantilla</li>
            <li>Asegúrate que las fechas estén en formato correcto (YYYY-MM-DD)</li>
            <li>Los precios no deben incluir símbolos de moneda (₡, $)</li>
            <li>Revisa que no haya filas vacías en medio de tus datos</li>
            <li>Verifica que los números de teléfono y emails sean válidos</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

