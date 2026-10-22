/**
 * Meta data-deletion / deauthorize callbacks, the part that holds the rules (no DB, no network, testable).
 * What each callback does is the promise in /privacy §8:
 *   - deauthorize (the person removed Betsy in Facebook/Instagram): disconnect — tokens cleared, history kept.
 *   - deletion (the person asked Meta to delete their data): every conversation, message, media file, ad referral
 *     and AI record received through the lines that person connected is deleted, and the lines are disconnected.
 *     The business keeps its own setup (agents, knowledge, automations) and the orders / customers its team made.
 * Storage files that fail to delete are kept on the request row and retried by the nightly retention cron;
 * the public status page (/data-deletion?code=) shows the real state.
 */
import crypto from 'crypto'

export type DeletionKind = 'deletion' | 'deauthorize'
export type DeletionStatus = 'received' | 'pending' | 'pending_storage' | 'completed' | 'no_data' | 'failed'

export type MetaLineRef = { id: string; tenantId: string; platform: string; linkedAt?: Date | null }

export type DeletionRequestRow = {
  id: string
  confirmationCode: string
  kind: DeletionKind
  status: DeletionStatus
  matchedAccounts: number
  accountIds: string[]
  pendingPaths: string[]
  attempts: number
  lastErrorCode: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export type DeletionRequestPatch = Partial<
  Pick<DeletionRequestRow, 'status' | 'pendingPaths' | 'attempts' | 'lastErrorCode' | 'completedAt' | 'matchedAccounts' | 'accountIds'>
>

/** Everything the flow needs from the database. `insertRequest` → false when 058 is not applied yet. */
export interface DeletionStore {
  findLines(metaUserId: string): Promise<MetaLineRef[]>
  findLinesByIds(ids: string[]): Promise<MetaLineRef[]>
  collectPaths(line: MetaLineRef): Promise<string[]>
  eraseLine(line: MetaLineRef): Promise<void>
  disconnectLine(line: MetaLineRef): Promise<void>
  findRecentRequest(metaUserKey: string, kind: DeletionKind, since: Date): Promise<DeletionRequestRow | null>
  insertRequest(row: DeletionRequestRow & { metaUserKey: string }): Promise<boolean>
  updateRequest(id: string, patch: DeletionRequestPatch): Promise<void>
  listOpenRequests(olderThan: Date, limit: number): Promise<DeletionRequestRow[]>
}

export type RemovePaths = (paths: string[]) => Promise<void>

export const CONFIRMATION_CODE_RE = /^BETSY-DEL-[A-F0-9]{12}$/
/** Meta may resend the same callback; within this window the first request is answered again. */
export const RESEND_WINDOW_MS = 15 * 60 * 1000
/** Storage work inside the callback itself (Meta waits for the answer). The cron finishes the rest. */
export const CALLBACK_STORAGE_BUDGET_MS = 8_000
export const STORAGE_BATCH = 200
/** Cron attempts before a request is marked failed (then finished by hand, see /data-deletion). */
export const MAX_RETRY_ATTEMPTS = 10

export function newConfirmationCode(): string {
  return `BETSY-DEL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

export function isConfirmationCode(value: unknown): value is string {
  return typeof value === 'string' && CONFIRMATION_CODE_RE.test(value)
}

export function isMetaUserId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,30}$/.test(value)
}

/**
 * The raw Meta user id is never stored on the request row: an HMAC keyed by the server secret
 * (a plain hash of a short number could be reversed by trying every number).
 */
export function metaUserKey(metaUserId: string, secret: string | undefined = process.env.NEXTAUTH_SECRET): string {
  const key = (secret || '').trim()
  if (!key) throw new Error('NEXTAUTH_SECRET is required for Meta data deletion')
  return crypto.createHmac('sha256', `betsy-meta-deletion:${key}`).update(metaUserId).digest('hex')
}

/**
 * Only files of that business's chat folder may be deleted, whatever a row's metadata says
 * (a tampered or legacy path must never reach another business's files).
 */
export function safeTenantChatPaths(tenantId: string, candidates: Array<string | null | undefined>): string[] {
  const prefix = `chat-media/${tenantId}/`
  const out = new Set<string>()
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const path = raw.trim()
    if (!path.startsWith(prefix) || path.length <= prefix.length) continue
    if (path.includes('..') || path.includes('//') || /[\s?#\\]/.test(path)) continue
    out.add(path)
  }
  return [...out]
}

function errorCode(error: unknown): string {
  const e = error as { code?: unknown; name?: unknown }
  const code = typeof e?.code === 'string' && e.code ? e.code : typeof e?.name === 'string' ? e.name : 'unknown'
  return String(code).slice(0, 120)
}

/** Deletes in batches until done or out of time. Returns what is left (on error: the failed batch onwards). */
export async function removeWithinBudget(
  paths: string[],
  remove: RemovePaths,
  budgetMs: number,
  now: () => number = Date.now,
): Promise<{ remaining: string[]; errorCode: string | null }> {
  const started = now()
  let i = 0
  while (i < paths.length) {
    if (now() - started > budgetMs) return { remaining: paths.slice(i), errorCode: 'time_budget' }
    const batch = paths.slice(i, i + STORAGE_BATCH)
    try {
      await remove(batch)
    } catch (error) {
      return { remaining: paths.slice(i), errorCode: errorCode(error) }
    }
    i += batch.length
  }
  return { remaining: [], errorCode: null }
}

export type DeletionOutcome = {
  confirmationCode: string
  status: DeletionStatus
  matchedAccounts: number
  /** false when 058 is not applied: the work was done but nothing was recorded. */
  recorded: boolean
  reused: boolean
}

type FlowOptions = {
  now?: () => Date
  storageBudgetMs?: number
  secret?: string
  onFailure?: (stage: string, code: string) => void
}

/**
 * One callback from Meta. Never throws for storage problems (Meta must always get its answer);
 * database errors during the erase leave the request `pending` for the cron instead of losing it.
 */
export async function processMetaDataRequest(
  input: { metaUserId: string; kind: DeletionKind },
  store: DeletionStore,
  removePaths: RemovePaths,
  options: FlowOptions = {},
): Promise<DeletionOutcome> {
  const now = options.now ?? (() => new Date())
  const key = metaUserKey(input.metaUserId, options.secret)

  const recent = await store.findRecentRequest(key, input.kind, new Date(now().getTime() - RESEND_WINDOW_MS))
  if (recent && recent.status !== 'failed') {
    return { confirmationCode: recent.confirmationCode, status: recent.status, matchedAccounts: recent.matchedAccounts, recorded: true, reused: true }
  }

  const lines = await store.findLines(input.metaUserId)
  const code = newConfirmationCode()
  const at = now()
  const row: DeletionRequestRow & { metaUserKey: string } = {
    id: crypto.randomUUID(),
    confirmationCode: code,
    kind: input.kind,
    metaUserKey: key,
    status: lines.length ? 'received' : 'no_data',
    matchedAccounts: lines.length,
    accountIds: lines.map((l) => l.id),
    pendingPaths: [],
    attempts: 0,
    lastErrorCode: null,
    createdAt: at,
    updatedAt: at,
    completedAt: lines.length ? null : at,
  }
  const recorded = await store.insertRequest(row)
  if (!lines.length) return { confirmationCode: code, status: 'no_data', matchedAccounts: 0, recorded, reused: false }

  const result = await runRequest(row, lines, store, removePaths, { ...options, now, recorded })
  return { confirmationCode: code, status: result, matchedAccounts: lines.length, recorded, reused: false }
}

async function runRequest(
  row: Pick<DeletionRequestRow, 'id' | 'kind' | 'attempts'> & { pendingPaths?: string[] },
  lines: MetaLineRef[],
  store: DeletionStore,
  removePaths: RemovePaths,
  options: FlowOptions & { now: () => Date; recorded: boolean },
): Promise<DeletionStatus> {
  const update = async (patch: DeletionRequestPatch) => {
    if (options.recorded) await store.updateRequest(row.id, patch)
  }

  if (row.kind === 'deauthorize') {
    try {
      for (const line of lines) await store.disconnectLine(line)
    } catch (error) {
      const code = errorCode(error)
      options.onFailure?.('disconnect', code)
      await update({ status: 'pending', lastErrorCode: code })
      return 'pending'
    }
    await update({ status: 'completed', completedAt: options.now(), lastErrorCode: null })
    return 'completed'
  }

  // Paths are saved on the row BEFORE each erase: once the messages are gone they cannot be found again, so a
  // failure half-way must not lose them (the retry starts from what is saved).
  const paths = new Set<string>(row.pendingPaths ?? [])
  try {
    for (const line of lines) {
      for (const p of await store.collectPaths(line)) paths.add(p)
      await update({ pendingPaths: [...paths] })
      await store.eraseLine(line)
    }
  } catch (error) {
    const code = errorCode(error)
    options.onFailure?.('erase', code)
    await update({ status: 'pending', lastErrorCode: code })
    return 'pending'
  }

  const { remaining, errorCode: storageError } = await removeWithinBudget(
    [...paths],
    removePaths,
    options.storageBudgetMs ?? CALLBACK_STORAGE_BUDGET_MS,
  )
  if (remaining.length) {
    if (storageError && storageError !== 'time_budget') options.onFailure?.('storage', storageError)
    await update({ status: 'pending_storage', pendingPaths: remaining, lastErrorCode: storageError })
    return 'pending_storage'
  }
  await update({ status: 'completed', pendingPaths: [], completedAt: options.now(), lastErrorCode: null })
  return 'completed'
}

/** Nightly: finish requests whose erase or file deletion did not complete. */
export async function retryOpenDeletionRequests(
  store: DeletionStore,
  removePaths: RemovePaths,
  options: { now?: () => Date; budgetMs?: number; limit?: number; onFailure?: FlowOptions['onFailure'] } = {},
): Promise<{ checked: number; completed: number; stillPending: number; failed: number }> {
  const now = options.now ?? (() => new Date())
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? 20_000
  const out = { checked: 0, completed: 0, stillPending: 0, failed: 0 }
  // Leave requests that a callback may still be working on.
  const open = await store.listOpenRequests(new Date(now().getTime() - 5 * 60 * 1000), options.limit ?? 50)
  for (const req of open) {
    if (Date.now() - startedAt > budgetMs) break
    out.checked += 1
    const attempts = req.attempts + 1
    let status: DeletionStatus
    if (req.status === 'pending_storage') {
      const left = Math.max(1_000, budgetMs - (Date.now() - startedAt))
      const { remaining, errorCode: code } = await removeWithinBudget(req.pendingPaths, removePaths, left)
      if (remaining.length) {
        status = 'pending_storage'
        await store.updateRequest(req.id, { pendingPaths: remaining, attempts, lastErrorCode: code })
      } else {
        status = 'completed'
        await store.updateRequest(req.id, { status, pendingPaths: [], attempts, completedAt: now(), lastErrorCode: null })
      }
    } else {
      // A line reconnected after the request is a new connection: the retry never touches it.
      const lines = (await store.findLinesByIds(req.accountIds)).filter(
        (l) => !l.linkedAt || new Date(l.linkedAt).getTime() <= new Date(req.createdAt).getTime(),
      )
      await store.updateRequest(req.id, { attempts })
      status = await runRequest({ ...req, attempts }, lines, store, removePaths, {
        now,
        recorded: true,
        storageBudgetMs: Math.max(1_000, budgetMs - (Date.now() - startedAt)),
        onFailure: options.onFailure,
      })
    }
    if (status === 'completed') {
      out.completed += 1
    } else if (attempts >= MAX_RETRY_ATTEMPTS) {
      await store.updateRequest(req.id, { status: 'failed' })
      options.onFailure?.('gave_up', `${req.confirmationCode}:${req.lastErrorCode || 'unknown'}`)
      out.failed += 1
    } else {
      out.stillPending += 1
    }
  }
  return out
}

/** What the public status page may say about a request (status and dates only, never whose data it was). */
export function describeDeletionStatus(status: DeletionStatus | null): { title: string; body: string; tone: 'ok' | 'wait' | 'warn' } {
  switch (status) {
    case 'completed':
      return {
        tone: 'ok',
        title: 'Eliminación completada · Deletion completed',
        body: 'Borramos las conversaciones, mensajes, archivos, referencias de anuncios y registros de IA recibidos por las cuentas que conectaste, y desconectamos esas cuentas. Las copias de seguridad se renuevan en 14 días. / We deleted the conversations, messages, files, ad referrals and AI records received through the accounts you connected, and disconnected them. Backups roll over within 14 days.',
      }
    case 'pending_storage':
      return {
        tone: 'wait',
        title: 'Datos borrados, archivos en proceso · Data deleted, files in progress',
        body: 'Ya borramos las conversaciones y mensajes. Algunos archivos (fotos, audios) siguen en proceso de borrado; lo reintentamos automáticamente cada noche. / Conversations and messages are deleted. Some files (photos, audio) are still being deleted; we retry automatically every night.',
      }
    case 'received':
    case 'pending':
      return {
        tone: 'wait',
        title: 'Solicitud en proceso · Request in progress',
        body: 'Recibimos tu solicitud y la estamos procesando; lo reintentamos automáticamente cada noche. / We received your request and are processing it; we retry automatically every night.',
      }
    case 'no_data':
      return {
        tone: 'ok',
        title: 'Sin coincidencia automática · No automatic match',
        body: 'No encontramos automáticamente ninguna cuenta de Instagram o WhatsApp conectada a Betsy por ese usuario de Facebook. Si conectaste una cuenta, escribí a support@betsycrm.com con este código y la borramos a mano dentro de 30 días. / We could not automatically match an Instagram or WhatsApp account connected to Betsy by that Facebook user. If you connected one, email support@betsycrm.com with this code and we delete it by hand within 30 days.',
      }
    case 'failed':
      return {
        tone: 'warn',
        title: 'Necesita revisión manual · Needs manual review',
        body: 'No pudimos terminar la eliminación automáticamente. Nuestro equipo ya fue avisado y la completa a mano dentro de 30 días; podés escribir a support@betsycrm.com con este código. / We could not finish automatically. Our team has been alerted and completes it by hand within 30 days; you can email support@betsycrm.com with this code.',
      }
    default:
      return {
        tone: 'wait',
        title: 'Solicitud recibida · Request received',
        body: 'Recibimos tu solicitud. Si querés confirmar el estado, escribí a support@betsycrm.com con este código. / We received your request. To confirm its status, email support@betsycrm.com with this code.',
      }
  }
}
