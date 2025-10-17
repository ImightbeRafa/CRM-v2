'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BulkOperations } from '../components/ui/bulk-operations'
import { SimpleAuditDashboard } from '../components/SimpleAuditDashboard'
import { Settings, Users, Shield, Database, BarChart3, Zap } from 'lucide-react'

export default function ConfigPage() {
  const [activeTab, setActiveTab] = useState('fields')
  const [isMasterUser, setIsMasterUser] = useState(true) // Simplified for demo
  
  // Data states
  const [fields, setFields] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [optionSets, setOptionSets] = useState<any[]>([])
  const [shipping, setShipping] = useState<any[]>([])
  const [sellers, setSellers] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Bulk operations state
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [selectedOptionSets, setSelectedOptionSets] = useState<string[]>([])
  const [selectedShipping, setSelectedShipping] = useState<string[]>([])
  const [selectedOrders, setSelectedOrders] = useState<string[]>([])
  
  // Form states
  const [showFieldForm, setShowFieldForm] = useState(false)
  const [showOptionSetForm, setShowOptionSetForm] = useState(false)
  const [showShippingForm, setShowShippingForm] = useState(false)
  const [editingField, setEditingField] = useState<any>(null)
  const [editingOptionSet, setEditingOptionSet] = useState<any>(null)
  const [editingShipping, setEditingShipping] = useState<any>(null)

  const loadData = async () => {
    setLoading(true)
    try {
        const [fieldsRes, usersRes, optionSetsRes, shippingRes, sellersRes, ordersRes] = await Promise.all([
          fetch('/api/config/fields').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/users').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/option-sets').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/shipping').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/sellers').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/orders').then(r => r.json()).catch(() => ({ status: 'success', data: [] }))
        ])
      
      if (fieldsRes.status === 'success') setFields(fieldsRes.data)
      if (usersRes.status === 'success') setUsers(usersRes.data)
      if (optionSetsRes.status === 'success') setOptionSets(optionSetsRes.data)
      if (shippingRes.status === 'success') setShipping(shippingRes.data)
      if (sellersRes.status === 'success') setSellers(sellersRes.data)
      if (ordersRes.status === 'success') setOrders(ordersRes.data)
      
      console.log('Loaded data:', {
        fields: fieldsRes.data,
        users: usersRes.data,
        optionSets: optionSetsRes.data,
        shipping: shippingRes.data,
        sellers: sellersRes.data,
        orders: ordersRes.data
      })
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Bulk operation handlers
  const handleBulkDelete = async (ids: string[], reason?: string) => {
    try {
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'users', reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh users data
        const usersRes = await fetch('/api/users').then(r => r.json())
        if (usersRes.status === 'success') setUsers(usersRes.data)
        
        // Clear selection
        setSelectedUsers([])
        
        alert(`Eliminación completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      // Fallback: simulate deletion for demo
      setUsers(prev => prev.filter(user => !ids.includes(user.id)))
      setSelectedUsers([])
      alert(`Eliminación simulada: ${ids.length} usuarios eliminados (modo demo)`)
    }
  }

  const handleBulkUpdate = async (ids: string[], updates: any) => {
    try {
      const response = await fetch('/api/bulk/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'users', updates })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh users data
        const usersRes = await fetch('/api/users').then(r => r.json())
        if (usersRes.status === 'success') setUsers(usersRes.data)
        
        // Clear selection
        setSelectedUsers([])
        
        alert(`Actualización completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Bulk update error:', error)
      // Fallback: simulate update for demo
      setUsers(prev => prev.map(user => 
        ids.includes(user.id) ? { ...user, ...updates } : user
      ))
      setSelectedUsers([])
      alert(`Actualización simulada: ${ids.length} usuarios actualizados (modo demo)`)
    }
  }

  const handleBulkToggle = async (ids: string[], active: boolean) => {
    try {
      const response = await fetch('/api/bulk/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'users', active })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh users data
        const usersRes = await fetch('/api/users').then(r => r.json())
        if (usersRes.status === 'success') setUsers(usersRes.data)
        
        // Clear selection
        setSelectedUsers([])
        
        alert(`Cambio de estado completado: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Bulk toggle error:', error)
      // Fallback: simulate toggle for demo
      setUsers(prev => prev.map(user => 
        ids.includes(user.id) ? { ...user, active } : user
      ))
      setSelectedUsers([])
      alert(`Cambio de estado simulado: ${ids.length} usuarios ${active ? 'activados' : 'desactivados'} (modo demo)`)
    }
  }

  // Field management functions
  const handleEditField = (field: any) => {
    setEditingField(field)
    setShowFieldForm(true)
  }

  const handleDeleteField = async (id: string) => {
    if (!confirm('¿Eliminar este campo?')) return
    try {
      const res = await fetch(`/api/config/fields?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setFields(prev => prev.filter(f => f.id !== id))
        alert('Campo eliminado exitosamente')
      } else {
        alert(json.error || 'Error al eliminar campo')
      }
    } catch (error) {
      console.error('Error deleting field:', error)
      alert('Error al eliminar campo')
    }
  }

  // Option Set management functions
  const handleEditOptionSet = (set: any) => {
    setEditingOptionSet(set)
    setShowOptionSetForm(true)
  }

  const handleDeleteOptionSet = async (id: string) => {
    if (!confirm('¿Eliminar este conjunto de opciones?')) return
    try {
      const res = await fetch(`/api/config/option-sets?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setOptionSets(prev => prev.filter(s => s.id !== id))
        alert('Conjunto de opciones eliminado exitosamente')
      } else {
        alert(json.error || 'Error al eliminar conjunto de opciones')
      }
    } catch (error) {
      console.error('Error deleting option set:', error)
      alert('Error al eliminar conjunto de opciones')
    }
  }

  // Shipping management functions
  const handleEditShipping = (method: any) => {
    setEditingShipping(method)
    setShowShippingForm(true)
  }

  const handleDeleteShipping = async (id: string) => {
    if (!confirm('¿Eliminar este método de envío?')) return
    try {
      const res = await fetch(`/api/config/shipping?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setShipping(prev => prev.filter(s => s.id !== id))
        alert('Método de envío eliminado exitosamente')
      } else {
        alert(json.error || 'Error al eliminar método de envío')
      }
    } catch (error) {
      console.error('Error deleting shipping method:', error)
      alert('Error al eliminar método de envío')
    }
  }

  // Bulk operations for configuration items
  const handleBulkDeleteFields = async (ids: string[], reason?: string) => {
    try {
      const response = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'fields', reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        setFields(prev => prev.filter(f => !ids.includes(f.id)))
        setSelectedFields([])
        alert(`Eliminación masiva completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
        } else {
        alert(`Error: ${result.error || result.message}`)
        }
      } catch (error) {
      console.error('Bulk delete fields error:', error)
      alert('Error al eliminar campos')
    }
  }

  const handleBulkDeleteOptionSets = async (ids: string[], reason?: string) => {
      try {
      const response = await fetch('/api/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'optionSets', reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        setOptionSets(prev => prev.filter(s => !ids.includes(s.id)))
        setSelectedOptionSets([])
        alert(`Eliminación masiva completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
        } else {
        alert(`Error: ${result.error || result.message}`)
        }
      } catch (error) {
      console.error('Bulk delete option sets error:', error)
      alert('Error al eliminar conjuntos de opciones')
    }
  }

  const handleBulkDeleteShipping = async (ids: string[], reason?: string) => {
    try {
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'shipping', reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        setShipping(prev => prev.filter(s => !ids.includes(s.id)))
        setSelectedShipping([])
        alert(`Eliminación masiva completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Bulk delete shipping error:', error)
      alert('Error al eliminar métodos de envío')
    }
  }

  // Bulk operations for business data
  const handleBulkDeleteOrders = async (ids: string[], reason?: string) => {
    try {
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'orders', reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        setSelectedOrders([])
        await loadData() // Refresh all data
        alert(`Eliminación masiva completada: ${result.data.success} órdenes eliminadas, ${result.data.failed} fallidas`)
      } else {
        alert(`Error: ${result.error || result.message}`)
      }
    } catch (error) {
      console.error('Bulk delete orders error:', error)
      alert('Error al eliminar órdenes')
    }
  }


  const tabs = [
    { id: 'fields', label: 'Configuración', icon: Settings },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'audit', label: 'Auditoría', icon: Shield }
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-4 mb-2">
            <a
              href="/home"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver al Inicio
            </a>
          </div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">Panel de Configuración</h1>
              <p className="text-gray-600 text-lg">Gestiona usuarios, configuración y auditoría del sistema</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Database className="w-6 h-6 text-blue-600" />
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-500">Sistema</div>
                <div className="font-semibold text-gray-900">Betsy CRM</div>
              </div>
            </div>
          </div>
          </div>

          {/* Tab Navigation */}
        <div className="mb-8">
          <div className="flex space-x-1 bg-white p-1 rounded-xl shadow-lg border border-gray-200">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
              <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-3 px-6 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                    <Icon className="w-5 h-5" />
                    {tab.label}
                </div>
              </button>
              )
            })}
            </div>
          </div>

          {/* Tab Content */}
        <div className="space-y-6">
          {/* Fields Tab */}
          {activeTab === 'fields' && (
            <div className="space-y-6">
              {/* Product Fields Management */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <Database className="w-8 h-8" />
                  </div>
                  <div>
                        <h2 className="text-2xl font-bold">Campos de Producto</h2>
                        <p className="text-green-100">Gestiona los campos que aparecen en el formulario de ventas</p>
                  </div>
                </div>
                    <button
                      onClick={() => setShowFieldForm(true)}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Agregar Campo
                    </button>
              </div>
                </div>
                
              <div className="p-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                      <span className="ml-3 text-gray-600">Cargando campos...</span>
                    </div>
                  ) : fields.length === 0 ? (
                    <div className="text-center py-8">
                      <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No hay campos configurados</p>
                      <button
                        onClick={() => setShowFieldForm(true)}
                        className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Crear Primer Campo
                      </button>
                  </div>
                ) : (
                    <div className="space-y-3">
                      {fields.map((field) => (
                        <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 rounded-lg">
                              <Database className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                              <div className="font-medium text-gray-900">{field.label}</div>
                            <div className="text-sm text-gray-500">
                                {field.type} • {field.required ? 'Requerido' : 'Opcional'} • Orden: {field.order}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                              onClick={() => handleEditField(field)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                              onClick={() => handleDeleteField(field.id)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

              {/* Option Sets Management */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-violet-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <Zap className="w-8 h-8" />
                  </div>
                  <div>
                        <h2 className="text-2xl font-bold">Conjuntos de Opciones</h2>
                        <p className="text-purple-100">Gestiona las opciones disponibles para los campos</p>
                  </div>
                </div>
                            <button 
                      onClick={() => setShowOptionSetForm(true)}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Agregar Conjunto
                            </button>
                          </div>
                        </div>
                
                <div className="p-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                      <span className="ml-3 text-gray-600">Cargando conjuntos...</span>
                    </div>
                  ) : optionSets.length === 0 ? (
                    <div className="text-center py-8">
                      <Zap className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No hay conjuntos de opciones configurados</p>
                                <button 
                        onClick={() => setShowOptionSetForm(true)}
                        className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                      >
                        Crear Primer Conjunto
                                </button>
                              </div>
                  ) : (
                    <div className="space-y-3">
                      {optionSets.map((set) => (
                        <div key={set.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 rounded-lg">
                              <Zap className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                              <div className="font-medium text-gray-900">{set.name}</div>
                              <div className="text-sm text-gray-500">
                                Clave: {set.key} • {set.options?.length || 0} opciones
                  </div>
                </div>
              </div>
                          <div className="flex items-center gap-2">
                          <button 
                              onClick={() => handleEditOptionSet(set)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                              onClick={() => handleDeleteOptionSet(set.id)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

              {/* Shipping Methods Management */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-orange-500 to-amber-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <BarChart3 className="w-8 h-8" />
                  </div>
                  <div>
                        <h2 className="text-2xl font-bold">Métodos de Envío</h2>
                        <p className="text-orange-100">Gestiona las opciones de envío disponibles</p>
                  </div>
                </div>
                    <button
                      onClick={() => setShowShippingForm(true)}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Agregar Método
                    </button>
              </div>
                </div>
                
              <div className="p-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                      <span className="ml-3 text-gray-600">Cargando métodos...</span>
                    </div>
                  ) : shipping.length === 0 ? (
                  <div className="text-center py-8">
                      <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No hay métodos de envío configurados</p>
                      <button
                        onClick={() => setShowShippingForm(true)}
                        className="mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                      >
                        Crear Primer Método
                      </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                      {shipping.map((method) => (
                        <div key={method.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-100 rounded-lg">
                              <BarChart3 className="w-5 h-5 text-orange-600" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900">{method.name}</div>
                              <div className="text-sm text-gray-500">
                                Precio: ${method.price || 0} • {method.active ? 'Activo' : 'Inactivo'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                          <button 
                              onClick={() => handleEditShipping(method)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                              onClick={() => handleDeleteShipping(method.id)}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              {/* Bulk Operations for Users */}
              <BulkOperations
                selectedItems={selectedUsers}
                onSelectionChange={setSelectedUsers}
                onBulkDelete={handleBulkDelete}
                onBulkUpdate={handleBulkUpdate}
                onBulkToggle={handleBulkToggle}
                totalItems={users.length}
                itemType="usuarios"
                showUpdate={true}
                showToggle={true}
              />

              {/* Users Table */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                      <Users className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Gestión de Usuarios</h2>
                      <p className="text-purple-100">Administra usuarios y permisos del sistema</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                      <span className="ml-3 text-gray-600">Cargando usuarios...</span>
                      </div>
                  ) : users.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No hay usuarios configurados</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {users.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedUsers.includes(user.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedUsers([...selectedUsers, user.id])
                                } else {
                                  setSelectedUsers(selectedUsers.filter(id => id !== user.id))
                                }
                              }}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <div>
                              <div className="font-medium text-gray-900">{user.username}</div>
                              <div className="text-sm text-gray-500">
                                {user.role} • {user.active ? 'Activo' : 'Inactivo'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              user.role === 'MASTER' 
                                ? 'bg-purple-100 text-purple-800' 
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {user.role}
                            </span>
                            <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                              Editar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Audit Tab */}
          {activeTab === 'audit' && (
            <div className="space-y-6">
              {/* Bulk Operations for Business Data */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-red-500 to-pink-600 p-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                      <Shield className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Operaciones Masivas</h2>
                      <p className="text-red-100">Elimina múltiples órdenes y datos de ventas de forma segura</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-6 space-y-6">
                  {/* Orders Bulk Operations */}
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-blue-600" />
                      Órdenes de Venta
                    </h3>
                    <BulkOperations
                      selectedItems={selectedOrders}
                      onSelectionChange={setSelectedOrders}
                      onBulkDelete={handleBulkDeleteOrders}
                      totalItems={orders.length}
                      itemType="órdenes"
                      showUpdate={true}
                      showToggle={true}
                    />
                    {orders.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {orders.map((order) => (
                          <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={selectedOrders.includes(order.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedOrders(prev => [...prev, order.id])
                                  } else {
                                    setSelectedOrders(prev => prev.filter(id => id !== order.id))
                                  }
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <div>
                                <div className="font-medium text-gray-900">Orden #{order.orderId}</div>
                                <div className="text-sm text-gray-500">
                                  {order.customerName} • ${order.total} • {order.status} • {new Date(order.timestamp).toLocaleDateString()}
                      </div>
                      </div>
                  </div>
                </div>
                        ))}
            </div>
          )}
      </div>

                </div>
              </div>

              {/* Audit Dashboard */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <Shield className="w-8 h-8" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold">Historial de Auditoría</h2>
                        <p className="text-indigo-100">Rastrea todos los cambios realizados en el sistema</p>
                      </div>
                    </div>
                    <button
                      onClick={loadData}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      🔄 Actualizar
                    </button>
                  </div>
                </div>
                <SimpleAuditDashboard isMaster={isMasterUser} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Field Form Modal */}
      {showFieldForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingField ? 'Editar Campo' : 'Nuevo Campo'}
            </h3>
            <form onSubmit={(e) => {
    e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const data = {
                label: formData.get('label'),
                type: formData.get('type'),
                required: formData.get('required') === 'on',
                order: parseInt(formData.get('order') as string) || 0
              }
              console.log('Field form submitted:', data)
              setShowFieldForm(false)
              setEditingField(null)
            }}>
              <div className="space-y-4">
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Etiqueta</label>
              <input
                    type="text"
                    name="label"
                    defaultValue={editingField?.label || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              />
            </div>
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                    name="type"
                    defaultValue={editingField?.type || 'text'}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                    <option value="email">Email</option>
                    <option value="tel">Teléfono</option>
                    <option value="textarea">Área de texto</option>
                <option value="select">Selección</option>
                    <option value="checkbox">Casilla de verificación</option>
              </select>
            </div>
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Orden</label>
              <input
                type="number"
                    name="order"
                    defaultValue={editingField?.order || 0}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
                <div className="flex items-center">
                <input
                  type="checkbox"
                    name="required"
                    defaultChecked={editingField?.required || false}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Campo requerido</label>
            </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                  onClick={() => {
                    setShowFieldForm(false)
                    setEditingField(null)
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                  {editingField ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      </div>
      )}

      {/* Option Set Form Modal */}
      {showOptionSetForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingOptionSet ? 'Editar Conjunto de Opciones' : 'Nuevo Conjunto de Opciones'}
            </h3>
            <form onSubmit={(e) => {
    e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const data = {
                name: formData.get('name'),
                key: formData.get('key')
              }
              console.log('Option set form submitted:', data)
              setShowOptionSetForm(false)
              setEditingOptionSet(null)
            }}>
              <div className="space-y-4">
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input
                    type="text"
                    name="name"
                    defaultValue={editingOptionSet?.name || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                required
              />
            </div>
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Clave</label>
              <input
                    type="text"
                    name="key"
                    defaultValue={editingOptionSet?.key || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                required
                    pattern="[a-zA-Z0-9_]+"
                    title="Solo letras, números y guiones bajos"
              />
            </div>
            </div>
              <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                  onClick={() => {
                    setShowOptionSetForm(false)
                    setEditingOptionSet(null)
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
              >
                  {editingOptionSet ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      </div>
      )}

      {/* Shipping Form Modal */}
      {showShippingForm && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingShipping ? 'Editar Método de Envío' : 'Nuevo Método de Envío'}
            </h3>
            <form onSubmit={(e) => {
    e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const data = {
                name: formData.get('name'),
                price: parseFloat(formData.get('price') as string) || 0,
                description: formData.get('description')
              }
              console.log('Shipping form submitted:', data)
              setShowShippingForm(false)
              setEditingShipping(null)
            }}>
              <div className="space-y-4">
        <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
          <input 
                    type="text"
                    name="name"
                    defaultValue={editingShipping?.name || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            required 
          />
        </div>
        <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Precio</label>
          <input 
            type="number" 
                    name="price"
                    step="0.01"
                    defaultValue={editingShipping?.price || 0}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>
        <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                  <textarea
                    name="description"
                    defaultValue={editingShipping?.description || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    rows={3}
          />
        </div>
        </div>
              <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                  onClick={() => {
                    setShowShippingForm(false)
                    setEditingShipping(null)
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                  className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"
              >
                  {editingShipping ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      </div>
      )}
    </div>
  )
}
