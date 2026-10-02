'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { installNotificationSoundUnlock, isNewInboundActivity, playNotificationChime } from '@/lib/notification-sound'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  appendOptimisticOutbound,
  createOptimisticOutboundMessage,
  humanizeChatSendError,
  markOptimisticOutboundFailed,
  newClientRequestId,
  parseApiJson,
  projectOptimisticListPreview,
  reconcileOptimisticOutbound,
  type ChatInboxMessage,
} from '@/lib/chat-inbox'
import {
  conversationStorageKey,
  filterSoftConversations,
  isWhatsAppWindowClosedError,
  readStatusMap,
  readTagsMap,
  accountDisplayLabel,
  accountChannelAddress,
  isConversationClosed,
  type ChannelFilter,
  type ConversationStatus,
  type InboxBucket,
  type SoftAiMonitorStats,
  type SoftConversation,
  type SoftSocialAccount,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'
import { isClosedCategory } from '@/lib/crm-stages'
import {
  advanceRevisionCursor,
  buildChangesPollQuery,
  buildChatTemplateSendBody,
  buildLocalImportPayload,
  CHAT_INBOX_V2_FULL_RECONCILE_MS,
  CHAT_INBOX_V2_IMPORTED_KEY,
  CHAT_INBOX_V2_LIST_PAGE_LIMIT,
  CHAT_INBOX_V2_POLL_MS,
  CHAT_INBOX_V2_SSE_SAFETY_POLL_MS,
  CHAT_INBOX_V2_THREAD_FETCH_LIMIT,
  decideInboxV2PollTick,
  inboxFetch,
  listDtoToSoftConversation,
  mergeListDtoIntoMap,
  mergeThreadMessageWindow,
  messageDtoToInbox,
  softConversationKeyFromDto,
  sortedConversationDtos,
  threadTailCursor,
} from '@/lib/chat-inbox-v2-client'
import {
  applyAgentControl,
  getConversationAgentState,
  conversationAgentMode,
  readAgentStateMap,
  writeAgentStateMap,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai/agent-state'
import { lineHealth, lineIsDown, summarizeLineCounts } from '@/lib/chat-line-filter'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { WA_OUTBOUND_ACCEPT } from '@/lib/chat-outbound-media'
import { WA_CAPTION_MAX, type ChatQuickReply, type QuickReplyChange, type QuickReplyMedia } from '@/lib/chat-quick-replies'
import { hasOrderDraft } from '@/lib/order-draft'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { loadChatAccounts } from '@/components/aurora/config/useChannelsNeedingAction'
import type { ChatAssignee } from '@/components/chats/ChatAssigneePicker'
import { SoftConversationList } from '@/components/chats/SoftConversationList'
import {
  SoftThreadPane,
  type SoftWaTemplateOption,
} from '@/components/chats/SoftThreadPane'
import { SoftTokenHealthBanners } from '@/components/chats/SoftTokenHealthBanners'
import { ChatContextRail, normalizeRailTab, type ContextRailTab } from '@/components/chats/ChatContextRail'
import { ChatAdOriginCard } from '@/components/chats/ChatAdOriginCard'
import { useCrmCatalog } from '@/components/chats/useCrmCatalog'
import { useChatPresence } from '@/components/chats/useChatPresence'
import { ChatClientPanel } from '@/components/chats/ChatClientPanel'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'
import { AuroraTopActions } from '@/components/aurora/shell/AuroraTopActions'
import dynamic from 'next/dynamic'
import type { CreatedOrderRef } from '@/app/ventas/components/EnhancedSalesForm'
import { useToast } from '@/app/hooks/use-toast'

const RAIL_TAB_KEY = 'betsy.chat.railTab.v2'
const DETAILS_PANEL_KEY = 'betsy.chat.detailsPanel.v1'

function softKey(c: SoftConversation) {
  return conversationStorageKey(c.socialAccountId, c.recipientId)
}

// Same Aurora "Crear pedido" drawer as /ventas; loaded on demand.
const CrearPedidoDrawer = dynamic(
  () => import('@/components/aurora/pedidos/CrearPedidoDrawer').then((m) => m.CrearPedidoDrawer),
  { ssr: false },
)

export function SoftCopilotInboxV2() {
  const { toast } = useToast()
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [accounts, setAccounts] = useState<SoftSocialAccount[]>([])
  const [dtoMap, setDtoMap] = useState<Map<string, ChatConversationListItemDto>>(new Map())
  // Mirror for the notification chime (compares a refreshed row with what is on screen).
  const dtoMapRef = useRef(dtoMap)
  dtoMapRef.current = dtoMap
  const [threadMessages, setThreadMessages] = useState<Record<string, ChatInboxMessage[]>>({})
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  // Default = every open chat: new inbound chats have no owner until someone replies.
  const [bucket, setBucket] = useState<InboxBucket>('abiertos')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('todos')
  const [accountFilter, setAccountFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<SoftTag | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(false)
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  // "Ana está respondiendo…" / "Ana también está viendo este chat" for the open chat.
  const presenceText = useChatPresence(selectedConversationId, messageInput)
  // Shown once the list says snooze works (false before migration 036 is applied).
  const [snoozeAvailable, setSnoozeAvailable] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [failedOutboundId, setFailedOutboundId] = useState<string | null>(null)
  // Cliente · Agente (Phase 2a). Remembered; old 'detalle' / 'copilot' values map onto them.
  const [railTab, setRailTabState] = useState<ContextRailTab>('cliente')
  useEffect(() => {
    try {
      setRailTabState(normalizeRailTab(window.localStorage.getItem(RAIL_TAB_KEY)))
    } catch {
      // private mode: default tab
    }
  }, [])
  const setRailTab = useCallback((tab: ContextRailTab) => {
    setRailTabState(tab)
    try {
      window.localStorage.setItem(RAIL_TAB_KEY, tab)
    } catch {
      // private mode: not remembered
    }
  }, [])
  const { activeTags } = useCrmCatalog()
  /** Details panel (Cliente · Agente): remembered; wide screens start open. */
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [wideScreen, setWideScreen] = useState(true)
  /** Bumped after an order / guía changes so the Cliente tab refetches. */
  const [clientPanelRev, setClientPanelRev] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [threadBeforeCursor, setThreadBeforeCursor] = useState<Record<string, string | null>>({})
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [templates, setTemplates] = useState<SoftWaTemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [agentStateMap, setAgentStateMap] = useState<SoftAiAgentStateMap>({})
  const [controlBusy, setControlBusy] = useState(false)
  const [listNextCursor, setListNextCursor] = useState<string | null>(null)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)

  const maxRevisionRef = useRef<bigint>(BigInt(0))
  const lastFullReconcileRef = useRef(0)
  const importStartedRef = useRef(false)
  const [assignees, setAssignees] = useState<ChatAssignee[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [outboundMedia, setOutboundMedia] = useState(false)
  const [quickReplyItems, setQuickReplyItems] = useState<ChatQuickReply[]>([])
  const { data: viewerSession } = useSession()
  const canManageQuickReplies = hasSessionPermission(viewerSession, 'update_config')
  /** Unsent composer text per chat (WhatsApp-style drafts; this tab only). */
  const composerDrafts = useRef(new Map<string, string>())
  const [threadErrorId, setThreadErrorId] = useState<string | null>(null)
  const pendingFileRequestIds = useRef(new Map<string, string>())
  /** Server search hits for the active query; re-merged after a reconcile replaces the list. */
  const searchHitsRef = useRef<ChatConversationListItemDto[]>([])
  /** Rows loaded outside the pages (deep link, Pospuestos): kept when the first page reloads. */
  const pinnedDtosRef = useRef<ChatConversationListItemDto[]>([])
  const pollInFlightRef = useRef(false)
  const pollStartedAtRef = useRef(0)
  const lastPollAtRef = useRef(0)
  const sseHealthyRef = useRef(false)
  const tickRef = useRef<((forced?: boolean) => void) | null>(null)
  const selectedConversationIdRef = useRef<string | null>(null)
  const threadMessagesRef = useRef<Record<string, ChatInboxMessage[]>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendInFlightRef = useRef(false)
  /** Last quick reply inserted, per chat: reported with that chat's next send (usage metric). */
  const quickReplyUsedRef = useRef<{ conversationId: string; shortcut: string } | null>(null)

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId
  }, [selectedConversationId])

  useEffect(() => {
    threadMessagesRef.current = threadMessages
  }, [threadMessages])

  useEffect(() => {
    setAgentStateMap(readAgentStateMap())
  }, [])

  // CHAT-M01: mobile bandeja opens on "Todos" (abiertos); desktop keeps "Tus chats".
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setBucket('abiertos')
  }, [])

  // Shared with the bell / mobile nav (one request, 60 s cache); `force` after a retry.
  const fetchAccounts = useCallback(async (opts?: { force?: boolean }) => {
    const accounts = await loadChatAccounts(opts)
    if (accounts) setAccounts(accounts as unknown as SoftSocialAccount[])
  }, [])

  const runLocalImportOnce = useCallback(async () => {
    if (importStartedRef.current) return
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(CHAT_INBOX_V2_IMPORTED_KEY) === '1') return
    importStartedRef.current = true
    const items = buildLocalImportPayload(readStatusMap(), readTagsMap())
    if (!items.length) {
      window.localStorage.setItem(CHAT_INBOX_V2_IMPORTED_KEY, '1')
      return
    }
    try {
      await fetch('/api/chat/conversations/import-local-state', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      window.localStorage.setItem(CHAT_INBOX_V2_IMPORTED_KEY, '1')
    } catch {
      importStartedRef.current = false
    }
  }, [])

  /** First page only (or one more page for "cargar más") — never walk 40 pages on idle. */
  const fetchListPage = useCallback(async (opts?: { cursor?: string | null; replace?: boolean }) => {
    const qs = new URLSearchParams({ limit: String(CHAT_INBOX_V2_LIST_PAGE_LIMIT) })
    if (opts?.cursor) qs.set('cursor', opts.cursor)
    const res = await inboxFetch(`/api/chat/conversations?${qs.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const parsed = await parseApiJson<{
      success?: boolean
      conversations?: ChatConversationListItemDto[]
      nextCursor?: string | null
      maxRevision?: string
      snoozeAvailable?: boolean
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.conversations) {
      throw new Error('list_failed')
    }
    if (typeof parsed.data.snoozeAvailable === 'boolean') setSnoozeAvailable(parsed.data.snoozeAvailable)
    setDtoMap((prev) =>
      opts?.replace
        ? (() => {
            const fresh = mergeListDtoIntoMap(new Map(), parsed.data.conversations!)
            // Prefer the live row (snooze / PATCH / changes feed) over the snapshot taken when pinned.
            const keep = [...searchHitsRef.current, ...pinnedDtosRef.current].map((c) => prev.get(c.id) ?? c).filter((c) => !fresh.has(c.id))
            return keep.length ? mergeListDtoIntoMap(fresh, keep) : fresh
          })()
        : mergeListDtoIntoMap(prev, parsed.data.conversations!),
    )
    setListNextCursor(parsed.data.nextCursor ?? null)
    if (parsed.data.maxRevision && opts?.replace) {
      // Seed revision cursor from first page max so changes feed starts at head.
      const head = BigInt(parsed.data.maxRevision)
      if (head > maxRevisionRef.current) maxRevisionRef.current = head
    }
    setListError(false)
    setLastSyncAt(Date.now())
    lastFullReconcileRef.current = Date.now()
  }, [])

  const applyThreadTail = useCallback(
    (conversationId: string, messages: Array<Parameters<typeof messageDtoToInbox>[0]>) => {
      const incoming = messages.map(messageDtoToInbox)
      const hadInbound = incoming.some((m) => m.direction === 'inbound')
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: mergeThreadMessageWindow({
          existing: prev[conversationId] || [],
          incoming,
          mode: 'tail',
        }),
      }))
      if (
        hadInbound &&
        conversationId === selectedConversationIdRef.current &&
        nearBottomRef.current
      ) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        })
      }
    },
    [],
  )

  const fetchChanges = useCallback(async () => {
    let guard = 0
    while (guard < 20) {
      guard += 1
      const after = maxRevisionRef.current.toString()
      const threadId = selectedConversationIdRef.current
      const existing = threadId ? threadMessagesRef.current[threadId] : undefined
      const persistedTail = existing?.length
        ? [...existing].reverse().find((m) => !m.id.startsWith('optimistic:'))
        : undefined
      // Look back a little: a customer message can be stored with a send time just before ours.
      const threadAfter = threadId ? threadTailCursor(persistedTail) : null

      const qs = buildChangesPollQuery({
        afterRevision: after,
        limit: 200,
        // Piggyback thread tail only on the first page of a drain burst.
        threadId: guard === 1 ? threadId : null,
        threadAfter: guard === 1 ? threadAfter : null,
      })
      const res = await inboxFetch(`/api/chat/conversations/changes?${qs}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const parsed = await parseApiJson<{
        success?: boolean
        conversations?: ChatConversationListItemDto[]
        nextRevision?: string
        maxRevision?: string
        hasMoreChanges?: boolean
        threadTail?: {
          conversationId: string
          messages: Array<Parameters<typeof messageDtoToInbox>[0]>
        } | null
      }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) return

      if (parsed.data.conversations?.length) {
        // A customer wrote (unread went up on an inbound message): soft chime, once per burst.
        if (lastFullReconcileRef.current > 0) {
          const onScreen = dtoMapRef.current
          const nowMs = Date.now()
          const fresh = parsed.data.conversations.some((c) =>
            isNewInboundActivity(onScreen.get(c.id)?.unreadCount ?? undefined, c, nowMs),
          )
          if (fresh) playNotificationChime()
        }
        setDtoMap((prev) => mergeListDtoIntoMap(prev, parsed.data.conversations!))
      }

      const advanced = advanceRevisionCursor({
        current: maxRevisionRef.current,
        nextRevision: parsed.data.nextRevision ?? parsed.data.maxRevision,
        hasMoreChanges: parsed.data.hasMoreChanges,
      })
      maxRevisionRef.current = advanced.next

      if (parsed.data.threadTail?.conversationId && parsed.data.threadTail.messages) {
        applyThreadTail(parsed.data.threadTail.conversationId, parsed.data.threadTail.messages)
      }

      setLastSyncAt(Date.now())
      if (!advanced.continueDrain) return
    }
  }, [applyThreadTail])

  const fetchThreadMessages = useCallback(async (conversationId: string) => {
    const qs = `limit=${CHAT_INBOX_V2_THREAD_FETCH_LIMIT}`
    const res = await inboxFetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`,
      { credentials: 'same-origin', cache: 'no-store' },
    )
    const parsed = await parseApiJson<{
      success?: boolean
      messages?: Array<Parameters<typeof messageDtoToInbox>[0]>
      nextBefore?: string | null
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.messages) {
      setThreadErrorId(conversationId)
      return
    }
    setThreadErrorId((cur) => (cur === conversationId ? null : cur))
    const incoming = parsed.data.messages.map(messageDtoToInbox)
    setThreadMessages((prev) => ({
      ...prev,
      [conversationId]: mergeThreadMessageWindow({
        existing: [],
        incoming,
        mode: 'replace',
      }),
    }))
    if (parsed.data.nextBefore !== undefined) {
      setThreadBeforeCursor((prev) => ({
        ...prev,
        [conversationId]: parsed.data.nextBefore ?? null,
      }))
    }
    void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
      credentials: 'same-origin',
    }).then(() => {
      setDtoMap((prev) => {
        const row = prev.get(conversationId)
        if (!row) return prev
        const next = new Map(prev)
        next.set(conversationId, { ...row, unreadCount: 0 })
        return next
      })
    })
  }, [])

  const loadThreadMessages = useCallback(async (conversationId: string) => {
    setThreadLoadingId(conversationId)
    try {
      await fetchThreadMessages(conversationId)
    } catch {
      // Offline / network error: show the thread error state (not "Sin mensajes").
      setThreadErrorId(conversationId)
    } finally {
      setThreadLoadingId((cur) => (cur === conversationId ? null : cur))
    }
  }, [fetchThreadMessages])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      // Block the poller during the first load: focus/visibility ticks would otherwise fire a
      // second "reconcile" list fetch in parallel (lastFullReconcileRef is still 0).
      const startedAt = Date.now()
      pollStartedAtRef.current = startedAt
      pollInFlightRef.current = true
      try {
        // Fresh on mount (a line connected seconds ago must show up); still shares an in-flight request.
        await fetchAccounts({ force: true })
        await runLocalImportOnce()
        try {
          await fetchListPage({ replace: true })
        } catch {
          setListError(true)
        }
      } finally {
        // fetchListPage sets lastFullReconcileRef on success; after a failure the next tick reconciles.
        // Only release the flag if a stuck-recovery poll has not taken it over meanwhile.
        if (pollStartedAtRef.current === startedAt) pollInFlightRef.current = false
        setLoading(false)
      }
    })()
  }, [fetchAccounts, fetchListPage, runLocalImportOnce])

  async function retryInitialLoad() {
    setLoading(true)
    setListError(false)
    try {
      await fetchAccounts({ force: true })
      await fetchListPage({ replace: true })
    } catch {
      setListError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    installNotificationSoundUnlock()
  }, [])

  useEffect(() => {
    const tick = (forced = false) => {
      // While live ticks (SSE) are healthy, the interval only acts as a slow safety net.
      if (
        !forced &&
        sseHealthyRef.current &&
        Date.now() - lastPollAtRef.current < CHAT_INBOX_V2_SSE_SAFETY_POLL_MS
      ) {
        return
      }
      lastPollAtRef.current = Date.now()
      void (async () => {
        const decision = decideInboxV2PollTick({
          documentHidden: typeof document !== 'undefined' ? document.hidden : false,
          inFlight: pollInFlightRef.current,
          nowMs: Date.now(),
          lastFullReconcileMs: lastFullReconcileRef.current,
          fullReconcileEveryMs: CHAT_INBOX_V2_FULL_RECONCILE_MS,
          inFlightSinceMs: pollStartedAtRef.current,
        })
        if (decision.action === 'skip') return
        const startedAt = Date.now()
        pollStartedAtRef.current = startedAt
        pollInFlightRef.current = true
        try {
          if (decision.action === 'reconcile') {
            // Option (2): reconcile tick = one list page only (no thread fetch).
            await fetchListPage({ replace: true })
          } else {
            await fetchChanges()
          }
        } catch {
          // swallow — next tick retries
        } finally {
          // Only the poll that still owns the flag clears it (a stuck one was already superseded).
          if (pollStartedAtRef.current === startedAt) pollInFlightRef.current = false
        }
      })()
    }
    tickRef.current = tick
    const id = window.setInterval(() => tick(), CHAT_INBOX_V2_POLL_MS)
    const onVisibility = () => {
      if (!document.hidden) tick(true)
    }
    const onFocus = () => tick(true)
    const onOnline = () => tick(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchChanges, fetchListPage])

  // Live ticks over Server-Sent Events (only when the server has CHAT_SSE on). The frames carry no data:
  // each tick just triggers the normal /changes poll. Any failure falls back to the 5 s poll.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    let closed = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let backoffMs = 5_000

    const scheduleRetry = () => {
      if (closed) return
      retryTimer = window.setTimeout(() => void connect(), backoffMs)
      backoffMs = Math.min(backoffMs * 2, 120_000)
    }
    const connect = async () => {
      if (closed) return
      try {
        const probe = await inboxFetch('/api/chat/stream?probe=1', { credentials: 'same-origin', cache: 'no-store' })
        const info = probe.ok ? ((await probe.json()) as { enabled?: boolean }) : null
        if (!info?.enabled) return // off on the server: stay on polling, no retries
      } catch {
        scheduleRetry()
        return
      }
      if (closed) return
      source = new EventSource('/api/chat/stream')
      source.addEventListener('ready', () => {
        sseHealthyRef.current = true
        backoffMs = 5_000
      })
      source.addEventListener('tick', () => tickRef.current?.(true))
      source.addEventListener('full', () => {
        sseHealthyRef.current = false
        source?.close()
      })
      source.onerror = () => {
        sseHealthyRef.current = false
        source?.close()
        source = null
        scheduleRetry()
      }
    }
    void connect()
    return () => {
      closed = true
      sseHealthyRef.current = false
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [])

  // Team quick replies for the composer (`/atajo`).
  useEffect(() => {
    let cancelled = false
    fetch('/api/chat/quick-replies', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.success && Array.isArray(json.items)) {
          setQuickReplyItems(json.items)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /** One change (add / edit / delete); the server applies it atomically and returns the list. */
  const changeQuickReplies = useCallback(async (change: QuickReplyChange): Promise<string | null> => {
    try {
      const res = await fetch('/api/chat/quick-replies', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
        signal: AbortSignal.timeout(20_000),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; items?: ChatQuickReply[]; error?: string } | null
      if (res.status === 403) return 'Solo administradores pueden editar las respuestas rápidas.'
      if (!res.ok || !json?.success) return json?.error || 'No se pudieron guardar las respuestas rápidas.'
      if (Array.isArray(json.items)) setQuickReplyItems(json.items)
      return null
    } catch (error) {
      return error instanceof Error && error.name === 'TimeoutError'
        ? 'El servidor tardó demasiado. Probá de nuevo.'
        : 'Sin conexión. Probá de nuevo.'
    }
  }, [])

  // Per-business switches (e.g. sending files) — on unless the tenant turned them off.
  useEffect(() => {
    let cancelled = false
    fetch('/api/chat/capabilities', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.success) setOutboundMedia(json.outboundMedia === true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Team for the owner picker (id / name / photo only; same gate as the inbox).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/chat/assignees', { credentials: 'same-origin', cache: 'no-store' })
        const parsed = await parseApiJson<{ success?: boolean; viewerUserId?: string; assignees?: ChatAssignee[] }>(res)
        if (cancelled || !parsed.ok || !res.ok || !parsed.data.success) return
        setAssignees(parsed.data.assignees ?? [])
        setViewerUserId(parsed.data.viewerUserId ?? null)
      } catch {
        // picker shows "Cargando equipo…"; assigning to self still needs viewerUserId
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1536px)')
    const sync = () => setWideScreen(mq.matches)
    sync()
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(DETAILS_PANEL_KEY)
    } catch {
      // ignore
    }
    setDetailsOpen(stored === null ? mq.matches : stored === '1')
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const toggleDetails = useCallback(() => {
    setDetailsOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(DETAILS_PANEL_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }, [])
  // "]" toggles the details panel (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ']' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      toggleDetails()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleDetails])

  // ⌘K / Ctrl+K focuses the visible chat search (desktop rail or mobile list).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
      const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-chat-search]')).find(
        (el) => el.offsetParent !== null,
      )
      if (!input) return
      e.preventDefault()
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Search also asks the server (`?q=`), so chats not loaded yet are found. The local
  // filter stays instant; server hits are merged into the same list.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      searchHitsRef.current = []
      return
    }
    const controller = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ limit: String(CHAT_INBOX_V2_LIST_PAGE_LIMIT), q })
        const res = await fetch(`/api/chat/conversations?${qs.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        const parsed = await parseApiJson<{ success?: boolean; conversations?: ChatConversationListItemDto[] }>(res)
        if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.conversations?.length) return
        searchHitsRef.current = parsed.data.conversations
        // Only add chats the list does not have yet — never overwrite a row the live
        // changes feed may have updated after this request started.
        setDtoMap((prev) => {
          const missing = parsed.data.conversations!.filter((c) => !prev.has(c.id))
          return missing.length ? mergeListDtoIntoMap(prev, missing) : prev
        })
      } catch {
        // aborted or offline: the local filter still works
      }
    }, 300)
    return () => {
      window.clearTimeout(t)
      controller.abort()
    }
  }, [search])

  async function loadMoreConversations() {
    if (!listNextCursor || loadingMoreConversations) return
    setLoadingMoreConversations(true)
    try {
      await fetchListPage({ cursor: listNextCursor, replace: false })
    } catch {
      // keep cursor for retry
    } finally {
      setLoadingMoreConversations(false)
    }
  }

  const conversations = useMemo(() => {
    const dtos = sortedConversationDtos(dtoMap)
    const byId = new Map(accounts.map((a) => [a.id, a]))
    return dtos.map((dto) => {
      const soft = listDtoToSoftConversation(dto, threadMessages[dto.id] || [])
      const account = byId.get(dto.socialAccountId)
      if (!account) return soft
      return {
        ...soft,
        accountLabel: accountDisplayLabel(account),
        channelAddress: accountChannelAddress(account),
      }
    })
  }, [dtoMap, threadMessages, accounts])

  /** Fetches rows by list query (session tenant) and pins them into the list. */
  /** Rows found (possibly none), or null when the request itself failed (network / server). */
  const pinRows = useCallback(async (qs: string): Promise<ChatConversationListItemDto[] | null> => {
    try {
      const res = await fetch(`/api/chat/conversations?${qs}`, { credentials: 'same-origin', cache: 'no-store' })
      const parsed = await parseApiJson<{ success?: boolean; conversations?: ChatConversationListItemDto[] }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) return null
      const rows = parsed.data.conversations ?? []
      if (rows.length) {
        const ids = new Set(rows.map((r) => r.id))
        pinnedDtosRef.current = [...pinnedDtosRef.current.filter((r) => !ids.has(r.id)), ...rows].slice(-200)
        setDtoMap((prev) => {
          const missing = rows.filter((c) => !prev.has(c.id))
          return missing.length ? mergeListDtoIntoMap(prev, missing) : prev
        })
      }
      return rows
    } catch {
      return null
    }
  }, [])

  // `/chats?c=<id>` (bell notification). Reactive to the URL, so it also works when already on
  // /chats (Next keeps this component mounted). Not in the loaded pages → fetched by id, which the
  // list route scopes to the session's business (another business's id finds nothing).
  const searchParams = useSearchParams()
  const router = useRouter()
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null)
  const deepLinkFetched = useRef<string | null>(null)
  useEffect(() => {
    const c = searchParams?.get('c')
    if (c && /^[A-Za-z0-9_-]{8,64}$/.test(c)) setDeepLinkId(c)
  }, [searchParams])
  useEffect(() => {
    if (!deepLinkId) return
    if (dtoMap.has(deepLinkId)) {
      setDeepLinkId(null)
      deepLinkFetched.current = null
      openConversationById(deepLinkId)
      // Handled: drop ?c= so the same notification can be clicked again later.
      router.replace('/chats', { scroll: false })
      return
    }
    if (deepLinkFetched.current === deepLinkId) return
    deepLinkFetched.current = deepLinkId
    void pinRows(new URLSearchParams({ id: deepLinkId, limit: '1' }).toString()).then((rows) => {
      if (rows === null) {
        deepLinkFetched.current = null
        setDeepLinkId(null)
        router.replace('/chats', { scroll: false })
        toast({ variant: 'destructive', title: 'No se pudo abrir el chat', description: 'Revisá la conexión e intentá de nuevo.' })
      } else if (!rows.length) {
        setDeepLinkId(null)
        router.replace('/chats', { scroll: false })
        toast({ title: 'Ese chat ya no está disponible' })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opens once the row is in the map
  }, [deepLinkId, dtoMap])

  // Pospuestos: snoozed chats can be far down the list; load them all when the bucket opens.
  useEffect(() => {
    if (bucket === 'pospuestos' && snoozeAvailable) void pinRows('snoozed=1&limit=50')
  }, [bucket, snoozeAvailable, pinRows])

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null
    const dto = dtoMap.get(selectedConversationId)
    if (!dto) return null
    const soft = listDtoToSoftConversation(dto, threadMessages[selectedConversationId] || [])
    const account = accounts.find((a) => a.id === dto.socialAccountId)
    if (!account) return soft
    return {
      ...soft,
      accountLabel: accountDisplayLabel(account),
      channelAddress: accountChannelAddress(account),
    }
  }, [dtoMap, selectedConversationId, threadMessages, accounts])

  // SoftCopilotRail is locked and prints `conversation.orderId` verbatim, so the display value is
  // mapped here: human order number when known, never the internal id (cuid).
  const railConversation = useMemo(() => {
    if (!selectedConversation) return null
    return {
      ...selectedConversation,
      orderId: selectedConversation.orderNumber
        ? `#${selectedConversation.orderNumber}`
        : selectedConversation.orderId
          ? 'vinculado'
          : undefined,
    }
  }, [selectedConversation])

  const selectedKey = selectedConversation ? softKey(selectedConversation) : null

  const selectedAgentState = selectedKey
    ? getConversationAgentState(agentStateMap, selectedKey, false)
    : getConversationAgentState(agentStateMap, '__none__', false)

  const monitorStats: SoftAiMonitorStats = useMemo(() => {
    let aiActive = 0
    let paused = 0
    let human = 0
    let toolActions = 0
    for (const dto of dtoMap.values()) {
      if (dto.stageCategory ? isClosedCategory(dto.stageCategory) : dto.status === 'hecho') continue
      const mode = dto.aiMode
      if (mode === 'ai_active') aiActive += 1
      else if (mode === 'paused') paused += 1
      else human += 1
      const st = getConversationAgentState(agentStateMap, softConversationKeyFromDto(dto), false)
      toolActions += st.toolLog.length
    }
    return { aiActive, paused, human, toolActions }
  }, [agentStateMap, dtoMap])

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (channelFilter === 'whatsapp') return a.platform === 'whatsapp'
      if (channelFilter === 'instagram') return a.platform === 'instagram'
      return true
    })
  }, [accounts, channelFilter])

  // Snoozed chats wake up on time even when nothing else changes: re-filter every 30 s while any
  // chat is snoozed (no timer otherwise).
  const [snoozeTick, setSnoozeTick] = useState(0)
  const anySnoozed = useMemo(() => conversations.some((c) => Boolean(c.snoozedUntil)), [conversations])
  useEffect(() => {
    if (!anySnoozed) return
    const id = window.setInterval(() => setSnoozeTick((t) => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [anySnoozed])

  const visibleConversations = useMemo(() => {
    let list = filterSoftConversations(conversations, {
      bucket,
      channel: channelFilter,
      accountId: accountFilter,
      search,
      viewerUserId,
    })
    if (bucket === 'ia_manejando') {
      list = list.filter((c) => {
        const dto = [...dtoMap.values()].find(
          (d) => d.socialAccountId === c.socialAccountId && d.peerId === c.recipientId,
        )
        return dto?.aiMode === 'ai_active' && !isConversationClosed(c)
      })
    }
    if (activeTag) list = list.filter((c) => c.tags.includes(activeTag))
    return list
    // snoozeTick: re-evaluate snoozes as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, bucket, channelFilter, accountFilter, search, activeTag, dtoMap, viewerUserId, snoozeTick])

  const openCount = useMemo(
    () => conversations.filter((c) => !isConversationClosed(c)).length,
    [conversations],
  )

  const lineCounts = useMemo(() => summarizeLineCounts(conversations), [conversations])

  const unreadChatCount = useMemo(
    () => conversations.filter((c) => !isConversationClosed(c) && (c.unreadCount || 0) > 0).length,
    [conversations],
  )
  const channelsAlert = useMemo(() => accounts.some((a) => lineIsDown(a)), [accounts])
  const agentActionsToday = useMemo(() => {
    const today = new Date().toDateString()
    return selectedAgentState.toolLog.filter((t) => new Date(t.at).toDateString() === today).length
  }, [selectedAgentState.toolLog])

  const selectedAccountHealth = useMemo(() => {
    if (!selectedConversation) return null
    const account = accounts.find((a) => a.id === selectedConversation.socialAccountId)
    if (!account) return null
    const health = lineHealth(account)
    return health.needsAction ? { account, health } : null
  }, [accounts, selectedConversation])

  const whatsappCount = accounts.filter((a) => a.platform === 'whatsapp').length
  const instagramCount = accounts.filter((a) => a.platform === 'instagram').length

  function selectConversation(conv: SoftConversation) {
    const dto = [...dtoMap.values()].find(
      (d) => d.socialAccountId === conv.socialAccountId && d.peerId === conv.recipientId,
    )
    if (!dto) return
    openConversationById(dto.id)
  }

  /** Opens a chat by its server id (list click, or a `/chats?c=<id>` link from a notification). */
  function openConversationById(id: string) {
    if (selectedConversationId && selectedConversationId !== id) {
      if (messageInput.trim()) composerDrafts.current.set(selectedConversationId, messageInput)
      else composerDrafts.current.delete(selectedConversationId)
    }
    setSelectedConversationId(id)
    setSendError(null)
    setFailedOutboundId(null)
    setMessageInput(composerDrafts.current.get(id) ?? '')
    setTemplatePickerOpen(false)
    setMobileDetailsOpen(false)
    nearBottomRef.current = true
    setMobileView('thread')
    void loadThreadMessages(id).then(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
        composerRef.current?.focus()
      })
    })
  }

  async function patchConversation(partial: {
    status?: ConversationStatus
    tags?: SoftTag[]
    assignedUserId?: string | null
  }): Promise<boolean> {
    if (!selectedConversationId) return false
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(selectedConversationId)}`,
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      },
    )
    const parsed = await parseApiJson<{ success?: boolean; conversation?: ChatConversationListItemDto }>(
      res,
    )
    if (parsed.ok && res.ok && parsed.data.success && parsed.data.conversation) {
      // PATCH responses are not enriched: keep the linked order / agent labels we already had.
      setDtoMap((prev) => {
        const incoming = parsed.data.conversation!
        const before = prev.get(incoming.id)
        const merged = before
          ? {
              ...incoming,
              linkedOrder: incoming.linkedOrder ?? before.linkedOrder,
              agentLabel: incoming.agentLabel ?? before.agentLabel,
              agentEmoji: incoming.agentEmoji ?? before.agentEmoji,
              agentStateDot: incoming.agentStateDot ?? before.agentStateDot,
              pendingSuggestionText: incoming.pendingSuggestionText ?? before.pendingSuggestionText,
              // PATCH never changes the snooze; keep what the list knew.
              snooze: incoming.snooze !== undefined ? incoming.snooze : before.snooze,
            }
          : incoming
        return mergeListDtoIntoMap(prev, [merged])
      })
      return true
    }
    return false
  }

  /** Posponer / despertar the open chat. Updates the list right away; the server bumps the revision. */
  async function setSnoozeFor(untilIso: string | null): Promise<boolean> {
    if (!selectedConversationId) return false
    const id = selectedConversationId
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(id)}/snooze`, {
        method: untilIso ? 'POST' : 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(untilIso ? { body: JSON.stringify({ until: untilIso }) } : {}),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; snooze?: { until: string; at: string } | null; error?: string } | null
      if (!res.ok || !json?.success) {
        if (res.status === 503) setSnoozeAvailable(false)
        toast({ variant: 'destructive', title: json?.error || 'No se pudo posponer el chat' })
        return false
      }
      setDtoMap((prev) => {
        const row = prev.get(id)
        if (!row) return prev
        const next = new Map(prev)
        next.set(id, { ...row, snooze: json.snooze ?? null })
        return next
      })
      toast({ title: untilIso ? 'Chat pospuesto' : 'Chat de vuelta en tu bandeja' })
      return true
    } catch {
      toast({ variant: 'destructive', title: 'Sin conexión' })
      return false
    }
  }

  async function assignTo(userId: string | null) {
    setAssignBusy(true)
    try {
      await patchConversation({ assignedUserId: userId })
    } finally {
      setAssignBusy(false)
    }
  }

  function updateStatus(status: ConversationStatus) {
    void patchConversation({ status }).catch(() => false).then((ok) => {
      if (!ok) toast({ variant: 'destructive', title: 'No se pudo cambiar la etapa', description: 'Probá de nuevo o recargá la página.' })
    })
  }

  function toggleTag(tag: SoftTag) {
    if (!selectedConversation) return
    const nextTags = selectedConversation.tags.includes(tag)
      ? selectedConversation.tags.filter((t) => t !== tag)
      : [...selectedConversation.tags, tag]
    void patchConversation({ tags: nextTags }).catch(() => false).then((ok) => {
      if (!ok) toast({ variant: 'destructive', title: 'No se pudo cambiar la etiqueta', description: 'Puede que la hayan archivado. Recargá la página.' })
    })
  }

  async function setAgentControl(action: 'take_over' | 'pause' | 'resume') {
    if (!selectedConversation || controlBusy) return
    const key = softKey(selectedConversation)
    setControlBusy(true)
    try {
      const res = await fetch('/api/chat/soft-ai/control', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, conversationKey: key }),
      })
      const parsed = await parseApiJson<{ success?: boolean }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) return
      const next = applyAgentControl(agentStateMap, key, action, false)
      setAgentStateMap(next)
      writeAgentStateMap(next)
      if (selectedConversationId) {
        await fetchChanges()
      }
    } finally {
      setControlBusy(false)
    }
  }

  async function handleLoadOlder() {
    if (!selectedConversationId) return
    const before = threadBeforeCursor[selectedConversationId]
    if (!before) return
    setLoadingOlder(true)
    try {
      const res = await fetch(
        `/api/chat/conversations/${encodeURIComponent(selectedConversationId)}/messages?before=${encodeURIComponent(before)}&limit=${CHAT_INBOX_V2_THREAD_FETCH_LIMIT}`,
        { credentials: 'same-origin', cache: 'no-store' },
      )
      const parsed = await parseApiJson<{
        success?: boolean
        messages?: Array<Parameters<typeof messageDtoToInbox>[0]>
        nextBefore?: string | null
      }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.messages) return
      const older = parsed.data.messages.map(messageDtoToInbox)
      setThreadMessages((prev) => ({
        ...prev,
        [selectedConversationId]: mergeThreadMessageWindow({
          existing: prev[selectedConversationId] || [],
          incoming: older,
          mode: 'older',
        }),
      }))
      setThreadBeforeCursor((prev) => ({
        ...prev,
        [selectedConversationId]: parsed.data.nextBefore ?? null,
      }))
    } finally {
      setLoadingOlder(false)
    }
  }

  async function openTemplatePicker() {
    if (!selectedConversation) return
    setSendError(null)
    setTemplatePickerOpen(true)
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const res = await fetch(
        `/api/chat/templates?socialAccountId=${encodeURIComponent(selectedConversation.socialAccountId)}`,
        { credentials: 'same-origin', cache: 'no-store' },
      )
      const parsed = await parseApiJson<{
        success?: boolean
        templates?: SoftWaTemplateOption[]
        error?: string
      }>(res)
      if (!parsed.ok) {
        setTemplatesError(humanizeChatSendError(parsed.error, parsed.status))
        setTemplates([])
        return
      }
      if (!res.ok || !parsed.data.success) {
        setTemplatesError(humanizeChatSendError(parsed.data.error, res.status))
        setTemplates([])
        return
      }
      setTemplates(Array.isArray(parsed.data.templates) ? parsed.data.templates : [])
    } catch (e: unknown) {
      setTemplatesError(e instanceof Error ? e.message : 'Error al cargar plantillas')
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }

  async function handleSendTemplate(template: SoftWaTemplateOption) {
    if (!selectedConversation) return
    if (selectedConversation.recipientId === 'unknown') {
      setSendError('Selecciona una conversación para responder')
      return
    }

    setSending(true)
    setSendError(null)
    setFailedOutboundId(null)
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildChatTemplateSendBody({
            socialAccountId: selectedConversation.socialAccountId,
            recipient: selectedConversation.recipientId,
            template,
          }),
        ),
      })
      const parsed = await parseApiJson<{ success?: boolean; error?: string }>(res)
      if (!parsed.ok) {
        setSendError(humanizeChatSendError(parsed.error, parsed.status))
        setFailedOutboundId('pending-fail')
        return
      }
      if (!res.ok || !parsed.data.success) {
        setSendError(humanizeChatSendError(parsed.data.error, res.status))
        setFailedOutboundId('pending-fail')
        return
      }
      setTemplatePickerOpen(false)
      if (selectedConversation.status === 'nuevo') updateStatus('en_curso')
      if (selectedConversationId) {
        await loadThreadMessages(selectedConversationId)
        await fetchChanges()
      }
    } catch (err: unknown) {
      setSendError(humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar'))
    } finally {
      setSending(false)
    }
  }

  async function handleSendMessage(e: FormEvent, opts?: { retryClientRequestId?: string }) {
    e.preventDefault()
    if (!selectedConversation || !selectedConversationId) return
    if (sendInFlightRef.current) return

    const conversationId = selectedConversationId
    const recipient = selectedConversation.recipientId
    const socialAccountId = selectedConversation.socialAccountId

    let content = messageInput.trim()
    let clientRequestId = opts?.retryClientRequestId

    if (clientRequestId) {
      const existing = threadMessagesRef.current[conversationId] || []
      const failed = existing.find(
        (m) =>
          m.clientRequestId === clientRequestId ||
          m.id === `optimistic:${clientRequestId}`,
      )
      if (!failed?.content?.trim()) return
      content = failed.content.trim()
    }

    if (!content) return

    // Usage metric: the quick reply inserted in THIS chat since the last send (not on retries).
    const quickReplyShortcut =
      !opts?.retryClientRequestId && quickReplyUsedRef.current?.conversationId === conversationId
        ? quickReplyUsedRef.current.shortcut
        : undefined
    quickReplyUsedRef.current = null

    sendInFlightRef.current = true
    setSending(true)
    setSendError(null)
    setFailedOutboundId(null)

    if (!clientRequestId) {
      clientRequestId = newClientRequestId()
      const optimistic = createOptimisticOutboundMessage({
        content,
        clientRequestId,
        to: recipient,
        platform: selectedConversation.platform,
      })
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: appendOptimisticOutbound(prev[conversationId] || [], optimistic),
      }))
      setDtoMap((prev) => {
        const row = prev.get(conversationId)
        if (!row) return prev
        const next = new Map(prev)
        next.set(
          conversationId,
          projectOptimisticListPreview(row, content, optimistic.sentAt),
        )
        return next
      })
      setMessageInput('')
      nearBottomRef.current = true
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        composerRef.current?.focus()
      })
    } else {
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m.clientRequestId === clientRequestId || m.id === `optimistic:${clientRequestId}`
            ? { ...m, deliveryStatus: 'pending' }
            : m,
        ),
      }))
    }

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialAccountId,
          recipient,
          content,
          clientRequestId,
          ...(quickReplyShortcut ? { quickReplyShortcut } : {}),
        }),
      })
      const parsed = await parseApiJson<{
        success?: boolean
        error?: string
        message?: Parameters<typeof messageDtoToInbox>[0]
        conversationId?: string
        clientRequestId?: string | null
      }>(res)

      // Thread may have changed while the request was in flight — only patch the origin conversation.
      const stillOnSameThread = selectedConversationIdRef.current === conversationId

      if (!parsed.ok || !res.ok || !parsed.data.success) {
        const err = humanizeChatSendError(
          !parsed.ok ? parsed.error : parsed.data.error,
          !parsed.ok ? parsed.status : res.status,
        )
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: markOptimisticOutboundFailed(
            prev[conversationId] || [],
            clientRequestId!,
          ),
        }))
        if (stillOnSameThread) {
          setSendError(err)
          setFailedOutboundId(`optimistic:${clientRequestId}`)
        }
        return
      }

      if (parsed.data.message) {
        const persisted = messageDtoToInbox(parsed.data.message)
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: reconcileOptimisticOutbound(
            prev[conversationId] || [],
            persisted,
          ),
        }))
      }

      if (selectedConversation.status === 'nuevo') updateStatus('en_curso')
      // Live list/unread via changes poll — no hard thread reload (keeps optimistic UX).
      await fetchChanges()
      if (stillOnSameThread) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
          composerRef.current?.focus()
        })
      }
    } catch (err: unknown) {
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: markOptimisticOutboundFailed(
          prev[conversationId] || [],
          clientRequestId!,
        ),
      }))
      if (selectedConversationIdRef.current === conversationId) {
        setSendError(
          humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar'),
        )
        setFailedOutboundId(`optimistic:${clientRequestId}`)
      }
    } finally {
      sendInFlightRef.current = false
      setSending(false)
    }
  }

  /** Upload + send a file (WhatsApp). Returns true when sent so the composer clears the chip. */
  async function handleSendFile(file: File, caption: string): Promise<boolean> {
    if (!selectedConversation) return false
    const form = new FormData()
    form.append('file', file)
    form.append('socialAccountId', selectedConversation.socialAccountId)
    form.append('recipient', selectedConversation.recipientId)
    form.append('caption', caption.trim())
    // One id per picked file: a retry of the same file is deduplicated by the server.
    const requestIdKey = `${file.name}:${file.size}:${file.lastModified}`
    if (!pendingFileRequestIds.current.has(requestIdKey)) {
      pendingFileRequestIds.current.set(requestIdKey, newClientRequestId())
    }
    form.append('clientRequestId', pendingFileRequestIds.current.get(requestIdKey)!)
    return postChatMedia({ method: 'POST', credentials: 'same-origin', body: form })
  }

  /**
   * Quick reply with files: the files go first (the text rides as the first one's caption when it
   * fits WhatsApp's 1024 limit), then a longer text as its own message. One request id per file
   * and chat, so retrying after a partial failure never re-sends what already went out.
   */
  async function handleSendQuickReplyMedia(media: QuickReplyMedia[], text: string): Promise<boolean> {
    if (!selectedConversation || media.length === 0) return false
    const usedShortcut =
      quickReplyUsedRef.current?.conversationId === selectedConversationId ? quickReplyUsedRef.current.shortcut : undefined
    const caption = text.trim()
    const captionFits = caption.length > 0 && caption.length <= WA_CAPTION_MAX
    const keys: string[] = []
    for (let i = 0; i < media.length; i += 1) {
      const m = media[i]
      const key = `qr:${m.path}:${selectedConversation.recipientId}`
      keys.push(key)
      if (!pendingFileRequestIds.current.has(key)) pendingFileRequestIds.current.set(key, newClientRequestId())
      const ok = await postChatMedia(
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quickReplyMediaPath: m.path,
            filename: m.filename,
            socialAccountId: selectedConversation.socialAccountId,
            recipient: selectedConversation.recipientId,
            caption: i === 0 && captionFits ? caption : '',
            clientRequestId: pendingFileRequestIds.current.get(key),
            ...(i === 0 && usedShortcut ? { quickReplyShortcut: usedShortcut } : {}),
          }),
        },
        '/api/chat/send-media',
        { keepInput: true },
      )
      if (!ok) return false
    }
    for (const key of keys) pendingFileRequestIds.current.delete(key)
    if (usedShortcut) quickReplyUsedRef.current = null
    if (caption && !captionFits) {
      await handleSendMessage({ preventDefault() {} } as FormEvent)
    } else {
      setMessageInput('')
    }
    return true
  }

  /** "Recientes": re-send a photo already stored in this business's chats. */
  async function handleSendRecent(sourceMessageId: string, caption: string): Promise<boolean> {
    if (!selectedConversation) return false
    const requestIdKey = `recent:${sourceMessageId}:${selectedConversation.recipientId}`
    if (!pendingFileRequestIds.current.has(requestIdKey)) {
      pendingFileRequestIds.current.set(requestIdKey, newClientRequestId())
    }
    // A retry of a failed send reuses the id (no double send); after success the next pick is new.
    const sent = await postChatMedia({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceMessageId,
        socialAccountId: selectedConversation.socialAccountId,
        recipient: selectedConversation.recipientId,
        caption: caption.trim(),
        clientRequestId: pendingFileRequestIds.current.get(requestIdKey),
      }),
    })
    if (sent) pendingFileRequestIds.current.delete(requestIdKey)
    return sent
  }

  async function postChatMedia(
    init: RequestInit,
    url = '/api/chat/send-media',
    opts: { keepInput?: boolean } = {},
  ): Promise<boolean> {
    if (!selectedConversation || !selectedConversationId || sendInFlightRef.current) return false
    const conversationId = selectedConversationId
    sendInFlightRef.current = true
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(url, init)
      const parsed = await parseApiJson<{
        success?: boolean
        error?: string
        sent?: boolean
        message?: Parameters<typeof messageDtoToInbox>[0]
      }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) {
        const alreadySent = parsed.ok && parsed.data.sent === true
        if (selectedConversationIdRef.current === conversationId) {
          setSendError(
            humanizeChatSendError(!parsed.ok ? parsed.error : parsed.data.error, !parsed.ok ? parsed.status : res.status),
          )
        }
        // The customer already got it: clear the chip so nobody re-sends it.
        if (alreadySent) {
          await fetchChanges()
          return true
        }
        return false
      }
      if (parsed.data.message) {
        const persisted = messageDtoToInbox(parsed.data.message)
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: reconcileOptimisticOutbound(prev[conversationId] || [], persisted),
        }))
      }
      if (!opts.keepInput) setMessageInput('')
      if (selectedConversation.status === 'nuevo') updateStatus('en_curso')
      await fetchChanges()
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }))
      return true
    } catch (err: unknown) {
      if (selectedConversationIdRef.current === conversationId) {
        setSendError(humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar el archivo'))
      }
      return false
    } finally {
      sendInFlightRef.current = false
      setSending(false)
    }
  }

  function handleRetryMessage(messageId: string) {
    const crid = messageId.startsWith('optimistic:')
      ? messageId.slice('optimistic:'.length)
      : (threadMessagesRef.current[selectedConversationId || ''] || []).find(
          (m) => m.id === messageId,
        )?.clientRequestId
    if (!crid) return
    void handleSendMessage({ preventDefault() {} } as FormEvent, {
      retryClientRequestId: crid,
    })
  }

  const emptyReason = (() => {
    if (accounts.length === 0) return 'no-channels' as const
    if (conversations.length === 0 && !loading) return 'no-chats' as const
    if (visibleConversations.length === 0 && !loading) return 'no-results' as const
    return null
  })()

  const selectedDto = selectedConversationId ? dtoMap.get(selectedConversationId) : null

  // Order created from this chat: link it (ChatMessage.orderId) and refresh the thread.
  // The order is never rolled back if linking fails.
  const handleOrderCreated = async (order: CreatedOrderRef) => {
    const conv = selectedConversation
    const conversationId = selectedConversationId
    const label = `#${order.orderId}`
    if (!conv || !conversationId) return
    try {
      const res = await fetch('/api/chat/order-link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: conv.socialAccountId,
          peerId: conv.recipientId,
          order: order.id ?? order.orderId,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast({ variant: 'success' as any, title: `Pedido ${label} creado y vinculado al chat` })
      setClientPanelRev((n) => n + 1)
      await fetchThreadMessages(conversationId)
    } catch {
      toast({ title: `Pedido ${label} creado`, description: 'No se pudo vincular al chat.' })
    }
  }
  const waWindowOpen = selectedDto?.waWindowOpen ?? true
  // Re-read when the drawer closes: the form saves the chat's draft on close.
  const orderDraftPending = useMemo(
    () => (selectedConversationId && !createOrderOpen ? hasOrderDraft(`chat:${selectedConversationId}`, (viewerSession?.user as { tenantId?: string } | undefined)?.tenantId) : false),
    [selectedConversationId, createOrderOpen, viewerSession],
  )
  const clientPanel =
    selectedConversationId && selectedConversation && !selectedConversation.isDemo ? (
      <>
      <ChatAdOriginCard key={`ad-${selectedConversationId}`} conversationId={selectedConversationId} />
      <ChatClientPanel
        key={selectedConversationId}
        conversationId={selectedConversationId}
        platform={selectedConversation.platform === 'instagram' ? 'instagram' : 'whatsapp'}
        revision={clientPanelRev}
        onCreateOrder={() => setCreateOrderOpen(true)}
        onGuiaSent={() => {
          if (selectedConversationId) void fetchThreadMessages(selectedConversationId)
          void fetchChanges()
        }}
      />
      </>
    ) : null

  const threadSharedProps = {
    presence: presenceText,
    snooze: snoozeAvailable
      ? {
          until: selectedConversationId ? dtoMap.get(selectedConversationId)?.snooze?.until ?? null : null,
          onSnooze: (untilIso: string) => setSnoozeFor(untilIso),
          onWake: () => setSnoozeFor(null),
        }
      : undefined,
    conversation: selectedConversation,
    messageInput,
    onMessageInput: setMessageInput,
    onSend: handleSendMessage,
    sending,
    sendError,
    onClearError: () => setSendError(null),
    onRetry: () => {
      if (failedOutboundId) handleRetryMessage(failedOutboundId)
      else void handleSendMessage({ preventDefault() {} } as FormEvent)
    },
    onRetryMessage: handleRetryMessage,
    failedOutboundId,
    composerRef,
    messagesEndRef,
    messagesContainerRef,
    onMessagesScroll: () => {
      const el = messagesContainerRef.current
      if (!el) return
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    },
    showTemplateCta:
      Boolean(selectedConversation) &&
      selectedConversation!.platform === 'whatsapp' &&
      (!waWindowOpen || isWhatsAppWindowClosedError(sendError)),
    hasMoreMessages: Boolean(
      selectedConversationId && threadBeforeCursor[selectedConversationId],
    ),
    loadingOlder,
    onLoadOlder: () => void handleLoadOlder(),
    templates,
    templatesLoading,
    templatesError,
    showTemplatePicker: templatePickerOpen,
    onOpenTemplatePicker: () => {
      void openTemplatePicker()
    },
    onCloseTemplatePicker: () => setTemplatePickerOpen(false),
    onSendTemplate: (tpl: SoftWaTemplateOption) => {
      void handleSendTemplate(tpl)
    },
    agentMode: selectedDto ? conversationAgentMode(selectedDto.aiMode) : selectedAgentState.mode,
    onTakeOver: () => void setAgentControl('take_over'),
    onPauseAi: () => void setAgentControl('pause'),
    onResumeAi: () => void setAgentControl('resume'),
    onCreateOrder: () => setCreateOrderOpen(true),
    orderDraftPending,
    assignment: { assignees, viewerUserId, onAssign: (id: string | null) => void assignTo(id), busy: assignBusy },
    attachments: outboundMedia
      ? {
          accept: WA_OUTBOUND_ACCEPT,
          onSendFile: handleSendFile,
          onSendRecent: handleSendRecent,
          onSendQuickReplyMedia: handleSendQuickReplyMedia,
        }
      : undefined,
    quickReplies: {
      items: quickReplyItems,
      onChange: changeQuickReplies,
      canManage: canManageQuickReplies,
      onUsed: (shortcut: string) => {
        if (selectedConversationId) quickReplyUsedRef.current = { conversationId: selectedConversationId, shortcut }
      },
    },
    aiBusy: controlBusy,
    threadLoading: Boolean(selectedConversationId && threadLoadingId === selectedConversationId),
    threadError: Boolean(selectedConversationId && threadErrorId === selectedConversationId),
    onRetryThread: () => {
      if (selectedConversationId) void loadThreadMessages(selectedConversationId)
    },
    channelDownMessage: selectedAccountHealth
      ? `${accountDisplayLabel(selectedAccountHealth.account)} · ${selectedAccountHealth.health.label.toLowerCase()}. Los mensajes de este chat pueden no enviarse.`
      : null,
  }

  return (
    <AuroraShell
      fullBleed
      bottomNav={
        mobileView === 'list' ? (
          <AuroraMobileNav chatsBadge={unreadChatCount} channelsAlert={channelsAlert} />
        ) : undefined
      }
    >
      <header className="hidden shrink-0 items-end justify-between gap-4 border-b border-slate-200/70 bg-white px-5 py-3 md:flex">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold leading-tight text-slate-900">Chats</h1>
          <p className="truncate text-[12px] text-slate-500">
            Bandeja unificada · WhatsApp e Instagram
          </p>
        </div>
        <AuroraTopActions />
      </header>
      <SoftTokenHealthBanners accounts={accounts} />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-white">
        <div className="relative hidden min-h-0 min-w-0 flex-1 md:flex">
          <SoftConversationList
            conversations={visibleConversations}
            selectedKey={selectedKey}
            onSelect={selectConversation}
            channelFilter={channelFilter}
            onChannelFilter={setChannelFilter}
            accounts={filteredAccounts}
            selectedAccountId={accountFilter}
            onAccountFilter={setAccountFilter}
            openCount={openCount}
            countsByAccount={lineCounts.byAccount}
            totalOpen={lineCounts.total.open}
            loadError={listError}
            onRetryLoad={() => void retryInitialLoad()}
            syncAgeSeconds={null}
            lastSyncAt={lastSyncAt}
            loading={loading}
            emptyReason={emptyReason}
            hasMoreConversations={Boolean(listNextCursor)}
            loadingMoreConversations={loadingMoreConversations}
            onLoadMoreConversations={() => void loadMoreConversations()}
            bucket={bucket}
            onBucketChange={setBucket}
            search={search}
            onSearchChange={setSearch}
            monitor={monitorStats}
            tags={activeTags.map((t) => t.key)}
            activeTag={activeTag}
            onTagClick={(tag) => setActiveTag((prev) => (prev === tag ? null : tag))}
          />
          <SoftThreadPane
            {...threadSharedProps}
            detailsPanel={{ open: detailsOpen, onToggle: toggleDetails }}
            onClose={() => {
              setSelectedConversationId(null)
              setMobileView('list')
            }}
          />
          {railConversation ? (
            detailsOpen ? (
              <>
                {/* Below 1536 px the panel floats over the thread instead of squeezing it. */}
                {!wideScreen ? (
                  <button
                    type="button"
                    aria-label="Cerrar detalles"
                    onClick={toggleDetails}
                    className="absolute inset-0 z-20 bg-slate-900/20 backdrop-blur-[1px] 2xl:hidden"
                  />
                ) : null}
                <div
                  className={`flex h-full w-[300px] shrink-0 flex-col border-l border-slate-200/70 bg-white ${
                    wideScreen ? '' : 'absolute inset-y-0 right-0 z-30 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right-8 motion-safe:duration-200'
                  }`}
                  data-testid="chat-details-panel"
                >
                  <ChatContextRail
                    conversation={railConversation}
                    tab={railTab}
                    onTabChange={setRailTab}
                    onStatusChange={updateStatus}
                    onToggleTag={toggleTag}
                    agentMode={threadSharedProps.agentMode}
                    toolLog={selectedAgentState.toolLog}
                    onTakeOver={() => void setAgentControl('take_over')}
                    onPauseAi={() => void setAgentControl('pause')}
                    onResumeAi={() => void setAgentControl('resume')}
                    clientPanel={clientPanel}
                  />
                </div>
              </>
            ) : null
          ) : (
            // No chat selected: the empty state for the details column.
            <aside
              className="hidden h-full w-[268px] shrink-0 flex-col items-center justify-center border-l border-slate-200/70 bg-white px-6 text-center xl:flex"
              data-testid="rail-empty"
            >
              <p className="text-[13px] font-medium text-slate-700">Ningún chat seleccionado</p>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
                Elegí una conversación para ver sus detalles y el estado del agente.
              </p>
            </aside>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 md:hidden">
          {mobileView === 'list' ? (
            <SoftConversationList
              conversations={visibleConversations}
              selectedKey={selectedKey}
              onSelect={selectConversation}
              channelFilter={channelFilter}
              onChannelFilter={setChannelFilter}
              accounts={filteredAccounts}
              selectedAccountId={accountFilter}
              onAccountFilter={setAccountFilter}
              openCount={openCount}
              countsByAccount={lineCounts.byAccount}
              totalOpen={lineCounts.total.open}
              loadError={listError}
              onRetryLoad={() => void retryInitialLoad()}
              syncAgeSeconds={null}
              lastSyncAt={lastSyncAt}
              loading={loading}
              emptyReason={emptyReason}
              compact
              bucket={bucket}
              onBucketChange={setBucket}
              search={search}
              onSearchChange={setSearch}
              hasMoreConversations={Boolean(listNextCursor)}
              loadingMoreConversations={loadingMoreConversations}
              onLoadMoreConversations={() => void loadMoreConversations()}
            />
          ) : (
            <SoftThreadPane
              {...threadSharedProps}
              onClose={() => setMobileView('list')}
              onBack={() => {
                setMobileDetailsOpen(false)
                setMobileView('list')
              }}
              onOpenDetails={() => setMobileDetailsOpen(true)}
              agentActionsToday={agentActionsToday}
              compact
            />
          )}
          {mobileView === 'thread' && mobileDetailsOpen && railConversation ? (
            <div
              className="fixed inset-0 z-40 flex flex-col bg-white md:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="Detalles del chat"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 py-3">
                <h2 className="text-[16px] font-bold text-slate-900">Detalles</h2>
                <button
                  type="button"
                  onClick={() => setMobileDetailsOpen(false)}
                  className="rounded-full bg-slate-100 px-3.5 py-1.5 text-[13px] font-semibold text-slate-700"
                >
                  Cerrar
                </button>
              </div>
              <ChatContextRail
                conversation={railConversation}
                tab={railTab}
                onTabChange={setRailTab}
                onStatusChange={updateStatus}
                onToggleTag={toggleTag}
                agentMode={threadSharedProps.agentMode}
                toolLog={selectedAgentState.toolLog}
                onTakeOver={() => void setAgentControl('take_over')}
                onPauseAi={() => void setAgentControl('pause')}
                onResumeAi={() => void setAgentControl('resume')}
                clientPanel={clientPanel}
              />
            </div>
          ) : null}
        </div>
      </div>
      {createOrderOpen && selectedConversation ? (
        <CrearPedidoDrawer
          open
          onOpenChange={setCreateOrderOpen}
          subtitle={`Desde el chat con ${selectedConversation.recipientName || selectedConversation.recipientId}`}
          prefill={{
            name: selectedConversation.recipientName || undefined,
            phone: selectedConversation.platform === 'whatsapp' ? selectedConversation.recipientId : undefined,
            username: selectedConversation.platform === 'instagram' ? selectedConversation.recipientName || undefined : undefined,
          }}
          onCreated={handleOrderCreated}
          draftKey={selectedConversationId ? `chat:${selectedConversationId}` : undefined}
        />
      ) : null}
    </AuroraShell>
  )
}
