import React, { useState, useEffect } from 'react'
import { Clock, User, Trash2, Edit, Plus, AlertTriangle, CheckCircle, Shield, Download, Filter, Activity, Zap, ToggleLeft, RefreshCw } from 'lucide-react'

interface SimpleAuditDashboardProps {
  isMaster: boolean
}

export function SimpleAuditDashboard({ isMaster }: SimpleAuditDashboardProps) {
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  })
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    userRole: ''
  })

  useEffect(() => {
    if (isMaster) {
      const loadAuditLogs = async () => {
        try {
          console.log('Loading audit logs...')
          const response = await fetch('/api/audit/logs')
          console.log('Response status:', response.status)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const data = await response.json()
          console.log('Audit logs data:', data)
          
          if (data.status === 'success') {
            setAuditLogs(data.data.logs || data.data || [])
          } else {
            console.log('No audit logs found or error:', data)
            setAuditLogs([])
          }
        } catch (error) {
          console.error('Failed to load audit logs:', error)
          setAuditLogs([])
        } finally {
          setLoading(false)
        }
      }
      
      loadAuditLogs()
    }
  }, [isMaster])

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE': return <Plus className="w-4 h-4 text-green-600" />
      case 'UPDATE': return <Edit className="w-4 h-4 text-blue-600" />
      case 'DELETE': return <Trash2 className="w-4 h-4 text-red-600" />
      case 'BULK_DELETE': return <Trash2 className="w-4 h-4 text-red-600" />
      case 'BULK_UPDATE': return <Edit className="w-4 h-4 text-blue-600" />
      case 'BULK_TOGGLE': return <ToggleLeft className="w-4 h-4 text-purple-600" />
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
      case 'BULK_TOGGLE': return 'bg-purple-100 text-purple-800'
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

  const handleExport = () => {
    // Simulate export functionality
    alert('Funcionalidad de exportación en desarrollo')
  }

  const refreshLogs = () => {
    setLoading(true)
    // Reload the logs
    window.location.reload()
  }

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value })
  }

  const filteredLogs = auditLogs.filter(log => {
    if (filters.action && log.action !== filters.action) return false
    if (filters.entityType && log.entityType !== filters.entityType) return false
    if (filters.userRole && log.userRole !== filters.userRole) return false
    
    // Date range filtering
    if (dateRange.startDate) {
      const logDate = new Date(log.timestamp)
      const startDate = new Date(dateRange.startDate)
      if (logDate < startDate) return false
    }
    if (dateRange.endDate) {
      const logDate = new Date(log.timestamp)
      const endDate = new Date(dateRange.endDate)
      endDate.setHours(23, 59, 59, 999) // Include the entire end date
      if (logDate > endDate) return false
    }
    
    return true
  })

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex)

  // Recent activity (last 24 hours)
  const recentLogs = auditLogs.filter(log => {
    const logDate = new Date(log.timestamp)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return logDate > yesterday
  })

  if (!isMaster) {
    return (
      <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
          </div>
          <div>
            <span className="text-yellow-800 font-semibold text-lg">Acceso Restringido</span>
            <p className="text-yellow-700 text-sm mt-1">
              Solo los usuarios maestros pueden ver el historial de auditoría.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 via-purple-600 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white bg-opacity-20 rounded-xl">
              <Shield className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-3xl font-bold">Historial de Auditoría</h2>
              <p className="text-purple-100 mt-1 text-lg">
                Registro completo de todos los cambios realizados en el sistema
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold">{filteredLogs.length}</div>
              <div className="text-purple-100 text-sm">registros</div>
              <div className="text-purple-200 text-xs mt-1">
                {recentLogs.length} en las últimas 24h
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200"
              >
                <Filter className="w-4 h-4" />
                Filtros
              </button>
              <button
                onClick={refreshLogs}
                className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200"
              >
                <RefreshCw className="w-4 h-4" />
                Actualizar
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Summary */}
      {recentLogs.length > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <Activity className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-green-800">Actividad Reciente</h3>
              <p className="text-green-700 text-sm">
                {recentLogs.length} cambios en las últimas 24 horas
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Filtros de Búsqueda</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Acción</label>
              <select
                name="action"
                value={filters.action}
                onChange={handleFilterChange}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todas las acciones</option>
                <option value="CREATE">Crear</option>
                <option value="UPDATE">Actualizar</option>
                <option value="DELETE">Eliminar</option>
                <option value="BULK_DELETE">Eliminación Masiva</option>
                <option value="BULK_UPDATE">Actualización Masiva</option>
                <option value="BULK_TOGGLE">Cambio de Estado Masivo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Entidad</label>
              <select
                name="entityType"
                value={filters.entityType}
                onChange={handleFilterChange}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todos los tipos</option>
                <option value="user">Usuario</option>
                <option value="order">Orden</option>
                <option value="field">Campo</option>
                <option value="option">Opción</option>
                <option value="shipping">Envío</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rol de Usuario</label>
              <select
                name="userRole"
                value={filters.userRole}
                onChange={handleFilterChange}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Todos los roles</option>
                <option value="MASTER">MASTER</option>
                <option value="REGULAR">REGULAR</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Rango de Fechas</label>
              <div className="space-y-2">
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                  placeholder="Fecha inicio"
                />
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                  placeholder="Fecha fin"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => {
                setFilters({ action: '', entityType: '', userRole: '' })
                setDateRange({ startDate: '', endDate: '' })
                setCurrentPage(1)
              }}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm font-medium"
            >
              Limpiar Filtros
            </button>
            <button
              onClick={() => setShowFilters(false)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
            >
              Aplicar Filtros
            </button>
          </div>
        </div>
      )}

      {/* Audit Logs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-lg">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-purple-600 mx-auto mb-4"></div>
              <span className="text-gray-600 text-lg">Cargando historial de auditoría...</span>
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 bg-gray-100 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
              <Activity className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">No hay registros de auditoría</h3>
            <p className="text-gray-500">Los registros de auditoría aparecerán aquí cuando se realicen cambios en el sistema.</p>
          </div>
        ) : (
          <div>
            <div className="divide-y divide-gray-100">
              {paginatedLogs.map((log, index) => (
              <div key={log.id} className="p-6 hover:bg-gradient-to-r hover:from-gray-50 hover:to-blue-50 transition-all duration-200 group">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-gray-100 group-hover:bg-white rounded-lg transition-colors">
                      {getActionIcon(log.action)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                        <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{log.entityType}</span>
                        {log.entityName && (
                          <span className="text-sm font-medium text-gray-900 bg-blue-50 px-2 py-1 rounded-md">
                            &ldquo;{log.entityName}&rdquo;
                          </span>
                        )}
                      </div>
                      
                      <div className="text-sm text-gray-600 mb-3">
                        <div className="flex items-center gap-6">
                          <span className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="font-medium">{log.userName}</span>
                            <span className="text-gray-500">({log.userRole})</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-400" />
                            {formatTimestamp(log.timestamp)}
                          </span>
                        </div>
                      </div>
                      
                      {log.reason && (
                        <div className="bg-gradient-to-r from-gray-50 to-blue-50 border border-gray-200 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <Zap className="w-4 h-4 text-blue-500 mt-0.5" />
                            <div>
                              <span className="text-sm font-semibold text-gray-700">Razón:</span>
                              <p className="text-sm text-gray-600 mt-1">{log.reason}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Display changes in a clean, focused way */}
                      {log.oldValues?.changes && log.oldValues.changes.length > 0 && (
                        <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-3 mt-3">
                          <div className="flex items-start gap-2">
                            <Edit className="w-4 h-4 text-orange-500 mt-0.5" />
                            <div className="flex-1">
                              <span className="text-sm font-semibold text-gray-700">Cambios realizados:</span>
                              <div className="mt-2 space-y-1">
                                {log.oldValues.changes.map((change: string, idx: number) => (
                                  <div key={idx} className="text-sm text-gray-700 bg-white rounded-md px-2 py-1 border border-yellow-200">
                                    {change}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Display new values for CREATE operations */}
                      {log.action === 'CREATE' && log.newValues && (
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-3 mt-3">
                          <div className="flex items-start gap-2">
                            <Plus className="w-4 h-4 text-green-500 mt-0.5" />
                            <div className="flex-1">
                              <span className="text-sm font-semibold text-gray-700">Datos creados:</span>
                              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                {Object.entries(log.newValues).map(([key, value]) => (
                                  <div key={key} className="text-sm text-gray-700 bg-white rounded-md px-2 py-1 border border-green-200">
                                    <span className="font-medium">{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Display old values for DELETE operations */}
                      {log.action === 'DELETE' && log.oldValues && (
                        <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-lg p-3 mt-3">
                          <div className="flex items-start gap-2">
                            <Trash2 className="w-4 h-4 text-red-500 mt-0.5" />
                            <div className="flex-1">
                              <span className="text-sm font-semibold text-gray-700">Datos eliminados:</span>
                              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                {Object.entries(log.oldValues).map(([key, value]) => (
                                  <div key={key} className="text-sm text-gray-700 bg-white rounded-md px-2 py-1 border border-red-200">
                                    <span className="font-medium">{key}:</span> {String(value)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
                    #{index + 1}
                  </div>
                </div>
              </div>
            ))}
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-700">
                    Mostrando {startIndex + 1} a {Math.min(endIndex, filteredLogs.length)} de {filteredLogs.length} registros
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Anterior
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const pageNum = i + 1
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-3 py-1 text-sm rounded-md ${
                              currentPage === pageNum
                                ? 'bg-purple-600 text-white'
                                : 'border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}
                      {totalPages > 5 && (
                        <>
                          <span className="text-gray-500">...</span>
                          <button
                            onClick={() => setCurrentPage(totalPages)}
                            className={`px-3 py-1 text-sm rounded-md ${
                              currentPage === totalPages
                                ? 'bg-purple-600 text-white'
                                : 'border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {totalPages}
                          </button>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
