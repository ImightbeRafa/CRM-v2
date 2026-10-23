'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { installNotificationSoundUnlock, isNewInboundActivity, playNotificationChime } from '@/lib/notification-sound'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  appendOptimisticOutbound,
  createOptimisticOutboundMedia,
  createOptimisticOutboundMessage,
  humanizeChatSendError,
  markOptimisticOutboundFailed,
  settleOptimisticOutboundWithoutRow,
  shouldAutoFocusComposer,
  newClientRequestId,
  parseApiJson,
  patchOptimisticOutbound,
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
import {
  INBOX_VIEW_STORAGE_KEY,
  inboxViewRowFromDto,
  isWaitingOnUs,
  matchesInboxView,
  parseInboxView,
  sortForInboxView,
  sumInboxViewCounts,
  type InboxView,
  type InboxViewCounts,
} from '@/lib/chat-inbox-views'
import { isBuiltinChatTag, isClosedCategory, ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG } from '@/lib/crm-stages'
import { matchesChatSearch } from '@/lib/chat-search'
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
  CHAT_INBOX_V2_SSE_SILENT_MS,
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
import { aiStatusFromDto } from '@/lib/chat-inbox-v2-client'
import { emitBetsySignal } from '@/components/brand/betsy-signals'
import { betsySignalsForChange } from '@/lib/chat-betsy-signals'
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
import { IG_OUTBOUND_ACCEPT, WA_OUTBOUND_ACCEPT } from '@/lib/chat-outbound-media'
import { downscaleImageForSend, outboundKindForMime, postFormWithProgress } from '@/lib/chat-outbound-upload'
import { quickReplyMediaUrl } from '@/components/chats/composer/ComposerExtras'
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
import type { CreatedOrderRef, OrderFormPrefill } from '@/app/ventas/components/EnhancedSalesForm'
import { useToast } from '@/app/hooks/use-toast'
import { conversationDisplayName, isPlaceholderPeerName } from '@/lib/chat-peer-display'

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


/** The open chat is waiting on us (server flag, else the same fallback as the Sin responder view). */
function selectedDtoWaiting(dto: ChatConversationListItemDto | undefined): boolean {
  if (!dto || dto.stageCategory === 'won' || dto.stageCategory === 'lost') return false
  return isWaitingOnUs({ lastMessageDirection: dto.lastMessageDirection, needsPerson: dto.needsPerson, waiting: dto.waiting })
}

const IN_FLIGHT_RECHECKS = 5
const IN_FLIGHT_RECHECK_MS = 4000

/** Phone thread / details: below the global banners, as tall as the visible area above the keyboard. */
const MOBILE_THREAD_STYLE = {
  top: 'calc(var(--app-top-offset, 0px) + var(--chat-vv-top, 0px))',
  height: 'calc(var(--chat-vv-height, 100dvh) - var(--app-top-offset, 0px))',
} as const

function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(max-width: 767px)').matches)
}

/** A queued file send (captured when picked; Reintentar re-runs it with the same clientRequestId). */
type MediaSendJob = {
  conversationId: string
  conversationStatus: string | undefined
  clientRequestId: string
  socialAccountId: string
  recipient: string
  platform?: string
  caption: string
  /** Picked from the device (multipart upload) … */
  file?: File
  /** … or already stored on the server (Recientes / respuesta rápida). */
  json?: Record<string, unknown>
  previewUrl?: string
}

