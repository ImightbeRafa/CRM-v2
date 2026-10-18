import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { encryptSocialAccessToken } from '@/lib/social-account-crypto'
import { encodeInstagramRefreshToken } from '@/lib/social-account-meta'
import { identityPersistPayload } from '@/lib/social-account-identity'
import { reconnectLifecycleData, softUnlinkUpdateData } from '@/lib/social-account-token-health'

/**
 * What the connecting user may do about another tenant's active row for the
 * same IG asset. Resolved by the route from the user's own membership there.
 */
export type InstagramForeignOwnerAccess = {
  /** User is OWNER/ADMIN (update_config) in that tenant: move the asset here. */
  canTransfer: boolean
  /** Only set when the user is a member there, so the name is already visible to them. */
  workspaceName?: string | null
}

export type UpsertInstagramSocialAccountParams = {
  tenantId: string
  userId: string
  igBusinessAccountId: string
  pageAccessToken: string
  pageId: string
  pageName?: string | null
  igUsername?: string | null
  /** When false, still persist token but mark inactive (subscribe failed). Default true. */
  isActive?: boolean
  /** Real Meta TTL; null = non-expiring. When omitted, keep existing expiresAt on update. */
  expiresAt?: Date | null
  /**
   * Called when another tenant holds the asset active. Omitted = always conflict.
   * When it returns canTransfer, that tenant's row is soft-unlinked first.
   */
  resolveForeignOwner?: (foreignTenantId: string) => Promise<InstagramForeignOwnerAccess>
}

/**
 * Another tenant already has this Instagram asset active, or a legacy
 * (platform, accountId) unique blocked the insert. Never includes tenant ids
 * or Prisma error text — safe to show to the connecting user.
 */
export class InstagramSocialAccountConflictError extends Error {
  readonly code = 'INSTAGRAM_ACCOUNT_OWNED_ELSEWHERE' as const
  /** Owning workspace name, only when the connecting user is a member there. */
  readonly workspaceName: string | null

  constructor(workspaceName: string | null = null) {
    super('Esta cuenta de Instagram ya está conectada en otro espacio de trabajo.')
    this.name = 'InstagramSocialAccountConflictError'
    this.workspaceName = workspaceName
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function instagramAccountOwnedElsewhereHtml(workspaceName?: string | null): string {
  const where = workspaceName
    ? `<p>Está activa en el espacio <strong>${escapeHtml(workspaceName)}</strong>. Cambiá a ese espacio, desconectala en Configuración → Canales y volvé a vincularla aquí, o pedile a un Owner/Admin de ese espacio que lo haga.</p>`
    : '<p>Si administrás ese espacio, cambiá a él y desconectala ahí. Si no, pedile a su Owner/Admin que la desconecte.</p>'
  return `<html><body>
          <h2>Instagram ya está conectado en otro espacio</h2>
          <p>Esta cuenta de Instagram ya está conectada en otro espacio de trabajo. Desconectala ahí antes de vincularla aquí.</p>
          ${where}
          <p><a href="/config/social">Volver a configuración</a></p>
        </body></html>`
}

type InstagramSocialAccountRow = {
  id: string
  tenantId?: string | null
  displayName?: string | null
  expiresAt?: Date | null
}

export type InstagramSocialAccountDelegate = {
  findFirst: (args: {
    where: Record<string, unknown>
    select?: Record<string, boolean>
  }) => Promise<InstagramSocialAccountRow | null>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>
}

type ExistingInstagramRow = {
  id: string
  displayName: string | null
  expiresAt: Date | null
}

/**
 * Prisma reports P2002 `target` as field names (`platform`,`accountId`) for the
 * 025 partial unique index, and sometimes as the index name string. The schema
 * unique also includes tenantId. All of those are this asset's identity.
 */
function isInstagramIdentityP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false
  }
  const target = error.meta?.target
  const parts = Array.isArray(target) ? target.map((part) => String(part)) : [String(target ?? '')]
  const blob = parts.join(' ').toLowerCase()
  return blob.includes('platform') && blob.includes('accountid')
}

function instagramAccountWriteData(
  params: UpsertInstagramSocialAccountParams,
  existing: { displayName?: string | null; expiresAt?: Date | null } | null,
) {
  const refreshToken = encodeInstagramRefreshToken(params.pageId)
  const identity = identityPersistPayload({
    platform: 'instagram',
    providerDisplayName: params.pageName,
    providerUsername: params.igUsername,
    pageId: params.pageId,
    existingDisplayName: existing?.displayName,
  })
  const encryptedToken = encryptSocialAccessToken(params.pageAccessToken)
  const isActive = params.isActive !== false
  const expiresAt =
    params.expiresAt !== undefined ? params.expiresAt : (existing?.expiresAt ?? null)
  const lifecycle = reconnectLifecycleData({ isActive, expiresAt })
  return {
    accessToken: encryptedToken,
    refreshToken: refreshToken ?? undefined,
    userId: params.userId,
    providerDisplayName: identity.providerDisplayName,
    providerUsername: identity.providerUsername,
    pageId: identity.pageId,
    displayName: identity.displayName,
    ...lifecycle,
  }
}

