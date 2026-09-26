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
  type WaEmbeddedSignupMessage,
} from '@/lib/whatsapp-embedded-signup'
import { Plus, Search } from 'lucide-react'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import {
  formatInstagramHandle,
  resolveChannelDisplayName,
} from '@/lib/social-account-identity'
import { hasSessionPermission } from '@/lib/session-permissions'
import type { SocialAccount } from './types'
import {
  classifyChannelHealth,
  filterByTab,
  isOwnerChannel,
  summarizeChannels,
  type ChannelTab,
} from './channel-health'
import { ChannelsAlertBanner } from './components/ChannelsAlertBanner'
import { ChannelsTable } from './components/ChannelsTable'
import { ChannelSummaryCards } from './components/ChannelSummaryCards'

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
  const [activeTab, setActiveTab] = useState<ChannelTab>('all')
  const [diagOpen, setDiagOpen] = useState(false)
  const [agentNameByAccountId, setAgentNameByAccountId] = useState<Record<string, string>>({})
  const [agentsKnown, setAgentsKnown] = useState(false)
  const diagRef = useRef<HTMLDetailsElement>(null)
  const waSignupPendingRef = useRef<{
    code?: string | null
    accessToken?: string | null
    message?: WaEmbeddedSignupMessage | null
    exchanging?: boolean
  }>({})
  const tryExchangeWhatsAppSignupRef = useRef<(forceTokenOnly?: boolean) => Promise<void>>(
    async () => {},
  )

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
  }

  async function tryExchangeWhatsAppSignup(forceTokenOnly = false) {
    const pending = waSignupPendingRef.current
    if (pending.exchanging) return

    const hasCred = Boolean(pending.code || pending.accessToken)
    if (!hasCred) return

    const assets = extractWaEmbeddedSignupAssets(pending.message || undefined)
    const hasAssets = Boolean(assets.phoneNumberId || assets.wabaId)
    // Prefer correlated exchange (code + session). Token-only only when FB.login
    // finished and we still have no session (legacy / waiting path).
    if (!hasAssets && !forceTokenOnly) return
    if (!hasAssets && forceTokenOnly && pending.message) return

    pending.exchanging = true
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

      if (exchangeData.waitingForPhoneNumber && !hasAssets) {
        // Keep pending code; session postMessage may still arrive.
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
    fetchAgentBindings()
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
            // Never forceTokenOnly here — exchanging a single-use code without
            // FINISH phone/WABA assets cannot complete the connection.
            void tryExchangeWhatsAppSignupRef.current(false)
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
        void tryExchangeWhatsAppSignupRef.current(false)
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

            // If session postMessage already arrived, exchange now; else wait briefly
            // then fall back to token-only (waitingForPhoneNumber) for classic flows.
            if (waSignupPendingRef.current.message) {
              await tryExchangeWhatsAppSignup(false)
              return
            }

            await new Promise((r) => setTimeout(r, 800))
            if (waSignupPendingRef.current.message) {
              await tryExchangeWhatsAppSignup(false)
              return
            }
            await tryExchangeWhatsAppSignup(true)
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

  /** Read-only: which ChatAgent is bound to each SocialAccount (Agentes owns editing). */
  async function fetchAgentBindings() {
    try {
      const res = await fetch('/api/chat/agents')
      const json = await res.json()
      if (!res.ok || !json.success || json.schemaReady === false) return
      const byAccount: Record<string, string> = {}
      for (const agent of json.agents || []) {
        for (const binding of agent.bindings || []) {
          if (binding.scope === 'social_account' && binding.isActive && binding.socialAccountId) {
            byAccount[binding.socialAccountId] = agent.name
          }
        }
      }
      setAgentNameByAccountId(byAccount)
      setAgentsKnown(true)
    } catch {
      // Agent column falls back to "—"; never blocks Canales.
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


  const ownerAccounts = accounts.filter(isOwnerChannel)
  const waAccounts = ownerAccounts.filter((a) => a.platform === 'whatsapp')
  const igAccounts = ownerAccounts.filter((a) => a.platform === 'instagram')
  const summary = summarizeChannels(ownerAccounts)

  const q = accountSearch.trim().toLowerCase()
  const searched = q
    ? ownerAccounts.filter((a) =>
        [
          a.accountId,
          a.phoneNumberId,
          a.whatsappBusinessAccountId,
          a.displayName,
          a.displayPhoneNumber,
          a.providerDisplayName,
          a.providerUsername,
        ].some((v) => (v || '').toLowerCase().includes(q)),
      )
    : ownerAccounts
  const visibleAccounts = filterByTab(searched, activeTab)

  const webhookDownAccounts = ownerAccounts.filter(
    (a) => classifyChannelHealth(a).action === 'repair',
  )

  function openDiagnostics() {
    setDiagOpen(true)
    fetchMetaStatus()
    window.setTimeout(() => {
      diagRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }
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

  function handleReconnect(acc: SocialAccount) {
    // Same asset ID = update in place (no duplicate row), so skip the "add another" confirm.
    if (acc.platform === 'instagram') {
      void handleLinkInstagram()
    } else {
      launchWhatsAppEmbeddedSignup()
    }
  }

  const addLineDisabled = !fbReady || !FB_LOGIN_CONFIG_ID || connectingWhatsApp
  const addLineTitle = !FB_LOGIN_CONFIG_ID
    ? 'Falta configuración de Embedded Signup (NEXT_PUBLIC_FB_LOGIN_CONFIG_ID).'
    : !fbReady
      ? 'Cargando SDK de Meta…'
      : undefined

  const tabs: Array<{ key: ChannelTab; label: string; count: number }> = [
    { key: 'all', label: 'Todos', count: searched.length },
    { key: 'whatsapp', label: 'WhatsApp', count: searched.filter((a) => a.platform === 'whatsapp').length },
    { key: 'instagram', label: 'Instagram', count: searched.filter((a) => a.platform === 'instagram').length },
  ]

  return (
    <AuroraShell>
      <header className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200/70 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight text-slate-900">Cuentas conectadas</h1>
          <p className="text-[12px] text-slate-500">
            Cada número de WhatsApp es un canal independiente
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="relative hidden w-64 sm:block">
            <span className="sr-only">Buscar canal</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              placeholder="Buscar canal…"
              className="w-full rounded-[10px] border-0 bg-slate-50 py-2.5 pl-8 pr-3 text-xs text-slate-800 outline-none ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/30"
            />
          </label>
          <button
            type="button"
            onClick={handleAddWhatsApp}
            disabled={addLineDisabled}
            title={addLineTitle}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#5B6CFF] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#4A5AE8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {connectingWhatsApp ? 'Conectando…' : 'Agregar línea'}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-6 py-5">
        {statusMessage && !subscribeFailToast ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            {statusMessage}
          </div>
        ) : null}

        {subscribeFailToast ? (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3.5 text-[13px] text-red-800">
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

        <ChannelsAlertBanner
          names={webhookDownAccounts.map(accountResolvedName)}
          canRepair={webhookDownAccounts.length > 0}
          repairing={webhookDownAccounts.some((a) => a.id === resubscribing)}
          onRepair={() => void handleResubscribe(webhookDownAccounts[0].id)}
          onDiagnose={openDiagnostics}
        />

        <ChannelSummaryCards summary={summary} />

        <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div role="tablist" aria-label="Filtrar canales" className="inline-flex rounded-xl bg-slate-100 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                    activeTab === tab.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}{' '}
                  <span className={activeTab === tab.key ? 'text-[#5B6CFF]' : 'text-slate-400'}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <ChannelsTable
            accounts={visibleAccounts}
            loading={loading}
            totalCount={ownerAccounts.length}
            agentNameByAccountId={agentNameByAccountId}
            agentsKnown={agentsKnown}
            resolvedName={accountResolvedName}
            secondaryLine={accountSecondaryLine}
            isDuplicateName={duplicateNameWarning}
            renamingId={renamingId}
            renameDraft={renameDraft}
            renamingBusy={renamingBusy}
            resubscribing={resubscribing}
            unlinking={unlinking}
            onRenameDraftChange={setRenameDraft}
            onStartRename={startRename}
            onCancelRename={cancelRename}
            onSaveRename={(acc) => void saveRename(acc)}
            onDiagnose={openDiagnostics}
            onRepair={(acc) => void handleResubscribe(acc.id)}
            onReconnect={handleReconnect}
            onUnlink={(acc) => void handleUnlinkAccount(acc.id, acc.platform)}
            onAddLine={handleAddWhatsApp}
          >
            <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={handleAddWhatsApp}
                  disabled={addLineDisabled}
                  title={addLineTitle}
                  aria-label="Agregar otra línea de WhatsApp"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-[#5B6CFF]/50 text-[#5B6CFF] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
                <div>
                  <button
                    type="button"
                    onClick={handleAddWhatsApp}
                    disabled={addLineDisabled}
                    title={addLineTitle}
                    className="text-[13px] font-medium text-[#5B6CFF] disabled:opacity-50"
                  >
                    Agregar otra línea de WhatsApp
                  </button>
                  <p className="text-[12px] text-slate-500">
                    Cada número queda como canal independiente con su propio agente y plantillas.
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Podés seguir usando WhatsApp Business en el teléfono + Betsy (
                    <span className="font-medium text-slate-700">coexistence</span>, requiere la app
                    2.24.17+). Mismo Phone Number ID = actualizar; otro número = se suma.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowManualWhatsApp((value) => !value)}
                    className="mt-1.5 text-[11px] text-slate-500 underline"
                  >
                    {showManualWhatsApp ? 'Ocultar vínculo manual' : 'Usar vínculo manual (avanzado)'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleAddInstagram()
                }}
                disabled={connectingInstagram}
                className="shrink-0 rounded-[10px] border border-slate-200 bg-white px-3.5 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {connectingInstagram
                  ? 'Conectando…'
                  : igAccounts.length > 0
                    ? '+ Agregar otra Instagram'
                    : '+ Conectar Instagram'}
              </button>
            </div>

            {showManualWhatsApp ? (
              <form
                onSubmit={handleLinkWhatsApp}
                className="mx-5 mb-5 max-w-md space-y-3 border-t border-slate-100 pt-3"
              >
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
          </ChannelsTable>
        </section>

        <p className="text-[12px] text-[#5B6CFF]">
          ✦ Inbox de clientes en{' '}
          <a className="underline" href="/chats">
            Chats
          </a>
          . OAuth verifica subscribed_apps antes de marcar Conectado.
        </p>

        {/* Collapsible Meta diagnostics */}
        <details
          ref={diagRef}
          open={diagOpen}
          onToggle={(e) => setDiagOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-xl border border-slate-100 bg-white p-4"
        >
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
    </AuroraShell>
  )
}
