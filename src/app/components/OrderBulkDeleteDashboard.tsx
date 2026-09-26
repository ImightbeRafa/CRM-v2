import React, { useState, useEffect } from 'react'
import { ConfigPanelHeader } from '@/components/aurora/config/panels/ConfigPanelHeader';
import { AuroraEmptyState, auroraButtonPrimary } from '@/components/aurora/states/AuroraEmptyState';
import { AuroraListSkeleton } from '@/components/aurora/states/AuroraSkeleton';
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
      const response = await fetch('/api/orders?limit=all')
      
      if (response.ok) {
        const data = await response.json()
        // Handle both response formats
        const ordersData = data.orders || data.data || data || []
        setOrders(ordersData)
        console.log(`📊 Loaded ${ordersData.length} orders for bulk delete`)
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
    const matchesSearch = (order.customerName && order.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (order.orderId && order.orderId.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (order.phone && order.phone.includes(searchTerm)) ||
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
      default: return 'bg-muted text-foreground'
    }
  }

  const getOrderTypeColor = (type: string) => {
    switch (type) {
      case 'EA': return 'bg-purple-100 text-purple-800'
      case 'RA': return 'bg-orange-100 text-orange-800'
      default: return 'bg-muted text-foreground'
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
      <ConfigPanelHeader
        className="!mb-0"
        title="Eliminación masiva"
        subtitle="Elimina pedidos del sistema indicando el motivo. Queda registrado en Auditoría."
        actions={
          <>
            {selectedOrders.size > 0 && (
              <button
                onClick={() => setShowDeleteDialog(true)}
                disabled={isDeleting}
                className="flex items-center gap-2 rounded-[10px] bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Eliminando...' : `Eliminar (${selectedOrders.size})`}
              </button>
            )}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
            >
              <Filter className="w-4 h-4" />
              Filtros
            </button>
            <button
              onClick={loadOrders}
              className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-800 hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              Actualizar
            </button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800 ring-1 ring-red-100">
        <span>Esta acción elimina pedidos de forma permanente. Revisá la selección antes de confirmar.</span>
        <span className="font-semibold">
          {filteredOrders.length === orders.length
            ? `${filteredOrders.length} pedidos totales`
            : `${filteredOrders.length} de ${orders.length} pedidos`}
          {selectedOrders.size > 0 ? ` · ${selectedOrders.size} seleccionados` : ''}
        </span>
      </div>

      {/* Search and Filters */}
      <div className="bg-card rounded-xl p-6 shadow-lg border border-border">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar por cliente, orden, teléfono, producto o vendedor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-background text-foreground"
            />
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Estado</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-background text-foreground"
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
              <label className="block text-sm font-medium text-muted-foreground mb-2">Tipo de Orden</label>
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-background text-foreground"
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
        <AuroraListSkeleton rows={5} label="Cargando pedidos" />
      ) : orders.length === 0 ? (
        <AuroraEmptyState
          tone="neutral"
          title="No hay pedidos"
          description="No se encontraron pedidos en el sistema."
          actions={
            <button type="button" onClick={loadOrders} className={auroraButtonPrimary}>
              Intentar de nuevo
            </button>
          }
        />
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12">
          <div className="p-4 bg-muted rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <Package className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No hay órdenes</h3>
          <p className="text-muted-foreground">No se encontraron órdenes que coincidan con los filtros.</p>
          <p className="text-sm text-muted-foreground/80 mt-2">Total de órdenes: {orders.length}</p>
        </div>
      ) : (
        <div>
          {/* Select All Bar */}
          <div className="bg-slate-50 border-b border-border px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={paginatedOrders.length > 0 && selectedOrders.size === paginatedOrders.length}
                onChange={toggleSelectAll}
                className="w-5 h-5 text-red-600 rounded focus:ring-2 focus:ring-red-500 cursor-pointer"
              />
              <span className="text-sm font-medium text-muted-foreground">
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
          
          <div className="divide-y divide-border">
            {paginatedOrders.map((order) => (
              <div key={order.id} className="p-6 hover:bg-slate-50 transition-colors group">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={selectedOrders.has(order.id)}
                      onChange={() => toggleSelectOrder(order.id)}
                      className="mt-1 w-5 h-5 text-red-600 rounded focus:ring-2 focus:ring-red-500 cursor-pointer"
                    />
                    <div className="p-2 bg-muted group-hover:bg-card rounded-lg transition-colors">
                      <Package className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg font-semibold text-foreground">#{order.orderId}</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getOrderTypeColor(order.orderType)}`}>
                          {order.orderType}
                        </span>
                      </div>
                      
                      <div className="text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-6">
                          <span className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground/70" />
                            <span className="font-medium text-foreground">{order.customerName}</span>
                            {order.phone && (
                              <span className="text-muted-foreground">({order.phone})</span>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground/70" />
                            {new Date(order.timestamp).toLocaleString()}
                          </span>
                          <span className="font-semibold text-green-600">
                            ₡{order.total.toLocaleString()}
                          </span>
                        </div>
                        {order.product && (
                          <div className="mt-2 text-sm text-muted-foreground">
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
                          className="flex items-center gap-1 px-3 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
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
                        <div className="mt-4 bg-muted rounded-lg p-4">
                          <h4 className="font-semibold text-foreground mb-2">Detalles de la orden:</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Cliente:</span>
                              <span className="text-sm font-medium">{order.customerName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Teléfono:</span>
                              <span className="text-sm font-medium">{order.phone}</span>
                            </div>
                            {order.email && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Email:</span>
                                <span className="text-sm font-medium">{order.email}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-sm text-muted-foreground">Total:</span>
                              <span className="text-sm font-semibold text-green-600">₡{order.total.toLocaleString()}</span>
                            </div>
                            {order.product && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Producto:</span>
                                <span className="text-sm font-medium">{order.product}</span>
                              </div>
                            )}
                            {order.quantity && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Cantidad:</span>
                                <span className="text-sm font-medium">{order.quantity}</span>
                              </div>
                            )}
                            {order.seller && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Vendedor:</span>
                                <span className="text-sm font-medium">{order.seller}</span>
                              </div>
                            )}
                            {order.delivery && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Entrega:</span>
                                <span className="text-sm font-medium">{order.delivery}</span>
                              </div>
                            )}
                            {order.address && (
                              <div className="flex justify-between">
                                <span className="text-sm text-muted-foreground">Dirección:</span>
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
            <div className="flex items-center justify-between px-6 py-4 bg-muted">
              <div className="text-sm text-muted-foreground">
                Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredOrders.length)} de {filteredOrders.length} órdenes
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed bg-background text-foreground"
                >
                  Anterior
                </button>
                <span className="px-3 py-1 text-sm bg-red-500 text-white rounded-md">
                  {currentPage} de {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm border border-border rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed bg-background text-foreground"
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
          <div className="bg-card rounded-xl p-6 max-w-md w-full mx-4 border border-border">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Confirmar Eliminación</h3>
                <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer</p>
              </div>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-muted-foreground mb-2">
                ¿Estás seguro de que quieres eliminar <strong>{selectedOrders.size} órdenes</strong>?
              </p>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Razón de eliminación (requerido):
              </label>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Ej: Órdenes duplicadas, datos incorrectos, etc."
                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-background text-foreground"
                rows={3}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors border border-border"
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