function defaultSocialAccounts(): InstagramSocialAccountDelegate {
  return prisma.socialAccount as unknown as InstagramSocialAccountDelegate
}

async function findSameTenant(
  socialAccounts: InstagramSocialAccountDelegate,
  tenantId: string,
  accountId: string,
): Promise<ExistingInstagramRow | null> {
  const existing = await socialAccounts.findFirst({
    where: {
      tenantId,
      platform: 'instagram',
      accountId,
    },
    select: {
      id: true,
      displayName: true,
      expiresAt: true,
    },
  })
  if (!existing?.id) return null
  return {
    id: existing.id,
    displayName: existing.displayName ?? null,
    expiresAt: existing.expiresAt ?? null,
  }
}

async function findForeignActive(
  socialAccounts: InstagramSocialAccountDelegate,
  tenantId: string,
  accountId: string,
): Promise<{ id: string; tenantId: string | null } | null> {
  const foreign = await socialAccounts.findFirst({
    where: {
      platform: 'instagram',
      accountId,
      isActive: true,
      tenantId: { not: tenantId },
    },
    select: { id: true, tenantId: true },
  })
  return foreign?.id ? { id: foreign.id, tenantId: foreign.tenantId ?? null } : null
}

/** Partial unique 025 allows one active row; the bound only covers pre-025 duplicates. */
const MAX_FOREIGN_TRANSFERS = 5

/**
 * Clears every other tenant's active row for this asset, or throws the conflict.
 * A row is moved only when resolveForeignOwner says the connecting user
 * administers that tenant; it is soft-unlinked (history kept, tokens cleared).
 */
async function releaseForeignActive(
  socialAccounts: InstagramSocialAccountDelegate,
  params: UpsertInstagramSocialAccountParams,
  accountId: string,
): Promise<void> {
  for (let i = 0; i <= MAX_FOREIGN_TRANSFERS; i++) {
    const foreign = await findForeignActive(socialAccounts, params.tenantId, accountId)
    if (!foreign) return
    if (i === MAX_FOREIGN_TRANSFERS) break

    const access =
      foreign.tenantId && params.resolveForeignOwner
        ? await params.resolveForeignOwner(foreign.tenantId)
        : null
    if (!access?.canTransfer) {
      console.warn('[instagram-social-account] Asset active on another tenant', {
        foreignSocialAccountId: foreign.id,
        userIsMember: Boolean(access?.workspaceName),
      })
      throw new InstagramSocialAccountConflictError(access?.workspaceName ?? null)
    }

    await socialAccounts.update({
      where: { id: foreign.id },
      data: softUnlinkUpdateData(),
    })
    console.warn('[instagram-social-account] Moved asset from another tenant the user administers', {
      foreignSocialAccountId: foreign.id,
    })
  }
  throw new InstagramSocialAccountConflictError()
}

async function updateSameTenant(
  socialAccounts: InstagramSocialAccountDelegate,
  params: UpsertInstagramSocialAccountParams,
  existing: ExistingInstagramRow,
) {
  try {
    return await socialAccounts.update({
      where: { id: existing.id },
      data: instagramAccountWriteData(params, existing),
    })
  } catch (error) {
    if (isInstagramIdentityP2002(error)) {
      throw new InstagramSocialAccountConflictError()
    }
    throw error
  }
}

/**
 * Shared IG SocialAccount upsert used by callback + complete routes.
 * Persists provider identity and default displayName (§7.2).
 * Reconnect of the same IG asset reuses the same row id (history preserved).
 *
 * Production may enforce either:
 * - @@unique([platform, accountId, tenantId]) from schema.prisma, and/or
 * - partial unique (platform, accountId) WHERE isActive (migration 025), and/or
 * - a legacy unique on (platform, accountId) alone.
 * Same-tenant rows are updated. An active owner on another tenant is a
 * user-facing conflict, never a P2002 500, and that row is not modified —
 * unless resolveForeignOwner reports the user administers that tenant, in
 * which case its row is soft-unlinked and the asset moves here.
 */
export async function upsertInstagramSocialAccount(
  params: UpsertInstagramSocialAccountParams,
  socialAccounts: InstagramSocialAccountDelegate = defaultSocialAccounts(),
) {
  const accountId = String(params.igBusinessAccountId)
  const isActive = params.isActive !== false
  const existing = await findSameTenant(socialAccounts, params.tenantId, accountId)

  if (isActive) {
    await releaseForeignActive(socialAccounts, params, accountId)
  }

  if (existing) {
    return updateSameTenant(socialAccounts, params, existing)
  }

  try {
    return await socialAccounts.create({
      data: {
        tenantId: params.tenantId,
        platform: 'instagram',
        accountId,
        ...instagramAccountWriteData(params, null),
      },
    })
  } catch (error) {
    if (!isInstagramIdentityP2002(error)) throw error

    const raced = await findSameTenant(socialAccounts, params.tenantId, accountId)
    if (!raced) {
      throw new InstagramSocialAccountConflictError()
    }
    if (isActive) {
      await releaseForeignActive(socialAccounts, params, accountId)
    }
    return updateSameTenant(socialAccounts, params, raced)
  }
}
