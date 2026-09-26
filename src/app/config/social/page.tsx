'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  buildWhatsAppEmbeddedSignupLoginOptions,
  extractWaEmbeddedSignupAssets,
  isFbSdkEmbeddedSignup36008,
  isWaEmbeddedSignupFinishEvent,
  isWaEmbeddedSignupMessage,
  parseWaDirectOauthMessage,
  shouldIgnoreWaSessionEvent,
  waSignupReadyToExchange,
  type WaEmbeddedSignupMessage,
} from '@/lib/whatsapp-embedded-signup'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import {
  formatInstagramHandle,
  resolveChannelDisplayName,
} from '@/lib/social-account-identity'
import {
  accountNeedsReconnect,
  socialReconnectBannerLabel,
} from '@/lib/social-account-token-health'
import { hasSessionPermission } from '@/lib/session-permissions'

interface SocialAccount {
  id: string
  platform: string
  accountId: string
  linkedAt: string
  isActive: boolean
  phoneNumberId?: string | null
  whatsappBusinessAccountId?: string | null
  pageId?: string | null
  displayName?: string | null
  providerDisplayName?: string | null
  providerUsername?: string | null
  displayPhoneNumber?: string | null
  logoKey?: 'whatsapp' | 'instagram'
  tokenStatus?: string | null
  wabaId?: string | null
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const waSignupPendingRef = useRef<{
    code?: string | null
    accessToken?: string | null
    message?: WaEmbeddedSignupMessage | null
    exchanging?: boolean
    /** Set when FINISH arrives while an exchange is in flight — retry after. */
    retryAfter?: boolean
  }>({})
  const tryExchangeWhatsAppSignupRef = useRef<() => Promise<void>>(async () => {})

  const META_WA_APP_ID =
    (process.env.NEXT_PUBLIC_META_WA_APP_ID as string | undefined) ||
    (process.env.NEXT_PUBLIC_META_APP_ID as string | undefined)
  const FB_LOGIN_CONFIG_ID = process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID as string | undefined
  const META_GRAPH_API_VERSION =
    (process.env.NEXT_PUBLIC_META_GRAPH_API_VERSION as string | undefined) || 'v24.0'

  const canManageSocial = hasSessionPermission(session, 'update_config')

  async function applyWhatsAppExchangeResult(res: Response, json: any) {
    if (res.ok && json.success && json.subscribed !== false && json.account) {
      setStatusMessage(
        json.message ||
          (json.coexistence
            ? 'WhatsApp Business App conectado (coexistence). Sincronizando… Dejá la app abierta.'
            : 'WhatsApp conectado y suscrito a webhooks.'),
      )
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
    if (json.cancelled) {
      setStatusMessage('Conexión de WhatsApp cancelada en Meta.')
      return
    }
    const graphDetail =
      typeof json.exchangeError === 'object' && json.exchangeError?.errorMessage
        ? String(json.exchangeError.errorMessage)
        : ''
    const errorMsg =
      (json.message && graphDetail && !String(json.message).includes(graphDetail)
        ? `${json.message} (${graphDetail})`
        : null) ||
      json.message ||
      json.error ||
      graphDetail ||
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
  }

  async function tryExchangeWhatsAppSignup() {
    const pending = waSignupPendingRef.current
    if (pending.exchanging) {
      // FINISH (or a second callback) arrived while Graph exchange is in flight.
      // Remember to retry once the in-flight call finishes — otherwise a single-use
      // code can be burned on waitingForPhoneNumber and never correlated with assets.
      pending.retryAfter = true
      return
    }

    // Single-use codes are never spent until FINISH phone/WABA assets exist.
    if (!waSignupReadyToExchange(pending)) return

    pending.exchanging = true
    pending.retryAfter = false
    setConnectingWhatsApp(true)
    try {
      const exchangeRes = await fetch('/api/auth/whatsapp/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: pending.code || undefined,
          accessToken: pending.accessToken || undefined,
          message: pending.message || undefined,
        }),
      })
      const exchangeData = await exchangeRes.json().catch(() => ({}))

