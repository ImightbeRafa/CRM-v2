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
  const [accountSearch, setAccountSearch] = useState('')
  const [subscribeFailToast, setSubscribeFailToast] = useState('')

  const META_WA_APP_ID =
    (process.env.NEXT_PUBLIC_META_WA_APP_ID as string | undefined) ||
    (process.env.NEXT_PUBLIC_META_APP_ID as string | undefined)
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
        appId: META_WA_APP_ID || '',
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
  }, [META_WA_APP_ID, META_GRAPH_API_VERSION])

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
              if (res.ok && json.success && json.subscribed !== false && json.account) {
                setStatusMessage('WhatsApp conectado y suscrito a webhooks.')
                fetchAccounts()
                fetchMetaStatus()
                return
              }
              if (json.waitingForPhoneNumber) {
                setStatusMessage(
                  'Token recibido. Completa el registro en la ventana de Meta para guardar el número.',
                )
                return
              }
              const errorMsg =
                json.message ||
                json.error ||
                json.exchangeError?.errorMessage ||
                'No se pudo conectar WhatsApp (revisa suscripción a webhooks).'
              setStatusMessage(errorMsg)
              if (json.subscribed === false || /suscri/i.test(errorMsg)) {
                setSubscribeFailToast(
                  'No se pudo suscribir el webhook. La cuenta NO está conectada de verdad.',
                )
              }
              if (json.account) {
                fetchAccounts()
                fetchMetaStatus()
              }
            })
            .catch(() => {
              setStatusMessage('Error de red al conectar WhatsApp.')
            })
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
        'Falta configuración de Embedded Signup. Verifica NEXT_PUBLIC_META_WA_APP_ID (o NEXT_PUBLIC_META_APP_ID) y NEXT_PUBLIC_FB_LOGIN_CONFIG_ID.',
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

            if (!exchangeRes.ok || !exchangeData.success || exchangeData.subscribed === false) {
              const errorMsg =
                exchangeData.message ||
                exchangeData.exchangeError?.errorMessage ||
                exchangeData.error ||
                'Error al conectar WhatsApp'
              setStatusMessage(errorMsg)
              if (exchangeData.subscribed === false || /suscri/i.test(errorMsg)) {
                setSubscribeFailToast(
                  'No se pudo suscribir el webhook. La cuenta NO está conectada de verdad.',
                )
              }
              if (exchangeData.account) {
                fetchAccounts()
                fetchMetaStatus()
              }
              return
            }

            if (exchangeData.waitingForPhoneNumber) {
              setStatusMessage(
                'Token recibido. Completa el registro en la ventana de Meta para guardar el número.',
              )
              return
            }

            setStatusMessage('WhatsApp conectado y suscrito a webhooks. Ya aparece en /chats.')
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
      const res = await fetch('/api/chat/accounts?includeInactive=1')
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
      if (!res.ok || !json.success || json.subscribed === false) {
        if (json.account) {
          fetchAccounts()
          fetchMetaStatus()
        }
        if (json.subscribed === false) {
          setSubscribeFailToast(
            'No se pudo suscribir el webhook. La cuenta NO está conectada de verdad.',
          )
        }
        throw new Error(
          json.message ||
            json.error ||
            'WhatsApp no quedó suscrito a webhooks. Revisa el token o usa Re-suscribir.',
        )
      }
      setStatusMessage('WhatsApp vinculado y suscrito a webhooks.')
      setAccountId('')
      setWhatsappBusinessAccountId('')
      setAccessToken('')
      setValidationError('')
      fetchAccounts()
      fetchMetaStatus()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Error al vincular WhatsApp'
      setValidationError(message)
      setStatusMessage(message)
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
        setSubscribeFailToast(
          'No se pudo suscribir el webhook. La cuenta NO está conectada de verdad.',
        )
      } else {
        setStatusMessage('Re-suscripción realizada. La cuenta quedó activa para /chats.')
        setSubscribeFailToast('')
        fetchAccounts()
        fetchMetaStatus()
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
  const q = accountSearch.trim().toLowerCase()
  const igVisible = q
    ? igAccounts.filter((a) => a.accountId.toLowerCase().includes(q))
    : igAccounts
  const waVisible = q
    ? waAccounts.filter(
        (a) =>
          a.accountId.toLowerCase().includes(q) ||
          (a.phoneNumberId || '').toLowerCase().includes(q) ||
          (a.whatsappBusinessAccountId || '').toLowerCase().includes(q),
      )
    : waAccounts

  function accountRowLabel(acc: SocialAccount) {
    if (acc.platform === 'instagram') {
      const handle = acc.accountId.startsWith('@') ? acc.accountId : `@${acc.accountId}`
      return handle
    }
    const phone = acc.phoneNumberId || acc.accountId
    const short = phone.length > 10 ? `${phone.slice(0, 4)}…${phone.slice(-4)}` : phone
    return `WA ${short}`
  }

  function confirmAddAnother(platform: 'instagram' | 'whatsapp', existingCount: number): boolean {
    if (existingCount <= 0) return true
    const label = platform === 'instagram' ? 'Instagram' : 'WhatsApp'
    return confirm(
      `Ya tenés ${existingCount} cuenta${existingCount === 1 ? '' : 's'} de ${label} conectada${existingCount === 1 ? '' : 's'}.\n\n` +
        `¿Agregar otra ${label}?\n\n` +
        `• Un ID distinto se suma como cuenta nueva.\n` +
        `• El mismo ID se actualiza (no duplica).`,
    )
  }

  async function handleAddInstagram() {
    if (!confirmAddAnother('instagram', igAccounts.length)) return
    await handleLinkInstagram()
  }

  function handleAddWhatsApp() {
    if (!confirmAddAnother('whatsapp', waAccounts.length)) return
    launchWhatsAppEmbeddedSignup()
  }

  return (
    <div className="min-h-[100dvh] bg-[#dde7f5] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[20px] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900">Canales conectados</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Multi IG + multi WA. Podés agregar otra cuenta sin reemplazar las ya conectadas.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Inbox de clientes en{' '}
              <a className="text-[#5b6cff] underline" href="/chats">
                /chats
              </a>
              . El bot staff NO aparece aquí.
            </p>
          </div>
          <label className="block w-full sm:max-w-xs">
            <span className="sr-only">Buscar cuenta</span>
            <input
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Buscar cuenta…  ⌘K"
              className="w-full rounded-[10px] border-0 bg-slate-50 px-3 py-2.5 text-xs text-slate-800 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5b6cff]/30"
            />
          </label>
        </div>

        {statusMessage && !subscribeFailToast ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            {statusMessage}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Instagram card */}
          <section className="rounded-2xl bg-[#fafbfd] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 text-sm font-semibold text-pink-800">
                IG
              </div>
              <h2 className="text-base font-semibold text-slate-900">Instagram</h2>
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <p className="text-sm text-slate-400">Cargando…</p>
              ) : igVisible.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500">
                  Ninguna cuenta de Instagram todavía. Conectá la primera para empezar.
                </p>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-slate-500">
                    {igAccounts.length} conectada{igAccounts.length === 1 ? '' : 's'} · podés sumar otra
                  </p>
                  {igVisible.map((acc) => (
                  <div
                    key={acc.id}
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      acc.isActive ? 'bg-white' : 'bg-red-50'
                    }`}
                  >
                    <p
                      className={`text-[13px] font-medium ${
                        acc.isActive ? 'text-green-800' : 'text-red-700'
                      }`}
                    >
                      {accountRowLabel(acc)} ·{' '}
                      {acc.isActive ? 'Conectado' : 'Error: no suscrito'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {!acc.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleResubscribe(acc.id)}
                          disabled={resubscribing === acc.id}
                          className="text-xs font-medium text-[#5b6cff] disabled:opacity-50"
                        >
                          {resubscribing === acc.id ? 'Re-suscribiendo…' : 'Re-suscribir'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleUnlinkAccount(acc.id, acc.platform)}
                        disabled={unlinking === acc.id}
                        className="text-xs font-medium text-red-600 disabled:opacity-50"
                      >
                        {unlinking === acc.id ? '…' : 'Desvincular'}
                      </button>
                    </div>
                  </div>
                ))}
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                void handleAddInstagram()
              }}
              disabled={connectingInstagram}
              className="mt-5 rounded-[10px] bg-[#5b6cff] px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {connectingInstagram
                ? 'Conectando…'
                : igAccounts.length > 0
                  ? '+ Agregar otra Instagram'
                  : '+ Conectar Instagram'}
            </button>
            {igAccounts.length > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Misma cuenta IG = actualizar. Otra Página/IG = se suma al inbox.
              </p>
            ) : null}
          </section>

          {/* WhatsApp card */}
          <section className="rounded-2xl bg-[#fafbfd] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-sm font-semibold text-green-800">
                WA
              </div>
              <h2 className="text-base font-semibold text-slate-900">WhatsApp</h2>
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <p className="text-sm text-slate-400">Cargando…</p>
              ) : waVisible.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500">
                  Ningún número de WhatsApp todavía. Conectá el primero para el inbox.
                </p>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-slate-500">
                    {waAccounts.length} número{waAccounts.length === 1 ? '' : 's'} · podés sumar otro
                  </p>
                  {waVisible.map((acc) => (
                  <div
                    key={acc.id}
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      acc.isActive ? 'bg-white' : 'bg-red-50'
                    }`}
                  >
                    <p
                      className={`text-[13px] font-medium ${
                        acc.isActive ? 'text-green-800' : 'text-red-700'
                      }`}
                    >
                      {accountRowLabel(acc)}
                      {acc.whatsappBusinessAccountId
                        ? ` · WABA …${acc.whatsappBusinessAccountId.slice(-4)}`
                        : ''}{' '}
                      · {acc.isActive ? 'Conectado' : 'Error: no suscrito'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {!acc.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleResubscribe(acc.id)}
                          disabled={resubscribing === acc.id}
                          className="text-xs font-medium text-[#5b6cff] disabled:opacity-50"
                        >
                          {resubscribing === acc.id ? 'Re-suscribiendo…' : 'Re-suscribir'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleUnlinkAccount(acc.id, acc.platform)}
                        disabled={unlinking === acc.id}
                        className="text-xs font-medium text-red-600 disabled:opacity-50"
                      >
                        {unlinking === acc.id ? '…' : 'Desvincular'}
                      </button>
                    </div>
                  </div>
                ))}
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleAddWhatsApp}
              disabled={!fbReady || !FB_LOGIN_CONFIG_ID || connectingWhatsApp}
              className="mt-5 rounded-[10px] bg-[#5b6cff] px-4 py-2.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connectingWhatsApp
                ? 'Conectando…'
                : !FB_LOGIN_CONFIG_ID
                  ? 'Falta FB_LOGIN_CONFIG_ID'
                  : !fbReady
                    ? 'Cargando SDK…'
                    : waAccounts.length > 0
                      ? '+ Agregar otro WhatsApp'
                      : '+ Conectar WhatsApp'}
            </button>
            {waAccounts.length > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">
                Mismo Phone Number ID = actualizar. Otro número = se suma al inbox.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => setShowManualWhatsApp((value) => !value)}
              className="mt-3 block text-xs text-slate-500 underline"
            >
              {showManualWhatsApp ? 'Ocultar vínculo manual' : 'Usar vínculo manual (avanzado)'}
            </button>

            {showManualWhatsApp ? (
              <form onSubmit={handleLinkWhatsApp} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                <input
                  id="accountId"
                  type="text"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value)
                    setValidationError('')
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Phone Number ID"
                  disabled={linking}
                />
                <input
                  id="whatsappBusinessAccountId"
                  type="text"
                  value={whatsappBusinessAccountId}
                  onChange={(e) => setWhatsappBusinessAccountId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="WABA ID"
                  disabled={linking}
                />
                <input
                  id="accessToken"
                  type="password"
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value)
                    setValidationError('')
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  placeholder="Access Token"
                  disabled={linking}
                />
                {validationError ? <p className="text-sm text-red-700">{validationError}</p> : null}
                <button
                  type="submit"
                  disabled={linking}
                  className="w-full rounded-lg border border-slate-200 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {linking ? 'Vinculando…' : 'Vincular manualmente'}
                </button>
              </form>
            ) : null}
          </section>
        </div>

        {subscribeFailToast ? (
          <div
            role="alert"
            className="mt-5 rounded-xl bg-red-50 px-4 py-3.5 text-[13px] text-red-800"
          >
            {subscribeFailToast}
            <button
              type="button"
              className="ml-3 text-xs underline"
              onClick={() => setSubscribeFailToast('')}
            >
              Cerrar
            </button>
          </div>
        ) : null}

        <p className="mt-5 text-[12px] text-[#5b6cff]">
          ✦ Tip: “Agregar otra/otro” suma un canal al inbox. OAuth verifica subscribed_apps antes de
          marcar Conectado.
        </p>

        {/* Collapsible Meta diagnostics */}
        <details className="mt-6 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Estado de Meta (diagnóstico inbox)
          </summary>
          <div className="mt-3 space-y-3">
            {metaStatusError ? (
              <p className="text-sm text-red-700">{metaStatusError}</p>
            ) : !metaStatus ? (
              <p className="text-sm text-slate-500">Revisando configuración…</p>
            ) : (
              <>
                {metaStatus.blockers.length > 0 ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                    Faltan: {metaStatus.blockers.join(', ')}
                  </div>
                ) : (
                  <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                    Variables obligatorias del inbox presentes.
                  </div>
                )}
                <div className="grid gap-1 font-mono text-[11px] text-slate-500">
                  <div>Webhook inbox: {metaStatus.urls.inboxWebhook}</div>
                  <div>OAuth IG: {metaStatus.urls.instagramOAuthRedirect}</div>
                  <div>Bot interno (no inbox): {metaStatus.urls.staffBotWebhook}</div>
                </div>
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
