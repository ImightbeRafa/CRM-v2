import React, { useState } from 'react'
import { Trash2, Edit, ToggleLeft, ToggleRight, AlertTriangle, CheckCircle, X, Shield, Zap } from 'lucide-react'

interface BulkOperationsProps {
  selectedItems: string[]
  onSelectionChange: (ids: string[]) => void
  onBulkDelete: (ids: string[], reason?: string) => Promise<void>
  onBulkUpdate?: (ids: string[], updates: any) => Promise<void>
  onBulkToggle?: (ids: string[], active: boolean) => Promise<void>
  totalItems: number
  itemType: string
  showUpdate?: boolean
  showToggle?: boolean
}

export function BulkOperations({
  selectedItems,
  onSelectionChange,
  onBulkDelete,
  onBulkUpdate,
  onBulkToggle,
  totalItems,
  itemType,
  showUpdate = false,
  showToggle = false
}: BulkOperationsProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [showToggleDialog, setShowToggleDialog] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [updateData, setUpdateData] = useState<any>({})
  const [toggleActive, setToggleActive] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSelectAll = () => {
    if (selectedItems.length === totalItems) {
      onSelectionChange([])
    } else {
      // This would need to be passed from parent with all item IDs
      onSelectionChange([]) // Placeholder - parent should handle this
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) return
    
    setIsProcessing(true)
    try {
      await onBulkDelete(selectedItems, deleteReason)
      onSelectionChange([])
      setShowDeleteDialog(false)
      setDeleteReason('')
    } catch (error) {
      console.error('Bulk delete failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkUpdate = async () => {
    if (selectedItems.length === 0) return
    
    setIsProcessing(true)
    try {
      if (onBulkUpdate) {
        await onBulkUpdate(selectedItems, updateData)
        onSelectionChange([])
        setShowUpdateDialog(false)
        setUpdateData({})
      }
    } catch (error) {
      console.error('Bulk update failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkToggle = async () => {
    if (selectedItems.length === 0) return
    
    setIsProcessing(true)
    try {
      if (onBulkToggle) {
        await onBulkToggle(selectedItems, toggleActive)
        onSelectionChange([])
        setShowToggleDialog(false)
      }
    } catch (error) {
      console.error('Bulk toggle failed:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  if (selectedItems.length === 0) {
    return (
      <div className="flex items-center justify-between p-5 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={false}
              onChange={handleSelectAll}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-sm font-medium text-gray-700">
              Seleccionar todos
            </span>
          </div>
          <div className="h-4 w-px bg-gray-300"></div>
          <span className="text-sm text-gray-500">
            {totalItems} {itemType} disponibles
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Shield className="w-4 h-4" />
          <span>Selecciona elementos para operaciones masivas</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between p-5 bg-gradient-to-r from-blue-50 via-blue-100 to-indigo-50 rounded-xl border border-blue-200 shadow-lg animate-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-semibold text-blue-900 text-lg">
                {selectedItems.length} {itemType} seleccionados
              </span>
              <div className="text-sm text-blue-700">
                Operaciones masivas disponibles
              </div>
            </div>
          </div>
          <button
            onClick={() => onSelectionChange([])}
            className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-lg transition-all duration-200 text-sm font-medium"
          >
            <X className="w-4 h-4" />
            Limpiar selección
          </button>
        </div>
        
        <div className="flex items-center gap-3">
          {showToggle && (
            <button
              onClick={() => setShowToggleDialog(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-all duration-200 text-sm font-medium shadow-md hover:shadow-lg transform hover:scale-105"
            >
              <ToggleLeft className="w-4 h-4" />
              Cambiar Estado
            </button>
          )}
          
          {showUpdate && (
            <button
              onClick={() => setShowUpdateDialog(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all duration-200 text-sm font-medium shadow-md hover:shadow-lg transform hover:scale-105"
            >
              <Edit className="w-4 h-4" />
              Actualizar
            </button>
          )}
          
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all duration-200 text-sm font-medium shadow-md hover:shadow-lg transform hover:scale-105"
          >
            <Trash2 className="w-4 h-4" />
            Eliminar
          </button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h3 className="text-lg font-semibold text-gray-900">
                Confirmar eliminación masiva
              </h3>
            </div>
            
            <p className="text-gray-600 mb-4">
              ¿Está seguro de que desea eliminar {selectedItems.length} {itemType}?
              Esta acción no se puede deshacer.
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Razón de la eliminación (opcional):
              </label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
                rows={3}
                placeholder="Explique por qué se están eliminando estos elementos..."
              />
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isProcessing}
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update Dialog */}
      {showUpdateDialog && showUpdate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Actualización masiva
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Campo a actualizar:
                </label>
                <select
                  value={updateData.field || ''}
                  onChange={(e) => setUpdateData({ ...updateData, field: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Seleccionar campo...</option>
                  <option value="active">Estado (Activo/Inactivo)</option>
                  <option value="name">Nombre</option>
                  <option value="label">Etiqueta</option>
                </select>
              </div>
              
              {updateData.field && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nuevo valor:
                  </label>
                  {updateData.field === 'active' ? (
                    <select
                      value={updateData.value || ''}
                      onChange={(e) => setUpdateData({ ...updateData, value: e.target.value === 'true' })}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Seleccionar...</option>
                      <option value="true">Activo</option>
                      <option value="false">Inactivo</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={updateData.value || ''}
                      onChange={(e) => setUpdateData({ ...updateData, value: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ingrese el nuevo valor..."
                    />
                  )}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowUpdateDialog(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isProcessing}
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkUpdate}
                disabled={isProcessing || !updateData.field || !updateData.value}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Actualizando...
                  </>
                ) : (
                  <>
                    <Edit className="w-4 h-4" />
                    Actualizar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Dialog */}
      {showToggleDialog && showToggle && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Cambio de estado masivo
            </h3>
            
            <p className="text-gray-600 mb-4">
              ¿Desea {toggleActive ? 'activar' : 'desactivar'} {selectedItems.length} {itemType}?
            </p>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowToggleDialog(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isProcessing}
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkToggle}
                disabled={isProcessing}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    {toggleActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {toggleActive ? 'Activar' : 'Desactivar'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
