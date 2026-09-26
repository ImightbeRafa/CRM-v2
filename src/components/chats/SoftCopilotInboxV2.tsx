'use client'

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
  advanceRevisionCursor,
  buildChangesPollQuery,
  buildChatTemplateSendBody,
  buildLocalImportPayload,
  CHAT_INBOX_V2_FULL_RECONCILE_MS,
  CHAT_INBOX_V2_IMPORTED_KEY,
  CHAT_INBOX_V2_LIST_PAGE_LIMIT,
  CHAT_INBOX_V2_POLL_MS,
  CHAT_INBOX_V2_THREAD_FETCH_LIMIT,
  decideInboxV2PollTick,
  listDtoToSoftConversation,
  mergeListDtoIntoMap,
  mergeThreadMessageWindow,
  messageDtoToInbox,
  softConversationKeyFromDto,
  sortedConversationDtos,
} from '@/lib/chat-inbox-v2-client'
import {
  applyAgentControl,
  getConversationAgentState,
  readAgentStateMap,
  writeAgentStateMap,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai/agent-state'
import { lineHealth, lineIsDown, summarizeLineCounts } from '@/lib/chat-line-filter'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { SoftInboxBuckets } from '@/components/chats/SoftInboxBuckets'
import { SoftConversationList } from '@/components/chats/SoftConversationList'
import {
  SoftThreadPane,
  type SoftWaTemplateOption,
} from '@/components/chats/SoftThreadPane'
import { SoftTokenHealthBanners } from '@/components/chats/SoftTokenHealthBanners'
import { SoftCopilotRail } from '@/components/chats/SoftCopilotRail'
import { AuroraMobileNav } from '@/components/aurora/AuroraMobileNav'

const TAG_FILTERS: SoftTag[] = ['Envío', 'VIP', 'Nuevo']

function softKey(c: SoftConversation) {
  return conversationStorageKey(c.socialAccountId, c.recipientId)
}

export function SoftCopilotInboxV2() {
  const [accounts, setAccounts] = useState<SoftSocialAccount[]>([])
  const [dtoMap, setDtoMap] = useState<Map<string, ChatConversationListItemDto>>(new Map())
  const [threadMessages, setThreadMessages] = useState<Record<string, ChatInboxMessage[]>>({})
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [bucket, setBucket] = useState<InboxBucket>('tus_chats')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('todos')
  const [accountFilter, setAccountFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<SoftTag | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(false)
  const [threadLoadingId, setThreadLoadingId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [failedOutboundId, setFailedOutboundId] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<'detalle' | 'copilot'>('copilot')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncAgeSeconds, setSyncAgeSeconds] = useState<number | null>(null)
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
  const pollInFlightRef = useRef(false)
  const selectedConversationIdRef = useRef<string | null>(null)
  const threadMessagesRef = useRef<Record<string, ChatInboxMessage[]>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendInFlightRef = useRef(false)

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

  const fetchAccounts = useCallback(async () => {
    const res = await fetch('/api/chat/accounts?includeInactive=1', { credentials: 'same-origin', cache: 'no-store' })
    const parsed = await parseApiJson<{ success?: boolean; accounts?: SoftSocialAccount[] }>(res)
    if (parsed.ok && res.ok && parsed.data.success && Array.isArray(parsed.data.accounts)) {
      setAccounts(parsed.data.accounts)
    }
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
    const res = await fetch(`/api/chat/conversations?${qs.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const parsed = await parseApiJson<{
      success?: boolean
      conversations?: ChatConversationListItemDto[]
      nextCursor?: string | null
      maxRevision?: string
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.conversations) {
      throw new Error('list_failed')
    }
    setDtoMap((prev) =>
      opts?.replace
        ? mergeListDtoIntoMap(new Map(), parsed.data.conversations!)
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
      const threadAfter =
        threadId && persistedTail
          ? `${persistedTail.sentAt},${persistedTail.id}`
          : null

      const qs = buildChangesPollQuery({
        afterRevision: after,
        limit: 200,
        // Piggyback thread tail only on the first page of a drain burst.
        threadId: guard === 1 ? threadId : null,
        threadAfter: guard === 1 ? threadAfter : null,
      })
      const res = await fetch(`/api/chat/conversations/changes?${qs}`, {
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
    const res = await fetch(
      `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`,
      { credentials: 'same-origin', cache: 'no-store' },
    )
    const parsed = await parseApiJson<{
      success?: boolean
      messages?: Array<Parameters<typeof messageDtoToInbox>[0]>
      nextBefore?: string | null
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success || !parsed.data.messages) return
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
    } finally {
      setThreadLoadingId((cur) => (cur === conversationId ? null : cur))
    }
  }, [fetchThreadMessages])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await fetchAccounts()
      await runLocalImportOnce()
      try {
        await fetchListPage({ replace: true })
      } catch {
        setListError(true)
      }
      setLoading(false)
    })()
  }, [fetchAccounts, fetchListPage, runLocalImportOnce])

  async function retryInitialLoad() {
    setLoading(true)
    setListError(false)
    try {
      await fetchAccounts()
      await fetchListPage({ replace: true })
    } catch {
      setListError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const tick = () => {
      void (async () => {
        const decision = decideInboxV2PollTick({
          documentHidden: typeof document !== 'undefined' ? document.hidden : false,
          inFlight: pollInFlightRef.current,
          nowMs: Date.now(),
          lastFullReconcileMs: lastFullReconcileRef.current,
          fullReconcileEveryMs: CHAT_INBOX_V2_FULL_RECONCILE_MS,
        })
        if (decision.action === 'skip') return
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
          pollInFlightRef.current = false
        }
      })()
    }
    const id = window.setInterval(tick, CHAT_INBOX_V2_POLL_MS)
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    const onFocus = () => tick()
    const onOnline = () => tick()
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

  useEffect(() => {
    if (!lastSyncAt) return
    const ageTick = () => setSyncAgeSeconds(Math.floor((Date.now() - lastSyncAt) / 1000))
    ageTick()
    const id = window.setInterval(ageTick, 1000)
    return () => window.clearInterval(id)
  }, [lastSyncAt])

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
      if (dto.status === 'hecho') continue
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

  const visibleConversations = useMemo(() => {
    let list = filterSoftConversations(conversations, {
      bucket,
      channel: channelFilter,
      accountId: accountFilter,
      search,
    })
    if (bucket === 'ia_manejando') {
      list = list.filter((c) => {
        const dto = [...dtoMap.values()].find(
          (d) => d.socialAccountId === c.socialAccountId && d.peerId === c.recipientId,
        )
        return dto?.aiMode === 'ai_active' && c.status !== 'hecho'
      })
    }
    if (activeTag) list = list.filter((c) => c.tags.includes(activeTag))
    return list
  }, [conversations, bucket, channelFilter, accountFilter, search, activeTag, dtoMap])

  const openCount = useMemo(
    () => conversations.filter((c) => c.status !== 'hecho').length,
    [conversations],
  )

  const lineCounts = useMemo(() => summarizeLineCounts(conversations), [conversations])

  const unreadChatCount = useMemo(
    () => conversations.filter((c) => c.status !== 'hecho' && (c.unreadCount || 0) > 0).length,
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
    setSelectedConversationId(dto.id)
    setSendError(null)
    setFailedOutboundId(null)
    setMessageInput('')
    setTemplatePickerOpen(false)
    setMobileDetailsOpen(false)
    nearBottomRef.current = true
    setMobileView('thread')
    void loadThreadMessages(dto.id).then(() => {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
        composerRef.current?.focus()
      })
    })
  }

  async function patchConversation(partial: {
    status?: ConversationStatus
    tags?: SoftTag[]
  }) {
    if (!selectedConversationId) return
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
      setDtoMap((prev) => mergeListDtoIntoMap(prev, [parsed.data.conversation!]))
    }
  }

  function updateStatus(status: ConversationStatus) {
    void patchConversation({ status })
  }

  function toggleTag(tag: SoftTag) {
    if (!selectedConversation) return
    const nextTags = selectedConversation.tags.includes(tag)
      ? selectedConversation.tags.filter((t) => t !== tag)
      : [...selectedConversation.tags, tag]
    void patchConversation({ tags: nextTags })
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
  const waWindowOpen = selectedDto?.waWindowOpen ?? true

  const threadSharedProps = {
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
    agentMode: (selectedDto?.aiMode || selectedAgentState.mode) as typeof selectedAgentState.mode,
    onTakeOver: () => void setAgentControl('take_over'),
    onPauseAi: () => void setAgentControl('pause'),
    onResumeAi: () => void setAgentControl('resume'),
    aiBusy: controlBusy,
    threadLoading: Boolean(selectedConversationId && threadLoadingId === selectedConversationId),
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
      </header>
      <SoftTokenHealthBanners accounts={accounts} />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-white">
        <SoftInboxBuckets
          bucket={bucket}
          onBucketChange={setBucket}
          search={search}
          onSearchChange={setSearch}
          whatsappCount={whatsappCount}
          instagramCount={instagramCount}
          monitor={monitorStats}
          tags={TAG_FILTERS}
          activeTag={activeTag}
          onTagClick={(tag) => setActiveTag((prev) => (prev === tag ? null : tag))}
        />
        <div className="hidden min-h-0 min-w-0 flex-1 md:flex">
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
            syncAgeSeconds={syncAgeSeconds}
            loading={loading}
            emptyReason={emptyReason}
            hasMoreConversations={Boolean(listNextCursor)}
            loadingMoreConversations={loadingMoreConversations}
            onLoadMoreConversations={() => void loadMoreConversations()}
          />
          <SoftThreadPane
            {...threadSharedProps}
            onClose={() => {
              setSelectedConversationId(null)
              setMobileView('list')
            }}
          />
          <SoftCopilotRail
            conversation={selectedConversation}
            tab={railTab}
            onTabChange={setRailTab}
            onStatusChange={updateStatus}
            onToggleTag={toggleTag}
            agentMode={threadSharedProps.agentMode}
            toolLog={selectedAgentState.toolLog}
            onTakeOver={() => void setAgentControl('take_over')}
            onPauseAi={() => void setAgentControl('pause')}
            onResumeAi={() => void setAgentControl('resume')}
          />
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
              syncAgeSeconds={syncAgeSeconds}
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
          {mobileView === 'thread' && mobileDetailsOpen && selectedConversation ? (
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
              <SoftCopilotRail
                sheet
                conversation={selectedConversation}
                tab={railTab}
                onTabChange={setRailTab}
                onStatusChange={updateStatus}
                onToggleTag={toggleTag}
                agentMode={threadSharedProps.agentMode}
                toolLog={selectedAgentState.toolLog}
                onTakeOver={() => void setAgentControl('take_over')}
                onPauseAi={() => void setAgentControl('pause')}
                onResumeAi={() => void setAgentControl('resume')}
              />
            </div>
          ) : null}
        </div>
      </div>
    </AuroraShell>
  )
}
