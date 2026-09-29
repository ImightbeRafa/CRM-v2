/**
 * Notes on a client and/or the chat they were written in (Phase 2a, 2026-09-29).
 *
 * - A note written in a chat is stored with the chat AND its linked client, so it shows from both
 *   sides (the chat, and every other chat / page of that client).
 * - Tenant-scoped everywhere: the client / conversation must belong to the session's business.
 * - Internal only: nothing here may be imported by the AI (soft-ai) or send paths (test).
 * - Author edits their own note; pin/unpin for anyone who can work chats; delete for the author or
 *   OWNER / ADMIN (soft delete).
 * - Tolerates migration 035 not being applied yet (`available: false`).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { staffDisplayName } from '@/lib/display-name'

export const NOTE_MAX_LENGTH = 4000

/** Before migration 035: remember "table missing" for 5 minutes instead of failing every view. */
let notesMissingUntil = 0

/**
 * Who sees a note (Phase 2b). Derived from the row, no extra column:
 * - 'client': stored with the client → shows in every chat and page of that client;
 * - 'chat':   stored with the conversation only → shows only in the chat it was written in.
 */
export type NoteScope = 'client' | 'chat'

export function noteScopeOf(row: { clientId: string | null }): NoteScope {
  return row.clientId ? 'client' : 'chat'
}

export function parseNoteScope(value: unknown): NoteScope | null {
  return value === 'client' || value === 'chat' ? value : null
}

export type NoteDto = {
  id: string
  body: string
  scope: NoteScope
  /** Author or OWNER / ADMIN may move a note between "solo este chat" and "todo el cliente". */
  canChangeScope: boolean
  clientId: string | null
  conversationId: string | null
  author: { id: string | null; name: string }
  pinned: boolean
  pinnedAt: string | null
  edited: boolean
  createdAt: string
  canEdit: boolean
  canDelete: boolean
}

export type NoteViewer = { userId: string; role: string }

export function normalizeNoteBody(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const body = input.replace(/\r\n/g, '\n').trim()
  if (!body || body.length > NOTE_MAX_LENGTH) return null
  return body
}

export function canDeleteNote(viewer: NoteViewer, authorUserId: string | null): boolean {
  return viewer.userId === authorUserId || viewer.role === 'OWNER' || viewer.role === 'ADMIN'
}

export function canEditNote(viewer: NoteViewer, authorUserId: string | null): boolean {
  return Boolean(authorUserId) && viewer.userId === authorUserId
}

type NoteRow = {
  id: string
  body: string
  clientId: string | null
  conversationId: string | null
  authorUserId: string | null
  pinnedAt: Date | null
  editedAt: Date | null
  createdAt: Date
}

async function authorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, username: true },
  })
  // Same rule as the rest of the inbox: an email stored as a name is never sent to the browser.
  return new Map(users.map((u) => [u.id, staffDisplayName(u.name, u.username) || 'Equipo']))
}

function toDto(row: NoteRow, names: Map<string, string>, viewer: NoteViewer): NoteDto {
  return {
    id: row.id,
    body: row.body,
    scope: noteScopeOf(row),
    canChangeScope: canDeleteNote(viewer, row.authorUserId),
    clientId: row.clientId,
    conversationId: row.conversationId,
    author: { id: row.authorUserId, name: row.authorUserId ? names.get(row.authorUserId) || 'Equipo' : 'Equipo' },
    pinned: Boolean(row.pinnedAt),
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    edited: Boolean(row.editedAt),
    createdAt: row.createdAt.toISOString(),
    canEdit: canEditNote(viewer, row.authorUserId),
    canDelete: canDeleteNote(viewer, row.authorUserId),
  }
}

/** Pinned first (newest pin first), then newest. */
export function sortNotes<T extends { pinnedAt: Date | null; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.pinnedAt && !b.pinnedAt) return -1
    if (!a.pinnedAt && b.pinnedAt) return 1
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.getTime() - a.pinnedAt.getTime()
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

const noteSelect = {
  id: true,
  body: true,
  clientId: true,
  conversationId: true,
  authorUserId: true,
  pinnedAt: true,
  editedAt: true,
  createdAt: true,
} as const

