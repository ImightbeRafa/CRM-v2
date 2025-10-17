'use client'

import { useState } from 'react'
import { BulkOperations } from '../components/ui/bulk-operations'
import { SimpleAuditDashboard } from '../components/SimpleAuditDashboard'

export default function DemoPage() {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [users] = useState([
    { id: '1', username: 'admin', role: 'MASTER', active: true },
    { id: '2', username: 'user1', role: 'REGULAR', active: true },
    { id: '3', username: 'user2', role: 'REGULAR', active: false },
    { id: '4', username: 'user3', role: 'REGULAR', active: true },
    { id: '5', username: 'user4', role: 'REGULAR', active: false }
  ])

  const handleBulkDelete = async (ids: string[], reason?: string) => {
    console.log('Bulk delete:', ids, reason)
    alert(`Eliminación simulada: ${ids.length} usuarios, razón: ${reason || 'No especificada'}`)
    setSelectedUsers([])
  }

  const handleBulkUpdate = async (ids: string[], updates: any) => {
    console.log('Bulk update:', ids, updates)
    alert(`Actualización simulada: ${ids.length} usuarios, cambios: ${JSON.stringify(updates)}`)
    setSelectedUsers([])
  }

  const handleBulkToggle = async (ids: string[], active: boolean) => {
    console.log('Bulk toggle:', ids, active)
    alert(`Cambio de estado simulado: ${ids.length} usuarios ${active ? 'activados' : 'desactivados'}`)
    setSelectedUsers([])
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Demo de Componentes</h1>
          <p className="text-gray-600 text-lg">Prueba los componentes mejorados de Betsy CRM</p>
        </div>

        {/* Bulk Operations Demo */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white">
            <h2 className="text-2xl font-bold">Bulk Operations Component</h2>
            <p className="text-blue-100">Selecciona usuarios para probar las operaciones masivas</p>
          </div>
          
          <div className="p-6">
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

            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4">Lista de Usuarios</h3>
              <div className="space-y-2">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
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
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <div className="font-medium text-gray-900">{user.username}</div>
                        <div className="text-sm text-gray-500">
                          {user.role} • {user.active ? 'Activo' : 'Inactivo'}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.role === 'MASTER' 
                        ? 'bg-purple-100 text-purple-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {user.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Audit Dashboard Demo */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white">
            <h2 className="text-2xl font-bold">Audit Dashboard Component</h2>
            <p className="text-purple-100">Panel de auditoría para usuarios maestros</p>
          </div>
          
          <div className="p-6">
            <SimpleAuditDashboard isMaster={true} />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-3">Instrucciones de Prueba</h3>
          <div className="space-y-2 text-green-800">
            <p>• <strong>Bulk Operations:</strong> Selecciona usuarios y prueba los botones de eliminación, actualización y cambio de estado</p>
            <p>• <strong>Audit Dashboard:</strong> Usa los filtros para explorar los registros de auditoría</p>
            <p>• <strong>Responsive:</strong> Prueba en diferentes tamaños de pantalla</p>
            <p>• <strong>Interactivo:</strong> Todos los componentes tienen animaciones y efectos hover</p>
          </div>
        </div>
      </div>
    </div>
  )
}
