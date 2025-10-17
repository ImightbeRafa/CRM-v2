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
  const [loading, setLoading] = useState(true)
  
  // Bulk operations state
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [selectedFields, setSelectedFields] = useState<string[]>([])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        const [fieldsRes, usersRes] = await Promise.all([
          fetch('/api/config/fields').then(r => r.json()),
          fetch('/api/users').then(r => r.json()).catch(() => ({ status: 'success', data: [] }))
        ])
        
        if (fieldsRes.status === 'success') setFields(fieldsRes.data)
        if (usersRes.status === 'success') setUsers(usersRes.data)
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
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
        // Refresh data
        window.location.reload()
        alert(`Operación completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.message}`)
      }
    } catch (error) {
      console.error('Bulk operation error:', error)
      alert('Error al realizar la operación masiva')
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
        window.location.reload()
        alert(`Actualización completada: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
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
        window.location.reload()
        alert(`Cambio de estado completado: ${result.data.success} exitosos, ${result.data.failed} fallidos`)
      } else {
        alert(`Error: ${result.message}`)
      }
    } catch (error) {
      console.error('Bulk toggle error:', error)
      alert('Error al realizar el cambio de estado masivo')
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
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white bg-opacity-20 rounded-xl">
                    <Settings className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Configuración del Sistema</h2>
                    <p className="text-blue-100">Gestiona campos, opciones y configuraciones</p>
                  </div>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-xl border border-green-200">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <Database className="w-6 h-6 text-green-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-green-900">Campos de Producto</h3>
                        <p className="text-green-600 text-sm">{fields.length} configurados</p>
                      </div>
                    </div>
                    <p className="text-green-700 text-sm">Define qué información recopilar de los productos</p>
                  </div>
                  
                  <div className="bg-gradient-to-br from-purple-50 to-violet-50 p-6 rounded-xl border border-purple-200">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Zap className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-purple-900">Opciones</h3>
                        <p className="text-purple-600 text-sm">Personalizables</p>
                      </div>
                    </div>
                    <p className="text-purple-700 text-sm">Configura opciones para colores, tamaños, etc.</p>
                  </div>
                  
                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-6 rounded-xl border border-orange-200">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-orange-100 rounded-lg">
                        <BarChart3 className="w-6 h-6 text-orange-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-orange-900">Métodos de Envío</h3>
                        <p className="text-orange-600 text-sm">Configurados</p>
                      </div>
                    </div>
                    <p className="text-orange-700 text-sm">Define opciones de envío disponibles</p>
                  </div>
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
                onBulkDelete={(ids, reason) => handleBulkDelete(ids, 'users', reason)}
                onBulkUpdate={(ids, updates) => handleBulkUpdate(ids, 'users', updates)}
                onBulkToggle={(ids, active) => handleBulkToggle(ids, 'users', active)}
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
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <SimpleAuditDashboard isMaster={isMasterUser} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
