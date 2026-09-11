'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CHAT_POLL_INTERVAL_MS,
  groupMessagesByRecipient,
  humanizeChatSendError,
  messagesFingerprint,
  parseApiJson,
  type ChatInboxMessage,
} from '@/lib/chat-inbox'
import {
  mergeChatMessagesById,
  nextThreadPager,
  type ThreadPagerState,
} from '@/lib/chat-message-query'
import {
  accountDisplayLabel,
  conversationStorageKey,
  enrichConversations,
  filterSoftConversations,
  isWhatsAppWindowClosedError,
  isWhatsAppWindowOpen,
  readStatusMap,
  readTagsMap,
  writeStatusMap,
  writeTagsMap,
  type ChannelFilter,
  type ConversationStatus,
  type InboxBucket,
  type SoftAiMonitorStats,
  type SoftConversation,
  type SoftSocialAccount,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import {
  buildSoftDemoConversations,
  isSoftDemoAccountId,
  isSoftDemoConversation,
  readSoftDemoMode,
  softDemoSocialAccounts,
  writeSoftDemoMode,
  type SoftDemoMode,
} from '@/lib/soft-demo-chats'
import {
  applyAgentControl,
  getConversationAgentState,
  readAgentStateMap,
  writeAgentStateMap,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai'
import { runSoftDemoAiPass } from '@/lib/soft-ai/demo-runner'
import { SoftSlimNav } from '@/components/chats/SoftSlimNav'
import { SoftInboxBuckets } from '@/components/chats/SoftInboxBuckets'
import { SoftConversationList } from '@/components/chats/SoftConversationList'
import {
  SoftThreadPane,
  type SoftWaTemplateOption,
} from '@/components/chats/SoftThreadPane'
import { SoftCopilotRail } from '@/components/chats/SoftCopilotRail'

const TAG_FILTERS: SoftTag[] = ['Envío', 'VIP', 'Nuevo']
const POLL_LIMIT = 100
const OLDER_PAGE_LIMIT = 50

function softKey(c: SoftConversation) {
  return conversationStorageKey(c.socialAccountId, c.recipientId)
}

export function SoftCopilotInbox() {
  const [accounts, setAccounts] = useState<SoftSocialAccount[]>([])
  const [allConversations, setAllConversations] = useState<SoftConversation[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [bucket, setBucket] = useState<InboxBucket>('tus_chats')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('todos')
  const [accountFilter, setAccountFilter] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<SoftTag | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [failedOutboundId, setFailedOutboundId] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<'detalle' | 'copilot'>('copilot')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncAgeSeconds, setSyncAgeSeconds] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [statusMap, setStatusMap] = useState<Record<string, ConversationStatus>>({})
  const [tagsMap, setTagsMap] = useState<Record<string, SoftTag[]>>({})
  const [threadPagers, setThreadPagers] = useState<Record<string, ThreadPagerState>>({})
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [templates, setTemplates] = useState<SoftWaTemplateOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState<SoftDemoMode>('off')
  const [demoHydrated, setDemoHydrated] = useState(false)
  const [demoConversationsLive, setDemoConversationsLive] = useState<SoftConversation[]>([])
  const [agentStateMap, setAgentStateMap] = useState<SoftAiAgentStateMap>({})
  const [aiBusy, setAiBusy] = useState(false)
  const [controlBusy, setControlBusy] = useState(false)
  const demoAiRanRef = useRef(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesFingerprintRef = useRef('')
  const nearBottomRef = useRef(true)
  const statusMapRef = useRef(statusMap)
  const tagsMapRef = useRef(tagsMap)
  const accountMessagesRef = useRef<Record<string, ChatInboxMessage[]>>({})

  useEffect(() => {
    statusMapRef.current = statusMap
  }, [statusMap])
  useEffect(() => {
    tagsMapRef.current = tagsMap
  }, [tagsMap])

  useEffect(() => {
    setStatusMap(readStatusMap())
    setTagsMap(readTagsMap())
    setAgentStateMap(readAgentStateMap())
    setDemoMode(readSoftDemoMode())
    setDemoHydrated(true)
  }, [])

  const demoConversations = useMemo(() => {
    if (!demoHydrated || demoMode !== 'on') return []
    return demoConversationsLive.length > 0
      ? demoConversationsLive
      : buildSoftDemoConversations()
  }, [demoHydrated, demoMode, demoConversationsLive])

  // Soft DEMO e2e: AI answers alone without Meta
  useEffect(() => {
    if (!demoHydrated || demoMode !== 'on' || demoAiRanRef.current) return
    demoAiRanRef.current = true
    const seed = buildSoftDemoConversations()
    setDemoConversationsLive(seed)
    setAiBusy(true)
    void runSoftDemoAiPass({
      conversations: seed,
      agentState: readAgentStateMap(),
    })
      .then((pass) => {
        setDemoConversationsLive(pass.conversations)
        setAgentStateMap(pass.agentState)
        writeAgentStateMap(pass.agentState)
        // Sync tags/status from AI results into maps
        const nextTags = { ...readTagsMap() }
        const nextStatus = { ...readStatusMap() }
        for (const c of pass.conversations) {
          const key = softKey(c)
          nextTags[key] = c.tags
          nextStatus[key] = c.status
        }
        setTagsMap(nextTags)
        setStatusMap(nextStatus)
        writeTagsMap(nextTags)
        writeStatusMap(nextStatus)
      })
      .finally(() => setAiBusy(false))
  }, [demoHydrated, demoMode])
  const demoAccounts = useMemo(
    () => (demoHydrated && demoMode === 'on' ? softDemoSocialAccounts() : []),
    [demoHydrated, demoMode],
  )
  const accountsForUi = useMemo(() => {
    if (demoAccounts.length === 0) return accounts
    const ids = new Set(accounts.map((a) => a.id))
    return [...accounts, ...demoAccounts.filter((a) => !ids.has(a.id))]
  }, [accounts, demoAccounts])
  const whatsappCount = accountsForUi.filter((a) => a.platform === 'whatsapp').length
  const instagramCount = accountsForUi.filter((a) => a.platform === 'instagram').length

  const filteredAccounts = useMemo(() => {
    return accountsForUi.filter((a) => {
      if (channelFilter === 'whatsapp') return a.platform === 'whatsapp'
      if (channelFilter === 'instagram') return a.platform === 'instagram'
      return true
    })
  }, [accountsForUi, channelFilter])

  const pollAccountIds = useMemo(() => {
    // Never poll Meta for demo account ids
    const realFiltered = accounts.filter((a) => {
      if (channelFilter === 'whatsapp') return a.platform === 'whatsapp'
      if (channelFilter === 'instagram') return a.platform === 'instagram'
      return true
    })
    if (accountFilter !== 'all') {
      if (isSoftDemoAccountId(accountFilter)) return []
      return realFiltered.some((a) => a.id === accountFilter) ? [accountFilter] : []
    }
    return realFiltered.map((a) => a.id)
  }, [accounts, channelFilter, accountFilter])

  const rebuildConversations = useCallback(
    (opts?: { forceScroll?: boolean }) => {
      const byAccount = Object.entries(accountMessagesRef.current)
        .map(([accountId, messages]) => {
          const account = accounts.find((a) => a.id === accountId)
          if (!account) return null
          return { account, messages }
        })
        .filter(Boolean) as Array<{ account: SoftSocialAccount; messages: ChatInboxMessage[] }>

      const fp = byAccount
        .map(({ account, messages }) => `${account.id}:${messagesFingerprint(messages)}`)
        .join('||')
      const changed = fp !== messagesFingerprintRef.current
      if (!changed && !opts?.forceScroll) return false

      const prevLen = messagesFingerprintRef.current
        ? messagesFingerprintRef.current.split('|').filter(Boolean).length
        : 0
      messagesFingerprintRef.current = fp

      const enriched: SoftConversation[] = []
      for (const { account, messages } of byAccount) {
        enriched.push(
          ...enrichConversations({
            messages,
            socialAccountId: account.id,
            platform: account.platform,
            accountLabel: accountDisplayLabel(account),
            statusMap: statusMapRef.current,
            tagsMap: tagsMapRef.current,
            groupFn: groupMessagesByRecipient,
          }),
        )
      }
      enriched.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
      setAllConversations(enriched)
      setLastSyncAt(Date.now())

      const nextLen = byAccount.reduce((n, row) => n + row.messages.length, 0)
      if (opts?.forceScroll || (nextLen > prevLen && nearBottomRef.current)) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        })
      }
      return true
    },
    [accounts],
  )

  const fetchMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (pollAccountIds.length === 0) {
        accountMessagesRef.current = {}
        setAllConversations([])
        messagesFingerprintRef.current = ''
        return
      }
      if (!opts?.silent) setLoading(true)
      try {
        const accountById = new Map(accounts.map((a) => [a.id, a]))
        const results = await Promise.all(
          pollAccountIds.map(async (id) => {
            const res = await fetch(
              `/api/chat/messages?socialAccountId=${encodeURIComponent(id)}&limit=${POLL_LIMIT}`,
              { credentials: 'same-origin', cache: 'no-store' },
            )
            const parsed = await parseApiJson<{
              success?: boolean
              messages?: ChatInboxMessage[]
              nextCursor?: string
              hasMore?: boolean
              error?: string
            }>(res)
            if (!parsed.ok || !res.ok || !parsed.data.success || !Array.isArray(parsed.data.messages)) {
              return null
            }
            const account = accountById.get(id)
            if (!account) return null
            return {
              account,
              messages: parsed.data.messages,
              hasMore: Boolean(parsed.data.hasMore),
              nextCursor: parsed.data.nextCursor,
            }
          }),
        )
        const ok = results.filter(Boolean) as Array<{
          account: SoftSocialAccount
          messages: ChatInboxMessage[]
          hasMore: boolean
          nextCursor?: string
        }>

        for (const row of ok) {
          const prev = accountMessagesRef.current[row.account.id] || []
          accountMessagesRef.current[row.account.id] = mergeChatMessagesById(prev, row.messages)
        }

        // Seed per-thread hasMore from account-level page when unknown
        setThreadPagers((prev) => {
          const next = { ...prev }
          for (const row of ok) {
            const grouped = groupMessagesByRecipient(row.messages, row.account.platform)
            for (const conv of grouped) {
              const key = conversationStorageKey(row.account.id, conv.recipientId)
              if (next[key]) continue
              if (row.hasMore && conv.messages.length > 0) {
                next[key] = {
                  hasMore: true,
                  nextCursor: conv.messages[0]?.id,
                }
              } else {
                next[key] = { hasMore: false }
              }
            }
          }
          return next
        })

        rebuildConversations()
      } catch (e: unknown) {
        if (!opts?.silent) {
          console.error(e instanceof Error ? e.message : 'Error al cargar mensajes')
        }
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [pollAccountIds, accounts, rebuildConversations],
  )

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/chat/accounts', { credentials: 'same-origin' })
      const parsed = await parseApiJson<{
        success?: boolean
        accounts?: SoftSocialAccount[]
        error?: string
      }>(res)
      if (parsed.ok && parsed.data.success && Array.isArray(parsed.data.accounts)) {
        setAccounts(parsed.data.accounts)
      }
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : 'Error al cargar cuentas')
    }
  }

  useEffect(() => {
    void fetchAccounts()
  }, [])

  useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    if (pollAccountIds.length === 0) return
    const poll = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void fetchMessages({ silent: true })
    }
    const intervalId = window.setInterval(poll, CHAT_POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollAccountIds, fetchMessages])

  useEffect(() => {
    if (lastSyncAt == null) {
      setSyncAgeSeconds(null)
      return
    }
    const tick = () => setSyncAgeSeconds(Math.max(0, Math.floor((Date.now() - lastSyncAt) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [lastSyncAt])

  // Soft keyboard feel: ⌘K search, Esc back, ↑↓ list nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const typing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="Buscar"]')
        input?.focus()
        input?.select()
        return
      }

      if (e.key === 'Escape') {
        if (typing && target) {
          ;(target as HTMLInputElement).blur?.()
        }
        setSelectedKey(null)
        setMobileView('list')
        setTemplatePickerOpen(false)
        return
      }

      if (typing) return

      if (e.key === '/' ) {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="Buscar"]')
        input?.focus()
        return
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return

      const list = visibleConversationsRef.current
      if (!list.length) return

      const currentIdx = list.findIndex((c) => softKey(c) === selectedKeyRef.current)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = list[Math.min(list.length - 1, Math.max(0, currentIdx) + 1)] || list[0]
        if (next) selectConversationRef.current(next)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev =
          list[Math.max(0, (currentIdx < 0 ? 0 : currentIdx) - 1)] || list[list.length - 1]
        if (prev) selectConversationRef.current(prev)
        return
      }
      if (e.key === 'Enter' && currentIdx >= 0) {
        e.preventDefault()
        setMobileView('thread')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const conversationsWithLocalState = useMemo(() => {
    const real = allConversations.map((c) => {
      const key = softKey(c)
      return {
        ...c,
        status: statusMap[key] || c.status,
        tags: tagsMap[key] || c.tags,
      }
    })
    const demos = demoConversations.map((c) => {
      const key = softKey(c)
      return {
        ...c,
        status: statusMap[key] || c.status,
        tags: tagsMap[key] || c.tags,
        isDemo: true as const,
      }
    })
    return [...demos, ...real].sort((a, b) =>
      (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''),
    )
  }, [allConversations, statusMap, tagsMap, demoConversations])

  const visibleConversationsRef = useRef<SoftConversation[]>([])
  const selectedKeyRef = useRef(selectedKey)
  const selectConversationRef = useRef<(c: SoftConversation) => void>(() => {})
  useEffect(() => {
    selectedKeyRef.current = selectedKey
  }, [selectedKey])

  const openCount = useMemo(
    () => conversationsWithLocalState.filter((c) => c.status !== 'hecho').length,
    [conversationsWithLocalState],
  )

  const selectedConversation =
    conversationsWithLocalState.find((c) => softKey(c) === selectedKey) || null

  const selectedPager = selectedKey ? threadPagers[selectedKey] : undefined

  const selectedAgentState = selectedKey
    ? getConversationAgentState(
        agentStateMap,
        selectedKey,
        Boolean(selectedConversation?.isDemo),
      )
    : getConversationAgentState(agentStateMap, '__none__', false)

  const monitorStats: SoftAiMonitorStats = useMemo(() => {
    let aiActive = 0
    let paused = 0
    let human = 0
    let toolActions = 0
    for (const c of conversationsWithLocalState) {
      if (c.status === 'hecho') continue
      const st = getConversationAgentState(agentStateMap, softKey(c), Boolean(c.isDemo))
      if (st.mode === 'ai_active') aiActive += 1
      else if (st.mode === 'paused') paused += 1
      else human += 1
      toolActions += st.toolLog.length
    }
    return { aiActive, paused, human, toolActions }
  }, [conversationsWithLocalState, agentStateMap])

  const visibleConversations = useMemo(() => {
    let list = filterSoftConversations(conversationsWithLocalState, {
      bucket,
      channel: channelFilter,
      accountId: accountFilter,
      search,
    })
    if (bucket === 'ia_manejando') {
      list = list.filter((c) => {
        const st = getConversationAgentState(agentStateMap, softKey(c), Boolean(c.isDemo))
        return st.mode === 'ai_active' && c.status !== 'hecho'
      })
    }
    if (activeTag) {
      list = list.filter((c) => c.tags.includes(activeTag))
    }
    return list
  }, [
    conversationsWithLocalState,
    bucket,
    channelFilter,
    accountFilter,
    search,
    activeTag,
    agentStateMap,
  ])

  useEffect(() => {
    visibleConversationsRef.current = visibleConversations
  }, [visibleConversations])

  const emptyReason = (() => {
    if (accounts.length === 0 && demoMode !== 'on') return 'no-channels' as const
    if (conversationsWithLocalState.length === 0 && !loading) return 'no-chats' as const
    if (
      visibleConversations.length === 0 &&
      (search || activeTag || bucket === 'hechos' || bucket === 'ia_manejando')
    ) {
      return 'no-results' as const
    }
    if (visibleConversations.length === 0 && !loading) return 'no-chats' as const
    return null
  })()

  function handleMessagesScroll() {
    const el = messagesContainerRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function selectConversation(conv: SoftConversation) {
    setSelectedKey(softKey(conv))
    setSendError(null)
    setFailedOutboundId(null)
    setMessageInput('')
    setTemplatePickerOpen(false)
    setTemplates([])
    setTemplatesError(null)
    nearBottomRef.current = true
    setMobileView('thread')
  }
  selectConversationRef.current = selectConversation

  function enableDemoChats() {
    demoAiRanRef.current = false
    const seed = buildSoftDemoConversations()
    setDemoConversationsLive(seed)
    writeSoftDemoMode('on')
    setDemoMode('on')
    setAiBusy(true)
    void runSoftDemoAiPass({
      conversations: seed,
      agentState: readAgentStateMap(),
    })
      .then((pass) => {
        demoAiRanRef.current = true
        setDemoConversationsLive(pass.conversations)
        setAgentStateMap(pass.agentState)
        writeAgentStateMap(pass.agentState)
        const nextTags = { ...readTagsMap() }
        const nextStatus = { ...readStatusMap() }
        for (const c of pass.conversations) {
          const key = softKey(c)
          nextTags[key] = c.tags
          nextStatus[key] = c.status
        }
        setTagsMap(nextTags)
        setStatusMap(nextStatus)
        writeTagsMap(nextTags)
        writeStatusMap(nextStatus)
      })
      .finally(() => setAiBusy(false))
  }

  function removeDemoChats() {
    writeSoftDemoMode('off')
    setDemoMode('off')
    setDemoConversationsLive([])
    demoAiRanRef.current = false
    if (selectedConversation && isSoftDemoConversation(selectedConversation)) {
      setSelectedKey(null)
      setMobileView('list')
    }
  }

  function updateStatus(status: ConversationStatus) {
    if (!selectedConversation) return
    const key = softKey(selectedConversation)
    const next = { ...statusMap, [key]: status }
    setStatusMap(next)
    writeStatusMap(next)
  }

  function toggleTag(tag: SoftTag) {
    if (!selectedConversation) return
    const key = softKey(selectedConversation)
    const current = tagsMap[key] || selectedConversation.tags
    const nextTags = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag]
    const next = { ...tagsMap, [key]: nextTags }
    setTagsMap(next)
    writeTagsMap(next)
  }

  async function setAgentControl(action: 'take_over' | 'pause' | 'resume') {
    if (!selectedConversation || controlBusy) return
    const key = softKey(selectedConversation)
    const isDemo = Boolean(selectedConversation.isDemo)

    // Soft DEMO: local-only is OK (no Meta / no tenant flag row required).
    if (isDemo) {
      const next = applyAgentControl(agentStateMap, key, action, true)
      setAgentStateMap(next)
      writeAgentStateMap(next)
      return
    }

    // F37-02: await server control success BEFORE committing UI mode (server truth).
    setControlBusy(true)
    try {
      const res = await fetch('/api/chat/soft-ai/control', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, conversationKey: key }),
      })
      const parsed = await parseApiJson<{
        success?: boolean
        mode?: string
        error?: string
      }>(res)
      if (!parsed.ok || !res.ok || !parsed.data.success) {
        const err =
          humanizeChatSendError(
            parsed.ok ? parsed.data.error : parsed.error,
            parsed.ok ? res.status : parsed.status,
          ) || 'No se pudo actualizar el control de IA'
        setSendError(err)
        return
      }
      const next = applyAgentControl(agentStateMap, key, action, false)
      setAgentStateMap(next)
      writeAgentStateMap(next)
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : 'No se pudo actualizar el control de IA'
      setSendError(err)
    } finally {
      setControlBusy(false)
    }
  }

  async function handleLoadOlder() {
    if (!selectedConversation || loadingOlder) return
    const key = softKey(selectedConversation)
    const pager = threadPagers[key]
    const cursor =
      pager?.nextCursor || selectedConversation.messages[0]?.id || undefined
    if (!cursor && pager?.hasMore === false) return

    setLoadingOlder(true)
    try {
      const params = new URLSearchParams({
        socialAccountId: selectedConversation.socialAccountId,
        recipientId: selectedConversation.recipientId,
        limit: String(OLDER_PAGE_LIMIT),
      })
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(`/api/chat/messages?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const parsed = await parseApiJson<{
        success?: boolean
        messages?: ChatInboxMessage[]
        nextCursor?: string
        hasMore?: boolean
        error?: string
      }>(res)

      if (!parsed.ok) {
        setSendError(humanizeChatSendError(parsed.error, parsed.status))
        return
      }
      if (!res.ok || !parsed.data.success || !Array.isArray(parsed.data.messages)) {
        setSendError(humanizeChatSendError(parsed.data.error, res.status))
        return
      }

      const accountId = selectedConversation.socialAccountId
      const prev = accountMessagesRef.current[accountId] || []
      accountMessagesRef.current[accountId] = mergeChatMessagesById(prev, parsed.data.messages)
      setThreadPagers((state) => ({
        ...state,
        [key]: nextThreadPager({
          nextCursor: parsed.data.nextCursor,
          hasMore: parsed.data.hasMore,
        }),
      }))
      rebuildConversations({ forceScroll: false })
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Error al cargar mensajes anteriores')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function openTemplatePicker() {
    if (!selectedConversation) return
    if (isSoftDemoConversation(selectedConversation)) {
      setSendError('Chat DEMO — no se envían plantillas a Meta.')
      return
    }
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
    if (isSoftDemoConversation(selectedConversation)) {
      setSendError('Chat DEMO — no se envía a Meta. Quitá el demo o usá un chat real.')
      return
    }
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
        body: JSON.stringify({
          socialAccountId: selectedConversation.socialAccountId,
          recipient: selectedConversation.recipientId,
          type: 'template',
          templateName: template.name,
          templateLanguage: template.language,
          content: `[Plantilla] ${template.name}`,
        }),
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
      if (selectedConversation.status === 'nuevo') {
        updateStatus('en_curso')
      }
      await fetchMessages({ silent: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al enviar plantilla'
      setSendError(humanizeChatSendError(message))
      setFailedOutboundId('pending-fail')
    } finally {
      setSending(false)
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    if (!messageInput.trim() || !selectedConversation) return

    // Soft DEMO: F37-03 — human may write after Pausar / Tomar control (local only, never Meta).
    if (isSoftDemoConversation(selectedConversation)) {
      const mode = selectedAgentState.mode
      if (mode !== 'paused' && mode !== 'human') {
        setSendError('Tomá control o pausá la IA para escribir en DEMO.')
        return
      }
      const content = messageInput.trim()
      const key = softKey(selectedConversation)
      const sentAt = new Date().toISOString()
      const outbound = {
        id: `demo-human-${key}-${Date.now()}`,
        direction: 'outbound' as const,
        content,
        sentAt,
        receivedAt: null as string | null,
      }
      setDemoConversationsLive((prev) => {
        const base = prev.length > 0 ? prev : buildSoftDemoConversations()
        return base.map((c) => {
          if (softKey(c) !== key) return c
          const messages = [...c.messages, outbound]
          return {
            ...c,
            messages,
            lastMessage: content,
            lastMessageAt: sentAt,
            unreadCount: 0,
            isDemo: true as const,
          }
        })
      })
      setMessageInput('')
      setSendError(null)
      setFailedOutboundId(null)
      nearBottomRef.current = true
      if (selectedConversation.status === 'nuevo') {
        updateStatus('en_curso')
      }
      return
    }

    if (selectedConversation.recipientId === 'unknown') {
      setSendError('Selecciona una conversación para responder')
      return
    }

    const recipient = selectedConversation.recipientId
    const socialAccountId = selectedConversation.socialAccountId
    const content = messageInput.trim()
    setSending(true)
    setSendError(null)
    setFailedOutboundId(null)

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialAccountId, recipient, content }),
      })
      const parsed = await parseApiJson<{ success?: boolean; error?: string; message?: string }>(
        res,
      )

      if (!parsed.ok) {
        const err = humanizeChatSendError(parsed.error, parsed.status)
        setSendError(err)
        setFailedOutboundId('pending-fail')
        return
      }
      if (!res.ok || !parsed.data.success) {
        const err = humanizeChatSendError(parsed.data.error, res.status)
        setSendError(err)
        setFailedOutboundId('pending-fail')
        return
      }

      setMessageInput('')
      nearBottomRef.current = true
      if (selectedConversation.status === 'nuevo') {
        updateStatus('en_curso')
      }
      await fetchMessages({ silent: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al enviar'
      setSendError(humanizeChatSendError(message))
      setFailedOutboundId('pending-fail')
    } finally {
      setSending(false)
    }
  }

  async function handleRetry() {
    if (!messageInput.trim()) {
      setSendError('Reescribí el mensaje y enviá de nuevo.')
      return
    }
    await handleSendMessage({ preventDefault() {} } as FormEvent)
  }

  const showTemplateCta =
    Boolean(selectedConversation) &&
    selectedConversation!.platform === 'whatsapp' &&
    (!isWhatsAppWindowOpen(selectedConversation!.messages, 'whatsapp') ||
      isWhatsAppWindowClosedError(sendError))

  const threadSharedProps = {
    conversation: selectedConversation,
    messageInput,
    onMessageInput: setMessageInput,
    onSend: handleSendMessage,
    sending,
    sendError,
    onClearError: () => setSendError(null),
    onRetry: handleRetry,
    messagesEndRef,
    messagesContainerRef,
    onMessagesScroll: handleMessagesScroll,
    showTemplateCta,
    hasMoreMessages: Boolean(selectedPager?.hasMore),
    loadingOlder,
    onLoadOlder: handleLoadOlder,
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
    agentMode: selectedAgentState.mode,
    onTakeOver: () => {
      void setAgentControl('take_over')
    },
    onPauseAi: () => {
      void setAgentControl('pause')
    },
    onResumeAi: () => {
      void setAgentControl('resume')
    },
    aiBusy: aiBusy || controlBusy,
  }

  const listPane = (
    <SoftConversationList
      conversations={visibleConversations}
      selectedKey={selectedKey}
      onSelect={selectConversation}
      channelFilter={channelFilter}
      onChannelFilter={(f) => {
        setChannelFilter(f)
        setSelectedKey(null)
        setMobileView('list')
      }}
      accounts={filteredAccounts}
      selectedAccountId={accountFilter}
      onAccountFilter={(id) => {
        setAccountFilter(id)
        setSelectedKey(null)
      }}
      openCount={openCount}
      syncAgeSeconds={syncAgeSeconds}
      loading={loading}
      emptyReason={emptyReason}
      demoMode={demoMode === 'on'}
      hasDemoInList={demoMode === 'on' && demoConversations.length > 0}
      onLoadDemo={enableDemoChats}
      onRemoveDemo={removeDemoChats}
    />
  )

  const threadPane = (
    <SoftThreadPane
      {...threadSharedProps}
      failedOutboundId={
        failedOutboundId && selectedConversation?.messages.length
          ? selectedConversation.messages[selectedConversation.messages.length - 1]?.id
          : failedOutboundId
      }
      onClose={() => {
        setSelectedKey(null)
        setMobileView('list')
      }}
    />
  )

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

        {/* Desktop / tablet: list + thread + rail */}
        <div className="hidden min-h-0 min-w-0 flex-1 md:flex">
          {listPane}
          {threadPane}
          <SoftCopilotRail
            conversation={selectedConversation}
            tab={railTab}
            onTabChange={setRailTab}
            onStatusChange={updateStatus}
            onToggleTag={toggleTag}
            agentMode={selectedAgentState.mode}
            toolLog={selectedAgentState.toolLog}
            onTakeOver={() => {
              void setAgentControl('take_over')
            }}
            onPauseAi={() => {
              void setAgentControl('pause')
            }}
            onResumeAi={() => {
              void setAgentControl('resume')
            }}
          />
        </div>

        {/* Mobile: list or thread */}
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
              demoMode={demoMode === 'on'}
              hasDemoInList={demoMode === 'on' && demoConversations.length > 0}
              onLoadDemo={enableDemoChats}
              onRemoveDemo={removeDemoChats}
            />
          ) : (
            <SoftThreadPane
              {...threadSharedProps}
              failedOutboundId={failedOutboundId}
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
