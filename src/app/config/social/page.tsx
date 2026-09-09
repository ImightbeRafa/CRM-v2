'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface SocialAccount {
  id: string
  platform: string
  accountId: string
  linkedAt: string
  isActive: boolean
  phoneNumberId?: string | null
  whatsappBusinessAccountId?: string | null
  pageId?: string | null
}

interface MetaEnvFlag {
  key: string
  set: boolean
}

interface MetaStatus {
  success: boolean
  blockers: string[]
  warnings: string[]
  notes: string[]
  instagramOAuthScopes: string[]
  urls: {
    inboxWebhook: string
    instagramOAuthRedirect: string
    socialConfig: string
    staffBotWebhook: string
    inbox?: string
  }
  env: {
    inboxRequired: MetaEnvFlag[]
    inboxRecommended: MetaEnvFlag[]
    staffBot: MetaEnvFlag[]
  }
  tenant: {
    linkedAccounts: Array<{ platform: string; count: number }>
    readyToReceive: boolean
  }
}

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void
      login: (callback: (response: any) => void, options: Record<string, unknown>) => void
    }
    fbAsyncInit?: () => void
  }
}

export default function SocialConfigPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)
  const [connectingInstagram, setConnectingInstagram] = useState(false)
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false)

  const [accountId, setAccountId] = useState('')
  const [whatsappBusinessAccountId, setWhatsappBusinessAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [showManualWhatsApp, setShowManualWhatsApp] = useState(false)
  const [validationError, setValidationError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [resubscribing, setResubscribing] = useState<string | null>(null)
  const [fbReady, setFbReady] = useState(false)
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null)
  const [metaStatusError, setMetaStatusError] = useState('')

  const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID as string | undefined
  const FB_LOGIN_CONFIG_ID = process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID as string | undefined
  const META_GRAPH_API_VERSION =
    (process.env.NEXT_PUBLIC_META_GRAPH_API_VERSION as string | undefined) || 'v24.0'

  const isOwnerOrMaster =
    session?.user?.membershipRole === 'OWNER' || session?.user?.role === 'MASTER'

  useEffect(() => {
    if (!session) return
    if (!isOwnerOrMaster) {
      router.push('/')
      return
    }
    fetchAccounts()
    fetchMetaStatus()
  }, [session, isOwnerOrMaster, router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.FB) {
      setFbReady(true)
      return
    }
    window.fbAsyncInit = function () {
      window.FB?.init({
        appId: META_APP_ID || '',
        autoLogAppEvents: true,
        xfbml: true,
        version: META_GRAPH_API_VERSION,
      })
      setFbReady(true)
    }
    const script = document.createElement('script')
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.src = 'https://connect.facebook.net/es_LA/sdk.js'
    document.body.appendChild(script)
  }, [META_APP_ID, META_GRAPH_API_VERSION])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin === window.location.origin) {
        const data = event.data
        if (data?.type === 'ig_oauth_complete') {
          setConnectingInstagram(false)
          if (data.success) {
            setStatusMessage('Instagram conectado. Actualizando cuentas…')
            fetchAccounts()
            fetchMetaStatus()
          } else if (data.reason === 'no_pages') {
            setStatusMessage(
              'Meta no devolvió Páginas. Revisa el mensaje en la ventana emergente (admin de Página + IG Empresa).',
            )
          }
        }
        return
      }

      if (!String(event.origin).endsWith('facebook.com')) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          fetch('/api/auth/whatsapp/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: data }),
          })
            .then(async (res) => {
              const json = await res.json().catch(() => ({}))
              if (res.ok && json.success && json.account) {
                setStatusMessage('WhatsApp conectado correctamente.')
                fetchAccounts()
                fetchMetaStatus()
              }
            })
            .catch(() => {})
        }
      } catch {
        // ignore non-JSON SDK noise
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function launchWhatsAppEmbeddedSignup() {
    const FB = window.FB
    if (!FB || !FB_LOGIN_CONFIG_ID) {
      setStatusMessage(
        'Falta configuración de Embedded Signup. Verifica NEXT_PUBLIC_META_APP_ID y NEXT_PUBLIC_FB_LOGIN_CONFIG_ID.',
      )
      return
    }

    setConnectingWhatsApp(true)
    setStatusMessage('')

    FB.login(
      (response: any) => {
        const handleResponse = async () => {
          try {
            if (!response || response.status === 'unknown') {
              setStatusMessage('Conexión de WhatsApp cancelada.')
              return
            }
            if (response.error) {
              setStatusMessage(`Error de Facebook: ${response.error.message || 'desconocido'}`)
              return
            }

            const token = response?.authResponse?.accessToken
            const code = response?.authResponse?.code
            if (!token && !code) {
              setStatusMessage('No se recibió código de autorización de WhatsApp.')
              return
            }

            const exchangeRes = await fetch('/api/auth/whatsapp/exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: code || undefined,
                accessToken: token || undefined,
              }),
            })
            const exchangeData = await exchangeRes.json()

            if (!exchangeRes.ok || !exchangeData.success) {
              const errorMsg =
                exchangeData.exchangeError?.errorMessage ||
                exchangeData.message ||
                'Error al conectar WhatsApp'
              setStatusMessage(errorMsg)
              return
            }

            if (exchangeData.waitingForPhoneNumber) {
              setStatusMessage(
                'Token recibido. Completa el registro en la ventana de Meta para guardar el número.',
              )
              return
            }

            setStatusMessage('WhatsApp conectado. Ya aparece en cuentas vinculadas y en /chats.')
            fetchAccounts()
            fetchMetaStatus()
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error inesperado'
            setStatusMessage(message)
          } finally {
            setConnectingWhatsApp(false)
          }
        }
        void handleResponse()
      },
      {
        config_id: FB_LOGIN_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        auth_type: 'rerequest',
        return_scopes: true,
        extras: { setup: {} },
      },
    )
  }

  async function fetchMetaStatus() {
    try {
      const res = await fetch('/api/chat/meta-status')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo leer el estado de Meta')
      setMetaStatus(json)
      setMetaStatusError('')
    } catch (e: unknown) {
      setMetaStatusError(e instanceof Error ? e.message : 'No se pudo leer el estado de Meta')
    }
  }

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts')
      const json = await res.json()
      if (json.success) setAccounts(json.accounts)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al cargar cuentas sociales'
      setStatusMessage(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLinkInstagram() {
    setConnectingInstagram(true)
    setStatusMessage('')
    try {
      const res = await fetch('/api/auth/instagram/auth-url')
      if (!res.ok) throw new Error('No se pudo generar el enlace de Instagram')
      const { authUrl, loginForBusiness } = await res.json()

      const popup = window.open(authUrl, 'instagram_oauth', 'width=640,height=760')
      if (!popup) {
        setStatusMessage('El navegador bloqueó la ventana emergente. Permite popups e intenta de nuevo.')
        setConnectingInstagram(false)
        return
      }

      setStatusMessage(
        loginForBusiness
          ? 'Elige Página + Instagram Business en el selector de Meta…'
          : 'Autoriza Facebook y selecciona la Página con Instagram Business…',
      )

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed)
          setConnectingInstagram(false)
          fetchAccounts()
          fetchMetaStatus()
        }
      }, 1000)
    } catch (error) {
      console.error('Error launching Instagram OAuth:', error)
      setStatusMessage('Error al iniciar la conexión con Instagram')
      setConnectingInstagram(false)
    }
  }

  async function handleLinkWhatsApp(e: React.FormEvent) {
    e.preventDefault()
    setValidationError('')

    if (!accountId.trim()) {
      setValidationError('El Phone Number ID es requerido')
      return
    }
    if (!accessToken.trim()) {
      setValidationError('El Access Token es requerido')
      return
    }
    if (accountId.length < 10) {
      setValidationError('El Phone Number ID debe tener al menos 10 caracteres')
      return
    }

    setLinking(true)
    try {
      const res = await fetch('/api/social/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'whatsapp',
          accountId: accountId.trim(),
          whatsappBusinessAccountId: whatsappBusinessAccountId.trim() || undefined,
          accessToken: accessToken.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      setStatusMessage('WhatsApp vinculado manualmente.')
      setAccountId('')
      setWhatsappBusinessAccountId('')
      setAccessToken('')
      setValidationError('')
      fetchAccounts()
      fetchMetaStatus()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al vincular WhatsApp'
      setValidationError(message)
    } finally {
      setLinking(false)
    }
  }

  async function handleUnlinkAccount(id: string, platform: string) {
    if (
      !confirm(
        `¿Desvincular esta cuenta de ${platform}? Se eliminarán los mensajes asociados en el inbox.`,
      )
    ) {
      return
    }

    setUnlinking(id)
    try {
      const res = await fetch(`/api/social/unlink?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      setStatusMessage('Cuenta desvinculada.')
      fetchAccounts()
      fetchMetaStatus()
    } catch (e: unknown) {
      setStatusMessage(e instanceof Error ? e.message : 'Error al desvincular')
    } finally {
      setUnlinking(null)
    }
  }

  async function handleResubscribe(id: string) {
    setResubscribing(id)
    try {
      const res = await fetch('/api/social/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) {
        setStatusMessage(json?.message || json?.error || 'No se pudo re-suscribir')
      } else {
        setStatusMessage('Re-suscripción realizada.')
      }
    } catch (e: unknown) {
      setStatusMessage(e instanceof Error ? e.message : 'Error al re-suscribir')
    } finally {
      setResubscribing(null)
    }
  }

  if (!session) return null
  if (!isOwnerOrMaster) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No tienes permisos para configurar cuentas sociales.
      </div>
    )
  }

  const igAccounts = accounts.filter((a) => a.platform === 'instagram')
  const waAccounts = accounts.filter((a) => a.platform === 'whatsapp')

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cuentas sociales</h1>
        <p className="text-muted-foreground">
          Conecta Instagram Business y WhatsApp Business para el inbox de clientes en{' '}
          <a className="underline" href="/chats">
            /chats
          </a>
          .
        </p>
      </div>

      {statusMessage && (
        <div className="p-3 rounded-lg border bg-amber-50 border-amber-200 text-sm text-amber-900">
          {statusMessage}
        </div>
      )}

      <div className="border rounded-lg p-6 bg-card shadow-sm">
        <h2 className="text-lg font-semibold mb-1">Estado de Meta (inbox CRM)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Variables y URLs del inbox. El bot interno de WhatsApp es otro producto.
        </p>
        {metaStatusError ? (
          <p className="text-sm text-red-700">{metaStatusError}</p>
        ) : !metaStatus ? (
          <p className="text-sm text-muted-foreground">Revisando configuración…</p>
        ) : (
          <div className="space-y-4">
            {metaStatus.blockers.length > 0 ? (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                Faltan variables obligatorias: {metaStatus.blockers.join(', ')}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                Variables obligatorias del inbox presentes
                {metaStatus.env.inboxRequired.find((item) => item.key === 'META_WEBHOOK_VERIFY_TOKEN')
                  ?.set
                  ? ' (incluye META_WEBHOOK_VERIFY_TOKEN).'
                  : '.'}
              </div>
            )}
            {metaStatus.warnings.length > 0 && (
              <p className="text-sm text-amber-800">
                Recomendadas: {metaStatus.warnings.join(', ')}
              </p>
            )}
            <div className="grid gap-2 text-xs font-mono text-muted-foreground">
              <div>Webhook inbox: {metaStatus.urls.inboxWebhook}</div>
              <div>OAuth Instagram: {metaStatus.urls.instagramOAuthRedirect}</div>
              <div>Inbox: {metaStatus.urls.inbox || '/chats'}</div>
              <div>Bot interno (no inbox): {metaStatus.urls.staffBotWebhook}</div>
              <div>
                Cuentas vinculadas:{' '}
                {metaStatus.tenant.linkedAccounts.length === 0
                  ? 'ninguna'
                  : metaStatus.tenant.linkedAccounts
                      .map((row) => `${row.platform} (${row.count})`)
                      .join(', ')}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border rounded-lg p-6 bg-card shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Instagram Business</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Facebook Login for Business: elige la Página y el Instagram Empresa en el selector de
            Meta.
          </p>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
          <li>Usuario Facebook administrador de la Página</li>
          <li>Instagram Profesional → Empresa vinculado a esa Página</li>
          <li>En modo Development, el usuario debe ser admin/tester de la app Meta</li>
        </ul>
        <button
          onClick={handleLinkInstagram}
          disabled={connectingInstagram}
          className="w-full bg-zinc-900 text-white px-6 py-3 rounded-lg hover:bg-zinc-800 font-medium disabled:opacity-50"
        >
          {connectingInstagram ? 'Conectando Instagram…' : 'Conectar Instagram'}
        </button>
        {igAccounts.length > 0 && (
          <p className="text-sm text-green-700">
            {igAccounts.length} cuenta(s) de Instagram activa(s) en este tenant.
          </p>
        )}
      </div>

      <div className="border rounded-lg p-6 bg-card shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-semibold">WhatsApp Business</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Un solo paso con Embedded Signup de Meta. Guarda Phone Number ID y WABA en la cuenta
            social.
          </p>
        </div>
        <button
          onClick={launchWhatsAppEmbeddedSignup}
          disabled={!fbReady || !FB_LOGIN_CONFIG_ID || connectingWhatsApp}
          className="w-full bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {connectingWhatsApp
            ? 'Conectando WhatsApp…'
            : !FB_LOGIN_CONFIG_ID
              ? 'Falta NEXT_PUBLIC_FB_LOGIN_CONFIG_ID'
              : !fbReady
                ? 'Cargando Facebook SDK…'
                : 'Conectar WhatsApp'}
        </button>
        {waAccounts.length > 0 && (
          <p className="text-sm text-green-700">
            {waAccounts.length} número(s) de WhatsApp activo(s) en este tenant.
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowManualWhatsApp((value) => !value)}
          className="text-sm text-muted-foreground underline"
        >
          {showManualWhatsApp ? 'Ocultar vínculo manual' : 'Usar vínculo manual (avanzado)'}
        </button>

        {showManualWhatsApp && (
          <form onSubmit={handleLinkWhatsApp} className="space-y-4 pt-2 border-t">
            <div>
              <label htmlFor="accountId" className="block text-sm font-semibold mb-2">
                Phone Number ID
              </label>
              <input
                id="accountId"
                type="text"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value)
                  setValidationError('')
                }}
                className="border border-border rounded-lg px-4 py-3 w-full"
                placeholder="Phone Number ID de Meta"
                disabled={linking}
              />
            </div>
            <div>
              <label htmlFor="whatsappBusinessAccountId" className="block text-sm font-semibold mb-2">
                WhatsApp Business Account ID
              </label>
              <input
                id="whatsappBusinessAccountId"
                type="text"
                value={whatsappBusinessAccountId}
                onChange={(e) => setWhatsappBusinessAccountId(e.target.value)}
                className="border border-border rounded-lg px-4 py-3 w-full"
                placeholder="WABA ID"
                disabled={linking}
              />
            </div>
            <div>
              <label htmlFor="accessToken" className="block text-sm font-semibold mb-2">
                Access Token
              </label>
              <input
                id="accessToken"
                type="password"
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value)
                  setValidationError('')
                }}
                className="border border-border rounded-lg px-4 py-3 w-full font-mono text-sm"
                placeholder="Token permanente de System User"
                disabled={linking}
              />
            </div>
            {validationError && <p className="text-sm text-red-700">{validationError}</p>}
            <button
              type="submit"
              disabled={linking}
              className="w-full border border-border px-6 py-3 rounded-lg font-medium disabled:opacity-50"
            >
              {linking ? 'Vinculando…' : 'Vincular manualmente'}
            </button>
          </form>
        )}
      </div>

      <div className="border rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Cuentas vinculadas</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Estas cuentas alimentan el inbox en /chats.
        </p>
        {loading ? (
          <div className="text-muted-foreground">Cargando...</div>
        ) : accounts.length === 0 ? (
          <div className="text-muted-foreground">No hay cuentas vinculadas aún.</div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border rounded-lg bg-card"
              >
                <div>
                  <div className="font-semibold capitalize text-lg">{acc.platform}</div>
                  <div className="text-sm text-muted-foreground">
                    {acc.platform === 'whatsapp'
                      ? `Phone Number ID: ${acc.phoneNumberId || acc.accountId}`
                      : `IG Business ID: ${acc.accountId}`}
                  </div>
                  {acc.platform === 'whatsapp' && acc.whatsappBusinessAccountId && (
                    <div className="text-xs text-muted-foreground">
                      WABA: {acc.whatsappBusinessAccountId}
                    </div>
                  )}
                  {acc.platform === 'instagram' && acc.pageId && (
                    <div className="text-xs text-muted-foreground">Page ID: {acc.pageId}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Vinculada: {new Date(acc.linkedAt).toLocaleDateString('es')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div
                    className={`text-xs px-3 py-1 rounded-full font-medium ${
                      acc.isActive ? 'bg-green-100 text-green-800' : 'bg-muted text-foreground'
                    }`}
                  >
                    {acc.isActive ? 'Activa' : 'Inactiva'}
                  </div>
                  <button
                    onClick={() => handleResubscribe(acc.id)}
                    disabled={resubscribing === acc.id}
                    className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg disabled:opacity-50"
                  >
                    {resubscribing === acc.id ? 'Re-suscribiendo…' : 'Re-suscribir'}
                  </button>
                  <button
                    onClick={() => handleUnlinkAccount(acc.id, acc.platform)}
                    disabled={unlinking === acc.id}
                    className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-lg disabled:opacity-50"
                  >
                    {unlinking === acc.id ? 'Desvinculando…' : 'Desvincular'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
