'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

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

interface Conversation {
  recipientId: string
  recipientName?: string
  lastMessage?: string
  lastMessageAt?: string
  unreadCount?: number
  messages: ChatMessage[]
}

export default function ChatsPage() {
  const { data: session } = useSession()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<'instagram' | 'whatsapp'>('whatsapp')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts')
      const json = await res.json()
      if (json.success) setAccounts(json.accounts)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar cuentas'
      console.error(message)
    }
  }

  async function fetchMessages() {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/chat/messages?socialAccountId=${selectedAccountId}&limit=100`)
      const json = await res.json()
      if (json.success) {
        setMessages(json.messages)
        // Group messages by recipient to create conversations
        groupMessagesByRecipient(json.messages)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar mensajes'
      console.error(message)
    } finally {
      setLoading(false)
    }
  }

  function groupMessagesByRecipient(msgs: ChatMessage[]) {
    const grouped: Record<string, Conversation> = {}
    
    msgs.forEach(msg => {
      // Extract recipient from metadata or use a placeholder
      const recipientId = msg.metadata?.from || msg.metadata?.to || 'unknown'
      
      // Get display name - prefer username, fallback to name, then format ID nicely
      let displayName = msg.metadata?.name || msg.metadata?.username || null
      if (!displayName || displayName === recipientId) {
        // If we only have the ID, make it look nicer
        const platform = msg.metadata?.platform || selectedPlatform
        if (platform === 'instagram') {
          displayName = `IG User ${recipientId.slice(-6)}`
        } else if (platform === 'whatsapp') {
          displayName = `+${recipientId}`
        } else {
          displayName = `User ${recipientId.slice(-6)}`
        }
      }
      
      if (!grouped[recipientId]) {
        grouped[recipientId] = {
          recipientId,
          recipientName: displayName,
          messages: [],
          lastMessageAt: msg.sentAt || msg.receivedAt || undefined,
          lastMessage: msg.content.substring(0, 50) || '(mensaje vacío)',
        }
      } else {
        // Update name if we found a better one (with username vs just ID)
        if (msg.metadata?.name && msg.metadata.name !== recipientId) {
          grouped[recipientId].recipientName = msg.metadata.name
        }
      }
      
      grouped[recipientId].messages.push(msg)
      
      // Update last message if this one is newer
      const currentLast = grouped[recipientId].lastMessageAt
      const thisTime = msg.sentAt || msg.receivedAt
      if (!currentLast || (thisTime && thisTime > currentLast)) {
        grouped[recipientId].lastMessageAt = thisTime || undefined
        grouped[recipientId].lastMessage = msg.content.substring(0, 50) || '(mensaje vacío)'
      }
    })
    
    const convs = Object.values(grouped).sort((a, b) => {
      const aTime = a.lastMessageAt || '0'
      const bTime = b.lastMessageAt || '0'
      return bTime.localeCompare(aTime)
    })
    
    setConversations(convs)
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!messageInput.trim() || !selectedAccountId) return

    if (!selectedConversation) {
      alert('Selecciona una conversación para responder')
      return
    }

    const recipient = selectedConversation

    setSending(true)
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: selectedAccountId,
          recipient,
          content: messageInput.trim()
        })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      
      setMessageInput('')
      setReplyingTo(null)
      fetchMessages() // Refresh messages
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al enviar'
      alert(message)
    } finally {
      setSending(false)
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
  const currentConversation = conversations.find(c => c.recipientId === selectedConversation)
  const displayMessages = currentConversation?.messages || []

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">💬 Mensajería Social</h1>
            <p className="text-sm text-gray-600">Gestiona tus conversaciones de WhatsApp e Instagram</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/config/social"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              ⚙️ Configurar Cuentas
            </Link>
            <Link
              href="/dashboard"
              className="text-sm bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium flex items-center gap-1"
            >
              ← Inicio
            </Link>
          </div>
        </div>
      </div>

      {/* Platform Tabs */}
      <div className="bg-white border-b flex gap-1 px-6">
        <button
          onClick={() => {
            setSelectedPlatform('whatsapp')
            setSelectedAccountId(null)
            setSelectedConversation(null)
            setMessages([])
            setConversations([])
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
            setSelectedConversation(null)
            setMessages([])
            setConversations([])
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

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Account Selection */}
        <div className="w-80 bg-white border-r flex flex-col">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900 mb-3">
              Cuentas de {selectedPlatform === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
            </h2>
            {platformAccounts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 text-sm mb-3">No hay cuentas vinculadas</p>
                <a
                  href="/config/social"
                  className="text-blue-600 hover:underline text-sm font-medium"
                >
                  Vincular cuenta →
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                {platformAccounts.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      setSelectedAccountId(acc.id)
                      setSelectedConversation(null)
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selectedAccountId === acc.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm">{acc.accountId}</div>
                    <div className="text-xs text-gray-500">
                      {selectedPlatform === 'whatsapp' ? 'Phone Number ID' : 'Instagram Account'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Conversations List */}
          {selectedAccountId && (
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-sm text-gray-700">Conversaciones Entrantes</h3>
                <p className="text-xs text-gray-500 mt-1">Clientes que te han contactado</p>
              </div>
              {loading ? (
                <div className="p-4 text-center text-gray-500 text-sm">Cargando...</div>
              ) : conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No hay conversaciones aún
                </div>
              ) : (
                <div className="divide-y">
                  {conversations.map(conv => (
                    <button
                      key={conv.recipientId}
                      onClick={() => setSelectedConversation(conv.recipientId)}
                      className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                        selectedConversation === conv.recipientId ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="font-medium text-sm">{conv.recipientName}</div>
                        <div className="text-xs text-gray-500">
                          {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 truncate">{conv.lastMessage}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {!selectedAccountId ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-lg font-medium">Selecciona una cuenta para comenzar</p>
              </div>
            </div>
          ) : !selectedConversation ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4">💬</div>
                <p className="text-lg font-medium mb-2">Selecciona una conversación</p>
                <p className="text-sm text-gray-500">Elige una conversación de la lista para ver los mensajes y responder a tus clientes</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold">
                      {currentConversation?.recipientName?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h2 className="font-semibold text-lg">
                        {currentConversation?.recipientName || 'Cliente'}
                      </h2>
                      <p className="text-xs text-gray-500">
                        {currentConversation?.recipientId}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Última actividad</div>
                    <div className="text-sm font-medium">
                      {currentConversation?.lastMessageAt ? new Date(currentConversation.lastMessageAt).toLocaleString('es', { 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) : '-'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
                {displayMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <div className="text-4xl mb-2">📭</div>
                      <p className="text-sm">No hay mensajes en esta conversación</p>
                    </div>
                  </div>
                ) : null}
                {displayMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-md px-4 py-2 rounded-lg ${
                        msg.direction === 'outbound'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-900'
                      }`}
                    >
                      <p className="text-sm">{msg.content}</p>
                      <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-blue-100' : 'text-gray-500'}`}>
                        {new Date(msg.sentAt || msg.receivedAt || '').toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input */}
              <div className="bg-white border-t p-4">
                <div className="mb-2 text-xs text-gray-500 flex items-center justify-between">
                  <span>Respondiendo a {currentConversation?.recipientName || 'cliente'}</span>
                  {displayMessages.length > 0 && displayMessages[displayMessages.length - 1].direction === 'inbound' && (
                    <span className="text-orange-600 font-medium">⚠️ Mensaje sin responder</span>
                  )}
                </div>
                <form onSubmit={handleSendMessage} className="flex gap-3">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder="Escribe tu respuesta..."
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={sending}
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={sending || !messageInput.trim()}
                    className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center gap-2"
                  >
                    {sending ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        Enviando...
                      </>
                    ) : (
                      <>
                        <span>📤</span>
                        Enviar Respuesta
                      </>
                    )}
                  </button>
                </form>
                <p className="text-xs text-gray-400 mt-2">💡 Tip: Responde de forma personalizada para brindar mejor servicio</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
