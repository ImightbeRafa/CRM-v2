/**
 * Meta data-deletion / deauthorize callbacks, the part that holds the rules (no DB, no network, testable).
 * What each callback does is the promise in /privacy §8:
 *   - deauthorize (the person removed Betsy in Facebook/Instagram): disconnect — tokens cleared, history kept.
 *   - deletion (the person asked Meta to delete their data): the lines that person connected are disconnected at
 *     once and the business owner is told; 72 hours later (first nightly run after that) every conversation,
 *     message, media file, ad referral and AI record received through them is deleted. The wait exists because the
 *     person may be one admin of a business with other admins (SecureDog 2026-10-22): the owner gets time to react.
 *     A line someone reconnected meanwhile is not erased automatically: it goes to manual review (support finishes
 *     it within the 30 days the policy promises). The business keeps its own setup and the orders / customers.
 * Storage files that fail to delete are kept on the request row and retried by the nightly retention cron;
 * the public status page (/data-deletion?code=) shows the real state.
 */
import crypto from 'crypto'

export type DeletionKind = 'deletion' | 'deauthorize'
export type DeletionStatus = 'received' | 'pending' | 'pending_storage' | 'completed' | 'no_data' | 'failed'

/**
 * `isActive` / `hasToken` / `metaUserId` are read at retry time to tell a line someone reconnected after the
 * request (undefined isActive counts as active: never erase on missing information).
 */
export type MetaLineRef = {
  id: string
  tenantId: string
  platform: string
  isActive?: boolean
  hasToken?: boolean
  metaUserId?: string | null
}

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
  /** HMAC of the requester (read back by the nightly retry). */
  metaUserKey?: string
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
  /** Tell each business's owner that its lines were disconnected and when the data will be erased. Never throws. */
  notifyScheduled(lines: MetaLineRef[], eraseAfter: Date, confirmationCode: string): Promise<void>
  findRecentRequest(metaUserKey: string, kind: DeletionKind, since: Date): Promise<DeletionRequestRow | null>
  insertRequest(row: DeletionRequestRow & { metaUserKey: string }): Promise<boolean>
  updateRequest(id: string, patch: DeletionRequestPatch): Promise<void>
  listOpenRequests(olderThan: Date, limit: number): Promise<DeletionRequestRow[]>
}

export type RemovePaths = (paths: string[]) => Promise<void>

export const CONFIRMATION_CODE_RE = /^BETSY-DEL-[A-F0-9]{12}$/
/**
 * Meta may resend the same callback; within this window the first request is answered again. It matches the
 * signed_request age limit, so a captured request cannot be replayed into a second erase.
 */
export const RESEND_WINDOW_MS = (24 * 60 * 60 + 5 * 60) * 1000
/** Time between the request (lines disconnected, owner told) and the erase. */
export const ERASE_DELAY_MS = 72 * 60 * 60 * 1000
export const STORAGE_BATCH = 200
/** Cron attempts before a request is marked failed (then finished by hand, see /data-deletion). */
export const MAX_RETRY_ATTEMPTS = 10
/** signed_request freshness: Meta sends `issued_at` (unix seconds). */
export const SIGNED_REQUEST_MAX_AGE_S = 24 * 60 * 60
export const SIGNED_REQUEST_MAX_SKEW_S = 5 * 60