export function SoftCopilotInboxV2() {
  const { toast } = useToast()
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  /** Order data read from the chat (name, address, products…) for "Crear pedido" — always tied to its chat. */
  const [chatOrderPrefill, setChatOrderPrefill] = useState<{ conversationId: string; prefill: OrderFormPrefill } | null>(null)
  const [orderPrefillLoading, setOrderPrefillLoading] = useState(false)
  /** "Pedido por confirmar" to settle when an order is created from this chat's form. */
  const [resolveTagOnOrder, setResolveTagOnOrder] = useState<SoftTag | null>(null)
  const [accounts, setAccounts] = useState<SoftSocialAccount[]>([])
  const [dtoMap, setDtoMap] = useState<Map<string, ChatConversationListItemDto>>(new Map())
  // Mirror for the notification chime (compares a refreshed row with what is on screen).
  const dtoMapRef = useRef(dtoMap)
  dtoMapRef.current = dtoMap
  const [threadMessages, setThreadMessages] = useState<Record<string, ChatInboxMessage[]>>({})
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  // Another chat opened (or the thread closed): the order form of the previous chat closes with it.
  useEffect(() => {
    setCreateOrderOpen(false)
    setResolveTagOnOrder(null)
  }, [selectedConversationId])
  const chatPrefillForOpenChat =
    chatOrderPrefill && chatOrderPrefill.conversationId === selectedConversationId ? chatOrderPrefill.prefill : null
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
  /** "Respondido" (SQL 063): shown only once the server says the marker exists. */
  const [answeredAvailable, setAnsweredAvailable] = useState(false)
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
  const { activeTags, activeChatStages } = useCrmCatalog()
  /** Details panel (Cliente · Agente): remembered; wide screens start open. */
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [wideScreen, setWideScreen] = useState(true)
  /** Bumped after an order / guía changes so the Cliente tab refetches. */
  const [clientPanelRev, setClientPanelRev] = useState(0)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false)
  /** Phone: which of thread / details we pushed as a history entry (the phone's back goes there). */
  const mobileHistoryRef = useRef({ thread: false, details: false })
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
  /** Server search hits for the active query; re-merged after a reconcile replaces the list. */
  const searchHitsRef = useRef<ChatConversationListItemDto[]>([])
  const [searchHitKeys, setSearchHitKeys] = useState<ReadonlySet<string>>(() => new Set())
  /** Rows loaded outside the pages (deep link, Pospuestos): kept when the first page reloads. */
  const pinnedDtosRef = useRef<ChatConversationListItemDto[]>([])
  /** The open quick view, read by the full list refresh (see `inboxView` below). */
  const inboxViewRef = useRef<InboxView>('todos')
  const pollInFlightRef = useRef(false)
  const pollStartedAtRef = useRef(0)
  const lastPollAtRef = useRef(0)
  const lastSseFrameRef = useRef(0)
  const pendingForcedRef = useRef(false)
  const sseHealthyRef = useRef(false)
  const tickRef = useRef<((forced?: boolean) => void) | null>(null)
  const selectedConversationIdRef = useRef<string | null>(null)
  const threadMessagesRef = useRef<Record<string, ChatInboxMessage[]>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  /**
   * Sends (text and files) run one after another per chat (WhatsApp order = typing order) but never
   * block the composer: the bubble appears and the box clears at once, the request queues here.
   */
  const textSendQueueRef = useRef<Map<string, Promise<void>>>(new Map())
  /** Double-send guard: requests already queued, and the last new text (a double Enter fires before the box clears). */
  const textInFlightRef = useRef<Set<string>>(new Set())
  /** File sends by clientRequestId until they are stored (Reintentar re-runs the same job, same id). */
  const mediaJobsRef = useRef<Map<string, MediaSendJob>>(new Map())
  const sendRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** "Still sending elsewhere" re-checks per clientRequestId (bounded). */
  const inFlightChecksRef = useRef<Map<string, number>>(new Map())
  const lastQueuedTextRef = useRef<{ conversationId: string; content: string; at: number } | null>(null)
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
      answeredAvailable?: boolean
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.conversations) {
      throw new Error('list_failed')
    }
    if (typeof parsed.data.snoozeAvailable === 'boolean') setSnoozeAvailable(parsed.data.snoozeAvailable)
    if (typeof parsed.data.answeredAvailable === 'boolean') setAnsweredAvailable(parsed.data.answeredAvailable)
    setDtoMap((prev) =>
      opts?.replace
        ? (() => {
            const fresh = mergeListDtoIntoMap(new Map(), parsed.data.conversations!)
            // Prefer the live row (snooze / PATCH / changes feed) over the snapshot taken when pinned.
            const keep = [...searchHitsRef.current, ...pinnedDtosRef.current].map((c) => prev.get(c.id) ?? c).filter((c) => !fresh.has(c.id))
            // An open quick view keeps the rows that joined it after it opened (e.g. a nudge far down the list).
            const view = inboxViewRef.current
            if (view !== 'todos') {
              const kept = new Set(keep.map((c) => c.id))
              for (const d of prev.values()) {
                if (fresh.has(d.id) || kept.has(d.id)) continue
                if (matchesInboxView(inboxViewRowFromDto(d), view)) keep.push(d)
              }
            }
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
        // Betsy mark for the OPEN chat: customer wrote (listen / think when the agent answers), agent done.
        const openId = selectedConversationIdRef.current
        const openRow = openId ? parsed.data.conversations.find((c) => c.id === openId) : undefined
        if (openRow) {
          const aiHandles = aiStatusFromDto(openRow)?.state === 'ia' && !openRow.needsPerson
          for (const signal of betsySignalsForChange(dtoMapRef.current.get(openRow.id), openRow, aiHandles)) emitBetsySignal(signal)
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
        // Bubbles still queued or failed (not on the server yet) survive a reload of the thread, so
        // they keep their status and "Reintentar"; once sent they merge by clientRequestId.
        incoming: [...incoming, ...(prev[conversationId] || []).filter((m) => m.id.startsWith('optimistic:'))],
        mode: 'replace',
      }),
    }))
    if (parsed.data.nextBefore !== undefined) {
      setThreadBeforeCursor((prev) => ({
        ...prev,
        [conversationId]: parsed.data.nextBefore ?? null,
      }))
    }
    // Betsy mark: a double blink only when this open actually read something new (not on every open).
    const hadUnread = (dtoMapRef.current.get(conversationId)?.unreadCount ?? 0) > 0
    void fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: 'POST',
      credentials: 'same-origin',
    }).then((res) => {
      if (res.ok && hadUnread) emitBetsySignal('read')
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
      // A stream that went silent (no frame, not even a heartbeat) is treated as broken: back to the 5 s poll.
      if (sseHealthyRef.current && Date.now() - lastSseFrameRef.current > CHAT_INBOX_V2_SSE_SILENT_MS) {
        sseHealthyRef.current = false
      }
      // While live ticks (SSE) are healthy, the interval only acts as a slow safety net.
      if (
        !forced &&
        sseHealthyRef.current &&
        Date.now() - lastPollAtRef.current < CHAT_INBOX_V2_SSE_SAFETY_POLL_MS
      ) {
        return
      }
      void (async () => {
        const decision = decideInboxV2PollTick({
          documentHidden: typeof document !== 'undefined' ? document.hidden : false,
          inFlight: pollInFlightRef.current,
          nowMs: Date.now(),
          lastFullReconcileMs: lastFullReconcileRef.current,
          fullReconcileEveryMs: CHAT_INBOX_V2_FULL_RECONCILE_MS,
          inFlightSinceMs: pollStartedAtRef.current,
        })
        if (decision.action === 'skip') {
          // A live tick that lands while a poll is running must not be lost: re-run it when that poll ends.
          if (forced && decision.reason === 'in_flight') pendingForcedRef.current = true
          return
        }
        lastPollAtRef.current = Date.now()
        const startedAt = Date.now()
        pollStartedAtRef.current = startedAt
        pollInFlightRef.current = true
        try {
          if (decision.action === 'reconcile') {
            // Option (2): reconcile tick = one list page only (no thread fetch).
            await fetchListPage({ replace: true })
            // A live tick also needs the open thread's new messages, which the list page does not carry.
            if (forced) await fetchChanges()
          } else {
            await fetchChanges()
          }
        } catch {
          // swallow — next tick retries
        } finally {
          // Only the poll that still owns the flag clears it (a stuck one was already superseded).
          if (pollStartedAtRef.current === startedAt) pollInFlightRef.current = false
          if (pendingForcedRef.current) {
            pendingForcedRef.current = false
            tickRef.current?.(true)
          }
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
    let tickTimer: number | null = null
    let backoffMs = 5_000
    // Busy chats: coalesce live ticks so /changes runs at most every 3 s (a burst becomes one trailing poll).
    const TICK_MIN_GAP_MS = 3_000
    const onLiveTick = () => {
      const since = Date.now() - lastPollAtRef.current
      if (since >= TICK_MIN_GAP_MS) {
        tickRef.current?.(true)
        return
      }
      if (tickTimer !== null) return
      tickTimer = window.setTimeout(() => {
        tickTimer = null
        tickRef.current?.(true)
      }, TICK_MIN_GAP_MS - since)
    }

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
      if (closed || document.hidden || source) return
      source = new EventSource('/api/chat/stream')
      source.addEventListener('ready', () => {
        lastSseFrameRef.current = Date.now()
        sseHealthyRef.current = true
        backoffMs = 5_000
      })
      source.addEventListener('ping', () => {
        lastSseFrameRef.current = Date.now()
      })
      source.addEventListener('tick', () => {
        lastSseFrameRef.current = Date.now()
        onLiveTick()
      })
      source.addEventListener('full', () => {
        sseHealthyRef.current = false
        source?.close()
        source = null
      })
      source.onerror = () => {
        sseHealthyRef.current = false
        source?.close()
        source = null
        scheduleRetry()
      }
    }
    // A hidden tab holds no stream (the server polls the DB for every open stream); reopen when visible.
    const onVisibility = () => {
      if (document.hidden) {
        sseHealthyRef.current = false
        source?.close()
        source = null
        if (retryTimer !== null) window.clearTimeout(retryTimer)
        retryTimer = null
      } else if (!source) {
        backoffMs = 5_000
        void connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    void connect()
    return () => {
      closed = true
      sseHealthyRef.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (tickTimer !== null) window.clearTimeout(tickTimer)
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
      setSearchHitKeys(new Set())
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
        if (!parsed.ok || !res.ok || !parsed.data.success) return
        const hits = parsed.data.conversations ?? []
        searchHitsRef.current = hits
        setSearchHitKeys(new Set(hits.map((hit) => `${hit.socialAccountId}|${hit.peerId}`)))
        if (!hits.length) return
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
  /** The ?c= already opened: a history step back onto that URL must not reopen it (phone back loop). */
  const handledDeepLinkRef = useRef<string | null>(null)
  useEffect(() => {
    const c = searchParams?.get('c')
    if (!c) {
      handledDeepLinkRef.current = null
      return
    }
    if (c !== handledDeepLinkRef.current && c && /^[A-Za-z0-9_-]{8,64}$/.test(c)) setDeepLinkId(c)
  }, [searchParams])
  useEffect(() => {
    if (!deepLinkId) return
    if (dtoMap.has(deepLinkId)) {
      setDeepLinkId(null)
      deepLinkFetched.current = null
      handledDeepLinkRef.current = deepLinkId
      // Handled: drop ?c= so the same notification can be clicked again later. Synchronously and in
      // place, BEFORE the phone thread entry is pushed: a later router.replace would
      // overwrite that entry and the phone's back would land on ?c= and reopen the chat.
      // Plain data: Next's patched replaceState copies its own state and syncs useSearchParams.
      window.history.replaceState({}, '', '/chats')
      openConversationById(deepLinkId)
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

  // agents2-notify: chats waiting on a payment check / order confirmation can be far down the list;
  // load them on open and again when their chip is chosen, so the chip counts and list are complete.
  useEffect(() => {
    for (const tag of [PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG]) {
      void pinRows(new URLSearchParams({ tag, limit: '50' }).toString())
    }
  }, [pinRows])
  useEffect(() => {
    if (activeTag && isBuiltinChatTag(activeTag)) void pinRows(new URLSearchParams({ tag: activeTag, limit: '50' }).toString())
  }, [activeTag, pinRows])

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
      // Left to a person by the agent: not "IA activa" (same rule as the IA list).
      if (mode === 'ai_active' && !dto.needsPerson) aiActive += 1
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

  // Quick views (chat-inbox-views.ts): the tab is remembered per user on this device.
  const [inboxView, setInboxViewState] = useState<InboxView>('todos')
  const viewStorageKey = `${INBOX_VIEW_STORAGE_KEY}:${(viewerSession?.user as { id?: string } | undefined)?.id ?? 'me'}`
  useEffect(() => {
    try {
      setInboxViewState(parseInboxView(window.localStorage.getItem(viewStorageKey)))
    } catch {
      // storage blocked: start on the normal list
    }
  }, [viewStorageKey])
  const setInboxView = useCallback(
    (next: InboxView) => {
      setInboxViewState(next)
      try {
        window.localStorage.setItem(viewStorageKey, next)
      } catch {
        // storage blocked: the tab still works for this visit
      }
    },
    [viewStorageKey],
  )
  useEffect(() => {
    inboxViewRef.current = inboxView
  }, [inboxView])
  // A view lists every open chat of its kind, even far down the list: load them when it opens or the line /
  // channel changes (the changes feed keeps them fresh afterwards; the full refresh keeps them, see fetchListPage).
  useEffect(() => {
    if (inboxView === 'todos') return
    const qs = new URLSearchParams({ view: inboxView, limit: '100' })
    if (accountFilter !== 'all') qs.set('socialAccountId', accountFilter)
    else if (channelFilter !== 'todos') qs.set('platform', channelFilter)
    void pinRows(qs.toString())
  }, [inboxView, accountFilter, channelFilter, pinRows])

  // Counts: one grouped query, refreshed at most every 20 s while the list changes (never per poll).
  const [viewCountsByAccount, setViewCountsByAccount] = useState<Record<string, Partial<InboxViewCounts>> | null>(null)
  const viewCountsAtRef = useRef(0)
  const viewCountsBusyRef = useRef(false)
  useEffect(() => {
    const load = async () => {
      // One request at a time: a slow answer never stacks a second query.
      if (viewCountsBusyRef.current) return
      viewCountsBusyRef.current = true
      viewCountsAtRef.current = Date.now()
      try {
        const res = await fetch('/api/chat/conversations/view-counts', { credentials: 'same-origin', cache: 'no-store' })
        const parsed = await parseApiJson<{ success?: boolean; byAccount?: Record<string, Partial<InboxViewCounts>> }>(res)
        if (parsed.ok && res.ok && parsed.data.success && parsed.data.byAccount) setViewCountsByAccount(parsed.data.byAccount)
      } catch {
        // offline: keep the last counts
      } finally {
        viewCountsBusyRef.current = false
      }
    }
    const wait = Math.max(0, viewCountsAtRef.current + 20_000 - Date.now())
    const t = window.setTimeout(() => void load(), wait)
    return () => window.clearTimeout(t)
  }, [dtoMap])
  const inboxViewCounts = useMemo(() => {
    if (!viewCountsByAccount) return null
    const ids =
      accountFilter !== 'all'
        ? [accountFilter]
        : channelFilter === 'todos'
          ? null
          : filteredAccounts.map((a) => a.id)
    return sumInboxViewCounts(viewCountsByAccount, ids)
  }, [viewCountsByAccount, accountFilter, channelFilter, filteredAccounts])

  const dtoByKey = useMemo(() => {
    const m = new Map<string, ChatConversationListItemDto>()
    for (const d of dtoMap.values()) m.set(`${d.socialAccountId}|${d.peerId}`, d)
    return m
  }, [dtoMap])

  const visibleConversations = useMemo(() => {
    if (inboxView !== 'todos') {
      const q = search.trim().toLowerCase()
      const rows: Array<{ c: SoftConversation; id: string; lastMessageAt: string; lastOutboundAt: string | null; lastInboundAt: string | null }> = []
      for (const c of conversations) {
        const dto = dtoByKey.get(`${c.socialAccountId}|${c.recipientId}`)
        if (!dto) continue
        if (channelFilter !== 'todos' && c.platform !== channelFilter) continue
        if (accountFilter !== 'all' && c.socialAccountId !== accountFilter) continue
        if (activeTag && !c.tags.includes(activeTag)) continue
        const row = {
          aiMode: dto.aiMode,
          tags: c.tags,
          lastMessageDirection: dto.lastMessageDirection,
          lastIsFollowUp: dto.lastIsFollowUp,
          lineAiOn: dto.aiLine?.state === 'on',
          closed: isConversationClosed(c),
          hasOpenOrder: dto.hasOpenOrder === true,
          needsPerson: dto.needsPerson === true,
          ...(typeof dto.waiting === 'boolean' ? { waiting: dto.waiting } : {}),
        }
        if (!matchesInboxView(row, inboxView)) continue
        if (
          q &&
          !searchHitKeys.has(`${c.socialAccountId}|${c.recipientId}`) &&
          !matchesChatSearch(q, {
            name: c.recipientName,
            username: c.recipientUsername,
            preview: c.lastMessage,
            peerId: c.recipientId,
            accountLabel: c.accountLabel,
            orderNumber: c.orderNumber,
            phone: c.channelAddress,
          })
        ) {
          continue
        }
        rows.push({ c, id: dto.id, lastMessageAt: dto.lastMessageAt, lastOutboundAt: dto.lastOutboundAt ?? null, lastInboundAt: dto.lastInboundAt ?? null })
      }
      return sortForInboxView(rows, inboxView).map((r) => r.c)
    }
    let list = filterSoftConversations(conversations, {
      bucket,
      channel: channelFilter,
      accountId: accountFilter,
      search,
      viewerUserId,
      tag: activeTag,
      searchHitKeys,
    })
    if (bucket === 'ia_manejando' && !isBuiltinChatTag(activeTag)) {
      list = list.filter((c) => {
        const dto = [...dtoMap.values()].find(
          (d) => d.socialAccountId === c.socialAccountId && d.peerId === c.recipientId,
        )
        return dto?.aiMode === 'ai_active' && !dto.needsPerson && !isConversationClosed(c)
      })
    }
    if (activeTag) list = list.filter((c) => c.tags.includes(activeTag))
    return list
    // snoozeTick: re-evaluate snoozes as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, bucket, channelFilter, accountFilter, search, activeTag, dtoMap, dtoByKey, inboxView, viewerUserId, snoozeTick, searchHitKeys])

  const openCount = useMemo(
    () => conversations.filter((c) => !isConversationClosed(c)).length,
    [conversations],
  )
  // A bandeja tab (Míos / Sin asignar / IA…) means the normal list again.
  const changeBucket = useCallback(
    (next: InboxBucket) => {
      setBucket(next)
      setInboxView('todos')
    },
    [setInboxView],
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
    if (mobileHistoryRef.current.details) closeMobileEntry('details')
    setMobileDetailsOpen(false)
    nearBottomRef.current = true
    setMobileView('thread')
    pushMobileEntry('thread')
    void loadThreadMessages(id).then(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
        // The thread finished loading: the composer may have just been enabled / mounted.
        if (selectedConversationIdRef.current === id && shouldAutoFocusComposer()) {
          focusComposer({ preventScroll: true })
        }
      })
    })
  }

  /**
   * Phone: opening a chat / its details adds a history entry, so the phone's back button or swipe
   * goes thread → list (Rafael 2026-10-22) instead of leaving Chats. The URL does not change.
   */
  function pushMobileEntry(kind: 'thread' | 'details') {
    if (typeof window === 'undefined' || !isPhoneViewport() || mobileHistoryRef.current[kind]) return
    mobileHistoryRef.current[kind] = true
    window.history.pushState({ ...(window.history.state ?? {}), betsyChat: kind }, '')
  }

  /** In-app back / Cerrar: pop our own entries (popstate closes the view), else close directly. */
  function closeMobileEntry(kind: 'thread' | 'details') {
    const entries = kind === 'thread'
      ? Number(mobileHistoryRef.current.thread) + Number(mobileHistoryRef.current.details)
      : Number(mobileHistoryRef.current.details)
    const atOurs = typeof window !== 'undefined' && Boolean((window.history.state as { betsyChat?: string } | null)?.betsyChat)
    if (entries > 0 && atOurs) {
      window.history.go(-entries)
      return
    }
    mobileHistoryRef.current = kind === 'thread' ? { thread: false, details: false } : { ...mobileHistoryRef.current, details: false }
    setMobileDetailsOpen(false)
    if (kind === 'thread') setMobileView('list')
  }

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const at = (event.state as { betsyChat?: string } | null)?.betsyChat
      const open = mobileHistoryRef.current
      if (open.details && at !== 'details') {
        open.details = false
        setMobileDetailsOpen(false)
      }
      if (open.thread && at !== 'thread' && at !== 'details') {
        open.thread = false
        setMobileDetailsOpen(false)
        setMobileView('list')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Phone keyboard: iOS / Android shrink only the visual viewport, so the open thread follows it and
  // the composer stays right above the keyboard (header stays on screen).
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const apply = () => {
      root.style.setProperty('--chat-vv-height', `${Math.round(vv.height)}px`)
      root.style.setProperty('--chat-vv-top', `${Math.round(vv.offsetTop)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty('--chat-vv-height')
      root.style.removeProperty('--chat-vv-top')
    }
  }, [])

  // Opening a chat (click, keyboard, deep link) puts the cursor in the composer on a computer. The
  // composer can turn on a moment later (agent state loads), so it tries again while nothing else
  // took the focus (the agent clicking the search box or a button wins).
  useEffect(() => {
    if (!selectedConversationId || !shouldAutoFocusComposer()) return
    const tryFocus = () => {
      const active = document.activeElement as HTMLElement | null
      const idle = !active || active === document.body || Boolean(active.closest('[data-soft-conv-key]'))
      if (idle) focusComposer({ preventScroll: true })
    }
    const raf = requestAnimationFrame(tryFocus)
    const timers = [400, 1200].map((ms) => window.setTimeout(tryFocus, ms))
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [selectedConversationId])

  /**
   * Focus the composer on screen. Desktop and phone thread panes are both mounted (one hidden by
   * CSS) and share `composerRef`, which holds whichever mounted last, so look for the visible one.
   */
  function focusComposer(opts?: FocusOptions) {
    const candidates = [
      composerRef.current,
      ...Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-testid="composer-textarea"]')),
    ]
    candidates.find((el) => el && !el.disabled && el.getClientRects().length > 0)?.focus(opts)
  }

  async function patchConversation(partial: {
    status?: ConversationStatus
    tags?: SoftTag[]
    /** Server removes just this tag (array_remove), never a whole-array write. */
    removeTag?: SoftTag
    /** With removeTag on a review tag: 'dismissed' = false alarm (audit wording only). */
    reviewOutcome?: 'resolved' | 'dismissed'
    /** Server adds just this tag (array_append when absent, 20-tag cap). */
    addTag?: SoftTag
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
              agentId: incoming.agentId ?? before.agentId,
              agentEmoji: incoming.agentEmoji ?? before.agentEmoji,
              agentStateDot: incoming.agentStateDot ?? before.agentStateDot,
              pendingSuggestionText: incoming.pendingSuggestionText ?? before.pendingSuggestionText,
              // Agentes IA 2.0: keep the line truth; the chat status is recomputed from it + the new aiMode.
              aiLine: incoming.aiLine !== undefined ? incoming.aiLine : before.aiLine,
              aiPersistedMode: incoming.aiPersistedMode !== undefined ? incoming.aiPersistedMode : before.aiPersistedMode,
              aiHumanRecent: incoming.aiHumanRecent ?? before.aiHumanRecent,
              aiStatus: incoming.aiStatus ?? before.aiStatus,
              // PATCH never changes the snooze; keep what the list knew.
              snooze: incoming.snooze !== undefined ? incoming.snooze : before.snooze,
              // Nor the last message: a chat stays under "Seguimientos".
              lastIsFollowUp: incoming.lastIsFollowUp ?? before.lastIsFollowUp,
              // Nor who still has to answer (Sin responder / Necesita persona); the changes feed refreshes it.
              needsPerson: incoming.needsPerson ?? before.needsPerson,
              lastOutboundAt: incoming.lastOutboundAt ?? before.lastOutboundAt,
            }
          : incoming
        return mergeListDtoIntoMap(prev, [merged])
      })
      return true
    }
    return false
  }

  /**
   * "Respondido": the chat leaves Sin responder at once (optimistic); the server stamps the marker and, when the agent
   * had handed it over and its line answers, gives it back to the agent for the customer's next message.
   */
  async function markAnswered(conversationId: string): Promise<void> {
    const before = dtoMapRef.current.get(conversationId)
    if (!before) return
    setDtoMap((prev) => {
      const row = prev.get(conversationId)
      if (!row) return prev
      const next = new Map(prev)
      next.set(conversationId, { ...row, waiting: false, needsPerson: false })
      return next
    })
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/answered`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seenThrough: before.lastMessageAt }),
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        returnedToAi?: boolean
        alreadyAnswered?: boolean
        error?: string
      } | null
      if (!res.ok || !json?.success) {
        if (res.status === 409) setAnsweredAvailable(false)
        setDtoMap((prev) => {
          const next = new Map(prev)
          next.set(conversationId, prev.get(conversationId) ? { ...prev.get(conversationId)!, waiting: before.waiting, needsPerson: before.needsPerson } : before)
          return next
        })
        toast({ variant: 'destructive', title: json?.error || 'No se pudo marcar como respondido' })
        return
      }
      if (json.returnedToAi) {
        setDtoMap((prev) => {
          const row = prev.get(conversationId)
          if (!row) return prev
          const next = new Map(prev)
          next.set(conversationId, { ...row, aiMode: 'ai_active' })
          return next
        })
      }
      if (!json.alreadyAnswered) emitBetsySignal('replied')
      toast({ title: json.returnedToAi ? 'Respondido · el agente vuelve a atender este chat' : 'Marcado como respondido' })
      scheduleRefreshAfterSend()
    } catch {
      setDtoMap((prev) => {
        const next = new Map(prev)
        next.set(conversationId, before)
        return next
      })
      toast({ variant: 'destructive', title: 'Sin conexión' })
    }
  }

  /** Row quick action (list rows carry the line + peer; the server id comes from the DTO). */
  const markAnsweredFromRow = answeredAvailable
    ? (c: SoftConversation) => {
        const dto = dtoByKey.get(`${c.socialAccountId}|${c.recipientId}`)
        if (dto) void markAnswered(dto.id)
      }
    : undefined

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
    // SecureDog DATA-53: one tag in / out atomically on the server, never a whole array from a stale copy.
    const change = selectedConversation.tags.includes(tag) ? { removeTag: tag } : { addTag: tag }
    void patchConversation(change).catch(() => false).then((ok) => {
      if (!ok) toast({ variant: 'destructive', title: 'No se pudo cambiar la etiqueta', description: 'Puede que la hayan archivado o que el chat tenga 20 etiquetas. Recargá la página.' })
    })
  }

  /**
   * agents2-notify: "Pago verificado" / "Confirmado" in the chat banner. Removes the built-in review tag
   * (explicit press only — linking an order never clears it). A verified payment also moves the chat to a
   * 'pagado' stage when the business has one.
   */
  const [reviewBusy, setReviewBusy] = useState(false)
  async function resolveReviewTag(tag: SoftTag) {
    if (!selectedConversation || reviewBusy || !selectedConversation.tags.includes(tag)) return
    // "Pedido por confirmar" → Confirmado: open "Crear pedido" filled from the chat; the alert clears when it is created.
    if (tag === ORDER_REVIEW_TAG) {
      void openCreateOrderFromChat()
      return
    }
    setReviewBusy(true)
    try {
      const paidStage = tag === PAYMENT_REVIEW_TAG ? activeChatStages.find((s) => s.key === 'pagado') : undefined
      // Only this tag, removed atomically on the server (a stale local tag list can never overwrite others).
      const ok = await patchConversation({
        removeTag: tag,
        ...(paidStage && selectedConversation.status !== paidStage.key ? { status: paidStage.key } : {}),
      }).catch(() => false)
      if (ok) {
        if (tag === PAYMENT_REVIEW_TAG) emitBetsySignal('yes')
        toast({ variant: 'success', title: tag === PAYMENT_REVIEW_TAG ? 'Pago verificado' : 'Pedido confirmado' })
      } else {
        toast({ variant: 'destructive', title: 'No se pudo guardar', description: 'Probá de nuevo o recargá la página.' })
      }
    } finally {
      setReviewBusy(false)
    }
  }

  /** "No es pago" / "Descartar": a false alarm — remove the review tag, no stage change, audited as dismissed. */
  async function dismissReviewTag(tag: SoftTag) {
    if (!selectedConversation || reviewBusy || !selectedConversation.tags.includes(tag)) return
    setReviewBusy(true)
    try {
      const ok = await patchConversation({ removeTag: tag, reviewOutcome: 'dismissed' }).catch(() => false)
      if (ok) {
        toast({ variant: 'success', title: tag === PAYMENT_REVIEW_TAG ? 'Aviso de pago quitado' : 'Aviso de pedido quitado' })
      } else {
        toast({ variant: 'destructive', title: 'No se pudo guardar', description: 'Probá de nuevo o recargá la página.' })
      }
    } finally {
      setReviewBusy(false)
    }
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

  async function handleSendMessage(
    e: FormEvent,
    opts?: { retryClientRequestId?: string; /** Send this text as a NEW message (composer untouched). */ resendContent?: string },
  ) {
    e.preventDefault()
    if (!selectedConversation || !selectedConversationId) return

    const conversationId = selectedConversationId
    const conversationStatus = selectedConversation.status
    const recipient = selectedConversation.recipientId
    const socialAccountId = selectedConversation.socialAccountId

    let content = (opts?.resendContent ?? messageInput).trim()
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
    if (clientRequestId && textInFlightRef.current.has(clientRequestId)) return
    if (!clientRequestId) {
      const last = lastQueuedTextRef.current
      if (last && last.conversationId === conversationId && last.content === content && Date.now() - last.at < 1000) return
      lastQueuedTextRef.current = { conversationId, content, at: Date.now() }
    }

    // Usage metric: the quick reply inserted in THIS chat since the last send (not on retries).
    const quickReplyShortcut =
      !opts?.retryClientRequestId && opts?.resendContent === undefined && quickReplyUsedRef.current?.conversationId === conversationId
        ? quickReplyUsedRef.current.shortcut
        : undefined
    quickReplyUsedRef.current = null

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
          { ...projectOptimisticListPreview(row, content, optimistic.sentAt), waiting: false, needsPerson: false },
        )
        return next
      })
      if (opts?.resendContent === undefined) setMessageInput('')
      nearBottomRef.current = true
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        focusComposer()
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

    const requestId = clientRequestId
    textInFlightRef.current.add(requestId)
    const deliver = () =>
      deliverTextMessage({ conversationId, conversationStatus, socialAccountId, recipient, content, clientRequestId: requestId, quickReplyShortcut })
        .finally(() => textInFlightRef.current.delete(requestId))
    await enqueueChatSend(conversationId, deliver)
  }

  /**
   * The server said another request with this id is still sending it. Re-ask a few times (same id,
   * never a second send); if it is still unknown, the bubble turns failed so "Reintentar" shows.
   */
  function scheduleInFlightRecheck(conversationId: string, clientRequestId: string, run: () => Promise<void>) {
    const attempt = (inFlightChecksRef.current.get(clientRequestId) ?? 0) + 1
    if (attempt > IN_FLIGHT_RECHECKS) {
      inFlightChecksRef.current.delete(clientRequestId)
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: markOptimisticOutboundFailed(prev[conversationId] || [], clientRequestId),
      }))
      if (selectedConversationIdRef.current === conversationId) {
        setSendError('No pudimos confirmar si salió. Revisá el chat antes de tocar Reintentar.')
        setFailedOutboundId(`optimistic:${clientRequestId}`)
      }
      return
    }
    inFlightChecksRef.current.set(clientRequestId, attempt)
    window.setTimeout(() => void enqueueChatSend(conversationId, run), IN_FLIGHT_RECHECK_MS)
  }

  /** Many fast sends → one list refresh shortly after the last one (not one request per message). */
  function scheduleRefreshAfterSend() {
    if (sendRefreshTimerRef.current) clearTimeout(sendRefreshTimerRef.current)
    sendRefreshTimerRef.current = setTimeout(() => {
      sendRefreshTimerRef.current = null
      void fetchChanges()
    }, 350)
  }

  /** One queue per chat: order matters inside a conversation, a slow send never holds another chat. */
  function enqueueChatSend(conversationId: string, run: () => Promise<void>): Promise<void> {
    const queues = textSendQueueRef.current
    const queued = (queues.get(conversationId) ?? Promise.resolve()).then(run, run)
    queues.set(conversationId, queued)
    void queued.finally(() => {
      if (queues.get(conversationId) === queued) queues.delete(conversationId)
    })
    return queued
  }

  /** One queued text send: POST, then reconcile or mark the optimistic bubble as failed. */
  async function deliverTextMessage({
    conversationId,
    conversationStatus,
    socialAccountId,
    recipient,
    content,
    clientRequestId,
    quickReplyShortcut,
  }: {
    conversationId: string
    conversationStatus: string | undefined
    socialAccountId: string
    recipient: string
    content: string
    clientRequestId: string
    quickReplyShortcut?: string
  }): Promise<void> {
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
        inFlight?: boolean
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
            clientRequestId,
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
      } else {
        // Delivered but not stored yet (or another tab is sending this id): never an error.
        const inFlight = parsed.data.inFlight === true
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: settleOptimisticOutboundWithoutRow(prev[conversationId] || [], clientRequestId, { inFlight }),
        }))
        if (inFlight) {
          // Ask again shortly (same id: the server never sends twice); give up into "Reintentar".
          scheduleInFlightRecheck(conversationId, clientRequestId, () =>
            deliverTextMessage({ conversationId, conversationStatus, socialAccountId, recipient, content, clientRequestId }),
          )
          return
        }
      }
      inFlightChecksRef.current.delete(clientRequestId)

      // updateStatus is bound to the chat of this send (render-time closure), so it still applies
      // after the operator moved to another chat.
      if (conversationStatus === 'nuevo') updateStatus('en_curso')
      // Live list/unread via changes poll — no hard thread reload (keeps optimistic UX).
      // Coalesced: a burst of fast sends refreshes the list once, after the last one.
      scheduleRefreshAfterSend()
      if (stillOnSameThread && nearBottomRef.current) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    }
  }

  /**
   * A file send: the bubble (photo preview + progress) shows at once, the chip and caption clear,
   * the composer stays free and the agent may switch chats; the upload runs in this chat's queue.
   */
  function queueMediaSend(
    job: MediaSendJob,
    preview: { messageType: string; mimeType: string; filename: string },
  ) {
    mediaJobsRef.current.set(job.clientRequestId, job)
    const optimistic = createOptimisticOutboundMedia({
      clientRequestId: job.clientRequestId,
      messageType: preview.messageType,
      mimeType: preview.mimeType,
      filename: preview.filename,
      caption: job.caption,
      localPreviewUrl: job.previewUrl,
      to: job.recipient,
      platform: job.platform,
    })
    setThreadMessages((prev) => ({
      ...prev,
      [job.conversationId]: appendOptimisticOutbound(prev[job.conversationId] || [], optimistic),
    }))
    setDtoMap((prev) => {
      const row = prev.get(job.conversationId)
      if (!row) return prev
      const next = new Map(prev)
      next.set(job.conversationId, {
        ...projectOptimisticListPreview(row, job.caption || `Archivo · ${preview.filename}`, optimistic.sentAt),
        waiting: false,
        needsPerson: false,
      })
      return next
    })
    nearBottomRef.current = true
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }))
    void enqueueChatSend(job.conversationId, () => deliverMedia(job))
  }

  /** One queued file send: shrink photos, upload with progress, then reconcile or mark failed. */
  async function deliverMedia(job: MediaSendJob): Promise<void> {
    const { conversationId, clientRequestId } = job
    const patch = (next: Parameters<typeof patchOptimisticOutbound>[2]) =>
      setThreadMessages((prev) => ({
        ...prev,
        [conversationId]: patchOptimisticOutbound(prev[conversationId] || [], clientRequestId, next),
      }))
    const fail = (error: string) => {
      patch({ deliveryStatus: 'failed' })
      if (selectedConversationIdRef.current === conversationId) {
        setSendError(error)
        setFailedOutboundId(`optimistic:${clientRequestId}`)
      }
    }
    try {
      let res: Response
      if (job.file) {
        const file = await downscaleImageForSend(job.file)
        const form = new FormData()
        form.append('file', file)
        form.append('socialAccountId', job.socialAccountId)
        form.append('recipient', job.recipient)
        form.append('caption', job.caption)
        form.append('clientRequestId', clientRequestId)
        let shown = 0
        res = await postFormWithProgress('/api/chat/send-media', form, (fraction) => {
          // ~20 repaints per upload at most.
          if (fraction - shown >= 0.05 || fraction === 1) {
            shown = fraction
            patch({ uploadProgress: fraction })
          }
        })
      } else {
        res = await fetch('/api/chat/send-media', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...job.json,
            socialAccountId: job.socialAccountId,
            recipient: job.recipient,
            caption: job.caption,
            clientRequestId,
          }),
        })
        patch({ uploadProgress: 1 })
      }
      const parsed = await parseApiJson<{
        success?: boolean
        error?: string
        sent?: boolean
        inFlight?: boolean
        message?: Parameters<typeof messageDtoToInbox>[0]
      }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) {
        // Older servers answered "sent but not saved" as an error; the customer has it.
        if (parsed.ok && parsed.data.sent === true) {
          mediaJobsRef.current.delete(clientRequestId)
          setThreadMessages((prev) => ({
            ...prev,
            [conversationId]: settleOptimisticOutboundWithoutRow(prev[conversationId] || [], clientRequestId, {}),
          }))
          return
        }
        fail(humanizeChatSendError(!parsed.ok ? parsed.error : parsed.data.error, !parsed.ok ? parsed.status : res.status))
        return
      }
      if (parsed.data.inFlight === true) {
        // Keep the job (Reintentar needs it); ask again with the same id.
        patch({ deliveryStatus: 'pending' })
        scheduleInFlightRecheck(conversationId, clientRequestId, () => deliverMedia(job))
        return
      }
      inFlightChecksRef.current.delete(clientRequestId)
      mediaJobsRef.current.delete(clientRequestId)
      if (parsed.data.message) {
        const persisted = messageDtoToInbox(parsed.data.message)
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: reconcileOptimisticOutbound(prev[conversationId] || [], persisted),
        }))
        // The stored row shows the server copy; the browser preview is no longer on screen.
        if (job.previewUrl?.startsWith('blob:')) {
          const url = job.previewUrl
          setTimeout(() => URL.revokeObjectURL(url), 30_000)
        }
      } else {
        setThreadMessages((prev) => ({
          ...prev,
          [conversationId]: settleOptimisticOutboundWithoutRow(prev[conversationId] || [], clientRequestId, {}),
        }))
      }
      if (job.conversationStatus === 'nuevo') updateStatus('en_curso')
      scheduleRefreshAfterSend()
    } catch (err: unknown) {
      fail(humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar el archivo'))
    }
  }

  /** The chat a file send belongs to, captured when it is queued (the agent may switch chats). */
  function mediaJobBase(caption: string): Omit<MediaSendJob, 'clientRequestId'> | null {
    if (!selectedConversation || !selectedConversationId) return null
    return {
      conversationId: selectedConversationId,
      conversationStatus: selectedConversation.status,
      socialAccountId: selectedConversation.socialAccountId,
      recipient: selectedConversation.recipientId,
      platform: selectedConversation.platform,
      caption: caption.trim(),
    }
  }

  /** Upload + send a file (WhatsApp / Instagram photos). Queued: returns true at once so the chip clears. */
  async function handleSendFile(file: File, caption: string): Promise<boolean> {
    const kind = outboundKindForMime(file.type || '')
    // Audio never carries a caption on WhatsApp (the server drops it too).
    const base = mediaJobBase(kind === 'audio' ? '' : caption)
    if (!base) return false
    setSendError(null)
    setFailedOutboundId(null)
    queueMediaSend(
      {
        ...base,
        clientRequestId: newClientRequestId(),
        file,
        previewUrl: kind === 'image' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined,
      },
      { messageType: kind, mimeType: file.type || 'application/octet-stream', filename: file.name },
    )
    setMessageInput('')
    requestAnimationFrame(() => focusComposer())
    return true
  }

  /**
   * Quick reply with files: the files go first (the text rides as the first one's caption when it
   * fits WhatsApp's 1024 limit), then a longer text as its own message, all in this chat's order.
   */
  async function handleSendQuickReplyMedia(media: QuickReplyMedia[], text: string): Promise<boolean> {
    if (!selectedConversation || media.length === 0) return false
    const usedShortcut =
      quickReplyUsedRef.current?.conversationId === selectedConversationId ? quickReplyUsedRef.current.shortcut : undefined
    const caption = text.trim()
    const captionFits = caption.length > 0 && caption.length <= WA_CAPTION_MAX
    setSendError(null)
    setFailedOutboundId(null)
    for (let i = 0; i < media.length; i += 1) {
      const m = media[i]
      const base = mediaJobBase(i === 0 && captionFits ? caption : '')
      if (!base) return false
      const kind = outboundKindForMime(m.mime || '')
      queueMediaSend(
        {
          ...base,
          clientRequestId: newClientRequestId(),
          json: {
            quickReplyMediaPath: m.path,
            filename: m.filename,
            ...(i === 0 && usedShortcut ? { quickReplyShortcut: usedShortcut } : {}),
          },
          previewUrl: kind === 'image' ? quickReplyMediaUrl(m.path) : undefined,
        },
        { messageType: kind, mimeType: m.mime || 'application/octet-stream', filename: m.filename },
      )
    }
    if (usedShortcut) quickReplyUsedRef.current = null
    if (caption && !captionFits) {
      // Queued after the files (same chat queue); the box clears inside handleSendMessage.
      void handleSendMessage({ preventDefault() {} } as FormEvent)
    } else {
      setMessageInput('')
    }
    return true
  }

  /** "Recientes": re-send a photo already stored in this business's chats (no new upload). */
  async function handleSendRecent(sourceMessageId: string, caption: string): Promise<boolean> {
    const base = mediaJobBase(caption)
    if (!base) return false
    setSendError(null)
    setFailedOutboundId(null)
    queueMediaSend(
      {
        ...base,
        clientRequestId: newClientRequestId(),
        json: { sourceMessageId },
        previewUrl: `/api/chat/media/${encodeURIComponent(sourceMessageId)}`,
      },
      { messageType: 'image', mimeType: 'image/jpeg', filename: 'Imagen reciente' },
    )
    setMessageInput('')
    requestAnimationFrame(() => focusComposer())
    return true
  }

  function handleRetryMessage(messageId: string) {
    const crid = messageId.startsWith('optimistic:')
      ? messageId.slice('optimistic:'.length)
      : (threadMessagesRef.current[selectedConversationId || ''] || []).find(
          (m) => m.id === messageId,
        )?.clientRequestId
    if (!crid) return
    if (!messageId.startsWith('optimistic:')) {
      // A stored row Meta failed later (status webhook): it never reached the customer, so Reintentar
      // is a NEW send of the same text with a new id (the old id is already "delivered" on the server).
      const row = (threadMessagesRef.current[selectedConversationId || ''] || []).find((m) => m.id === messageId)
      if (row?.content?.trim() && (row.messageType || 'text') === 'text') {
        void handleSendMessage({ preventDefault() {} } as FormEvent, { resendContent: row.content })
      } else {
        setSendError('Este archivo o plantilla no salió: volvé a adjuntarlo o elegí la plantilla de nuevo.')
      }
      return
    }
    const mediaJob = mediaJobsRef.current.get(crid)
    if (mediaJob) {
      // Same id: the server never sends it twice (claim), even if the first try actually went out.
      setSendError(null)
      setFailedOutboundId(null)
      setThreadMessages((prev) => ({
        ...prev,
        [mediaJob.conversationId]: patchOptimisticOutbound(prev[mediaJob.conversationId] || [], crid, {
          deliveryStatus: 'pending',
          uploadProgress: 0,
        }),
      }))
      void enqueueChatSend(mediaJob.conversationId, () => deliverMedia(mediaJob))
      return
    }
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
  /** Open "Crear pedido" already filled from what the customer wrote (a person reviews and submits). */
  async function openCreateOrderFromChat() {
    const requestedId = selectedConversationId
    if (!requestedId || !selectedConversation || orderPrefillLoading) return
    // Any order created from this chat settles its "Pedido por confirmar" alert (Crear pedido or Confirmado).
    const resolveTag = selectedConversation.tags.includes(ORDER_REVIEW_TAG) ? ORDER_REVIEW_TAG : null
    setOrderPrefillLoading(true)
    toast({ title: 'Preparando el pedido con los datos del chat…' })
    let prefill: OrderFormPrefill | null = null
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(requestedId)}/order-prefill`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = res.ok ? await res.json() : null
      if (data?.customer) {
        prefill = {
          ...Object.fromEntries(Object.entries(data.customer).filter(([, v]) => typeof v === 'string' && v.trim())),
          ...(data.orderType ? { orderType: data.orderType } : {}),
          ...(data.paymentChoice ? { paymentChoice: data.paymentChoice } : {}),
          ...(Array.isArray(data.products) && data.products.length ? { products: data.products } : {}),
        } as OrderFormPrefill
      }
    } catch {
      // The form still opens with the chat's name / phone.
    } finally {
      setOrderPrefillLoading(false)
    }
    // Verifier: the person moved to another chat while this loaded → this chat's data never opens there.
    if (selectedConversationIdRef.current !== requestedId) return
    setChatOrderPrefill(prefill ? { conversationId: requestedId, prefill } : null)
    setResolveTagOnOrder(resolveTag)
    setCreateOrderOpen(true)
  }

  const handleOrderCreated = async (order: CreatedOrderRef) => {
    const conv = selectedConversation
    const conversationId = selectedConversationId
    const label = `#${order.orderId}`
    if (!conv || !conversationId) return
    // The order exists (even if linking it below fails): "Pedido por confirmar" clears so it is never created twice.
    const settleTag = resolveTagOnOrder
    setResolveTagOnOrder(null)
    if (settleTag && conv.tags.includes(settleTag)) {
      const cleared = await patchConversation({ removeTag: settleTag }).catch(() => false)
      if (!cleared) toast({ variant: 'destructive', title: 'El pedido se creó, pero no se pudo quitar el aviso', description: 'Quitalo con "Descartar".' })
    }
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
        onCreateOrder={() => void openCreateOrderFromChat()}
        onGuiaSent={() => {
          if (selectedConversationId) void fetchThreadMessages(selectedConversationId)
          void fetchChanges()
        }}
        onOrdersChanged={() => {
          if (selectedConversationId) void fetchThreadMessages(selectedConversationId)
          void fetchChanges()
        }}
      />
      </>
    ) : null

  const threadSharedProps = {
    presence: presenceText,
    reviewTags: {
      onResolve: (tag: SoftTag) => void resolveReviewTag(tag),
      onDismiss: (tag: SoftTag) => void dismissReviewTag(tag),
      busy: reviewBusy || orderPrefillLoading,
    },
    // "Corregir" on AI messages: only people who can edit agents (the API checks update_config again).
    canTuneAgent: canManageQuickReplies,
    // Respondido in the thread header: only while this chat is waiting on us (and SQL 063 is applied).
    onMarkAnswered:
      answeredAvailable && selectedConversationId && selectedDtoWaiting(dtoMap.get(selectedConversationId))
        ? () => void markAnswered(selectedConversationId)
        : undefined,
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
    igHumanAgentEnabled: selectedDto?.igHumanAgentEnabled === true,
    lastInboundAt: selectedDto?.lastInboundAt ?? null,
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
    onCreateOrder: () => void openCreateOrderFromChat(),
    orderDraftPending,
    assignment: { assignees, viewerUserId, onAssign: (id: string | null) => void assignTo(id), busy: assignBusy },
    attachments: outboundMedia
      ? {
          accept: selectedConversation?.platform === 'instagram' ? IG_OUTBOUND_ACCEPT : WA_OUTBOUND_ACCEPT,
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
            onBucketChange={changeBucket}
            search={search}
            onSearchChange={setSearch}
            monitor={monitorStats}
            tags={activeTags.map((t) => t.key)}
            activeTag={activeTag}
            onTagClick={(tag) => setActiveTag((prev) => (prev === tag ? null : tag))}
            inboxView={inboxView}
            inboxViewCounts={inboxViewCounts}
            onInboxViewChange={setInboxView}
            onMarkAnswered={markAnsweredFromRow}
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
                    detailConversation={selectedConversation ?? undefined}
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
              onBucketChange={changeBucket}
              search={search}
              onSearchChange={setSearch}
              hasMoreConversations={Boolean(listNextCursor)}
              loadingMoreConversations={loadingMoreConversations}
              onLoadMoreConversations={() => void loadMoreConversations()}
              activeTag={activeTag}
              onTagClick={(tag) => setActiveTag((prev) => (prev === tag ? null : tag))}
              inboxView={inboxView}
              inboxViewCounts={inboxViewCounts}
              onInboxViewChange={setInboxView}
              onMarkAnswered={markAnsweredFromRow}
            />
          ) : (
            // Pinned to the visual viewport: the composer sits right above the phone keyboard.
            <div className="fixed inset-x-0 z-30 flex flex-col bg-white md:hidden" style={MOBILE_THREAD_STYLE} data-testid="mobile-thread">
              <SoftThreadPane
                {...threadSharedProps}
                onClose={() => closeMobileEntry('thread')}
                onBack={() => closeMobileEntry('thread')}
                onOpenDetails={() => {
                  setMobileDetailsOpen(true)
                  pushMobileEntry('details')
                }}
                agentActionsToday={agentActionsToday}
                compact
              />
            </div>
          )}
          {mobileView === 'thread' && mobileDetailsOpen && railConversation ? (
            <div
              className="fixed inset-x-0 z-40 flex flex-col bg-white md:hidden"
              style={MOBILE_THREAD_STYLE}
              role="dialog"
              aria-modal="true"
              aria-label="Detalles del chat"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                <h2 className="text-[16px] font-bold text-slate-900">Detalles</h2>
                <button
                  type="button"
                  onClick={() => closeMobileEntry('details')}
                  className="rounded-full bg-slate-100 px-3.5 py-1.5 text-[13px] font-semibold text-slate-700"
                >
                  Cerrar
                </button>
              </div>
              <ChatContextRail
                conversation={railConversation}
                detailConversation={selectedConversation ?? undefined}
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
      {createOrderOpen && selectedConversation && (!chatOrderPrefill || chatOrderPrefill.conversationId === selectedConversationId) ? (
        <CrearPedidoDrawer
          open
          onOpenChange={setCreateOrderOpen}
          subtitle={`Desde el chat con ${conversationDisplayName(selectedConversation)}`}
          prefill={{
            ...(chatPrefillForOpenChat ?? {}),
            // The customer's own data first; the chat's name / WhatsApp number when they did not write one.
            name:
              chatPrefillForOpenChat?.name ||
              (isPlaceholderPeerName(selectedConversation.recipientName) ? undefined : selectedConversation.recipientName) ||
              undefined,
            // SecureDog L3: on WhatsApp the verified chat number is the order phone (a typed number never replaces it).
            phone: selectedConversation.platform === 'whatsapp' ? selectedConversation.recipientId : chatPrefillForOpenChat?.phone || undefined,
            username:
              selectedConversation.platform === 'instagram'
                ? selectedConversation.recipientUsername || selectedConversation.recipientName || undefined
                : undefined,
          }}
          onCreated={handleOrderCreated}
          draftKey={selectedConversationId ? `chat:${selectedConversationId}` : undefined}
        />
      ) : null}
    </AuroraShell>
  )
}
