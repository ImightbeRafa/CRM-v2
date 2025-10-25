import React, { useState, useEffect } from 'react'
import { 
  Trash2, 
  Search, 
  Filter, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  User, 
  Package,
  RefreshCw,
  Download,
  Eye,
  EyeOff
} from 'lucide-react'

interface Order {
  id: string
  orderId: string
  customerName: string
  phone: string
  email?: string
  total: number
  status: string
  orderType: string
  timestamp: string
  items?: any[]
  // Additional fields from actual API response
  username?: string
  business?: string
  product?: string
  quantity?: number
  size?: string
  color?: string
  packaging?: string
  customization?: string
  comments?: string
  iva?: number
  shippingCost?: number
  productCost?: number
  address?: string
  province?: string
  canton?: string
  district?: string
  courier?: string
  expectedDate?: string
  funnel?: string
  agreedDate?: string
  pickupDate?: string
  saleDate?: string
  seller?: string
  delivery?: string
  productDetails?: string
}

interface OrderBulkDeleteDashboardProps {
  isMaster: boolean
}

export function OrderBulkDeleteDashboard({ isMaster }: OrderBulkDeleteDashboardProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [deleteReason, setDeleteReason] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showOrderDetails, setShowOrderDetails] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (isMaster) {
      loadOrders()
    }
  }, [isMaster])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/orders')
      
      if (response.ok) {
        const data = await response.json()
        // Handle both response formats
        const ordersData = data.orders || data.data || data || []
        setOrders(ordersData)
      } else {
        console.error('Failed to load orders:', response.status, response.statusText)
        setOrders([])
      }
    } catch (error) {
      console.error('Error loading orders:', error)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  const toggleSelectOrder = (orderId: string) => {
    const newSelected = new Set(selectedOrders)
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId)
    } else {
      newSelected.add(orderId)
    }
    setSelectedOrders(newSelected)
  }

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set())
    } else {
      setSelectedOrders(new Set(filteredOrders.map(order => order.id)))
    }
  }

  const toggleOrderDetails = (orderId: string) => {
    const newShowDetails = new Set(showOrderDetails)
    if (newShowDetails.has(orderId)) {
      newShowDetails.delete(orderId)
    } else {
      newShowDetails.add(orderId)
    }
    setShowOrderDetails(newShowDetails)
  }

  const handleBulkDelete = async () => {
    if (selectedOrders.size === 0) {
      alert('Selecciona al menos una orden para eliminar')
      return
    }

    if (!deleteReason.trim()) {
      alert('Debes proporcionar una razón para la eliminación')
      return
    }

    if (!confirm(`¿Estás seguro de que quieres eliminar ${selectedOrders.size} órdenes? Esta acción no se puede deshacer.`)) {
      return
    }

    setIsDeleting(true)
    try {
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ids: Array.from(selectedOrders), 
          type: 'orders', 
          reason: deleteReason 
        })
      })

      if (!response.ok) {
        throw new Error('Error al eliminar órdenes')
      }

      const result = await response.json()
      
      if (result.status === 'success') {
        // Remove deleted orders from state
        setOrders(orders.filter(order => !selectedOrders.has(order.id)))
        setSelectedOrders(new Set())
        setDeleteReason('')
        setShowDeleteDialog(false)
        alert(`Eliminación completada: ${result.data.success} órdenes eliminadas, ${result.data.failed} fallidas`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Error deleting orders:', error)
      alert('Error al eliminar órdenes. Por favor intenta de nuevo.')
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.phone.includes(searchTerm) ||
                         (order.product && order.product.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (order.seller && order.seller.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    const matchesType = orderTypeFilter === 'all' || order.orderType === orderTypeFilter
    return matchesSearch && matchesStatus && matchesType
  })

  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pendiente': return 'bg-yellow-100 text-yellow-800'
      case 'En Proceso': return 'bg-blue-100 text-blue-800'
      case 'Enviado': return 'bg-green-100 text-green-800'
      case 'Entregado': return 'bg-emerald-100 text-emerald-800'
      case 'Cancelado': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getOrderTypeColor = (type: string) => {
    switch (type) {
      case 'EA': return 'bg-purple-100 text-purple-800'
      case 'RA': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (!isMaster) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-4 p-6 bg-yellow-50 rounded-xl border border-yellow-200">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-yellow-600" />
          </div>
          <div>
            <span className="text-yellow-800 font-semibold text-lg">Acceso Restringido</span>
            <p className="text-yellow-700 text-sm mt-1">
              Solo los usuarios maestros pueden acceder a la eliminación masiva de órdenes.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-red-500 via-red-600 to-pink-600 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white bg-opacity-20 rounded-xl">
              <Trash2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-3xl font-bold">Eliminación Masiva de Órdenes</h2>
              <p className="text-red-100 mt-1 text-lg">
                Elimina órdenes del sistema con razón de eliminación
              </p>
              {selectedOrders.size > 0 && (
                <p className="text-yellow-300 mt-1 text-sm font-semibold">
                  {selectedOrders.size} órdenes seleccionadas
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold">{filteredOrders.length}</div>
              <div className="text-red-100 text-sm">órdenes</div>
            </div>
            <div className="flex gap-2">
              {selectedOrders.size > 0 && (
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? 'Eliminando...' : `Eliminar (${selectedOrders.size})`}
                </button>
              )}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200"
              >
                <Filter className="w-4 h-4" />
                Filtros
              </button>
              <button
                onClick={loadOrders}
                className="flex items-center gap-2 px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-all duration-200"
              >
                <RefreshCw className="w-4 h-4" />
                Actualizar
              </button>
            </div>
          </div>
        </div>
      </div>


      {/* Search and Filters */}
      <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar por cliente, orden, teléfono, producto o vendedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Estado</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="all">Todos los estados</option>
                <option value="Pendiente">Pendiente</option>
                <option value="En Proceso">En Proceso</option>
                <option value="Enviado">Enviado</option>
                <option value="Entregado">Entregado</option>
                <option value="Cancelado">Cancelado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Orden</label>
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="all">Todos los tipos</option>
                <option value="EA">EA</option>
                <option value="RA">RA</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-red-500" />
            <span className="text-gray-600">Cargando órdenes...</span>
          </div>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12">
          <div className="p-4 bg-gray-100 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <Package className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No hay órdenes</h3>
          <p className="text-gray-500">No se encontraron órdenes en el sistema.</p>
          <button
            onClick={loadOrders}
            className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            Intentar de nuevo
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12">
          <div className="p-4 bg-gray-100 rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <Package className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No hay órdenes</h3>
          <p className="text-gray-500">No se encontraron órdenes que coincidan con los filtros.</p>
          <p className="text-sm text-gray-400 mt-2">Total de órdenes: {orders.length}</p>
        </div>
      ) : (
        <div>
          {/* Select All Bar */}
          <div className="bg-gradient-to-r from-red-50 to-pink-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={paginatedOrders.length > 0 && selectedOrders.size === paginatedOrders.length}
                onChange={toggleSelectAll}
                className="w-5 h-5 text-red-600 rounded focus:ring-2 focus:ring-red-500 cursor-pointer"
              />
              <span className="text-sm font-medium text-gray-700">
                {selectedOrders.size > 0 
                  ? `${selectedOrders.size} de ${paginatedOrders.length} seleccionadas`
                  : 'Seleccionar todas'}
              </span>
            </div>
            {selectedOrders.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all duration-200 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? 'Eliminando...' : `Eliminar seleccionadas`}
                </button>
              </div>
            )}
          </div>
          
          <div className="divide-y divide-gray-100">
            {paginatedOrders.map((order) => (
              <div key={order.id} className="p-6 hover:bg-gradient-to-r hover:from-gray-50 hover:to-red-50 transition-all duration-200 group">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={selectedOrders.has(order.id)}
                      onChange={() => toggleSelectOrder(order.id)}
                      className="mt-1 w-5 h-5 text-red-600 rounded focus:ring-2 focus:ring-red-500 cursor-pointer"
                    />
                    <div className="p-2 bg-gray-100 group-hover:bg-white rounded-lg transition-colors">
                      <Package className="w-5 h-5 text-gray-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg font-semibold text-gray-900">#{order.orderId}</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getOrderTypeColor(order.orderType)}`}>
                          {order.orderType}
                        </span>
                      </div>
                      
                      <div className="text-sm text-gray-600 mb-3">
                        <div className="flex items-center gap-6">
                          <span className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="font-medium">{order.customerName}</span>
                            {order.phone && (
                              <span className="text-gray-500">({order.phone})</span>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-400" />
                            {new Date(order.timestamp).toLocaleString()}
                          </span>
                          <span className="font-semibold text-green-600">
                            ₡{order.total.toLocaleString()}
                          </span>
                        </div>
                        {order.product && (
                          <div className="mt-2 text-sm text-gray-500">
                            <span className="font-medium">Producto:</span> {order.product}
                            {order.quantity && ` (${order.quantity}x)`}
                            {order.color && ` - ${order.color}`}
                            {order.size && ` - ${order.size}`}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleOrderDetails(order.id)}
                          className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                        >
                          {showOrderDetails.has(order.id) ? (
                            <>
                              <EyeOff className="w-4 h-4" />
                              Ocultar detalles
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4" />
                              Ver detalles
                            </>
                          )}
                        </button>
                      </div>

                      {showOrderDetails.has(order.id) && (
                        <div className="mt-4 bg-gray-50 rounded-lg p-4">
                          <h4 className="font-semibold text-gray-800 mb-2">Detalles de la orden:</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Cliente:</span>
                              <span className="text-sm font-medium">{order.customerName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Teléfono:</span>
                              <span className="text-sm font-medium">{order.phone}</span>
                            </div>
                            {order.email && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Email:</span>
                                <span className="text-sm font-medium">{order.email}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Total:</span>
                              <span className="text-sm font-semibold text-green-600">₡{order.total.toLocaleString()}</span>
                            </div>
                            {order.product && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Producto:</span>
                                <span className="text-sm font-medium">{order.product}</span>
                              </div>
                            )}
                            {order.quantity && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Cantidad:</span>
                                <span className="text-sm font-medium">{order.quantity}</span>
                              </div>
                            )}
                            {order.seller && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Vendedor:</span>
                                <span className="text-sm font-medium">{order.seller}</span>
                              </div>
                            )}
                            {order.delivery && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Entrega:</span>
                                <span className="text-sm font-medium">{order.delivery}</span>
                              </div>
                            )}
                            {order.address && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Dirección:</span>
                                <span className="text-sm font-medium">{order.address}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 bg-gray-50">
              <div className="text-sm text-gray-600">
                Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredOrders.length)} de {filteredOrders.length} órdenes
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <span className="px-3 py-1 text-sm bg-red-500 text-white rounded-md">
                  {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Confirmar Eliminación</h3>
                <p className="text-sm text-gray-600">Esta acción no se puede deshacer</p>
              </div>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-gray-700 mb-2">
                ¿Estás seguro de que quieres eliminar <strong>{selectedOrders.size} órdenes</strong>?
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Razón de eliminación (requerido):
              </label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ej: Órdenes duplicadas, datos incorrectos, etc."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                rows={3}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isDeleting || !deleteReason.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar Órdenes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
