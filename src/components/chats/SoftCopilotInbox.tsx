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
  accountDisplayLabel,
  buildAgentChecklist,
  buildSuggestedReply,
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
  type SoftConversation,
  type SoftSocialAccount,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import { SoftSlimNav } from '@/components/chats/SoftSlimNav'
import { SoftInboxBuckets } from '@/components/chats/SoftInboxBuckets'
import { SoftConversationList } from '@/components/chats/SoftConversationList'
import { SoftThreadPane } from '@/components/chats/SoftThreadPane'
import { SoftCopilotRail } from '@/components/chats/SoftCopilotRail'

const TAG_FILTERS: SoftTag[] = ['Envío', 'VIP', 'Nuevo']

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
  const [draftHint, setDraftHint] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<'detalle' | 'copilot'>('copilot')
  const [askValue, setAskValue] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncAgeSeconds, setSyncAgeSeconds] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [statusMap, setStatusMap] = useState<Record<string, ConversationStatus>>({})
  const [tagsMap, setTagsMap] = useState<Record<string, SoftTag[]>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesFingerprintRef = useRef('')
  const nearBottomRef = useRef(true)
  const statusMapRef = useRef(statusMap)
  const tagsMapRef = useRef(tagsMap)

  useEffect(() => {
    statusMapRef.current = statusMap
  }, [statusMap])
  useEffect(() => {
    tagsMapRef.current = tagsMap
  }, [tagsMap])

  useEffect(() => {
    setStatusMap(readStatusMap())
    setTagsMap(readTagsMap())
  }, [])

  const whatsappCount = accounts.filter((a) => a.platform === 'whatsapp').length
  const instagramCount = accounts.filter((a) => a.platform === 'instagram').length

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (channelFilter === 'whatsapp') return a.platform === 'whatsapp'
      if (channelFilter === 'instagram') return a.platform === 'instagram'
      return true
    })
  }, [accounts, channelFilter])

  const pollAccountIds = useMemo(() => {
    if (accountFilter !== 'all') {
      return filteredAccounts.some((a) => a.id === accountFilter) ? [accountFilter] : []
    }
    return filteredAccounts.map((a) => a.id)
  }, [filteredAccounts, accountFilter])

  const applyFetchedMessages = useCallback(
    (
      byAccount: Array<{
        account: SoftSocialAccount
        messages: ChatInboxMessage[]
      }>,
      opts?: { forceScroll?: boolean },
    ) => {
      const fp = byAccount
        .map(({ account, messages }) => `${account.id}:${messagesFingerprint(messages)}`)
        .join('||')
      const changed = fp !== messagesFingerprintRef.current
      if (!changed) return false

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
    [],
  )

  const fetchMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (pollAccountIds.length === 0) {
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
              `/api/chat/messages?socialAccountId=${encodeURIComponent(id)}&limit=100`,
              { credentials: 'same-origin', cache: 'no-store' },
            )
            const parsed = await parseApiJson<{
              success?: boolean
              messages?: ChatInboxMessage[]
              error?: string
            }>(res)
            if (!parsed.ok || !res.ok || !parsed.data.success || !Array.isArray(parsed.data.messages)) {
              return null
            }
            const account = accountById.get(id)
            if (!account) return null
            return { account, messages: parsed.data.messages }
          }),
        )
        const ok = results.filter(Boolean) as Array<{
          account: SoftSocialAccount
          messages: ChatInboxMessage[]
        }>
        applyFetchedMessages(ok)
      } catch (e: unknown) {
        if (!opts?.silent) {
          console.error(e instanceof Error ? e.message : 'Error al cargar mensajes')
        }
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [pollAccountIds, accounts, applyFetchedMessages],
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

  // ⌘K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="Buscar"]')
        input?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const conversationsWithLocalState = useMemo(
    () =>
      allConversations.map((c) => {
        const key = softKey(c)
        return {
          ...c,
          status: statusMap[key] || c.status,
          tags: tagsMap[key] || c.tags,
        }
      }),
    [allConversations, statusMap, tagsMap],
  )

  const visibleConversations = useMemo(() => {
    let list = filterSoftConversations(conversationsWithLocalState, {
      bucket,
      channel: channelFilter,
      accountId: accountFilter,
      search,
    })
    if (activeTag) {
      list = list.filter((c) => c.tags.includes(activeTag))
    }
    return list
  }, [conversationsWithLocalState, bucket, channelFilter, accountFilter, search, activeTag])

  const openCount = useMemo(
    () => conversationsWithLocalState.filter((c) => c.status !== 'hecho').length,
    [conversationsWithLocalState],
  )

  const selectedConversation =
    conversationsWithLocalState.find((c) => softKey(c) === selectedKey) || null

  const checklist = buildAgentChecklist({
    hasConversation: Boolean(selectedConversation),
    hasSummary: Boolean(selectedConversation?.messages.length),
    hasDraft: Boolean(draftHint),
    windowOpen: selectedConversation
      ? isWhatsAppWindowOpen(selectedConversation.messages, selectedConversation.platform)
      : true,
  })

  const emptyReason = (() => {
    if (accounts.length === 0) return 'no-channels' as const
    if (allConversations.length === 0 && !loading) return 'no-chats' as const
    if (visibleConversations.length === 0 && (search || activeTag || bucket === 'hechos')) {
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
    setDraftHint(null)
    setMessageInput('')
    nearBottomRef.current = true
    setMobileView('thread')
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

  function handleSuggest() {
    if (!selectedConversation) return
    const { draft } = buildSuggestedReply(selectedConversation)
    setDraftHint(draft)
    setRailTab('copilot')
  }

  function applyDraft(draft?: string) {
    const text = draft || draftHint
    if (!text) return
    setMessageInput(text)
    setDraftHint(null)
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    if (!messageInput.trim() || !selectedConversation) return
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
      // retry last failed by re-focusing composer — user may need to retype
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
    />
  )

  const threadPane = (
    <SoftThreadPane
      conversation={selectedConversation}
      messageInput={messageInput}
      onMessageInput={setMessageInput}
      onSend={handleSendMessage}
      sending={sending}
      sendError={sendError}
      onClearError={() => setSendError(null)}
      onRetry={handleRetry}
      failedOutboundId={
        failedOutboundId && selectedConversation?.messages.length
          ? selectedConversation.messages[selectedConversation.messages.length - 1]?.id
          : failedOutboundId
      }
      onSuggest={handleSuggest}
      onClose={() => {
        setSelectedKey(null)
        setMobileView('list')
      }}
      messagesEndRef={messagesEndRef}
      messagesContainerRef={messagesContainerRef}
      onMessagesScroll={handleMessagesScroll}
      showTemplateCta={showTemplateCta}
      draftHint={draftHint}
      onUseDraft={() => applyDraft()}
      onDiscardDraft={() => setDraftHint(null)}
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
          checklist={checklist}
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
            onAddToComposer={(draft) => applyDraft(draft)}
            onStatusChange={updateStatus}
            onToggleTag={toggleTag}
            askValue={askValue}
            onAskChange={setAskValue}
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
            />
          ) : (
            <SoftThreadPane
              conversation={selectedConversation}
              messageInput={messageInput}
              onMessageInput={setMessageInput}
              onSend={handleSendMessage}
              sending={sending}
              sendError={sendError}
              onClearError={() => setSendError(null)}
              onRetry={handleRetry}
              failedOutboundId={failedOutboundId}
              onSuggest={handleSuggest}
              onClose={() => setMobileView('list')}
              onBack={() => setMobileView('list')}
              messagesEndRef={messagesEndRef}
              messagesContainerRef={messagesContainerRef}
              onMessagesScroll={handleMessagesScroll}
              showTemplateCta={showTemplateCta}
              compact
              draftHint={draftHint}
              onUseDraft={() => applyDraft()}
              onDiscardDraft={() => setDraftHint(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
