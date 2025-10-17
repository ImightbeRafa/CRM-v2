'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { OnboardingWizard } from './onboarding-wizard'
import { BulkOperations } from '../components/ui/bulk-operations'
import { SimpleAuditDashboard } from '../components/SimpleAuditDashboard'

export default function ConfigPage() {
  const [fields, setFields] = useState<any[]>([])
  const [sets, setSets] = useState<any[]>([])
  const [shipping, setShipping] = useState<any[]>([])
  const [sellers, setSellers] = useState<any[]>([])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [editingField, setEditingField] = useState<any>(null)
  const [editingOptionSet, setEditingOptionSet] = useState<any>(null)
  const [editingShipping, setEditingShipping] = useState<any>(null)
  const [editingSeller, setEditingSeller] = useState<any>(null)
  const [editingUser, setEditingUser] = useState<any>(null)
  
  // User management state
  const [users, setUsers] = useState<any[]>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [showDataManagement, setShowDataManagement] = useState(false)
  const [activeTab, setActiveTab] = useState('fields')
  const [draggedField, setDraggedField] = useState<string | null>(null)
  const searchParams = useSearchParams()

  // Bulk operations state
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedFields, setSelectedFields] = useState<string[]>([])
  const [selectedOptionSets, setSelectedOptionSets] = useState<string[]>([])
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [selectedSellers, setSelectedSellers] = useState<string[]>([])
  const [selectedShipping, setSelectedShipping] = useState<string[]>([])

  // Audit dashboard state
  const [showAuditDashboard, setShowAuditDashboard] = useState(false)
  const [isMasterUser, setIsMasterUser] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [f, s, sh, se, u] = await Promise.all([
        fetch('/api/config/fields').then(r => r.json()),
        fetch('/api/config/option-sets').then(r => r.json()).catch(() => ({ status:'success', data: [] })),
        fetch('/api/config/shipping').then(r => r.json()),
        fetch('/api/config/sellers').then(r => r.json()),
        fetch('/api/users').then(r => r.json()).catch(() => ({ status:'success', data: [] })),
      ])
      if (f.status === 'success') setFields(f.data)
      if (s.status === 'success') setSets(s.data)
      if (sh.status === 'success') setShipping(sh.data)
      if (se.status === 'success') setSellers(se.data)
      if (u.status === 'success') {
        setUsers(u.data)
        // Check if current user is master
        const currentUser = u.data.find((user: any) => user.username === 'admin') // Adjust this based on your auth system
        setIsMasterUser(currentUser?.role === 'MASTER')
      }
    }
    load()
  }, [])

  // Bulk operation handlers
  const handleBulkDelete = async (ids: string[], type: string, reason?: string) => {
    try {
      const response = await fetch('/api/bulk/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type, reason })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh the appropriate data
        const load = async () => {
          const [f, s, sh, se, u] = await Promise.all([
            fetch('/api/config/fields').then(r => r.json()),
            fetch('/api/config/option-sets').then(r => r.json()).catch(() => ({ status:'success', data: [] })),
            fetch('/api/config/shipping').then(r => r.json()),
            fetch('/api/config/sellers').then(r => r.json()),
            fetch('/api/users').then(r => r.json()).catch(() => ({ status:'success', data: [] })),
          ])
          if (f.status === 'success') setFields(f.data)
          if (s.status === 'success') setSets(s.data)
          if (sh.status === 'success') setShipping(sh.data)
          if (se.status === 'success') setSellers(se.data)
          if (u.status === 'success') setUsers(u.data)
        }
        await load()
        
        // Clear selections
        setSelectedUsers([])
        setSelectedFields([])
        setSelectedOptionSets([])
        setSelectedOptions([])
        setSelectedSellers([])
        setSelectedShipping([])
        
        alert(`Eliminación masiva completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.message}`)
      }
    } catch (error) {
      console.error('Bulk delete error:', error)
      alert('Error al realizar la eliminación masiva')
    }
  }

  const handleBulkUpdate = async (ids: string[], type: string, updates: any) => {
    try {
      const response = await fetch('/api/bulk/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type, updates })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh data and clear selections
        window.location.reload() // Simple refresh for now
        alert(`Actualización masiva completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.message}`)
      }
    } catch (error) {
      console.error('Bulk update error:', error)
      alert('Error al realizar la actualización masiva')
    }
  }

  const handleBulkToggle = async (ids: string[], type: string, active: boolean) => {
    try {
      const response = await fetch('/api/bulk/toggle-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, type, active })
      })
      const result = await response.json()
      
      if (result.status === 'success') {
        // Refresh data and clear selections
        window.location.reload() // Simple refresh for now
        alert(`Cambio de estado completado: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.message}`)
      }
    } catch (error) {
      console.error('Bulk toggle error:', error)
      alert('Error al realizar el cambio de estado masivo')
    }
  }

  useEffect(() => {
    // Show onboarding if URL has onboarding=true parameter
    if (searchParams.get('onboarding') === 'true') {
      setShowOnboarding(true)
    }
    
    // Set active tab from URL parameter
    const tab = searchParams.get('tab')
    if (tab === 'users') {
      setActiveTab('users')
    }
  }, [searchParams])

  // Handler functions for edit/delete operations
  const handleEditField = async (field: any) => {
    setEditingField(field)
  }

  const handleDeleteField = async (id: string) => {
    if (!confirm('¿Eliminar este campo?')) return
    try {
      const res = await fetch(`/api/config/fields?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setFields(prev => prev.filter(f => f.id !== id))
      }
    } catch (e) {
      alert('Error al eliminar campo')
    }
  }

  const handleEditOptionSet = async (set: any) => {
    setEditingOptionSet(set)
  }

  const handleDeleteOptionSet = async (id: string) => {
    if (!confirm('¿Eliminar este conjunto de opciones?')) return
    try {
      const res = await fetch(`/api/config/option-sets?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setSets(prev => prev.filter(s => s.id !== id))
      }
    } catch (e) {
      alert('Error al eliminar conjunto')
    }
  }

  const handleEditOption = async (option: any) => {
    console.log('Edit option:', option)
  }

  const handleDeleteOption = async (id: string) => {
    if (!confirm('¿Eliminar esta opción?')) return
    try {
      const res = await fetch(`/api/config/options?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setSets(prev => prev.map(s => ({ ...s, options: s.options?.filter((o: any) => o.id !== id) || [] })))
      }
    } catch (e) {
      alert('Error al eliminar opción')
    }
  }

  const handleEditShipping = async (shipping: any) => {
    setEditingShipping(shipping)
  }

  const handleDeleteShipping = async (id: string) => {
    if (!confirm('¿Eliminar este método de envío?')) return
    try {
      const res = await fetch(`/api/config/shipping?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setShipping(prev => prev.filter(s => s.id !== id))
      }
    } catch (e) {
      alert('Error al eliminar método de envío')
    }
  }

  const handleEditSeller = async (seller: any) => {
    setEditingSeller(seller)
  }

  const handleDeleteSeller = async (id: string) => {
    if (!confirm('¿Eliminar este vendedor?')) return
    try {
      const res = await fetch(`/api/config/sellers?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setSellers(prev => prev.filter(s => s.id !== id))
      }
    } catch (e) {
      alert('Error al eliminar vendedor')
    }
  }

  // User management functions
  const handleEditUser = async (user: any) => {
    setEditingUser(user)
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('¿Eliminar este usuario?')) return
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.status === 'success') {
        setUsers(prev => prev.filter(u => u.id !== id))
      } else {
        alert(json.error || 'Error al eliminar usuario')
      }
    } catch (e) {
      alert('Error al eliminar usuario')
    }
  }

  const handleResetData = async () => {
    if (confirm('¿Está seguro de que desea resetear TODOS los datos? Esta acción no se puede deshacer.')) {
      try {
        const res = await fetch('/api/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        })
        const json = await res.json()
        if (json.status === 'success') {
          alert('Datos reseteados exitosamente')
          window.location.reload()
        } else {
          alert(json.error || 'Error al resetear datos')
        }
      } catch (error) {
        alert('Error al resetear datos')
      }
    }
  }

  const handlePopulateData = async () => {
    if (confirm('¿Poblar la base de datos con datos de prueba? Esto agregará usuarios, productos y órdenes de ejemplo.')) {
      try {
        const res = await fetch('/api/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'populate' })
        })
        const json = await res.json()
        if (json.status === 'success') {
          alert('Datos de prueba creados exitosamente')
          window.location.reload()
        } else {
          alert(json.error || 'Error al poblar datos')
        }
      } catch (error) {
        alert('Error al poblar datos')
      }
    }
  }

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, fieldId: string) => {
    setDraggedField(fieldId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', fieldId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: React.DragEvent, targetFieldId: string) => {
    e.preventDefault()
    if (!draggedField || draggedField === targetFieldId) return

    const draggedIndex = fields.findIndex(f => f.id === draggedField)
    const targetIndex = fields.findIndex(f => f.id === targetFieldId)
    
    if (draggedIndex === -1 || targetIndex === -1) return

    // Create new order array
    const newFields = [...fields]
    const [draggedItem] = newFields.splice(draggedIndex, 1)
    newFields.splice(targetIndex, 0, draggedItem)

    // Update local state immediately for better UX
    setFields(newFields)

    // Update order values and sync with backend
    const updatedFields = newFields.map((field, index) => ({
      ...field,
      order: index
    }))

    try {
      // Update all fields with new order
      await Promise.all(updatedFields.map(async (field) => {
        const res = await fetch('/api/config/fields', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: field.id,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            order: field.order,
            optionSetId: field.optionSetId,
            multiSelect: field.multiSelect
          })
        })
        return res.json()
      }))

      // Update local state with the new order
      setFields(updatedFields)
    } catch (error) {
      console.error('Error updating field order:', error)
      // Revert on error
      setFields(fields)
      alert('Error al actualizar el orden de los campos')
    }

    setDraggedField(null)
  }

  const handleDragEnd = () => {
    setDraggedField(null)
  }

  return (
    <>
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="container mx-auto px-4 py-8">
          {/* Navigation */}
          <div className="mb-6">
            <a
              href="/home"
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver al Inicio
            </a>
          </div>
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Configuración del Sistema</h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Configure los campos de productos, opciones y métodos de envío para personalizar su CRM
            </p>
            <button
              onClick={() => setShowOnboarding(true)}
              className="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Guía de Configuración
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="max-w-6xl mx-auto mb-8">
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('fields')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'fields'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Configuración
                </div>
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'users'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                  Usuarios
                </div>
              </button>
              {isMasterUser && (
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                    activeTab === 'audit'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    Auditoría
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'fields' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
            
            {/* Product Fields Card */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Campos del Producto</h2>
                    <p className="text-blue-100 text-sm">Configure qué información recopilar</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <CreateField optionSets={sets} existingFields={fields} onCreated={(f) => setFields((prev) => [...prev, f])} />
                {fields.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-gray-500">No hay campos configurados</p>
                    <p className="text-sm text-gray-400">Agregue campos para recopilar información del producto</p>
                  </div>
                ) : (
                  <div>
                    <div className="mb-3 text-sm text-gray-600 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                      Arrastra los campos para reordenarlos
                    </div>
                    <div className="space-y-3">
                      {fields.map((f: any, index: number) => (
                      <div 
                        key={f.id} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, f.id)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, f.id)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center justify-between p-4 rounded-lg border transition-all duration-200 ${
                          draggedField === f.id 
                            ? 'bg-blue-100 border-blue-300 shadow-lg transform scale-105' 
                            : 'bg-gray-50 hover:bg-gray-100'
                        } ${draggedField && draggedField !== f.id ? 'hover:bg-blue-50' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`cursor-move p-1 rounded transition-colors ${
                            draggedField === f.id 
                              ? 'text-blue-600 bg-blue-200' 
                              : 'text-gray-400 hover:bg-gray-200'
                          }`}>
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                            </svg>
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{f.label}</div>
                            <div className="text-sm text-gray-500">
                              {f.type} {f.required ? '· Requerido' : '· Opcional'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">#{f.order}</span>
                          <button 
                            onClick={() => handleEditField(f)} 
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                            onClick={() => handleDeleteField(f.id)} 
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Option Sets Card */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-green-500 to-green-600 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Conjuntos de Opciones</h2>
                    <p className="text-green-100 text-sm">Cree menús desplegables para opciones</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <CreateOptionSet onCreated={(s) => setSets((prev) => [...prev, s])} />
                {sets.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                    </div>
                    <p className="text-gray-500">No hay conjuntos de opciones</p>
                    <p className="text-sm text-gray-400">Cree menús desplegables para colores, tamaños, etc.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sets.map((s: any) => (
                      <div key={s.id} className="border rounded-lg p-4 bg-gray-50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-medium text-gray-900">{s.name}</div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleEditOptionSet(s)} 
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Editar
                            </button>
                            <button 
                              onClick={() => handleDeleteOptionSet(s.id)} 
                              className="text-red-600 hover:text-red-800 text-sm font-medium"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                        <CreateOption setId={s.id} onCreated={(o) => {
                          setSets(prev => prev.map(ps => ps.id === s.id ? { ...ps, options: [...(ps.options||[]), o] } : ps))
                        }} />
                        <div className="mt-3 space-y-2">
                          {(s.options || []).map((o: any) => (
                            <div key={o.id} className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-sm text-gray-700">
                                {o.label} {o.priceDelta ? `(+₡${o.priceDelta.toFixed(2)})` : ''}
                              </span>
                              <div className="flex gap-1">
                                <button 
                                  onClick={() => handleEditOption(o)} 
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                >
                                  Editar
                                </button>
                                <button 
                                  onClick={() => handleDeleteOption(o.id)} 
                                  className="text-red-600 hover:text-red-800 text-xs"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Shipping Methods Card */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Métodos de Envío</h2>
                    <p className="text-purple-100 text-sm">Configure opciones de entrega</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <CreateShipping onCreated={(m) => setShipping((prev) => [m, ...prev])} />
                {shipping.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <p className="text-gray-500">No hay métodos de envío</p>
                    <p className="text-sm text-gray-400">Configure opciones de entrega y precios</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {shipping.map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
                        <div>
                          <div className="font-medium text-gray-900">{m.name}</div>
                          <div className="text-sm text-gray-500">₡{m.basePrice?.toFixed(2) ?? '0.00'}</div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleEditShipping(m)} 
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                            onClick={() => handleDeleteShipping(m.id)} 
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

            {/* Sellers Card */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Vendedores</h2>
                    <p className="text-orange-100 text-sm">Gestione su equipo de ventas</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <CreateSeller onCreated={(s) => setSellers((prev) => [s, ...prev])} />
                {sellers.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-500">No hay vendedores</p>
                    <p className="text-sm text-gray-400">Agregue miembros de su equipo de ventas</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sellers.map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
                        <div className="font-medium text-gray-900">{m.name}</div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleEditSeller(m)} 
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button 
                            onClick={() => handleDeleteSeller(m.id)} 
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
            <div className="max-w-4xl mx-auto">
              {/* User Management Card */}
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Gestión de Usuarios</h2>
                      <p className="text-purple-100 text-sm">Administre el acceso al sistema</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  {/* Create User Form */}
                  <CreateUser onCreated={(u) => setUsers((prev) => [u, ...prev])} />
                  
                  {/* Users List */}
                  {users.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                        </svg>
                      </div>
                      <p className="text-gray-500">No hay usuarios</p>
                      <p className="text-sm text-gray-400">Agregue usuarios para acceder al sistema</p>
                    </div>
                  ) : (
                    <div>
                      <BulkOperations
                        selectedItems={selectedUsers}
                        onSelectionChange={setSelectedUsers}
                        onBulkDelete={(ids, reason) => handleBulkDelete(ids, 'users', reason)}
                        onBulkUpdate={(ids, updates) => handleBulkUpdate(ids, 'users', updates)}
                        onBulkToggle={(ids, active) => handleBulkToggle(ids, 'users', active)}
                        totalItems={users.length}
                        itemType="usuarios"
                        showUpdate={true}
                        showToggle={true}
                      />
                      <div className="space-y-3">
                        {users.map((user: any) => (
                          <div key={user.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
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
                                className="rounded border-gray-300"
                              />
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                                user.role === 'MASTER' ? 'bg-red-500' : 'bg-blue-500'
                              }`}>
                                {user.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-gray-900">{user.username}</div>
                                <div className="text-sm text-gray-500">
                                  {user.role === 'MASTER' ? 'Administrador' : 'Usuario Regular'}
                                  {!user.active && ' • Inactivo'}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleEditUser(user)} 
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                              >
                                Editar
                              </button>
                              {user.role !== 'MASTER' && (
                                <button 
                                  onClick={() => handleDeleteUser(user.id)} 
                                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                                >
                                  Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Data Management Card */}
              <div className="mt-6 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-gray-500 to-gray-600 p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Gestión de Datos</h2>
                      <p className="text-gray-100 text-sm">Herramientas de administración del sistema</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={handlePopulateData}
                      className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-gray-900">Poblar Datos de Prueba</div>
                        <div className="text-sm text-gray-500">Agregar datos de ejemplo para testing</div>
                      </div>
                    </button>
                    
                    <button
                      onClick={handleResetData}
                      className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-gray-900">Resetear Todo</div>
                        <div className="text-sm text-gray-500">⚠️ Eliminar todos los datos</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Audit Dashboard Tab */}
          {activeTab === 'audit' && (
            <div className="max-w-6xl mx-auto">
              <SimpleAuditDashboard isMaster={isMasterUser} />
            </div>
          )}
        </div>
      </div>

      {/* Edit Modals */}
      {editingField && (
        <EditFieldModal
          field={editingField}
          optionSets={sets}
          onClose={() => setEditingField(null)}
          onSave={(updatedField) => {
            setFields(prev => prev.map(f => f.id === updatedField.id ? updatedField : f))
            setEditingField(null)
          }}
        />
      )}

      {editingOptionSet && (
        <EditOptionSetModal
          optionSet={editingOptionSet}
          onClose={() => setEditingOptionSet(null)}
          onSave={(updatedSet) => {
            setSets(prev => prev.map(s => s.id === updatedSet.id ? updatedSet : s))
            setEditingOptionSet(null)
          }}
        />
      )}

      {editingShipping && (
        <EditShippingModal
          shipping={editingShipping}
          onClose={() => setEditingShipping(null)}
          onSave={(updatedShipping) => {
            setShipping(prev => prev.map(s => s.id === updatedShipping.id ? updatedShipping : s))
            setEditingShipping(null)
          }}
        />
      )}

      {editingSeller && (
        <EditSellerModal
          seller={editingSeller}
          onClose={() => setEditingSeller(null)}
          onSave={(updatedSeller) => {
            setSellers(prev => prev.map(s => s.id === updatedSeller.id ? updatedSeller : s))
            setEditingSeller(null)
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={(updatedUser) => {
            setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u))
            setEditingUser(null)
          }}
        />
      )}
    </>
  )
}

