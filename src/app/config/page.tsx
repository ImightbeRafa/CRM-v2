'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { BulkOperations } from '../components/ui/bulk-operations'
import { SimpleAuditDashboard } from '../components/SimpleAuditDashboard'
import { OrderBulkDeleteDashboard } from '../components/OrderBulkDeleteDashboard'
import { MasterConfigDashboard } from './components/MasterConfigDashboard'
import { SimpleFieldsManager } from './components/SimpleFieldsManager'
import { OptionSetsManager } from './components/OptionSetsManager'
import { BillingDashboard } from './components/BillingDashboard'
import { ExcelImporter } from './components/ExcelImporter'
import { StatusManager } from './components/StatusManager'
import { TenantSettingsPanel } from '../components/TenantSettingsPanel'
import { Settings, Users, Shield, Database, BarChart3, Package, UserCheck, FileSpreadsheet, List, Zap, Trash2, MessageCircle } from 'lucide-react'

export default function ConfigPage() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState('fields')
  const [newFieldType, setNewFieldType] = useState('text') // Track type for validation
  const [isMasterUser, setIsMasterUser] = useState(true) // Simplified for demo
  
  // Data states
  const [fields, setFields] = useState<any[]>([])
  const [businessFields, setBusinessFields] = useState<any[]>([])
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
  const [showBusinessFieldForm, setShowBusinessFieldForm] = useState(false)
  const [showOptionSetForm, setShowOptionSetForm] = useState(false)
  const [showShippingForm, setShowShippingForm] = useState(false)
  const [showUserForm, setShowUserForm] = useState(false)
  const [editingField, setEditingField] = useState<any>(null)
  const [editingBusinessField, setEditingBusinessField] = useState<any>(null)
  const [editingOptionSet, setEditingOptionSet] = useState<any>(null)
  const [optionSetOptions, setOptionSetOptions] = useState<{ label: string; value: string; priceDelta: number; metadata: string }[]>([])
  const [editingShipping, setEditingShipping] = useState<any>(null)
  const [editingUser, setEditingUser] = useState<any>(null)
  const [showPassword, setShowPassword] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
        const [fieldsRes, businessFieldsRes, usersRes, optionSetsRes, shippingRes, sellersRes, ordersRes] = await Promise.all([
          fetch('/api/config/fields').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/business-info').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/users').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/option-sets').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/shipping').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/config/sellers').then(r => r.json()).catch(() => ({ status: 'success', data: [] })),
          fetch('/api/orders').then(r => r.json()).catch(() => ({ status: 'success', data: [] }))
        ])
      
      if (fieldsRes.status === 'success') setFields(fieldsRes.data)
      if (businessFieldsRes.status === 'success') setBusinessFields(businessFieldsRes.data)
      if (usersRes.status === 'success') setUsers(usersRes.data)
      if (optionSetsRes.status === 'success') setOptionSets(optionSetsRes.data)
      if (shippingRes.status === 'success') setShipping(shippingRes.data)
      if (sellersRes.status === 'success') setSellers(sellersRes.data)
      if (ordersRes.status === 'success') setOrders(ordersRes.data)
      
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Read tab from URL query parameter on mount and when URL changes
  useEffect(() => {
    const tabParam = searchParams?.get('tab')
    if (tabParam) {
      // Validate tab value to prevent invalid tabs
      const validTabs = ['fields', 'business', 'users', 'option-sets', 'shipping', 'sellers', 'import', 'billing', 'bulk-delete', 'audit', 'legacy-fields', 'social']
      if (validTabs.includes(tabParam)) {
        setActiveTab(tabParam)
      }
    }
  }, [searchParams])

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

  // Business field management functions
  const handleEditBusinessField = (field: any) => {
    setEditingBusinessField(field)
    setShowBusinessFieldForm(true)
  }

  const handleDeleteBusinessField = async (id: string) => {
    if (!confirm('¿Eliminar este campo de negocio?')) return
    try {
      const res = await fetch(`/api/config/business-info?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setBusinessFields(prev => prev.filter(f => f.id !== id))
        alert('Campo de negocio eliminado exitosamente')
      } else {
        alert(json.error || 'Error al eliminar campo de negocio')
      }
    } catch (error) {
      console.error('Error deleting business field:', error)
      alert('Error al eliminar campo de negocio')
    }
  }

  // Option Set management functions
  const handleEditOptionSet = (set: any) => {
    setEditingOptionSet(set)
    setOptionSetOptions((set?.options || []).map((o: any) => ({
      label: o.label || '',
      value: o.value || '',
      priceDelta: o.priceDelta || 0,
      metadata: typeof o.metadata === 'string' ? o.metadata : JSON.stringify(o.metadata || '')
    })))
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

  // User management functions
  const handleEditUser = (user: any) => {
    setEditingUser(user)
    setShowUserForm(true)
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('⚠️ ¿Eliminar este usuario? Esta acción no se puede deshacer.')) return
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setUsers(prev => prev.filter(u => u.id !== id))
        alert('✅ Usuario eliminado exitosamente')
      } else {
        alert(`❌ Error: ${json.error || 'Error al eliminar usuario'}`)
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('❌ Error al eliminar usuario')
    }
  }

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const formData = new FormData(e.target as HTMLFormElement)
    const userData = {
      email: formData.get('email'),
      username: formData.get('username'),
      role: formData.get('role'),
      active: formData.get('active') === 'on',
      password: (formData.get('password') as string) || ''
    }

    try {
      const isEditing = Boolean(editingUser)
      const url = '/api/users'
      const method = isEditing ? 'PUT' : 'POST'
      const body = isEditing
        ? {
            id: editingUser.id,
            email: userData.email,
            username: userData.username,
            role: userData.role,
            active: userData.active,
            ...(userData.password && userData.password.length > 0 ? { password: userData.password } : {})
          }
        : {
            email: userData.email,
            username: userData.username, // Required field for tracking
            role: userData.role,
            active: userData.active,
            password: userData.password // Password is required for new users
          }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const result = await response.json()

      if (response.ok) {
        await loadData()
        setShowUserForm(false)
        setEditingUser(null)
        setShowPassword(false)
        alert(isEditing ? '✅ Usuario actualizado exitosamente' : '✅ Usuario creado exitosamente')
      } else {
        alert(`❌ Error: ${result.error || 'Error al guardar usuario'}`)
      }
    } catch (error) {
      console.error('Error saving user:', error)
      alert('❌ Error al guardar usuario')
    }
  }

  // Bulk operations for configuration items
  const handleBulkDeleteFields = async (ids: string[], reason?: string) => {
    if (!confirm(`¿Eliminar ${ids.length} campos? Esta acción no se puede deshacer.`)) return;
    
    try {
      console.log(`🗑️ Deleting ${ids.length} fields...`);
      
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'fields', reason })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Bulk delete result:', result);
      
      if (result.status === 'success') {
        await loadData(); // Reload data
        setSelectedFields([]);
        alert(`✅ Eliminación completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`);
      } else {
        alert(`❌ Error: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Bulk delete fields error:', error);
      alert('❌ Error al eliminar campos. Por favor intente de nuevo.');
    }
  }

  const handleBulkDeleteOptionSets = async (ids: string[], reason?: string) => {
    if (!confirm(`¿Eliminar ${ids.length} conjuntos de opciones? Esta acción no se puede deshacer.`)) return;
    
    try {
      console.log(`🗑️ Deleting ${ids.length} option sets...`);
      
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'optionSets', reason })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Bulk delete result:', result);
      
      if (result.status === 'success') {
        await loadData(); // Reload data
        setSelectedOptionSets([]);
        alert(`✅ Eliminación completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`);
      } else {
        alert(`❌ Error: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Bulk delete option sets error:', error);
      alert('❌ Error al eliminar conjuntos de opciones. Por favor intente de nuevo.');
    }
  }

  const handleBulkDeleteShipping = async (ids: string[], reason?: string) => {
    if (!confirm(`¿Eliminar ${ids.length} métodos de envío? Esta acción no se puede deshacer.`)) return;
    
    try {
      console.log(`🗑️ Deleting ${ids.length} shipping methods...`);
      
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type: 'shipping', reason })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Bulk delete result:', result);
      
      if (result.status === 'success') {
        await loadData(); // Reload data
        setSelectedShipping([]);
        alert(`✅ Eliminación completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`);
      } else {
        alert(`❌ Error: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Bulk delete shipping error:', error);
      alert('❌ Error al eliminar métodos de envío. Por favor intente de nuevo.');
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
    { id: 'fields', label: 'Configuración de Campos', icon: Database },
    { id: 'statuses', label: 'Estados de Órdenes', icon: Settings },
    { id: 'inventory', label: 'Inventario', icon: Package },
    { id: 'clients', label: 'Clientes', icon: UserCheck },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'social', label: 'Cuentas Sociales', icon: MessageCircle },
    { id: 'import', label: 'Importar Excel', icon: FileSpreadsheet },
    { id: 'billing', label: 'Facturación', icon: BarChart3 },
    { id: 'bulk-delete', label: 'Eliminación Masiva', icon: Trash2 },
    { id: 'audit', label: 'Auditoría', icon: Shield }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="w-full md:w-auto">
              <div className="flex items-center gap-2 md:gap-4 mb-2">
            <a
              href="/dashboard"
                  className="inline-flex items-center gap-2 px-3 md:px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm md:text-base"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">Volver al Inicio</span>
              <span className="sm:hidden">Inicio</span>
            </a>
          </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-1 md:mb-2">Panel de Configuración</h1>
              <p className="text-gray-600 text-sm md:text-base lg:text-lg">Gestiona usuarios, configuración y auditoría del sistema</p>
            </div>
            <div className="flex items-center gap-3 justify-between md:justify-end">
              <div className="p-2 md:p-3 bg-blue-100 rounded-xl">
                <Database className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
              </div>
              <div className="text-left md:text-right">
                <div className="text-xs md:text-sm text-gray-500">Sistema</div>
                <div className="text-sm md:text-base font-semibold text-gray-900">Betsy CRM</div>
              </div>
            </div>
          </div>
          </div>

          {/* Tab Navigation */}
        <div className="mb-6 md:mb-8">
          {/* Desktop: Grid layout, Mobile: Scrollable */}
          <div className="hidden md:block">
            <div className="flex gap-2 bg-white p-2 rounded-xl shadow-lg border border-gray-200">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 rounded-lg transition-all duration-200 px-4 py-2 min-h-[44px] ${
                      activeTab === tab.id
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg ring-1 ring-black/5'
                        : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2 text-center leading-tight whitespace-normal">
                      <Icon className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
                      <span className="text-xs md:text-sm">{tab.label}</span>
                  </div>
                </button>
                )
              })}
            </div>
          </div>
          
          {/* Mobile: Scrollable tabs */}
          <div className="md:hidden -mx-4 px-4 overflow-x-auto">
            <div className="flex gap-2 pb-2 min-w-max">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg'
                        : 'bg-white text-gray-600 hover:text-gray-900 shadow border border-gray-200'
                  }`}
                >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{tab.label}</span>
                </button>
                )
              })}
            </div>
          </div>
          </div>

          {/* Tab Content */}
        <div className="space-y-6">
          {/* Fields Tab */}
          {activeTab === 'fields' && (
            <SimpleFieldsManager />
          )}

          {/* Statuses Tab */}
          {activeTab === 'statuses' && (
            <StatusManager />
          )}

          {/* Inventory Tab - locked to inventory only */}
          {activeTab === 'inventory' && (
            <MasterConfigDashboard key="inventory" initialTab="inventory" lockToInitial />
          )}

          {/* Clients Tab - locked to clients only */}
          {activeTab === 'clients' && (
            <MasterConfigDashboard key="clients" initialTab="clients" lockToInitial />
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              {/* Users Table */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <Users className="w-8 h-8" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold">Gestión de Usuarios</h2>
                        <p className="text-purple-100">Administra usuarios y permisos del sistema</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingUser(null)
                        setShowUserForm(true)
                      }}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Agregar Usuario
                    </button>
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
                      <button 
                        onClick={() => {
                          setEditingUser(null)
                          setShowUserForm(true)
                        }}
                        className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                      >
                        Crear Primer Usuario
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {users.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="p-2 bg-purple-100 rounded-lg">
                              <Users className="w-5 h-5 text-purple-600" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-3">
                                <div className="font-medium text-gray-900">{user.username}</div>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  user.role === 'MASTER' 
                                    ? 'bg-purple-100 text-purple-800' 
                                    : 'bg-gray-100 text-gray-800'
                                }`}>
                                  {user.role}
                                </span>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  user.active 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {user.active ? 'Activo' : 'Inactivo'}
                                </span>
                              </div>
                              <div className="text-sm text-gray-500 mt-1">
                                Última actividad: {new Date().toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => handleEditUser(user)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 rounded-md hover:bg-blue-50"
                            >
                              Editar
                            </button>
                            <button 
                              onClick={() => handleDeleteUser(user.id)}
                              className="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 rounded-md hover:bg-red-50"
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

          {/* Social Tab */}
          {activeTab === 'social' && (
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-100 rounded-xl">
                      <MessageCircle className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Cuentas Sociales</h2>
                      <p className="text-gray-600">Vincula Instagram y WhatsApp para gestionar chats en Betsy</p>
                    </div>
                  </div>
                  <a
                    href="/config/social"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Gestionar Cuentas
                  </a>
                </div>
                <div className="text-sm text-gray-500">
                  Solo usuarios Owner o Master pueden vincular cuentas sociales.
                </div>
              </div>
            </div>
          )}

          {/* Import Tab */}
          {activeTab === 'import' && (
            <ExcelImporter />
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <BillingDashboard />
          )}

          {/* Bulk Delete Tab */}
          {activeTab === 'bulk-delete' && (
            <OrderBulkDeleteDashboard isMaster={isMasterUser} />
          )}

          {/* Audit Tab */}
          {activeTab === 'audit' && (
            <SimpleAuditDashboard isMaster={isMasterUser} />
          )}

          {/* Legacy Fields Tab - keeping for reference */}
          {activeTab === 'legacy-fields' && (
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
                      onClick={() => {
                        setEditingField(null)
                        setShowFieldForm(true)
                      }}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Nuevo Campo
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
                        onClick={() => {
                          setEditingField(null)
                          setShowFieldForm(true)
                        }}
                        className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Crear primer campo
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

              {/* Business Info Fields Management */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 to-cyan-600 p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                        <Settings className="w-8 h-8" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold">Campos de Información de Negocio</h2>
                        <p className="text-blue-100">Gestiona los campos personalizados para tu negocio</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditingBusinessField(null)
                        setShowBusinessFieldForm(true)
                      }}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Nuevo Campo
                    </button>
                  </div>
                </div>
                
                <div className="p-6">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      <span className="ml-3 text-gray-600">Cargando campos...</span>
                    </div>
                  ) : businessFields.length === 0 ? (
                    <div className="text-center py-8">
                      <Settings className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No hay campos de negocio configurados</p>
                      <button
                        onClick={() => {
                          setEditingBusinessField(null)
                          setShowBusinessFieldForm(true)
                        }}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Crear primer campo
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {businessFields.map((field) => (
                        <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 rounded-lg">
                              <Settings className="w-5 h-5 text-blue-600" />
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
                              onClick={() => handleEditBusinessField(field)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Editar
                            </button>
                            <button 
                              onClick={() => handleDeleteBusinessField(field.id)}
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
                      onClick={() => {
                        setEditingOptionSet(null)
                        setOptionSetOptions([{ label: '', value: '', priceDelta: 0, metadata: '' }])
                        setShowOptionSetForm(true)
                      }}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Nuevo conjunto
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
                        onClick={() => {
                          setEditingOptionSet(null)
                          setOptionSetOptions([{ label: '', value: '', priceDelta: 0, metadata: '' }])
                          setShowOptionSetForm(true)
                        }}
                        className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                      >
                        Crear primer conjunto
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
                      onClick={() => {
                        setEditingShipping(null)
                        setShowShippingForm(true)
                      }}
                      className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg transition-colors"
                    >
                      + Nuevo método
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
                        onClick={() => {
                          setEditingShipping(null)
                          setShowShippingForm(true)
                        }}
                        className="mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                      >
                        Crear primer método
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
                                Precio base: ₡{method.basePrice || 0} • {method.active ? 'Activo' : 'Inactivo'}
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
        </div>
      </div>

      {/* Field Form Modal */}
      {showFieldForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingField ? 'Editar Campo' : 'Nuevo Campo'}
            </h3>
            <form onSubmit={async (e) => {
              e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const payload: any = {
                label: formData.get('label'),
                type: formData.get('type'),
                required: formData.get('required') === 'on',
                order: parseInt(formData.get('order') as string) || 0,
                optionSetId: (formData.get('optionSetId') as string) || null,
                multiSelect: formData.get('multiSelect') === 'on',
              }
              if (!editingField) {
                payload.key = formData.get('key')
              } else {
                payload.id = editingField.id
              }

              try {
                const res = await fetch('/api/config/fields', {
                  method: editingField ? 'PUT' : 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                })
                const json = await res.json()
                if (res.ok && json.status === 'success') {
                  await loadData()
                  setShowFieldForm(false)
                  setEditingField(null)
                  alert(editingField ? '✅ Campo actualizado' : '✅ Campo creado')
                } else {
                  alert(`❌ Error: ${json.error || 'No se pudo guardar el campo'}`)
                }
              } catch (err) {
                console.error('Field save error:', err)
                alert('❌ Error al guardar campo')
              }
            }}>
              <div className="space-y-4">
            {!editingField && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Clave única</label>
                    <input
                      type="text"
                      name="key"
                      defaultValue={''}
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      required
                      pattern="[a-zA-Z0-9_]+"
                      title="Solo letras, números y guiones bajos"
                    />
                  </div>
                )}
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
                    value={editingField ? editingField.type : newFieldType}
                    onChange={(e) => {
                      if (!editingField) setNewFieldType(e.target.value);
                    }}
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
                  {(editingField?.type === 'select' || newFieldType === 'select') && (
                    <p className="text-xs text-green-600 mt-1">
                      ℹ️ Los campos de selección requieren un conjunto de opciones
                    </p>
                  )}
            </div>
                {(editingField?.type === 'select' || newFieldType === 'select') && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Conjunto de opciones *
                    </label>
                    <select
                      name="optionSetId"
                      defaultValue={editingField?.optionSetId || ''}
                      className="w-full p-2 border border-green-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white"
                      required
                    >
                      <option value="">-- Seleccionar conjunto --</option>
                      {optionSets.map((set) => (
                        <option key={set.id} value={set.id}>{set.name} ({set.key})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Gestiona conjuntos de opciones en la pestaña &quot;Conjuntos de Opciones&quot;
                    </p>
                  </div>
                )}
            <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Orden</label>
              <input
                type="number"
                    name="order"
                    defaultValue={editingField?.order || 0}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center"><input
                    type="checkbox"
                    name="required"
                    defaultChecked={editingField?.required || false}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500 mr-2"
                  />Requerido</label>
                  <label className="flex items-center"><input
                    type="checkbox"
                    name="multiSelect"
                    defaultChecked={editingField?.multiSelect || false}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-500 mr-2"
                  />Selección múltiple</label>
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
            <form onSubmit={async (e) => {
              e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const payload: any = {
                name: formData.get('name'),
                key: formData.get('key')
              }
              if (editingOptionSet) payload.id = editingOptionSet.id
              try {
                // Create or update the option set first
                const res = await fetch('/api/config/option-sets', {
                  method: editingOptionSet ? 'PUT' : 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                })
                const json = await res.json()
                if (!(res.ok && json.status === 'success')) {
                  alert(`❌ Error: ${json.error || 'No se pudo guardar el conjunto'}`)
                  return
                }

                const setId = editingOptionSet ? editingOptionSet.id : json.data.id

                // Submit options in sequence
                for (const opt of optionSetOptions) {
                  if (!opt.label || !opt.value) continue
                  const optPayload = {
                    setId,
                    label: opt.label,
                    value: opt.value,
                    priceDelta: opt.priceDelta || 0,
                    metadata: opt.metadata || null
                  }
                  await fetch('/api/config/options', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(optPayload)
                  })
                }

                await loadData()
                setShowOptionSetForm(false)
                setEditingOptionSet(null)
                setOptionSetOptions([])
                alert(editingOptionSet ? '✅ Conjunto actualizado' : '✅ Conjunto creado')
              } catch (err) {
                console.error('Option set save error:', err)
                alert('❌ Error al guardar conjunto de opciones')
              }
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
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-900">Opciones del conjunto</label>
                    <button
                      type="button"
                      onClick={() => setOptionSetOptions(prev => [...prev, { label: '', value: '', priceDelta: 0, metadata: '' }])}
                      className="text-sm text-purple-600 hover:text-purple-800"
                    >
                      + Agregar opción
                    </button>
                  </div>
                  {optionSetOptions.length === 0 ? (
                    <div className="text-sm text-gray-500">No hay opciones. Agrega al menos una opción.</div>
                  ) : (
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                      {optionSetOptions.map((opt, idx) => (
                        <div key={idx} className="grid grid-cols-6 gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Etiqueta"
                            value={opt.label}
                            onChange={(e) => {
                              const v = e.target.value
                              setOptionSetOptions(prev => prev.map((o, i) => i === idx ? { ...o, label: v } : o))
                            }}
                            className="col-span-2 p-2 border rounded"
                          />
                          <input
                            type="text"
                            placeholder="Valor"
                            value={opt.value}
                            onChange={(e) => {
                              const v = e.target.value
                              setOptionSetOptions(prev => prev.map((o, i) => i === idx ? { ...o, value: v } : o))
                            }}
                            className="col-span-2 p-2 border rounded"
                          />
                          <input
                            type="number"
                            placeholder="Δ precio"
                            value={opt.priceDelta}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value || '0')
                              setOptionSetOptions(prev => prev.map((o, i) => i === idx ? { ...o, priceDelta: isNaN(v) ? 0 : v } : o))
                            }}
                            className="col-span-1 p-2 border rounded"
                          />
                          <button
                            type="button"
                            onClick={() => setOptionSetOptions(prev => prev.filter((_, i) => i !== idx))}
                            className="col-span-1 text-red-600 hover:text-red-800 text-sm"
                          >
                            Quitar
                          </button>
                          <input
                            type="text"
                            placeholder="Metadata (JSON o texto)"
                            value={opt.metadata}
                            onChange={(e) => {
                              const v = e.target.value
                              setOptionSetOptions(prev => prev.map((o, i) => i === idx ? { ...o, metadata: v } : o))
                            }}
                            className="col-span-6 p-2 border rounded"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            </div>
              <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                  onClick={() => {
                    setShowOptionSetForm(false)
                    setEditingOptionSet(null)
                    setOptionSetOptions([])
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
            <form onSubmit={async (e) => {
              e.preventDefault()
              const formData = new FormData(e.target as HTMLFormElement)
              const payload: any = {
                name: formData.get('name'),
                basePrice: parseFloat((formData.get('basePrice') as string) || '0') || 0,
                carrier: formData.get('carrier') || null,
              }
              if (editingShipping) payload.id = editingShipping.id
              try {
                const res = await fetch('/api/config/shipping', {
                  method: editingShipping ? 'PUT' : 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                })
                const json = await res.json()
                if (res.ok && json.status === 'success') {
                  await loadData()
                  setShowShippingForm(false)
                  setEditingShipping(null)
                  alert(editingShipping ? '✅ Método actualizado' : '✅ Método creado')
                } else {
                  alert(`❌ Error: ${json.error || 'No se pudo guardar el método de envío'}`)
                }
              } catch (err) {
                console.error('Shipping save error:', err)
                alert('❌ Error al guardar método de envío')
              }
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transportista (opcional)</label>
          <input 
            type="text" 
                    name="carrier"
                    defaultValue={editingShipping?.carrier || ''}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          />
        </div>
        <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Precio base</label>
          <input 
            type="number" 
                    name="basePrice"
                    step="0.01"
                    defaultValue={editingShipping?.basePrice || 0}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            required
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

      {/* User Form Modal */}
      {showUserForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            </h3>
            {!editingUser && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Nota:</strong> Los nuevos usuarios tendrán la contraseña por defecto: <code className="bg-blue-100 px-1 rounded">password123</code>
                </p>
                <p className="text-sm text-blue-600 mt-1">
                  El usuario podrá cambiar su contraseña después de iniciar sesión.
                </p>
              </div>
            )}
            <form onSubmit={handleUserSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    defaultValue={editingUser?.email || ''}
                    placeholder="usuario@ejemplo.com"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Email único para iniciar sesión</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre de Usuario <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="username"
                    defaultValue={editingUser?.username || ''}
                    placeholder="Ej: PedroPascal02"
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Usado para identificar quién realiza acciones (ventas, órdenes, etc.)</p>
                </div>
                {!editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contraseña <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        placeholder="Mínimo 8 caracteres"
                        className="w-full p-2 pr-24 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(prev => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-purple-600 hover:text-purple-800"
                      >
                        {showPassword ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">La contraseña es requerida para nuevos usuarios. Mínimo 8 caracteres.</p>
                  </div>
                )}
                {editingUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        placeholder="Dejar en blanco para mantener la actual"
                        className="w-full p-2 pr-24 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(prev => !prev)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-purple-600 hover:text-purple-800"
                      >
                        {showPassword ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Dejar vacío para no cambiar la contraseña.</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Rol <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="role"
                    defaultValue={editingUser?.role || 'VIEWER'}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    required
                  >
                    <option value="OWNER">OWNER - Propietario (Acceso completo + facturación)</option>
                    <option value="ADMIN">ADMIN - Administrador (Acceso completo)</option>
                    <option value="MANAGER">MANAGER - Gerente (Ventas + Producción + Estadísticas)</option>
                    <option value="SALES">SALES - Ventas (Solo módulo de ventas)</option>
                    <option value="PRODUCTION">PRODUCTION - Producción (Solo módulo de producción)</option>
                    <option value="VIEWER">VIEWER - Visualizador (Solo lectura)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Define los permisos y accesos del usuario</p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editingUser?.active !== false}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <label className="ml-2 text-sm text-gray-700">Usuario activo</label>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowUserForm(false)
                    setEditingUser(null)
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                >
                  {editingUser ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Tenant Settings Gear (only visible on config page) */}
      <TenantSettingsPanel />
    </div>
  )
}