export async function listNotes(args: {
  tenantId: string
  viewer: NoteViewer
  clientId?: string | null
  conversationId?: string | null
}): Promise<{ available: boolean; notes: NoteDto[] }> {
  const or: Array<Record<string, string>> = []
  if (args.clientId) or.push({ clientId: args.clientId })
  if (args.conversationId) or.push({ conversationId: args.conversationId })
  if (!or.length) return { available: true, notes: [] }
  if (Date.now() < notesMissingUntil) return { available: false, notes: [] }
  try {
    const rows = await prisma.crmNote.findMany({
      where: { tenantId: args.tenantId, deletedAt: null, kind: 'note', OR: or },
      select: noteSelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const names = await authorNames(rows.map((r) => r.authorUserId || ''))
    return { available: true, notes: sortNotes(rows).map((r) => toDto(r, names, args.viewer)) }
  } catch (error) {
    if (isMissingRelation(error)) {
      notesMissingUntil = Date.now() + 5 * 60_000
      return { available: false, notes: [] }
    }
    throw error
  }
}

export type NoteResult = { ok: true; note: NoteDto } | { ok: false; status: number; error: string }

export async function createNote(args: {
  tenantId: string
  viewer: NoteViewer
  body: unknown
  clientId?: string | null
  conversationId?: string | null
}): Promise<NoteResult> {
  const body = normalizeNoteBody(args.body)
  if (!body) return { ok: false, status: 400, error: `La nota debe tener entre 1 y ${NOTE_MAX_LENGTH} caracteres.` }
  // Scope checks: both references must belong to this business.
  if (args.clientId) {
    const client = await prisma.client.findFirst({ where: { id: args.clientId, tenantId: args.tenantId }, select: { id: true } })
    if (!client) return { ok: false, status: 404, error: 'Cliente no encontrado' }
  }
  if (args.conversationId) {
    const conv = await prisma.chatConversation.findFirst({ where: { id: args.conversationId, tenantId: args.tenantId }, select: { id: true } })
    if (!conv) return { ok: false, status: 404, error: 'Chat no encontrado' }
  }
  if (!args.clientId && !args.conversationId) return { ok: false, status: 400, error: 'Falta el cliente o el chat' }
  try {
    const row = await prisma.crmNote.create({
      data: {
        tenantId: args.tenantId,
        clientId: args.clientId ?? null,
        conversationId: args.conversationId ?? null,
        body,
        authorUserId: args.viewer.userId,
      },
      select: noteSelect,
    })
    void recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.viewer.userId,
      verb: 'note.create',
      entityType: 'CrmNote',
      entityId: row.id,
      clientId: row.clientId,
      conversationId: row.conversationId,
      surface: row.conversationId ? 'chats' : 'clients',
      props: { length: body.length },
    })
    const names = await authorNames([args.viewer.userId])
    return { ok: true, note: toDto(row, names, args.viewer) }
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, status: 503, error: 'Las notas aún no están disponibles.' }
    throw error
  }
}