function CreateField({ optionSets, onCreated, existingFields = [] }: { optionSets: any[]; onCreated: (f: any) => void; existingFields?: any[] }) {
  const [label, setLabel] = useState('')
  const [keyName, setKeyName] = useState('')
  const [type, setType] = useState('text')
  const [required, setRequired] = useState(false)
  const [order, setOrder] = useState('0')
  const [optionSetId, setOptionSetId] = useState('')
  const [multiSelect, setMultiSelect] = useState(false)
  const [error, setError] = useState('')
  const [validationErrors, setValidationErrors] = useState<{[key: string]: string}>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Validation functions
  const validateKey = (key: string) => {
    if (!key.trim()) return 'La clave es requerida'
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) return 'La clave debe empezar con letra y contener solo letras, números y guiones bajos'
    if (key.length < 2) return 'La clave debe tener al menos 2 caracteres'
    if (key.length > 50) return 'La clave no puede tener más de 50 caracteres'
    
    // Check for duplicates
    const isDuplicate = existingFields.some(field => field.key.toLowerCase() === key.toLowerCase())
    if (isDuplicate) return 'Esta clave ya existe. Use una clave única.'
    
    return ''
  }

  const validateLabel = (label: string) => {
    if (!label.trim()) return 'La etiqueta es requerida'
    if (label.length < 2) return 'La etiqueta debe tener al menos 2 caracteres'
    if (label.length > 100) return 'La etiqueta no puede tener más de 100 caracteres'
    return ''
  }

  const validateOrder = (order: string) => {
    const num = Number(order)
    if (isNaN(num)) return 'El orden debe ser un número'
    if (num < 0) return 'El orden no puede ser negativo'
    if (num > 999) return 'El orden no puede ser mayor a 999'
    return ''
  }

  const validateForm = () => {
    const errors: {[key: string]: string} = {}
    
    const keyError = validateKey(keyName)
    if (keyError) errors.keyName = keyError
    
    const labelError = validateLabel(label)
    if (labelError) errors.label = labelError
    
    const orderError = validateOrder(order)
    if (orderError) errors.order = orderError

    // Validate option set selection for select/multiselect types
    if ((type === 'select' || type === 'multiselect') && !optionSetId) {
      errors.optionSetId = 'Debe seleccionar un conjunto de opciones para este tipo de campo'
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setValidationErrors({})
    
    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch('/api/config/fields', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          key: keyName, 
          label, 
          type, 
          required, 
          order: Number(order), 
          optionSetId: optionSetId || undefined, 
          multiSelect 
        }) 
      })
      const json = await res.json()
      if (json.status === 'success') { 
        onCreated(json.data)
        setLabel('')
        setKeyName('')
        setType('text')
        setRequired(false)
        setOrder('0')
        setOptionSetId('')
        setMultiSelect(false)
        setValidationErrors({})
      } else {
        setError(json.error || 'Error al crear campo')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <form onSubmit={submit} className="mb-3 grid grid-cols-6 gap-2 items-end">
      <div className="col-span-2">
        <label className="text-xs block">Etiqueta</label>
        <input 
          className={`border rounded p-1 w-full ${validationErrors.label ? 'border-red-500' : ''}`} 
          value={label} 
          onChange={(e) => {
            setLabel(e.target.value)
            if (validationErrors.label) {
              const newErrors = {...validationErrors}
              delete newErrors.label
              setValidationErrors(newErrors)
            }
          }} 
          required 
        />
        {validationErrors.label && <div className="text-red-500 text-xs mt-1">{validationErrors.label}</div>}
      </div>
      <div>
        <label className="text-xs block">Clave</label>
        <input 
          className={`border rounded p-1 ${validationErrors.keyName ? 'border-red-500' : ''}`} 
          value={keyName} 
          onChange={(e) => {
            setKeyName(e.target.value)
            if (validationErrors.keyName) {
              const newErrors = {...validationErrors}
              delete newErrors.keyName
              setValidationErrors(newErrors)
            }
          }} 
          required 
        />
        {validationErrors.keyName && <div className="text-red-500 text-xs mt-1">{validationErrors.keyName}</div>}
      </div>
      <div>
        <label className="text-xs block">Tipo</label>
        <select 
          className="border rounded p-1" 
          value={type} 
          onChange={(e) => {
            setType(e.target.value)
            if (e.target.value !== 'select' && e.target.value !== 'multiselect') {
              setOptionSetId('')
            }
          }}
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="select">Selección</option>
          <option value="multiselect">Multi-selección</option>
          <option value="boolean">Sí/No</option>
        </select>
      </div>
      <div>
        <label className="text-xs block">Orden</label>
        <input 
          type="number" 
          className={`border rounded p-1 ${validationErrors.order ? 'border-red-500' : ''}`} 
          value={order} 
          onChange={(e) => {
            setOrder(e.target.value)
            if (validationErrors.order) {
              const newErrors = {...validationErrors}
              delete newErrors.order
              setValidationErrors(newErrors)
            }
          }} 
        />
        {validationErrors.order && <div className="text-red-500 text-xs mt-1">{validationErrors.order}</div>}
      </div>
      <div>
        <label className="text-xs block">Conjunto</label>
        <select 
          className={`border rounded p-1 ${validationErrors.optionSetId ? 'border-red-500' : ''}`} 
          value={optionSetId} 
          onChange={(e) => {
            setOptionSetId(e.target.value)
            if (validationErrors.optionSetId) {
              const newErrors = {...validationErrors}
              delete newErrors.optionSetId
              setValidationErrors(newErrors)
            }
          }} 
          disabled={!(type === 'select' || type === 'multiselect')}
        >
          <option value="">Ninguno</option>
          {optionSets.map((s: any) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        {validationErrors.optionSetId && <div className="text-red-500 text-xs mt-1">{validationErrors.optionSetId}</div>}
      </div>
      <div className="col-span-6 flex items-center gap-4">
        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> 
          Requerido
        </label>
        <label className="text-xs flex items-center gap-1">
          <input 
            type="checkbox" 
            checked={multiSelect} 
            onChange={(e) => setMultiSelect(e.target.checked)} 
            disabled={type !== 'multiselect'} 
          /> 
          Multi
        </label>
        <button 
          className={`px-3 py-1 rounded text-white ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creando...' : 'Crear campo'}
        </button>
        {error && <span className="text-red-600 text-xs">{error}</span>}
      </div>
    </form>
  )
}




// Edit Modal Components
function EditFieldModal({ field, optionSets, onClose, onSave }: { field: any; optionSets: any[]; onClose: () => void; onSave: (field: any) => void }) {
  const [label, setLabel] = useState(field.label || '')
  const [keyName, setKeyName] = useState(field.key || '')
  const [type, setType] = useState(field.type || 'text')
  const [required, setRequired] = useState(field.required || false)
  const [order, setOrder] = useState(field.order?.toString() || '0')
  const [optionSetId, setOptionSetId] = useState(field.optionSetId || '')
  const [multiSelect, setMultiSelect] = useState(field.multiSelect || false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/config/fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: field.id,
          key: keyName,
          label,
          type,
          required,
          order: Number(order),
          optionSetId: optionSetId || undefined,
          multiSelect
        })
      })
      const json = await res.json()
      if (json.status === 'success') {
        onSave(json.data)
      } else {
        setError(json.error || 'Error al actualizar campo')
      }
    } catch (e) {
      setError('Error al actualizar campo')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Editar Campo</h3>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm block mb-1">Etiqueta</label>
              <input
                className="border rounded p-2 w-full"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Clave</label>
              <input
                className="border rounded p-2 w-full"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Tipo</label>
              <select
                className="border rounded p-2 w-full"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="select">Selección</option>
                <option value="multiselect">Multi-selección</option>
                <option value="boolean">Sí/No</option>
              </select>
            </div>
            <div>
              <label className="text-sm block mb-1">Orden</label>
              <input
                type="number"
                className="border rounded p-2 w-full"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Conjunto</label>
              <select
                className="border rounded p-2 w-full"
                value={optionSetId}
                onChange={(e) => setOptionSetId(e.target.value)}
                disabled={!(type === 'select' || type === 'multiselect')}
              >
                <option value="">Ninguno</option>
                {optionSets.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                <span className="text-sm">Requerido</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={multiSelect}
                  onChange={(e) => setMultiSelect(e.target.checked)}
                  disabled={type !== 'multiselect'}
                />
                <span className="text-sm">Multi</span>
              </label>
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function EditOptionSetModal({ optionSet, onClose, onSave }: { optionSet: any; onClose: () => void; onSave: (set: any) => void }) {
  const [name, setName] = useState(optionSet.name || '')
  const [keyName, setKeyName] = useState(optionSet.key || '')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/config/option-sets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: optionSet.id, name, key: keyName })
      })
      const json = await res.json()
      if (json.status === 'success') {
        onSave(json.data)
      } else {
        setError(json.error || 'Error al actualizar conjunto')
      }
    } catch (e) {
      setError('Error al actualizar conjunto')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Editar Conjunto de Opciones</h3>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm block mb-1">Nombre</label>
              <input
                className="border rounded p-2 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Clave</label>
              <input
                className="border rounded p-2 w-full"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
              />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function EditShippingModal({ shipping, onClose, onSave }: { shipping: any; onClose: () => void; onSave: (shipping: any) => void }) {
  const [name, setName] = useState(shipping.name || '')
  const [carrier, setCarrier] = useState(shipping.carrier || '')
  const [price, setPrice] = useState(shipping.basePrice?.toString() || '0')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/config/shipping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shipping.id, name, carrier, basePrice: Number(price) })
      })
      const json = await res.json()
      if (json.status === 'success') {
        onSave(json.data)
      } else {
        setError(json.error || 'Error al actualizar método de envío')
      }
    } catch (e) {
      setError('Error al actualizar método de envío')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Editar Método de Envío</h3>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm block mb-1">Nombre</label>
              <input
                className="border rounded p-2 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Mensajería</label>
              <input
                className="border rounded p-2 w-full"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Precio base</label>
              <input
                type="number"
                step="any"
                className="border rounded p-2 w-full"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function EditSellerModal({ seller, onClose, onSave }: { seller: any; onClose: () => void; onSave: (seller: any) => void }) {
  const [name, setName] = useState(seller.name || '')
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/config/sellers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: seller.id, name })
      })
      const json = await res.json()
      if (json.status === 'success') {
        onSave(json.data)
      } else {
        setError(json.error || 'Error al actualizar vendedor')
      }
    } catch (e) {
      setError('Error al actualizar vendedor')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Editar Vendedor</h3>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm block mb-1">Nombre</label>
              <input
                className="border rounded p-2 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}


// Missing Create Components for Config Page

function CreateShipping({ onCreated }: { onCreated: (m: any) => void }) {
  const [name, setName] = useState('')
  const [carrier, setCarrier] = useState('')
  const [price, setPrice] = useState('0')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/config/shipping', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ name, carrier, basePrice: Number(price) }) 
      })
      const json = await res.json()
      if (json.status === 'success') {
        onCreated(json.data)
        setName('')
        setCarrier('')
        setPrice('0')
      } else {
        setError(json.error || 'Error al crear método de envío')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Nombre</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            required 
            placeholder="Ej: Envío estándar"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Mensajería</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent" 
            value={carrier} 
            onChange={(e) => setCarrier(e.target.value)} 
            placeholder="Ej: Correos de Costa Rica"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Precio base</label>
          <input 
            type="number" 
            step="any" 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent" 
            value={price} 
            onChange={(e) => setPrice(e.target.value)} 
            placeholder="0"
          />
        </div>
        <div>
          <button 
            type="submit"
            className={`w-full px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-purple-600 hover:bg-purple-700 focus:ring-2 focus:ring-purple-500'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </form>
  )
}

function CreateSeller({ onCreated }: { onCreated: (s: any) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/config/sellers', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ name }) 
      })
      const json = await res.json()
      if (json.status === 'success') {
        onCreated(json.data)
        setName('')
      } else {
        setError(json.error || 'Error al crear vendedor')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-sm block mb-1 font-medium text-gray-700">Nombre</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-orange-500 focus:border-transparent" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            required 
            placeholder="Ej: Juan Pérez"
          />
        </div>
        <div>
          <button 
            type="submit"
            className={`px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-orange-600 hover:bg-orange-700 focus:ring-2 focus:ring-orange-500'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </form>
  )
}

function CreateOptionSet({ onCreated }: { onCreated: (s: any) => void }) {
  const [name, setName] = useState('')
  const [keyName, setKeyName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/config/option-sets', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ name, key: keyName }) 
      })
      const json = await res.json()
      if (json.status === 'success') {
        onCreated(json.data)
        setName('')
        setKeyName('')
      } else {
        setError(json.error || 'Error al crear conjunto')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Nombre</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            required 
            placeholder="Ej: Colores disponibles"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Clave</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            value={keyName} 
            onChange={(e) => setKeyName(e.target.value)} 
            required 
            placeholder="Ej: colores"
          />
        </div>
        <div>
          <button 
            type="submit"
            className={`w-full px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-700 focus:ring-2 focus:ring-green-500'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creando...' : 'Crear conjunto'}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </form>
  )
}

function CreateOption({ setId, onCreated }: { setId: string; onCreated: (o: any) => void }) {
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [delta, setDelta] = useState('0')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/config/options', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ setId, label, value, priceDelta: Number(delta) }) 
      })
      const json = await res.json()
      if (json.status === 'success') {
        onCreated(json.data)
        setLabel('')
        setValue('')
        setDelta('0')
      } else {
        setError(json.error || 'Error al crear opción')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Etiqueta</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            value={label} 
            onChange={(e) => setLabel(e.target.value)} 
            required 
            placeholder="Ej: Rojo"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Valor</label>
          <input 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            value={value} 
            onChange={(e) => setValue(e.target.value)} 
            required 
            placeholder="Ej: red"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Δ Precio</label>
          <input 
            type="number" 
            step="any" 
            className="border rounded p-2 w-full focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            value={delta} 
            onChange={(e) => setDelta(e.target.value)} 
            placeholder="0"
          />
        </div>
        <div>
          <button 
            type="submit"
            className={`w-full px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-green-600 hover:bg-green-700 focus:ring-2 focus:ring-green-500'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Agregando...' : 'Agregar opción'}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </form>
  )
}

// Create User Component
function CreateUser({ onCreated }: { onCreated: (u: any) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('REGULAR')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      })
      const json = await res.json()
      if (json.status === 'success') {
        onCreated(json.data)
        setUsername('')
        setPassword('')
        setRole('REGULAR')
      } else {
        setError(json.error || 'Error al crear usuario')
      }
    } catch (err) {
      setError('Error de conexión')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Usuario</label>
          <input
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="Ej: juan.perez"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Contraseña</label>
          <input
            type="password"
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Mínimo 6 caracteres"
          />
        </div>
        <div>
          <label className="text-sm block mb-1 font-medium text-gray-700">Rol</label>
          <select
            className="border rounded p-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="REGULAR">Usuario Regular</option>
            <option value="MASTER">Administrador</option>
          </select>
        </div>
        <div>
          <button
            type="submit"
            className={`w-full px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              isSubmitting
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 focus:ring-2 focus:ring-purple-500'
            }`}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creando...' : 'Crear Usuario'}
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}
    </form>
  )
}

// Edit User Modal
function EditUserModal({ user, onClose, onSave }: { user: any; onClose: () => void; onSave: (user: any) => void }) {
  const [username, setUsername] = useState(user.username || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user.role || 'REGULAR')
  const [active, setActive] = useState(user.active !== false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    try {
      const updateData: any = { username, role, active }
      if (password) updateData.password = password
      
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })
      const json = await res.json()
      if (json.status === 'success') {
        onSave(json.data)
      } else {
        setError(json.error || 'Error al actualizar usuario')
      }
    } catch (e) {
      setError('Error al actualizar usuario')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Editar Usuario</h3>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm block mb-1">Usuario</label>
              <input
                className="border rounded p-2 w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Nueva Contraseña (opcional)</label>
              <input
                type="password"
                className="border rounded p-2 w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Dejar vacío para mantener la actual"
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Rol</label>
              <select
                className="border rounded p-2 w-full"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="REGULAR">Usuario Regular</option>
                <option value="MASTER">Administrador</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="active" className="text-sm">Usuario activo</label>
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 bg-purple-600 text-white py-2 px-4 rounded hover:bg-purple-700"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
