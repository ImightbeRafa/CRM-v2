import React, { useState, useEffect, useCallback } from 'react'
import { Clock, User, Trash2, Edit, Plus, ToggleLeft, ToggleRight, AlertTriangle, CheckCircle, Filter, Download } from 'lucide-react'

interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId: string
  entityName?: string
  oldValues?: any
  newValues?: any
  reason?: string
  userId: string
  userName: string
  userRole: string
  timestamp: string
  ipAddress?: string
  userAgent?: string
}

interface AuditDashboardProps {
  isMaster: boolean
}

export function AuditDashboard({ isMaster }: AuditDashboardProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    userRole: '',
    dateFrom: '',
    dateTo: ''
  })
  const [showFilters, setShowFilters] = useState(false)

  const loadAuditLogs = useCallback(async () => {
    try {
      setLoading(true)
      const queryParams = new URLSearchParams()
      
      if (filters.action) queryParams.append('action', filters.action)
      if (filters.entityType) queryParams.append('entityType', filters.entityType)
      if (filters.userRole) queryParams.append('userRole', filters.userRole)
      if (filters.dateFrom) queryParams.append('dateFrom', filters.dateFrom)
      if (filters.dateTo) queryParams.append('dateTo', filters.dateTo)

      const response = await fetch(`/api/audit/logs?${queryParams}`)
      const data = await response.json()
      
      if (data.status === 'success') {
        setAuditLogs(data.data.logs || data.data)
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    if (isMaster) {
      loadAuditLogs()
    }
  }, [isMaster, loadAuditLogs])

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE': return <Plus className="w-4 h-4 text-green-600" />
      case 'UPDATE': return <Edit className="w-4 h-4 text-blue-600" />
      case 'DELETE': return <Trash2 className="w-4 h-4 text-red-600" />
      case 'BULK_DELETE': return <Trash2 className="w-4 h-4 text-red-600" />
      case 'BULK_UPDATE': return <Edit className="w-4 h-4 text-blue-600" />
      case 'BULK_TOGGLE': return <ToggleLeft className="w-4 h-4 text-yellow-600" />
      case 'LOGIN': return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'LOGOUT': return <AlertTriangle className="w-4 h-4 text-gray-600" />
      default: return <Clock className="w-4 h-4 text-gray-600" />
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-800'
      case 'UPDATE': return 'bg-blue-100 text-blue-800'
      case 'DELETE': return 'bg-red-100 text-red-800'
      case 'BULK_DELETE': return 'bg-red-100 text-red-800'
      case 'BULK_UPDATE': return 'bg-blue-100 text-blue-800'
      case 'BULK_TOGGLE': return 'bg-yellow-100 text-yellow-800'
      case 'LOGIN': return 'bg-green-100 text-green-800'
      case 'LOGOUT': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const exportAuditLogs = async () => {
    try {
      const queryParams = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value) queryParams.append(key, value)
      })

      const response = await fetch(`/api/audit/export?${queryParams}`)
      const blob = await response.blob()
      
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Failed to export audit logs:', error)
    }
  }

  if (!isMaster) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-yellow-600" />
          <span className="text-yellow-800 font-medium">Acceso Restringido</span>
        </div>
        <p className="text-yellow-700 text-sm mt-1">
          Solo los usuarios maestros pueden ver el historial de auditoría.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Historial de Auditoría</h2>
            <p className="text-purple-100 mt-1">
              Registro completo de todos los cambios realizados en el sistema
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-3 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-md transition-colors"
            >
              <Filter className="w-4 h-4" />
              Filtros
            </button>
            <button
              onClick={exportAuditLogs}
              className="flex items-center gap-2 px-3 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-md transition-colors"
            >
              <Download className="w-4 h-4" />
              Exportar
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-4">Filtros de Búsqueda</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Acción</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todas las acciones</option>
                <option value="CREATE">Crear</option>
                <option value="UPDATE">Actualizar</option>
                <option value="DELETE">Eliminar</option>
                <option value="BULK_DELETE">Eliminación masiva</option>
                <option value="BULK_UPDATE">Actualización masiva</option>
                <option value="BULK_TOGGLE">Cambio de estado masivo</option>
                <option value="LOGIN">Inicio de sesión</option>
                <option value="LOGOUT">Cierre de sesión</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de entidad</label>
              <select
                value={filters.entityType}
                onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todos los tipos</option>
                <option value="order">Pedidos</option>
                <option value="user">Usuarios</option>
                <option value="field">Campos</option>
                <option value="optionSet">Conjuntos de opciones</option>
                <option value="option">Opciones</option>
                <option value="seller">Vendedores</option>
                <option value="shipping">Métodos de envío</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rol de usuario</label>
              <select
                value={filters.userRole}
                onChange={(e) => setFilters({ ...filters, userRole: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todos los roles</option>
                <option value="MASTER">Maestro</option>
                <option value="REGULAR">Regular</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Audit Logs */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            <span className="ml-3 text-gray-600">Cargando historial...</span>
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No se encontraron registros de auditoría</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {getActionIcon(log.action)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                        <span className="text-sm text-gray-600">{log.entityType}</span>
                        {log.entityName && (
                          <span className="text-sm font-medium text-gray-900">&ldquo;{log.entityName}&rdquo;</span>
                        )}
                      </div>
                      
                      <div className="text-sm text-gray-600 mb-2">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.userName} ({log.userRole})
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                      </div>
                      
                      {log.reason && (
                        <div className="text-sm text-gray-700 bg-gray-100 rounded p-2 mb-2">
                          <strong>Razón:</strong> {log.reason}
                        </div>
                      )}
                      
                      {log.oldValues && (
                        <div className="text-xs text-gray-600 mb-1">
                          <strong>Valores anteriores:</strong> {JSON.stringify(log.oldValues, null, 2)}
                        </div>
                      )}
                      
                      {log.newValues && (
                        <div className="text-xs text-gray-600">
                          <strong>Nuevos valores:</strong> {JSON.stringify(log.newValues, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-400">
                    ID: {log.entityId}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
