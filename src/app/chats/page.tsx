'use client'

import { useState, useEffect } from 'react'

interface SocialAccount {
  id: string
  platform: string
  accountId: string
  isActive: boolean
}

interface ChatMessage {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  sentAt: string
  receivedAt: string | null
  metadata?: any
  clientId?: string
  orderId?: string
}

export default function ChatsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<'instagram' | 'whatsapp'>('whatsapp')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [recipient, setRecipient] = useState('')

  const platformAccounts = accounts.filter(a => a.platform === selectedPlatform)
  const instagramCount = accounts.filter(a => a.platform === 'instagram').length
  const whatsappCount = accounts.filter(a => a.platform === 'whatsapp').length

  useEffect(() => {
    fetchAccounts()
  }, [])

  useEffect(() => {
    if (selectedAccountId) {
      fetchMessages()
    }
  }, [selectedAccountId])

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts')
      const json = await res.json()
      if (json.success) setAccounts(json.accounts)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar cuentas'
      alert(message)
    }
  }

  async function fetchMessages() {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/chat/messages?socialAccountId=${selectedAccountId}&limit=50`)
      const json = await res.json()
      if (json.success) setMessages(json.messages)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar mensajes'
      alert(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSend() {
    if (!messageInput.trim() || !selectedAccountId || !recipient.trim()) {
      alert('Escribe un mensaje y un destinatario')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: selectedAccountId,
          recipient: recipient.trim(),
          content: messageInput.trim(),
        })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al enviar')
      alert('Mensaje enviado')
      setMessageInput('')
      fetchMessages()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al enviar'
      alert(message)
    } finally {
      setSending(false)
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Mensajería Social</h1>
        <p className="text-gray-600">Gestiona todas tus conversaciones de Instagram y WhatsApp en un solo lugar.</p>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => {
            setSelectedPlatform('whatsapp')
            setSelectedAccountId(null)
            setMessages([])
          }}
          className={`px-6 py-3 font-medium transition-colors border-b-2 ${
            selectedPlatform === 'whatsapp'
              ? 'border-green-600 text-green-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          WhatsApp {whatsappCount > 0 && `(${whatsappCount})`}
        </button>
        <button
          onClick={() => {
            setSelectedPlatform('instagram')
            setSelectedAccountId(null)
            setMessages([])
          }}
          className={`px-6 py-3 font-medium transition-colors border-b-2 ${
            selectedPlatform === 'instagram'
              ? 'border-pink-600 text-pink-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Instagram {instagramCount > 0 && `(${instagramCount})`}
        </button>
      </div>

      {/* Account Selector */}
      <div className="border rounded-lg p-4 bg-white shadow-sm">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${
            selectedPlatform === 'whatsapp' ? 'bg-green-500' : 'bg-pink-500'
          }`}></span>
          Cuentas de {selectedPlatform === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
        </h2>
        {platformAccounts.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-3">No hay cuentas de {selectedPlatform} vinculadas.</p>
            <a
              href="/config/social"
              className="text-blue-600 hover:underline font-medium"
            >
              Vincular cuenta de {selectedPlatform === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
            </a>
          </div>
        ) : (
          <div className="grid gap-2">
            {platformAccounts.map(acc => (
              <button
                key={acc.id}
                onClick={() => setSelectedAccountId(acc.id)}
                className={`text-left p-3 rounded-lg border-2 transition-all ${
                  selectedAccountId === acc.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="font-medium">{acc.accountId}</div>
                <div className="text-xs text-gray-500">
                  {selectedPlatform === 'whatsapp' ? 'Phone Number ID' : 'Instagram Account'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAccount && (
        <>
          {/* Recipient input (for demo; real apps would show conversation list) */}
          <div className="border rounded p-4">
            <h2 className="text-lg font-semibold mb-2">Destinatario (ID de Instagram o número de WhatsApp)</h2>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Ej: 123456789 (Instagram) o +5491112345678 (WhatsApp)"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          {/* Messages */}
          <div className="border rounded p-4">
            <h2 className="text-lg font-semibold mb-2">Mensajes</h2>
            <div className="h-96 overflow-y-auto border rounded p-4 space-y-2">
              {loading ? (
                <div className="text-gray-600">Cargando...</div>
              ) : messages.length === 0 ? (
                <div className="text-gray-600">No hay mensajes aún.</div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`max-w-md px-4 py-2 rounded whitespace-pre-wrap ${
                      msg.direction === 'outbound'
                        ? 'bg-blue-600 text-white ml-auto'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    <div>{msg.content}</div>
                    <div className="text-xs opacity-70 mt-1">
                      {new Date(msg.sentAt).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Send input */}
          <div className="border rounded p-4">
            <div className="flex gap-2">
              <input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Escribe un mensaje..."
                disabled={sending}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1 border rounded px-3 py-2"
              />
              <button onClick={handleSend} disabled={sending} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