export function newConfirmationCode(): string {
  return `BETSY-DEL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

export function isConfirmationCode(value: unknown): value is string {
  return typeof value === 'string' && CONFIRMATION_CODE_RE.test(value)
}

/** Meta sends user_id as a string; a JSON number above 2^53 would round to someone else's id. */
export function isMetaUserId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,30}$/.test(value)
}

/**
 * A data-deletion / deauthorize payload, not some other signed_request of the same app (e.g. the Facebook JS SDK's
 * login signedRequest, which carries `code` / `oauth_token`), and fresh.
 */
export function checkCallbackPayload(
  payload: Record<string, unknown>,
  nowS: number = Math.floor(Date.now() / 1000),
): { ok: true; userId: string } | { ok: false; reason: string } {
  if ('code' in payload || 'oauth_token' in payload) return { ok: false, reason: 'not_a_callback' }
  const issuedAt = payload.issued_at
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return { ok: false, reason: 'no_issued_at' }
  if (issuedAt < nowS - SIGNED_REQUEST_MAX_AGE_S || issuedAt > nowS + SIGNED_REQUEST_MAX_SKEW_S) {
    return { ok: false, reason: 'stale' }
  }
  if (!isMetaUserId(payload.user_id)) return { ok: false, reason: 'bad_user' }
  return { ok: true, userId: payload.user_id }
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

export function eraseAfterFor(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ERASE_DELAY_MS)
}

export type DeletionOutcome = {
  confirmationCode: string
  status: DeletionStatus
  matchedAccounts: number
  /** false when 058 is not applied: nothing could be recorded or scheduled. */
  recorded: boolean
  reused: boolean
}

type FlowOptions = {
  now?: () => Date
  secret?: string
  onFailure?: (stage: string, code: string) => void
}

/**
 * One callback from Meta. Never throws for line problems (Meta must always get its answer): a failed
 * disconnect leaves the request `pending` for the cron instead of losing it.
 */
export async function processMetaDataRequest(
  input: { metaUserId: string; kind: DeletionKind },
  store: DeletionStore,
  options: FlowOptions = {},
): Promise<DeletionOutcome> {
  const now = options.now ?? (() => new Date())
  const key = metaUserKey(input.metaUserId, options.secret)

  const recent = await store.findRecentRequest(key, input.kind, new Date(now().getTime() - RESEND_WINDOW_MS))
  if (recent) {
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

  const update = async (patch: DeletionRequestPatch) => {
    if (recorded) await store.updateRequest(row.id, patch)
  }

  // Both kinds disconnect right away (tokens cleared, nothing new arrives).
  try {
    for (const line of lines) await store.disconnectLine(line)
  } catch (error) {
    const failure = errorCode(error)
    options.onFailure?.('disconnect', failure)
    await update({ status: 'pending', lastErrorCode: failure })
    return { confirmationCode: code, status: 'pending', matchedAccounts: lines.length, recorded, reused: false }
  }

  if (input.kind === 'deauthorize') {
    await update({ status: 'completed', completedAt: now(), lastErrorCode: null })
    return { confirmationCode: code, status: 'completed', matchedAccounts: lines.length, recorded, reused: false }
  }

  if (!recorded) {
    // 058 missing: the erase cannot be scheduled. The lines are disconnected; support finishes it by hand.
    options.onFailure?.('not_recorded', code)
    return { confirmationCode: code, status: 'received', matchedAccounts: lines.length, recorded, reused: false }
  }
  await store.notifyScheduled(lines, eraseAfterFor(at), code)
  return { confirmationCode: code, status: 'received', matchedAccounts: lines.length, recorded, reused: false }
}

/** Erase of a deletion request whose wait is over (lines already disconnected). */
async function eraseRequest(
  req: DeletionRequestRow,
  lines: MetaLineRef[],
  store: DeletionStore,
  removePaths: RemovePaths,
  options: { now: () => Date; storageBudgetMs: number; onFailure?: FlowOptions['onFailure'] },
): Promise<DeletionStatus> {
  // Paths are saved on the row BEFORE each erase: once the messages are gone they cannot be found again, so a
  // failure half-way must not lose them (the next try starts from what is saved).
  const paths = new Set<string>(req.pendingPaths)
  try {
    for (const line of lines) {
      for (const p of await store.collectPaths(line)) paths.add(p)
      await store.updateRequest(req.id, { pendingPaths: [...paths] })
      await store.eraseLine(line)
    }
  } catch (error) {
    const code = errorCode(error)
    options.onFailure?.('erase', code)
    await store.updateRequest(req.id, { status: 'pending', lastErrorCode: code })
    return 'pending'
  }
  const { remaining, errorCode: storageError } = await removeWithinBudget([...paths], removePaths, options.storageBudgetMs)
  if (remaining.length) {
    if (storageError && storageError !== 'time_budget') options.onFailure?.('storage', storageError)
    await store.updateRequest(req.id, { status: 'pending_storage', pendingPaths: remaining, lastErrorCode: storageError })
    return 'pending_storage'
  }
  await store.updateRequest(req.id, { status: 'completed', pendingPaths: [], completedAt: options.now(), lastErrorCode: null })
  return 'completed'
}

/** Nightly: run erases whose wait is over, finish file deletions, retry what failed. */
export async function retryOpenDeletionRequests(
  store: DeletionStore,
  removePaths: RemovePaths,
  options: { now?: () => Date; budgetMs?: number; limit?: number; secret?: string; onFailure?: FlowOptions['onFailure'] } = {},
): Promise<{ checked: number; completed: number; stillPending: number; failed: number; waiting: number }> {
  const now = options.now ?? (() => new Date())
  const startedAt = Date.now()
  const budgetMs = options.budgetMs ?? 20_000
  const left = () => Math.max(1_000, budgetMs - (Date.now() - startedAt))
  const out = { checked: 0, completed: 0, stillPending: 0, failed: 0, waiting: 0 }
  // Leave requests that a callback may still be working on.
  const open = await store.listOpenRequests(new Date(now().getTime() - 5 * 60 * 1000), options.limit ?? 50)
  for (const req of open) {
    if (Date.now() - startedAt > budgetMs) break
    const waitOver = now().getTime() >= eraseAfterFor(new Date(req.createdAt)).getTime()
    if (req.kind === 'deletion' && req.status === 'received' && !waitOver) {
      out.waiting += 1
      continue
    }
    out.checked += 1
    const attempts = req.attempts + 1
    let status: DeletionStatus
    if (req.status === 'pending_storage') {
      const { remaining, errorCode: code } = await removeWithinBudget(req.pendingPaths, removePaths, left())
      if (remaining.length) {
        status = 'pending_storage'
        await store.updateRequest(req.id, { pendingPaths: remaining, attempts, lastErrorCode: code })
      } else {
        status = 'completed'
        await store.updateRequest(req.id, { status, pendingPaths: [], attempts, completedAt: now(), lastErrorCode: null })
      }
    } else {
      await store.updateRequest(req.id, { attempts })
      const lines = await store.findLinesByIds(req.accountIds)
      // Still the requester's connection = the line names no other connector. A reconnect by anyone else overwrites
      // metaUserId, so this also separates two overlapping requests (SecureDog NEW-1).
      const stillTheirs = (l: MetaLineRef) =>
        !l.metaUserId || !req.metaUserKey || metaUserKey(l.metaUserId, options.secret) === req.metaUserKey
      // Reconnected since our disconnect: live, a token again (our disconnect clears it, every reconnect sets
      // one, even when its subscribe fails and the line stays inactive), or another connector.
      const reconnectedLine = (l: MetaLineRef) => l.isActive !== false || l.hasToken === true || !stillTheirs(l)
      const reconnected = lines.filter(reconnectedLine)
      const idle = lines.filter((l) => !reconnectedLine(l))
      // A disconnect that failed in the callback is retried on the lines that are still the requester's.
      const toDisconnect = lines.filter(stillTheirs)
      if (req.kind === 'deauthorize') {
        // A line connected by someone else since is the business's new choice.
        status = 'completed'
        try {
          for (const line of toDisconnect) await store.disconnectLine(line)
          await store.updateRequest(req.id, { status, completedAt: now(), lastErrorCode: null })
        } catch (error) {
          status = 'pending'
          await store.updateRequest(req.id, { lastErrorCode: errorCode(error) })
        }
      } else if (req.status === 'pending' && !waitOver) {
        // The callback's disconnect failed: do it now, then wait out the 72 hours.
        try {
          for (const line of toDisconnect) await store.disconnectLine(line)
          await store.updateRequest(req.id, { status: 'received', lastErrorCode: null })
          await store.notifyScheduled(toDisconnect, eraseAfterFor(new Date(req.createdAt)), req.confirmationCode)
          status = 'received'
        } catch (error) {
          status = 'pending'
          await store.updateRequest(req.id, { lastErrorCode: errorCode(error) })
        }
      } else if (reconnected.length) {
        status = 'failed'
        await store.updateRequest(req.id, { status, lastErrorCode: 'line_reconnected' })
        options.onFailure?.('gave_up', `${req.confirmationCode}:line_reconnected`)
        out.failed += 1
        continue
      } else {
        status = await eraseRequest(req, idle, store, removePaths, { now, storageBudgetMs: left(), onFailure: options.onFailure })
      }
    }
    if (status === 'completed') {
      out.completed += 1
    } else if (status === 'received') {
      out.waiting += 1
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
export function describeDeletionStatus(
  status: DeletionStatus | null,
  kind: DeletionKind = 'deletion',
): { title: string; body: string; tone: 'ok' | 'wait' | 'warn' } {
  switch (status) {
    case 'completed':
      return kind === 'deauthorize'
        ? {
            tone: 'ok',
            title: 'Desconectado · Disconnected',
            body: 'Borramos los tokens de acceso y desconectamos las cuentas. / We deleted the access tokens and disconnected the accounts.',
          }
        : {
            tone: 'ok',
            title: 'Eliminación completada · Deletion completed',
            body: 'Borramos las conversaciones, mensajes, archivos, referencias de anuncios y registros de IA recibidos por las cuentas que conectaste, y desconectamos esas cuentas. Las copias de seguridad se renuevan en 14 días. / We deleted the conversations, messages, files, ad referrals and AI records received through the accounts you connected, and disconnected them. Backups roll over within 14 days.',
          }
    case 'received':
      return {
        tone: 'wait',
        title: 'Programada · Scheduled',
        body: 'Ya desconectamos las cuentas que conectaste y avisamos al negocio. Los datos se borran 3 días después de la solicitud (en la primera revisión nocturna). / We already disconnected the accounts you connected and told the business. The data is deleted 3 days after the request (at the first nightly run).',
      }
    case 'pending_storage':
      return {
        tone: 'wait',
        title: 'Datos borrados, archivos en proceso · Data deleted, files in progress',
        body: 'Ya borramos las conversaciones y mensajes. Algunos archivos (fotos, audios) siguen en proceso de borrado; lo reintentamos automáticamente cada noche. / Conversations and messages are deleted. Some files (photos, audio) are still being deleted; we retry automatically every night.',
      }
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
        body: 'No pudimos terminar la eliminación automáticamente (por ejemplo, el negocio volvió a conectar la cuenta). Nuestro equipo ya fue avisado y la completa a mano dentro de 30 días; podés escribir a support@betsycrm.com con este código. / We could not finish automatically (for example, the business connected the account again). Our team has been alerted and completes it by hand within 30 days; you can email support@betsycrm.com with this code.',
      }
    default:
      return {
        tone: 'wait',
        title: 'Solicitud recibida · Request received',
        body: 'Recibimos tu solicitud y desconectamos las cuentas. Para confirmar el estado o terminarla, escribí a support@betsycrm.com con este código; la completamos dentro de 30 días. / We received your request and disconnected the accounts. To confirm its status or finish it, email support@betsycrm.com with this code; we complete it within 30 days.',
      }
  }
}