export async function updateNote(args: {
  tenantId: string
  viewer: NoteViewer
  noteId: string
  body?: unknown
  pinned?: unknown
  scope?: unknown
}): Promise<NoteResult> {
  try {
    const existing = await prisma.crmNote.findFirst({
      where: { id: args.noteId, tenantId: args.tenantId, deletedAt: null },
      select: noteSelect,
    })
    if (!existing) return { ok: false, status: 404, error: 'Nota no encontrada' }

    const data: Record<string, unknown> = {}
    let verb = ''
    if (args.body !== undefined) {
      if (!canEditNote(args.viewer, existing.authorUserId)) {
        return { ok: false, status: 403, error: 'Solo quien escribió la nota puede editarla.' }
      }
      const body = normalizeNoteBody(args.body)
      if (!body) return { ok: false, status: 400, error: `La nota debe tener entre 1 y ${NOTE_MAX_LENGTH} caracteres.` }
      data.body = body
      data.editedAt = new Date()
      verb = 'note.edit'
    }
    if (args.pinned !== undefined) {
      if (typeof args.pinned !== 'boolean') return { ok: false, status: 400, error: 'pinned debe ser true o false' }
      data.pinnedAt = args.pinned ? new Date() : null
      data.pinnedByUserId = args.pinned ? args.viewer.userId : null
      verb = verb || (args.pinned ? 'note.pin' : 'note.unpin')
    }
    let scopeChanged = false
    if (args.scope !== undefined) {
      const scope = parseNoteScope(args.scope)
      if (!scope) return { ok: false, status: 400, error: 'scope debe ser "client" o "chat"' }
      if (!canDeleteNote(args.viewer, existing.authorUserId)) {
        return { ok: false, status: 403, error: 'Solo quien escribió la nota, un Owner o un Admin pueden cambiar quién la ve.' }
      }
      if (scope !== noteScopeOf(existing)) {
        if (!existing.conversationId) return { ok: false, status: 400, error: 'Esta nota no se escribió en un chat.' }
        if (scope === 'chat') {
          data.clientId = null
        } else {
          // Always the chat's CURRENT linked client, of this business.
          const conv = await prisma.chatConversation.findFirst({
            where: { id: existing.conversationId, tenantId: args.tenantId },
            select: { clientId: true },
          })
          if (!conv?.clientId) return { ok: false, status: 400, error: 'Vinculá el chat a un cliente primero.' }
          data.clientId = conv.clientId
        }
        scopeChanged = true
        verb = verb || 'note.scope.set'
      } else if (!verb) {
        // Same scope as before and nothing else to change: answer with the note as it is.
        const names = await authorNames([existing.authorUserId || ''])
        return { ok: true, note: toDto(existing, names, args.viewer) }
      }
    }
    if (!verb) return { ok: false, status: 400, error: 'Nada que actualizar' }

    // Conditional on not deleted: an edit racing a delete must not put text back (DATA-11).
    const done = await prisma.crmNote.updateMany({ where: { id: existing.id, tenantId: args.tenantId, deletedAt: null }, data })
    if (done.count === 0) return { ok: false, status: 404, error: 'Nota no encontrada' }
    const row = await prisma.crmNote.findFirst({ where: { id: existing.id, tenantId: args.tenantId }, select: noteSelect })
    if (!row) return { ok: false, status: 404, error: 'Nota no encontrada' }
    void recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.viewer.userId,
      verb,
      entityType: 'CrmNote',
      entityId: row.id,
      clientId: row.clientId ?? existing.clientId,
      conversationId: row.conversationId,
      ...(scopeChanged ? { props: { scope: noteScopeOf(row) } } : {}),
    })
    const names = await authorNames([row.authorUserId || ''])
    return { ok: true, note: toDto(row, names, args.viewer) }
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, status: 503, error: 'Las notas aún no están disponibles.' }
    throw error
  }
}

export async function deleteNote(args: { tenantId: string; viewer: NoteViewer; noteId: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const existing = await prisma.crmNote.findFirst({
      where: { id: args.noteId, tenantId: args.tenantId, deletedAt: null },
      select: { id: true, authorUserId: true, clientId: true, conversationId: true },
    })
    if (!existing) return { ok: false, status: 404, error: 'Nota no encontrada' }
    if (!canDeleteNote(args.viewer, existing.authorUserId)) {
      return { ok: false, status: 403, error: 'Solo quien escribió la nota, un Owner o un Admin pueden borrarla.' }
    }
    // The text is wiped, not just hidden (SecureDog DATA-10). Older logical backups keep it until
    // they expire (BACKUP_RETENTION_DAYS).
    const done = await prisma.crmNote.updateMany({
      where: { id: existing.id, tenantId: args.tenantId, deletedAt: null },
      data: { deletedAt: new Date(), body: '[borrada]', mentionUserIds: [] },
    })
    if (done.count === 0) return { ok: false, status: 404, error: 'Nota no encontrada' }
    void recordActivity({
      tenantId: args.tenantId,
      actorUserId: args.viewer.userId,
      verb: 'note.delete',
      entityType: 'CrmNote',
      entityId: existing.id,
      clientId: existing.clientId,
      conversationId: existing.conversationId,
    })
    return { ok: true }
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, status: 503, error: 'Las notas aún no están disponibles.' }
    throw error
  }
}
