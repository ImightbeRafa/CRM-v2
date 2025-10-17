'use client'

import { useState } from 'react'
import { BulkOperations } from '../components/ui/bulk-operations'
import { SimpleAuditDashboard } from '../components/SimpleAuditDashboard'

export default function TestComponentsPage() {
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [isMasterUser, setIsMasterUser] = useState(true)

  const handleBulkDelete = async (ids: string[], reason?: string) => {
    console.log('Bulk delete:', ids, reason)
    alert(`Bulk delete: ${ids.length} items, reason: ${reason}`)
  }

  const handleBulkUpdate = async (ids: string[], updates: any) => {
    console.log('Bulk update:', ids, updates)
    alert(`Bulk update: ${ids.length} items, updates: ${JSON.stringify(updates)}`)
  }

  const handleBulkToggle = async (ids: string[], active: boolean) => {
    console.log('Bulk toggle:', ids, active)
    alert(`Bulk toggle: ${ids.length} items, active: ${active}`)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-gray-900">Component Test Page</h1>
        
        {/* Bulk Operations Test */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Bulk Operations Component Test</h2>
          <BulkOperations
            selectedItems={selectedItems}
            onSelectionChange={setSelectedItems}
            onBulkDelete={handleBulkDelete}
            onBulkUpdate={handleBulkUpdate}
            onBulkToggle={handleBulkToggle}
            totalItems={5}
            itemType="test items"
            showUpdate={true}
            showToggle={true}
          />
          <div className="mt-4 p-4 bg-gray-50 rounded">
            <p className="text-sm text-gray-600">
              Selected items: {selectedItems.length > 0 ? selectedItems.join(', ') : 'None'}
            </p>
          </div>
        </div>

        {/* Audit Dashboard Test */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Audit Dashboard Component Test</h2>
          <SimpleAuditDashboard isMaster={isMasterUser} />
        </div>

        {/* Toggle Master User */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Test Controls</h2>
          <button
            onClick={() => setIsMasterUser(!isMasterUser)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Toggle Master User: {isMasterUser ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  )
}
