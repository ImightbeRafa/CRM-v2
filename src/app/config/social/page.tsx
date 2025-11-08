'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { getInstagramAuthUrl } from '@/lib/instagram-oauth'

interface SocialAccount {
  id: string
  platform: string
  accountId: string
  linkedAt: string
  isActive: boolean
}

export default function SocialConfigPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)

  // WhatsApp manual link form
  const [platform, setPlatform] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [accountId, setAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')

  const isOwnerOrMaster = session?.user?.membershipRole === 'OWNER' || session?.user?.role === 'MASTER'

  useEffect(() => {
    // Wait for session to load before checking permissions
    if (!session) return
    
    if (!isOwnerOrMaster) {
      router.push('/')
      return
    }
    fetchAccounts()
  }, [session, isOwnerOrMaster, router])

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts')
      const json = await res.json()
      if (json.success) setAccounts(json.accounts)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar cuentas sociales'
      alert(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLinkInstagram() {
    const authUrl = getInstagramAuthUrl()
    // Open popup
    const popup = window.open(authUrl, 'instagram_oauth', 'width=600,height=700')
    if (!popup) {
      alert('No se pudo abrir la ventana de inicio de sesión')
      return
    }
    // Poll for closure (simple approach)
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed)
        fetchAccounts()
        alert('Recargando cuentas...')
      }
    }, 1000)
  }

  async function handleLinkWhatsApp(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) {
      alert('El Account ID es requerido')
      return
    }
    setLinking(true)
    try {
      const res = await fetch('/api/social/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, accountId, accessToken: accessToken || undefined })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      alert('Cuenta de WhatsApp vinculada')
      setAccountId('')
      setAccessToken('')
      fetchAccounts()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al vincular WhatsApp'
      alert(message)
    } finally {
      setLinking(false)
    }
  }

  if (!session) return null
  if (!isOwnerOrMaster) {
    return <div className="p-8 text-center text-muted-foreground">No tienes permisos para configurar cuentas sociales.</div>
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuración de Cuentas Sociales</h1>
        <p className="text-gray-600">Aquí puedes vincular WhatsApp e Instagram para gestionar chats desde Betsy.</p>
      </div>

      {/* Instagram Link */}
      <div className="border rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Instagram</h2>
        <p className="text-sm text-gray-600 mb-4">Vincula tu cuenta de Instagram Business para recibir y enviar DMs.</p>
        <button
          onClick={handleLinkInstagram}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Conectar Instagram
        </button>
      </div>

      {/* WhatsApp Manual Link */}
      <div className="border rounded p-4">
        <h2 className="text-lg font-semibold mb-2">WhatsApp (manual)</h2>
        <p className="text-sm text-gray-600 mb-4">Ingresa el Account ID y token de tu proveedor (Meta Cloud, Infobip, Twilio, etc.).</p>
        <form onSubmit={handleLinkWhatsApp} className="space-y-4">
          <div>
            <label htmlFor="accountId" className="block text-sm font-medium mb-1">Account ID (Phone Number ID o Sender ID)</label>
            <input
              id="accountId"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="123456789"
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="accessToken" className="block text-sm font-medium mb-1">Access Token (opcional)</label>
            <input
              id="accessToken"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAZ..."
              type="password"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <button type="submit" disabled={linking} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50">
            {linking ? 'Vinculando...' : 'Vincular WhatsApp'}
          </button>
        </form>
      </div>

      {/* Linked Accounts */}
      <div className="border rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Cuentas vinculadas</h2>
        <p className="text-sm text-gray-600 mb-4">Lista de cuentas sociales conectadas a este tenant.</p>
        {loading ? (
          <div className="text-gray-600">Cargando...</div>
        ) : accounts.length === 0 ? (
          <div className="text-gray-600">No hay cuentas vinculadas aún.</div>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-medium capitalize">{acc.platform}</div>
                  <div className="text-sm text-gray-600">ID: {acc.accountId}</div>
                  <div className="text-xs text-gray-500">Vinculada: {new Date(acc.linkedAt).toLocaleString()}</div>
                </div>
                <div className={`text-xs px-2 py-1 rounded ${acc.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {acc.isActive ? 'Activa' : 'Inactiva'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
