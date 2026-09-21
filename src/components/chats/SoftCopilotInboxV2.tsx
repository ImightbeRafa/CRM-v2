'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  humanizeChatSendError,
  parseApiJson,
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
  buildChatTemplateSendBody,
  buildLocalImportPayload,
  CHAT_INBOX_V2_FULL_RECONCILE_MS,
  CHAT_INBOX_V2_IMPORTED_KEY,
  CHAT_INBOX_V2_LIST_PAGE_LIMIT,
  CHAT_INBOX_V2_POLL_MS,
  listDtoToSoftConversation,
  mergeListDtoIntoMap,
  messageDtoToInbox,
  softConversationKeyFromDto,
  sortedConversationDtos,
  walkConversationListPages,
} from '@/lib/chat-inbox-v2-client'
import {
  applyAgentControl,
  getConversationAgentState,
  readAgentStateMap,
  writeAgentStateMap,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai'
import { SoftSlimNav } from '@/components/chats/SoftSlimNav'
import { SoftInboxBuckets } from '@/components/chats/SoftInboxBuckets'
import { SoftConversationList } from '@/components/chats/SoftConversationList'
import {
  SoftThreadPane,
  type SoftWaTemplateOption,
} from '@/components/chats/SoftThreadPane'
import { SoftCopilotRail } from '@/components/chats/SoftCopilotRail'

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
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [failedOutboundId, setFailedOutboundId] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<'detalle' | 'copilot'>('copilot')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncAgeSeconds, setSyncAgeSeconds] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [threadBeforeCursor, setThreadBeforeCursor] = useState<Record<string, string | null>>({})
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [templates, setTemplates] = useState<SoftWaTemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [agentStateMap, setAgentStateMap] = useState<SoftAiAgentStateMap>({})
  const [controlBusy, setControlBusy] = useState(false)

  const maxRevisionRef = useRef<bigint>(BigInt(0))
  const lastFullReconcileRef = useRef(0)
  const importStartedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  useEffect(() => {
    setAgentStateMap(readAgentStateMap())
  }, [])

  const fetchAccounts = useCallback(async () => {
    const res = await fetch('/api/chat/accounts', { credentials: 'same-origin', cache: 'no-store' })
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

  const fetchFullList = useCallback(async () => {
    try {
      const walked = await walkConversationListPages({
        fetchPage: async (cursor) => {
          const qs = new URLSearchParams({ limit: String(CHAT_INBOX_V2_LIST_PAGE_LIMIT) })
          if (cursor) qs.set('cursor', cursor)
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
          return {
            conversations: parsed.data.conversations,
            nextCursor: parsed.data.nextCursor ?? null,
            maxRevision: parsed.data.maxRevision ?? null,
          }
        },
      })
      if (!walked.complete) return
      setDtoMap(mergeListDtoIntoMap(new Map(), walked.items))
      if (walked.maxRevision) {
        maxRevisionRef.current = BigInt(walked.maxRevision)
      }
      setLastSyncAt(Date.now())
      lastFullReconcileRef.current = Date.now()
    } catch {
      // Keep the previous map if a mid-walk page fails.
    }
  }, [])

  const fetchChanges = useCallback(async () => {
    const after = maxRevisionRef.current.toString()
    const res = await fetch(
      `/api/chat/conversations/changes?afterRevision=${encodeURIComponent(after)}&limit=200`,
      { credentials: 'same-origin', cache: 'no-store' },
    )
    const parsed = await parseApiJson<{
      success?: boolean
      conversations?: ChatConversationListItemDto[]
      maxRevision?: string
    }>(res)
    if (!parsed.ok || !res.ok || !parsed.data.success) return
    if (parsed.data.conversations?.length) {
      setDtoMap((prev) => mergeListDtoIntoMap(prev, parsed.data.conversations!))
    }
    if (parsed.data.maxRevision) {
      maxRevisionRef.current = BigInt(parsed.data.maxRevision)
    }
    setLastSyncAt(Date.now())
  }, [])

  const loadThreadMessages = useCallback(
    async (conversationId: string, opts?: { tailOnly?: boolean }) => {
      const dto = dtoMap.get(conversationId)
      const after =
        opts?.tailOnly && threadMessages[conversationId]?.length
          ? (() => {
              const last = threadMessages[conversationId]![threadMessages[conversationId]!.length - 1]!
              return `${last.sentAt},${last.id}`
            })()
          : null
      const qs = after
        ? `after=${encodeURIComponent(after)}&limit=50`
        : 'limit=50'
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
      setThreadMessages((prev) => {
        const existing = prev[conversationId] || []
        if (after) {
          const byId = new Map(existing.map((m) => [m.id, m]))
          for (const m of incoming) byId.set(m.id, m)
          return { ...prev, [conversationId]: [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt)) }
        }
        return { ...prev, [conversationId]: incoming }
      })
      if (parsed.data.nextBefore !== undefined) {
        setThreadBeforeCursor((prev) => ({
          ...prev,
          [conversationId]: parsed.data.nextBefore ?? null,
        }))
      }
      if (dto && !after) {
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
      }
    },
    [dtoMap, threadMessages],
  )

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await fetchAccounts()
      await runLocalImportOnce()
      await fetchFullList()
      setLoading(false)
    })()
  }, [fetchAccounts, fetchFullList, runLocalImportOnce])

  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        if (Date.now() - lastFullReconcileRef.current >= CHAT_INBOX_V2_FULL_RECONCILE_MS) {
          await fetchFullList()
        } else {
          await fetchChanges()
        }
        if (selectedConversationId) {
          await loadThreadMessages(selectedConversationId, { tailOnly: true })
        }
      })()
    }, CHAT_INBOX_V2_POLL_MS)
    return () => window.clearInterval(id)
  }, [fetchChanges, fetchFullList, loadThreadMessages, selectedConversationId])

  useEffect(() => {
    if (!lastSyncAt) return
    const tick = () => setSyncAgeSeconds(Math.floor((Date.now() - lastSyncAt) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [lastSyncAt])

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
    nearBottomRef.current = true
    setMobileView('thread')
    void loadThreadMessages(dto.id)
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
        `/api/chat/conversations/${encodeURIComponent(selectedConversationId)}/messages?before=${encodeURIComponent(before)}&limit=50`,
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
        [selectedConversationId]: [...older, ...(prev[selectedConversationId] || [])],
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
        await loadThreadMessages(selectedConversationId, { tailOnly: false })
        await fetchChanges()
      }
    } catch (err: unknown) {
      setSendError(humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar'))
    } finally {
      setSending(false)
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    if (!selectedConversation || !messageInput.trim()) return
    const recipient = selectedConversation.recipientId
    const socialAccountId = selectedConversation.socialAccountId
    const content = messageInput.trim()
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialAccountId, recipient, content }),
      })
      const parsed = await parseApiJson<{ success?: boolean; error?: string }>(res)
      if (!parsed.ok) {
        setSendError(humanizeChatSendError(parsed.error, parsed.status))
        setFailedOutboundId('pending-fail')
        return
      }
      if (!res.ok) {
        setSendError(humanizeChatSendError(parsed.data.error, res.status))
        setFailedOutboundId('pending-fail')
        return
      }
      if (!parsed.data.success) {
        setSendError(humanizeChatSendError(parsed.data.error, res.status))
        setFailedOutboundId('pending-fail')
        return
      }
      setMessageInput('')
      if (selectedConversation.status === 'nuevo') updateStatus('en_curso')
      if (selectedConversationId) {
        await loadThreadMessages(selectedConversationId, { tailOnly: false })
        await fetchChanges()
      }
    } catch (err: unknown) {
      setSendError(humanizeChatSendError(err instanceof Error ? err.message : 'Error al enviar'))
    } finally {
      setSending(false)
    }
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
    onRetry: () => void handleSendMessage({ preventDefault() {} } as FormEvent),
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
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#dde7f5] p-0 md:p-4 lg:p-6">
      <div className="mx-auto flex h-full w-full max-w-[1440px] min-h-0 overflow-hidden rounded-none bg-white shadow-none md:rounded-[20px] md:shadow-sm">
        <SoftSlimNav />
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
            syncAgeSeconds={syncAgeSeconds}
            loading={loading}
            emptyReason={emptyReason}
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
              syncAgeSeconds={syncAgeSeconds}
              loading={loading}
              emptyReason={emptyReason}
              compact
            />
          ) : (
            <SoftThreadPane
              {...threadSharedProps}
              onClose={() => setMobileView('list')}
              onBack={() => setMobileView('list')}
              compact
            />
          )}
        </div>
      </div>
    </div>
  )
}
