"use client";
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { 
  Play, 
  Pause, 
  CheckCircle, 
  Clock, 
  Package, 
  Truck, 
  AlertCircle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Home,
  Settings,
  Users,
  Download
} from 'lucide-react';

interface ProductionWorkflowGuideProps {
  onClose: () => void;
}

export function ProductionWorkflowGuide({ onClose }: ProductionWorkflowGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const workflowSteps = [
    {
      id: 'overview',
      title: 'Bienvenido al Panel de Producción',
      description: 'Este es tu centro de control para gestionar todas las órdenes de producción y envío.',
      icon: <Home className="h-8 w-8" />,
      color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-600',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <h4 className="font-semibold text-green-800 dark:text-green-300 mb-2">Órdenes de Envío (EA)</h4>
              <p className="text-sm text-green-700 dark:text-green-400">Productos que se envían a los clientes</p>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
              <h4 className="font-semibold text-purple-800 dark:text-purple-300 mb-2">Órdenes de Retiro (RA)</h4>
              <p className="text-sm text-purple-700 dark:text-purple-400">Productos que los clientes recogen</p>
            </div>
          </div>
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <AlertCircle className="h-5 w-5 text-yellow-600 inline mr-2" />
            <span className="text-sm text-yellow-800 dark:text-yellow-300">
              <strong>Tip:</strong> Las órdenes urgentes aparecen con un borde rojo
            </span>
          </div>
        </div>
      )
    },
    {
      id: 'statuses',
      title: 'Estados de las Órdenes',
      description: 'Cada orden pasa por diferentes estados durante el proceso de producción.',
      icon: <Settings className="h-8 w-8" />,
      color: 'bg-green-100 dark:bg-green-950/40 text-green-600',
      content: (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <Clock className="h-5 w-5 text-yellow-600" />
              <div>
                <div className="font-semibold text-yellow-800 dark:text-yellow-300">Pendiente</div>
                <div className="text-sm text-yellow-700 dark:text-yellow-400">Orden recibida, esperando procesamiento</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Package className="h-5 w-5 text-blue-600" />
              <div>
                <div className="font-semibold text-blue-800 dark:text-blue-300">En Proceso</div>
                <div className="text-sm text-blue-700 dark:text-blue-400">Orden siendo preparada</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <div className="font-semibold text-green-800 dark:text-green-300">Completado</div>
                <div className="text-sm text-green-700 dark:text-green-400">Orden lista para envío/retiro</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
              <Truck className="h-5 w-5 text-purple-600" />
              <div>
                <div className="font-semibold text-purple-800 dark:text-purple-300">Enviado</div>
                <div className="text-sm text-purple-700 dark:text-purple-400">Orden en camino al cliente</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'navigation',
      title: 'Cómo Navegar',
      description: 'Aprende a usar las diferentes funciones del panel de producción.',
      icon: <ArrowRight className="h-8 w-8" />,
      color: 'bg-purple-100 dark:bg-purple-950/40 text-purple-600',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">🔍 Buscar Órdenes</h4>
              <p className="text-sm text-muted-foreground mb-2">Usa la barra de búsqueda para encontrar órdenes por:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Nombre del cliente</li>
                <li>• Número de orden</li>
                <li>• Producto</li>
                <li>• Teléfono</li>
              </ul>
            </div>
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">🏷️ Filtrar por Estado</h4>
              <p className="text-sm text-muted-foreground mb-2">Selecciona un estado para ver solo esas órdenes:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Pendiente</li>
                <li>• En Proceso</li>
                <li>• Completado</li>
                <li>• Enviado</li>
              </ul>
            </div>
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">👁️ Ver Detalles</h4>
              <p className="text-sm text-muted-foreground">Haz clic en &quot;Ver Detalles&quot; para:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Ver toda la información</li>
                <li>• Editar datos</li>
                <li>• Cambiar estado</li>
                <li>• Agregar comentarios</li>
              </ul>
            </div>
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">⚡ Acciones Rápidas</h4>
              <p className="text-sm text-muted-foreground">Cambia el estado directamente desde la tarjeta:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Selecciona nuevo estado</li>
                <li>• Se actualiza automáticamente</li>
                <li>• Ideal para cambios rápidos</li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'bulk-operations',
      title: 'Operaciones Masivas',
      description: 'Aprende a actualizar múltiples órdenes al mismo tiempo.',
      icon: <Users className="h-8 w-8" />,
      color: 'bg-orange-100 dark:bg-orange-950/40 text-orange-600',
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">📋 Seleccionar Múltiples Órdenes</h4>
            <ol className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
              <li>1. Marca las casillas de las órdenes que quieres actualizar</li>
              <li>2. Haz clic en &quot;Operaciones Masivas&quot;</li>
              <li>3. Selecciona el nuevo estado</li>
              <li>4. Confirma la actualización</li>
            </ol>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
            <h4 className="font-semibold text-green-800 dark:text-green-300 mb-2">💡 Casos de Uso Comunes</h4>
            <ul className="text-sm text-green-700 dark:text-green-400 space-y-1">
              <li>• Marcar todas las órdenes del día como &quot;En Proceso&quot;</li>
              <li>• Cambiar múltiples órdenes a &quot;Completado&quot;</li>
              <li>• Actualizar estado de envío en lote</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'export',
      title: 'Exportar Datos',
      description: 'Aprende a generar reportes y exportar información.',
      icon: <Download className="h-8 w-8" />,
      color: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">📊 Generar Reportes</h4>
              <p className="text-sm text-muted-foreground mb-2">Haz clic en &quot;Exportar&quot; para:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Crear archivos Excel/CSV</li>
                <li>• Generar reportes PDF</li>
                <li>• Filtrar por fecha/estado</li>
                <li>• Seleccionar campos a incluir</li>
              </ul>
            </div>
            <div className="p-4 bg-muted border border-border rounded-lg">
              <h4 className="font-semibold mb-2">📋 Generar Guías</h4>
              <p className="text-sm text-muted-foreground mb-2">Para órdenes de envío:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Selecciona órdenes EA</li>
                <li>• Agrega números de guía</li>
                <li>• Imprime etiquetas</li>
                <li>• Actualiza automáticamente</li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'tips',
      title: 'Consejos y Trucos',
      description: 'Maximiza tu eficiencia con estos consejos profesionales.',
      icon: <HelpCircle className="h-8 w-8" />,
      color: 'bg-teal-100 dark:bg-teal-950/40 text-teal-600',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <h4 className="font-semibold text-yellow-800 dark:text-yellow-300 mb-2">⚡ Eficiencia</h4>
              <ul className="text-sm text-yellow-700 dark:text-yellow-400 space-y-1">
                <li>• Usa filtros para enfocarte</li>
                <li>• Actualiza estados en lote</li>
                <li>• Revisa órdenes urgentes primero</li>
                <li>• Usa búsqueda rápida</li>
              </ul>
            </div>
            <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <h4 className="font-semibold text-green-800 dark:text-green-300 mb-2">📱 Móvil</h4>
              <ul className="text-sm text-green-700 dark:text-green-400 space-y-1">
                <li>• Funciona en tablets y móviles</li>
                <li>• Navegación táctil optimizada</li>
                <li>• Acceso rápido a funciones</li>
                <li>• Sincronización automática</li>
              </ul>
            </div>
            <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">🔔 Notificaciones</h4>
              <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                <li>• Órdenes urgentes destacadas</li>
                <li>• Actualizaciones en tiempo real</li>
                <li>• Confirmaciones de cambios</li>
                <li>• Alertas de errores</li>
              </ul>
            </div>
            <div className="p-4 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg">
              <h4 className="font-semibold text-purple-800 dark:text-purple-300 mb-2">🛡️ Seguridad</h4>
              <ul className="text-sm text-purple-700 dark:text-purple-400 space-y-1">
                <li>• Todos los cambios se registran</li>
                <li>• Historial de modificaciones</li>
                <li>• Acceso controlado por roles</li>
                <li>• Respaldo automático</li>
              </ul>
            </div>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    if (currentStep < workflowSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const startTour = () => {
    setIsPlaying(true);
    setCurrentStep(0);
  };

  const stopTour = () => {
    setIsPlaying(false);
  };

  const currentStepData = workflowSteps[currentStep];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {currentStepData.icon}
            {currentStepData.title}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / workflowSteps.length) * 100}%` }}
            />
          </div>

          {/* Step Content */}
          <div className="space-y-4">
            <p className="text-muted-foreground">{currentStepData.description}</p>
            {currentStepData.content}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={prevStep}
                disabled={currentStep === 0}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Anterior
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={nextStep}
                disabled={currentStep === workflowSteps.length - 1}
              >
                Siguiente
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={isPlaying ? stopTour : startTour}
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-4 w-4 mr-1" />
                    Pausar Tour
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-1" />
                    Iniciar Tour
                  </>
                )}
              </Button>
              
              <Badge variant="secondary">
                {currentStep + 1} de {workflowSteps.length}
              </Badge>
            </div>
          </div>

          {/* Step Indicators */}
          <div className="flex justify-center gap-2">
            {workflowSteps.map((_, index) => (
              <button
                key={index}
                className={`w-3 h-3 rounded-full transition-colors ${
                  index === currentStep ? 'bg-blue-500' : 'bg-muted-foreground/30'
                }`}
                onClick={() => setCurrentStep(index)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