      // A ready exchange (assets present) can still hit waitingForPhoneNumber when
      // Graph has no phone yet. The code is burned server-side, so keep the returned
      // business token for a later FINISH payload.
      if (
        exchangeData.waitingForPhoneNumber &&
        typeof exchangeData.accessToken === 'string' &&
        exchangeData.accessToken
      ) {
        pending.accessToken = exchangeData.accessToken
        pending.code = null
      }

      if (exchangeData.waitingForPhoneNumber) {
        // Keep pending credentials; another FINISH payload may still arrive.
        await applyWhatsAppExchangeResult(exchangeRes, exchangeData)
        return
      }

      // Clear pending after a decisive response (success or hard failure).
      if (!exchangeData.waitingForPhoneNumber) {
        waSignupPendingRef.current = {}
      }
      await applyWhatsAppExchangeResult(exchangeRes, exchangeData)
    } catch {
      setStatusMessage('Error de red al conectar WhatsApp.')
    } finally {
      pending.exchanging = false
      const again = waSignupPendingRef.current
      const canRetry = Boolean(again.retryAfter) && waSignupReadyToExchange(again)
      again.retryAfter = false
      if (canRetry) {
        void tryExchangeWhatsAppSignupRef.current()
        return
      }
      setConnectingWhatsApp(false)
    }
  }
  tryExchangeWhatsAppSignupRef.current = tryExchangeWhatsAppSignup

  useEffect(() => {
    if (!session) return
    if (!canManageSocial) {
      router.push('/')
      return
    }
    fetchAccounts()
    fetchMetaStatus()
  }, [session, canManageSocial, router])

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
        } else {
          const direct = parseWaDirectOauthMessage(data)
          if (direct) {
            if (!direct.ok || direct.error) {
              setConnectingWhatsApp(false)
              setStatusMessage(
                direct.error
                  ? `Error de WhatsApp OAuth: ${direct.error}`
                  : 'La conexión de WhatsApp fue cancelada.',
              )
              setShowManualWhatsApp(true)
              return
            }
            const code = direct.code.trim()
            if (!code) {
              setConnectingWhatsApp(false)
              setStatusMessage(
                'No se recibió código de autorización de WhatsApp. Usá el vínculo manual.',
              )
              setShowManualWhatsApp(true)
              return
            }
            waSignupPendingRef.current.code = code
            // Never spend the single-use code until FINISH phone/WABA assets exist;
            // current() no-ops via waSignupReadyToExchange when assets are missing.
            void tryExchangeWhatsAppSignupRef.current()
          }
        }
        return
      }

      if (!String(event.origin).endsWith('facebook.com')) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (!isWaEmbeddedSignupMessage(data)) return

        if (shouldIgnoreWaSessionEvent(data.event)) {
          setConnectingWhatsApp(false)
          setStatusMessage('Conexión de WhatsApp cancelada en Meta.')
          waSignupPendingRef.current = {}
          return
        }

        // Ignore intermediate session steps; only FINISH* carries assets.
        if (data.event && !isWaEmbeddedSignupFinishEvent(data.event)) {
          return
        }

        waSignupPendingRef.current.message = data as WaEmbeddedSignupMessage
        void tryExchangeWhatsAppSignupRef.current()
      } catch {
        // ignore non-JSON SDK noise
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function launchWhatsAppDirectOauthFallback() {
    setConnectingWhatsApp(true)
    setStatusMessage('FB.login no pudo abrir Embedded Signup. Probando el flujo directo…')
    waSignupPendingRef.current = {}
    try {
      const res = await fetch('/api/auth/whatsapp/direct-oauth', { credentials: 'same-origin' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.oauthUrl) {
        setStatusMessage(
          json.error ||
            json.details ||
            'No se pudo iniciar el OAuth directo de WhatsApp. Usá el vínculo manual.',
        )
        setShowManualWhatsApp(true)
        setConnectingWhatsApp(false)
        return
      }

      const popup = window.open(String(json.oauthUrl), 'whatsapp_direct_oauth', 'width=640,height=760')
      if (!popup) {
        setStatusMessage(
          'El navegador bloqueó la ventana emergente. Permite popups e intenta de nuevo.',
        )
        setConnectingWhatsApp(false)
        return
      }

      const checkClosed = window.setInterval(() => {
        if (!popup.closed) return
        window.clearInterval(checkClosed)
        const pending = waSignupPendingRef.current
        if (pending.exchanging) return
        const assets = extractWaEmbeddedSignupAssets(pending.message || undefined)
        if (assets.phoneNumberId || assets.wabaId) return
        if (pending.code) {
          setStatusMessage(
            'Completá el registro en la ventana de Meta, o vinculá el número manualmente. No se intercambia el código sin WABA/teléfono.',
          )
          setShowManualWhatsApp(true)
        }
        setConnectingWhatsApp(false)
      }, 1000)
    } catch {
      setStatusMessage('Error al iniciar el OAuth directo de WhatsApp.')
      setConnectingWhatsApp(false)
    }
  }

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
    waSignupPendingRef.current = {}

    FB.login(
      (response: any) => {
        const handleResponse = async () => {
          try {
            if (isFbSdkEmbeddedSignup36008(response?.error) || isFbSdkEmbeddedSignup36008(response)) {
              await launchWhatsAppDirectOauthFallback()
              return
            }
            if (!response || response.status === 'unknown') {
              setStatusMessage('Conexión de WhatsApp cancelada.')
              setConnectingWhatsApp(false)
              waSignupPendingRef.current = {}
              return
            }
            if (response.error) {
              setStatusMessage(`Error de Facebook: ${response.error.message || 'desconocido'}`)
              setConnectingWhatsApp(false)
              return
            }

            const token = response?.authResponse?.accessToken
            const code = response?.authResponse?.code
            if (!token && !code) {
              setStatusMessage('No se recibió código de autorización de WhatsApp.')
              setConnectingWhatsApp(false)
              return
            }

            waSignupPendingRef.current.code = code || null
            waSignupPendingRef.current.accessToken = token || null

            // Never spend a single-use Embedded Signup code until FINISH assets exist.
            // A late WA_EMBEDDED_SIGNUP message triggers the exchange from onMessage.
            if (waSignupReadyToExchange(waSignupPendingRef.current)) {
              await tryExchangeWhatsAppSignup()
              return
            }

            setStatusMessage(
              'Esperando confirmación de Meta (número o WABA). Completá el registro en la ventana…',
            )
            // Settle the spinner; a late FINISH message re-arms it via tryExchange.
            setConnectingWhatsApp(false)
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Error inesperado'
            setStatusMessage(message)
            setConnectingWhatsApp(false)
          }
        }
        void handleResponse()
      },
      buildWhatsAppEmbeddedSignupLoginOptions(FB_LOGIN_CONFIG_ID),
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
        `¿Desvincular esta cuenta de ${platform}? El historial de conversaciones se conserva; solo se deja de recibir y enviar mensajes hasta que la reconectes.`,
      )
    ) {
      return
    }

    setUnlinking(id)
    try {
      const res = await fetch(`/api/social/unlink?id=${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error desconocido')
      setStatusMessage('Cuenta desvinculada. El historial se mantiene.')
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
  if (!canManageSocial) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No tienes permisos para configurar cuentas sociales.
      </div>
    )
  }

  const reconnectBanners = accounts.filter(accountNeedsReconnect)

  const igAccounts = accounts.filter((a) => a.platform === 'instagram')
  const waAccounts = accounts.filter((a) => a.platform === 'whatsapp')
  const q = accountSearch.trim().toLowerCase()
  const igVisible = q
    ? igAccounts.filter(
        (a) =>
          a.accountId.toLowerCase().includes(q) ||
          (a.displayName || '').toLowerCase().includes(q) ||
          (a.providerUsername || '').toLowerCase().includes(q) ||
          (a.providerDisplayName || '').toLowerCase().includes(q),
      )
    : igAccounts
  const waVisible = q
    ? waAccounts.filter(
        (a) =>
          a.accountId.toLowerCase().includes(q) ||
          (a.phoneNumberId || '').toLowerCase().includes(q) ||
          (a.whatsappBusinessAccountId || '').toLowerCase().includes(q) ||
          (a.displayName || '').toLowerCase().includes(q) ||
          (a.displayPhoneNumber || '').toLowerCase().includes(q) ||
          (a.providerDisplayName || '').toLowerCase().includes(q),
      )
    : waAccounts

  function accountResolvedName(acc: SocialAccount) {
    return resolveChannelDisplayName({
      id: acc.id,
      platform: acc.platform,
      accountId: acc.accountId,
      displayName: acc.displayName,
      providerDisplayName: acc.providerDisplayName,
      providerUsername: acc.providerUsername,
      displayPhoneNumber: acc.displayPhoneNumber,
      phoneNumberId: acc.phoneNumberId,
    })
  }

  function accountSecondaryLine(acc: SocialAccount): string {
    if (acc.platform === 'instagram') {
      const handle = formatInstagramHandle(acc.providerUsername)
      const meta = acc.providerDisplayName?.trim()
      return [handle, meta ? `Meta: ${meta}` : null].filter(Boolean).join(' · ')
    }
    const phone = acc.displayPhoneNumber?.trim()
    const meta = acc.providerDisplayName?.trim()
    return [phone, meta ? `Meta: ${meta}` : null].filter(Boolean).join(' · ')
  }

  function healthLabel(acc: SocialAccount): string {
    if (!acc.isActive) return 'Error: no suscrito'
    const status = (acc.tokenStatus || 'unknown').toLowerCase()
    if (status === 'valid') return 'Saludable'
    if (status === 'expiring') return 'Token por vencer'
    if (status === 'expired' || status === 'revoked') return 'Reconectar'
    if (status === 'error') return 'Error de token'
    return 'Conectado'
  }

  function startRename(acc: SocialAccount) {
    setRenamingId(acc.id)
    setRenameDraft(accountResolvedName(acc))
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameDraft('')
  }

  async function saveRename(acc: SocialAccount) {
    setRenamingBusy(true)
    try {
      const res = await fetch(`/api/chat/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: renameDraft }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatusMessage(json.error || 'No se pudo renombrar la cuenta.')
        return
      }
      setStatusMessage('Nombre actualizado.')
      cancelRename()
      fetchAccounts()
    } catch {
      setStatusMessage('No se pudo renombrar la cuenta.')
    } finally {
      setRenamingBusy(false)
    }
  }

  function duplicateNameWarning(acc: SocialAccount): boolean {
    const name = accountResolvedName(acc).toLowerCase()
    return accounts.some(
      (other) => other.id !== acc.id && accountResolvedName(other).toLowerCase() === name,
    )
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

        {reconnectBanners.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2" data-testid="social-token-reconnect-banners">
            {reconnectBanners.map((acc) => (
              <div
                key={acc.id}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                role="status"
              >
                {socialReconnectBannerLabel({
                  id: acc.id,
                  platform: acc.platform,
                  accountId: acc.accountId,
                  tokenStatus: acc.tokenStatus,
                  displayName: acc.displayName,
                  providerDisplayName: acc.providerDisplayName,
                  providerUsername: acc.providerUsername,
                  displayPhoneNumber: acc.displayPhoneNumber,
                })}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Instagram card */}
          <section className="rounded-2xl bg-[#fafbfd] p-5">
            <div className="flex items-center gap-3">
              <ChannelLogo platform="instagram" size={20} colorful className="shrink-0" />
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
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${
                      acc.isActive ? 'bg-white' : 'bg-red-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ChannelLogo platform="instagram" size={16} className="shrink-0" />
                        {renamingId === acc.id ? (
                          <input
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            maxLength={40}
                            className="w-full max-w-xs rounded-md bg-slate-50 px-2 py-1 text-[13px] text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#5b6cff]/30"
                            aria-label="Nuevo nombre del canal"
                          />
                        ) : (
                          <p
                            className={`truncate text-[13px] font-semibold ${
                              acc.isActive ? 'text-slate-900' : 'text-red-700'
                            }`}
                          >
                            {accountResolvedName(acc)}
                          </p>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {accountSecondaryLine(acc) || 'Sin handle todavía'}
                        {' · '}
                        {healthLabel(acc)}
                      </p>
                      {duplicateNameWarning(acc) ? (
                        <p className="mt-0.5 text-[10px] text-amber-700">
                          Nombre duplicado — podés distinguirlas renombrando.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {renamingId === acc.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void saveRename(acc)}
                            disabled={renamingBusy}
                            className="text-xs font-medium text-[#5b6cff] disabled:opacity-50"
                          >
                            {renamingBusy ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            disabled={renamingBusy}
                            className="text-xs font-medium text-slate-500 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(acc)}
                          className="text-xs font-medium text-slate-600"
                        >
                          Renombrar
                        </button>
                      )}
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
              <ChannelLogo platform="whatsapp" size={20} className="shrink-0" />
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
                    className={`flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${
                      acc.isActive ? 'bg-white' : 'bg-red-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ChannelLogo platform="whatsapp" size={16} className="shrink-0" />
                        {renamingId === acc.id ? (
                          <input
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            maxLength={40}
                            className="w-full max-w-xs rounded-md bg-slate-50 px-2 py-1 text-[13px] text-slate-900 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#5b6cff]/30"
                            aria-label="Nuevo nombre del canal"
                          />
                        ) : (
                          <p
                            className={`truncate text-[13px] font-semibold ${
                              acc.isActive ? 'text-slate-900' : 'text-red-700'
                            }`}
                          >
                            {accountResolvedName(acc)}
                          </p>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {accountSecondaryLine(acc) ||
                          (acc.whatsappBusinessAccountId
                            ? `WABA …${acc.whatsappBusinessAccountId.slice(-4)}`
                            : 'Sin teléfono todavía')}
                        {' · '}
                        {healthLabel(acc)}
                      </p>
                      {duplicateNameWarning(acc) ? (
                        <p className="mt-0.5 text-[10px] text-amber-700">
                          Nombre duplicado — podés distinguirlas renombrando.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {renamingId === acc.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void saveRename(acc)}
                            disabled={renamingBusy}
                            className="text-xs font-medium text-[#5b6cff] disabled:opacity-50"
                          >
                            {renamingBusy ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            disabled={renamingBusy}
                            className="text-xs font-medium text-slate-500 disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startRename(acc)}
                          className="text-xs font-medium text-slate-600"
                        >
                          Renombrar
                        </button>
                      )}
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
                  ? waAccounts.length > 0
                    ? '+ Agregar otro WA (falta config)'
                    : '+ Conectar WA (falta config)'
                  : !fbReady
                    ? 'Cargando SDK…'
                    : waAccounts.length > 0
                      ? '+ Agregar otro WhatsApp'
                      : '+ Conectar WhatsApp'}
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              Números ya activos en la app WhatsApp Business usan{' '}
              <span className="font-medium text-slate-700">coexistence</span> (Embedded Signup).
              Requiere WhatsApp Business app 2.24.17+. Si Meta dice “No cumple los requisitos”, el
              número no admitía partner-share clásico — este flujo es el correcto.
            </p>
            {waAccounts.length > 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">
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
