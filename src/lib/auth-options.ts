import { NextAuthOptions, Session, User } from "next-auth"
import { JWT } from "next-auth/jwt"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from './db'
import { verifyPassword, isBcryptHash } from './password'
import { withoutTenantIsolation } from './tenantContext'
import {
  LOGIN_ERRORS,
  burnPasswordCheck,
  clientIpFromHeaders,
  emailVerificationBlocks,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from './auth-gates'
import { loadUserAuthState, revokeUserSessions, sessionMatches } from './session-revocation'
import { findUserIdByEmail } from './user-lookup'
import { TEAM_INVITE_COOKIE } from './team-invite'

/** Invite token from the accept-invite cookie in a raw Cookie header (credentials authorize). */
function inviteTokenFromCookieHeader(header: unknown): string | null {
  const raw = Array.isArray(header) ? header.join(';') : typeof header === 'string' ? header : ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === TEAM_INVITE_COOKIE) {
      try {
        return decodeURIComponent(v.join('='))
      } catch {
        return null
      }
    }
  }
  return null
}

/** Same cookie inside NextAuth callbacks (Google sign-in runs in the route handler's request). */
async function readInviteTokenCookie(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers')
    return (await cookies()).get(TEAM_INVITE_COOKIE)?.value ?? null
  } catch (error) {
    // Loud on purpose: if this ever breaks, Google invitees would silently stop joining.
    console.warn('[OAuth] invite cookie unreadable', error instanceof Error ? error.message : error)
    return null
  }
}
import { selectActiveTenantId } from './membership-lifecycle'
import { provisionOwnedTenantForExistingUser } from './tenant-provisioning'
import { shouldJoinInviteInsteadOfProvisioning } from './team-invite'
import { acceptTeamInviteForUser, findInviteForPresentedToken } from './team-invite-service'

type MemberRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SALES' | 'PRODUCTION' | 'MEMBER' | 'VIEWER';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Membership {
  id: string;
  role: MemberRole;
  tenantId: string;
  isActive: boolean;
  joinedAt: Date;
  tenant?: Tenant;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: "MASTER" | "REGULAR";
      membershipRole?: "OWNER" | "ADMIN" | "MANAGER" | "SALES" | "PRODUCTION" | "VIEWER";
      tenantId?: string | null;
      email_verified?: boolean;
      active?: boolean;
      memberships?: Membership[];
      allTenantIds?: string[];
      isLogisticsAdmin?: boolean;
      currentTenant?: {
        id: string;
        role: MemberRole;
        name?: string;
        slug?: string;
        isActive?: boolean;
        profileCompleted?: boolean;
      } | null;
    } & User;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role?: "MASTER" | "REGULAR";
    tenantId?: string | null;
    email_verified?: boolean;
    active?: boolean;
    memberships?: Membership[];
    allTenantIds?: string[];
    isLogisticsAdmin?: boolean;
    lastDbSync?: number;
    currentTenant?: {
      id: string;
      role: MemberRole;
      name?: string;
      slug?: string;
      isActive?: boolean;
      plan?: string;
      subscriptionStatus?: string | null;
      trialEndsAt?: Date | null;
      profileCompleted?: boolean;
    } | null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Sign in",
      credentials: {
        email: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      // @ts-ignore - NextAuth authorize type mismatch; runtime works correctly
      async authorize(credentials, req) {
        const email = (credentials?.email || "").toString().trim()
        const password = (credentials?.password || "").toString()
        if (!email || !password) return null

        try {
          // Normalize email (trim and lowercase) for consistent lookup
          const normalizedEmail = email.toLowerCase()

          // Lockout: this attempt is reserved atomically before any bcrypt (see auth-gates.ts).
          const ip = clientIpFromHeaders(req?.headers as Record<string, unknown> | undefined)
          if ((await reserveLoginAttempt(normalizedEmail, ip)).locked) {
            console.log('[Credentials Auth] Locked out (too many attempts)')
            throw new Error(LOGIN_ERRORS.locked)
          }

          // Exact case-insensitive match (no ILIKE wildcards; see user-lookup.ts)
          const userId = await findUserIdByEmail(normalizedEmail)

          // Session version read BEFORE the password hash (AUTH-12): if a reset commits between the
          // two reads, the hash is the new one and the old password fails; if it commits after
          // both, this session carries the old version and the reset has already revoked it.
          let sessionVersion = 0
          if (userId) {
            try {
              sessionVersion = (await loadUserAuthState(userId))?.sessionVersion ?? 0
            } catch {
              sessionVersion = 0
            }
          }

          const user = !userId ? null : await prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              username: true,
              email: true,
              password: true,
              active: true,
              emailVerified: true,
              createdAt: true,
              defaultTenantId: true,
              memberships: {
                where: { isActive: true },
                select: { role: true, tenantId: true }
              }
            }
          })

          // Every failing path costs the same bcrypt time (unknown, inactive, Google-only, legacy
          // non-bcrypt) and keeps its reserved attempt, so none of them can be told apart.
          if (!user || !user.active || !user.password || !isBcryptHash(user.password)) {
            console.log(`[Credentials Auth] ${!user ? 'User not found' : !user.active ? 'Inactive user' : 'No usable password'}`)
            await burnPasswordCheck(password)
            return null
          }

          const passwordValid = await verifyPassword(password, user.password)
          if (!passwordValid) {
            return null
          }

          // Only after the password checks out (never reveals verification state to a guesser).
          // OFF until EMAIL_VERIFICATION_ENFORCE_FROM is set; accounts older than it are exempt.
          if (emailVerificationBlocks(user)) {
            // The password was right: not a failure (never LOCKED for trying to log in unverified).
            await releaseLoginAttempt(normalizedEmail, ip)
            throw new Error(LOGIN_ERRORS.emailNotVerified)
          }
          await releaseLoginAttempt(normalizedEmail, ip)

          // A TenantInvite is joined only by whoever holds its emailed link (the accept-invite page
          // sets the cookie). Knowing the address — even with a verified account — is not enough.
          let memberships = user.memberships
          let defaultTenantId = user.defaultTenantId
          try {
            const pending = await findInviteForPresentedToken(
              inviteTokenFromCookieHeader((req?.headers as Record<string, unknown> | undefined)?.cookie),
              user.email,
            )
            if (pending) {
              const accepted = await acceptTeamInviteForUser({
                emailProven: true, // holds the emailed invite token
                inviteId: pending.id,
                token: pending.token,
                userId: user.id,
                userEmail: user.email,
              })
              if (accepted.ok) {
                const refreshed = await prisma.user.findUnique({
                  where: { id: user.id },
                  select: {
                    defaultTenantId: true,
                    memberships: {
                      where: { isActive: true },
                      select: { role: true, tenantId: true },
                    },
                  },
                })
                memberships = refreshed?.memberships || memberships
                defaultTenantId = refreshed?.defaultTenantId ?? accepted.tenantId
                console.log(`[Credentials Auth] ✅ Joined inviting tenant ${accepted.tenantId} via pending invite`)
              } else {
                console.warn(`[Credentials Auth] Invite accept skipped:`, accepted.error)
              }
            }
          } catch (inviteError) {
            console.warn('[Credentials Auth] TenantInvite lookup/accept failed:', inviteError)
          }

          // Get membership role (OWNER, ADMIN, MANAGER, SALES, PRODUCTION, VIEWER)
          const activeTenantIds = memberships.map((m) => m.tenantId)
          // Prefer inviting tenant (now defaultTenantId) over orphan owned tenants.
          const selectedTenantId = selectActiveTenantId(defaultTenantId, activeTenantIds)
          const selectedMembership = memberships.find((m) => m.tenantId === selectedTenantId)
          const membershipRole = selectedMembership?.role ?? null

          // Legacy role for compatibility (OWNER -> MASTER)
          const role = membershipRole === 'OWNER' ? 'MASTER' : 'REGULAR'

          return {
            id: user.id,
            email: user.email,
            name: user.username || user.email, // Username for display, fallback to email
            role: role,
            membershipRole: membershipRole, // Actual role from Membership table
            tenantId: selectedTenantId,
            email_verified: !!user.emailVerified,
            active: user.active,
            sv: sessionVersion,
            memberships: memberships.map(m => ({
              id: m.tenantId,
              role: m.role,
              tenantId: m.tenantId
            }))
          }
        } catch (error) {
          // Gate errors reach the sign-in page (res.error) so it can explain what to do.
          if (error instanceof Error && (Object.values(LOGIN_ERRORS) as string[]).includes(error.message)) {
            throw error
          }
          console.error('Auth error:', error)
          return null
        }
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // This function is called when a user signs in
      try {
        // Handle OAuth sign-in (Google, etc.)
        if (account?.provider !== 'credentials') {
          try {
            const email = user.email || '';
            if (!email) {
              console.error('No email provided for OAuth user');
              return false;
            }
            // Accounts are matched by email: never trust an address the provider did not verify.
            if ((profile as { email_verified?: boolean } | undefined)?.email_verified === false) {
              console.error('[OAuth] Rejected sign-in: provider reports the email as unverified');
              return false;
            }

            // Normalize email for storage (trim and lowercase)
            const normalizedEmail = email.trim().toLowerCase();

            // CRITICAL: Use case-insensitive search to find existing users
            // This prevents duplicate users when email casing differs (e.g., "User@gmail.com" vs "user@gmail.com")
            // Exact lower() match: Prisma's insensitive `equals` is ILIKE, where `_` in a Google
            // address (a_b@x) could match a different account (axb@x) and merge into it.
            let dbUser = await prisma.user.findUnique({
              where: { id: (await findUserIdByEmail(normalizedEmail)) ?? '' },
              select: {
                id: true,
                email: true,
                name: true,
                username: true,
                image: true,
                emailVerified: true,
                active: true,
                defaultTenantId: true,
                provider: true,
                providerId: true,
                memberships: {
                  where: { isActive: true },
                  include: {
                    tenant: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                        plan: true,
                        isActive: true,
                        trialEndsAt: true
                      }
                    }
                  }
                }
              }
            });

            // If user exists, update their information and associate with existing tenants
            if (dbUser) {
              console.log(`[OAuth] 📧 Found existing user: ${dbUser.email}`);
              console.log(`[OAuth] 📊 Active memberships: ${dbUser.memberships.length}`);
              console.log(`[OAuth] 🎯 User active status: ${dbUser.active}`);
              console.log(`[OAuth] 🏢 Default tenant ID: ${dbUser.defaultTenantId || 'none'}`);

              // Align with credentials auth: deactivated users cannot sign in via OAuth
              if (!dbUser.active) {
                console.log(`[OAuth] ❌ Rejected inactive user: ${dbUser.email}`);
                return false;
              }

              // First proof of this mailbox: end every session opened with a password set before
              // anyone proved the address (no-op before migration 034). BEFORE the update below: if
              // the revoke fails we refuse, and the next Google sign-in retries it (AUTH-08).
              if (!dbUser.emailVerified) {
                try {
                  await revokeUserSessions(dbUser.id)
                } catch (revokeError) {
                  console.error('[OAuth] session revoke failed; refusing sign-in', revokeError)
                  return false
                }
              }

              // Update user with latest info from OAuth provider, including OAuth provider info
              const updatedUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                  name: user.name || dbUser.name,
                  image: user.image || dbUser.image,
                  emailVerified: dbUser.emailVerified || new Date(),
                  // First proof of this mailbox (AUTH-08): a password set before anyone proved the
                  // address may belong to a squatter — drop it (the owner can reset one later).
                  ...(!dbUser.emailVerified ? { password: null } : {}),
                  active: dbUser.active, // Preserve admin deactivation — don't re-activate disabled users
                  // Update OAuth provider info so user can log in with Google in the future
                  provider: account?.provider || dbUser.provider || 'google',
                  providerId: account?.providerAccountId || dbUser.providerId,
                  // Normalize email if it was stored with different casing
                  ...(dbUser.email !== normalizedEmail && { email: normalizedEmail })
                },
                select: {
                  id: true,
                  email: true,
                  name: true,
                  username: true,
                  image: true,
                  emailVerified: true,
                  active: true,
                  defaultTenantId: true,
                  memberships: {
                    where: { isActive: true },
                    include: {
                      tenant: {
                        select: {
                          id: true,
                          name: true,
                          slug: true,
                          plan: true,
                          isActive: true,

                          trialEndsAt: true
                        }
                      }
                    }
                  }
                }
              });

              // Update user object with latest data
              user.id = updatedUser.id;
              (user as any).email_verified = !!updatedUser.emailVerified;
              (user as any).active = updatedUser.active !== false;
              (user as any).memberships = updatedUser.memberships || [];

              // Prefer pending TenantInvite EVEN when the user already has other
              // active memberships (orphan owned tenant must not shadow invite).
              let pending = null as Awaited<ReturnType<typeof findInviteForPresentedToken>>
              try {
                pending = await findInviteForPresentedToken(await readInviteTokenCookie(), updatedUser.email)
              } catch (inviteLookupError) {
                console.warn('[OAuth] TenantInvite lookup failed (SQL 030 may be pending):', inviteLookupError)
              }
              const decision = shouldJoinInviteInsteadOfProvisioning({
                activeMembershipCount: updatedUser.memberships.length,
                pendingInvite: pending ? { tenantId: pending.tenantId, role: pending.role } : null,
              })

              if (decision === 'join_invite' && pending) {
                try {
                  const accepted = await acceptTeamInviteForUser({
                    emailProven: true, // Google-verified email (checked at the top of signIn)
                    inviteId: pending.id,
                    token: pending.token,
                    userId: updatedUser.id,
                    userEmail: updatedUser.email,
                  })
                  if (!accepted.ok) {
                    console.error(`[OAuth] ❌ Invite accept failed for ${updatedUser.email}:`, accepted.error)
                    return false
                  }
                  const refreshed = await prisma.user.findUnique({
                    where: { id: updatedUser.id },
                    select: {
                      defaultTenantId: true,
                      memberships: {
                        where: { isActive: true },
                        include: {
                          tenant: {
                            select: {
                              id: true,
                              name: true,
                              slug: true,
                              plan: true,
                              isActive: true,
                              trialEndsAt: true,
                            },
                          },
                        },
                      },
                    },
                  })
                  const memberships = refreshed?.memberships || []
                  const hasOwnerRole = memberships.some((m) => m.role === 'OWNER')
                  ;(user as any).role = hasOwnerRole ? 'MASTER' : 'REGULAR'
                  // Session + defaultTenantId must land on the inviting tenant.
                  ;(user as any).tenantId = accepted.tenantId
                  ;(user as any).memberships = memberships.length
                    ? memberships
                    : [{
                        role: accepted.role,
                        tenantId: accepted.tenantId,
                        tenant: pending.tenant,
                      }]
                  console.log(
                    `[OAuth] ✅ Joined inviting tenant ${accepted.tenantId} via invite (had ${updatedUser.memberships.length} prior membership(s))`,
                  )
                  return true
                } catch (inviteAcceptError) {
                  console.error(`[OAuth] ❌ Invite accept path failed for ${updatedUser.email}:`, inviteAcceptError)
                  return false
                }
              }

              // No pending invite — use existing tenant memberships.
              if (updatedUser.memberships.length > 0) {
                const selectedTenantId = selectActiveTenantId(
                  updatedUser.defaultTenantId,
                  updatedUser.memberships.map((m) => m.tenantId),
                );
                // Legacy MASTER = OWNER of the SELECTED business (same as credentials login).
                (user as any).role = updatedUser.memberships.find((m) => m.tenantId === selectedTenantId)?.role === 'OWNER' ? 'MASTER' : 'REGULAR';
                (user as any).tenantId = selectedTenantId;
                (user as any).memberships = updatedUser.memberships;
                console.log(`[OAuth] ✅ User logged in with tenant: ${selectedTenantId} (${updatedUser.memberships.length} active membership(s))`);
                return true;
              }

              // No memberships and no invite — provision one owned tenant (not another orphan when invite exists).
              console.log(`[OAuth] ⚠️ User ${updatedUser.email} has no active memberships and no pending invite; provisioning owned tenant`);
              try {
                const newTenant = await withoutTenantIsolation(async () => {
                  return prisma.$transaction(async (tx) => {
                    return provisionOwnedTenantForExistingUser(tx, {
                      userId: updatedUser.id,
                      email: updatedUser.email,
                      displayName: updatedUser.name || updatedUser.username || updatedUser.email.split('@')[0],
                    });
                  });
                });

                (user as any).role = 'MASTER';
                (user as any).tenantId = newTenant.id;
                (user as any).memberships = [{
                  role: 'OWNER',
                  tenantId: newTenant.id,
                  tenant: newTenant,
                }];
                console.log(`[OAuth] ✅ Provisioned owned tenant ${newTenant.id} for ${updatedUser.email}`);
                return true;
              } catch (provisionError) {
                console.error(`[OAuth] ❌ Failed to provision owned tenant for ${updatedUser.email}:`, provisionError);
                return false;
              }
            }

            // If we get here, user doesn't exist - prefer joining a pending invite over orphan tenant
            console.log(`[OAuth] Creating new user: ${normalizedEmail}`);
            try {
              let pendingForNew = null as Awaited<ReturnType<typeof findInviteForPresentedToken>>
              try {
                pendingForNew = await findInviteForPresentedToken(await readInviteTokenCookie(), normalizedEmail)
              } catch (inviteLookupError) {
                console.warn('[OAuth] TenantInvite lookup failed for new user:', inviteLookupError)
              }
              if (pendingForNew) {
                const emailPrefix = normalizedEmail.split('@')[0];
                const createdForInvite = await prisma.user.create({
                  data: {
                    email: normalizedEmail,
                    username: user.name || emailPrefix,
                    name: user.name || undefined,
                    image: user.image || undefined,
                    provider: account?.provider || 'google',
                    providerId: account?.providerAccountId,
                    emailVerified: new Date(),
                    active: true,
                    defaultTenantId: pendingForNew.tenantId,
                  },
                })
                const accepted = await acceptTeamInviteForUser({
                  emailProven: true, // Google-verified email (checked at the top of signIn)
                  inviteId: pendingForNew.id,
                  token: pendingForNew.token,
                  userId: createdForInvite.id,
                  userEmail: normalizedEmail,
                })
                if (!accepted.ok) {
                  console.error('[OAuth] ❌ Failed to accept invite for new Google user:', accepted.error)
                  return false
                }
                user.id = createdForInvite.id
                ;(user as any).email_verified = true
                ;(user as any).active = true
                ;(user as any).role = 'REGULAR'
                ;(user as any).tenantId = accepted.tenantId
                ;(user as any).memberships = [{
                  role: accepted.role,
                  tenantId: accepted.tenantId,
                  tenant: pendingForNew.tenant,
                }]
                console.log(`[OAuth] ✅ New Google user joined inviting tenant ${accepted.tenantId}`)
                return true
              }

              const emailPrefix = normalizedEmail.split('@')[0];
              const tenantName = `${user.name || emailPrefix}'s Organization`;
              const tenantSlug = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

              // Create user, tenant, membership, and statuses in ONE atomic transaction
              // Use withoutTenantIsolation since this is a system operation creating a new tenant
              let newUser: any
              try {
                newUser = await withoutTenantIsolation(async () => {
                  return await prisma.$transaction(async (tx) => {
                    console.log('[OAuth]   1️⃣ Creating tenant...');
                    const newTenant = await tx.tenant.create({
                      data: {
                        name: tenantName,
                        slug: tenantSlug, // Include timestamp to avoid duplicates
                        plan: 'FREE',
                        isActive: true,
                        // 7 days from now
                      }
                    });
                    console.log('[OAuth]   ✅ Tenant created:', newTenant.id);

                    console.log('[OAuth]   2️⃣ Creating user...');
                    const createdUser = await tx.user.create({
                      data: {
                        email: normalizedEmail, // Use normalized email (MUST be globally unique)
                        username: user.name || emailPrefix,
                        name: user.name || undefined,
                        image: user.image || undefined,
                        provider: account?.provider || 'google',
                        providerId: account?.providerAccountId,
                        emailVerified: new Date(),
                        active: true, // CRITICAL: Must be true for OAuth users
                        defaultTenantId: newTenant.id // Set default tenant immediately
                      }
                    });
                    console.log('[OAuth]   ✅ User created:', createdUser.id);

                    console.log('[OAuth]   3️⃣ Creating membership...');
                    await tx.membership.create({
                      data: {
                        role: 'OWNER',
                        isActive: true,
                        joinedAt: new Date(),
                        user: { connect: { id: createdUser.id } },
                        tenant: { connect: { id: newTenant.id } }
                      }
                    });
                    console.log('[OAuth]   ✅ Membership created');

                    // Create default order statuses in same transaction
                    console.log('[OAuth]   4️⃣ Creating default order statuses...');
                    const defaultStatuses = [
                      { key: 'pendiente', label: 'Pendiente', color: '#FCD34D', order: 0 },
                      { key: 'en-proceso', label: 'En Proceso', color: '#60A5FA', order: 1 },
                      { key: 'urgente', label: 'Urgente', color: '#EF4444', order: 2 },
                      { key: 'completado', label: 'Completado', color: '#10B981', order: 3 },
                      { key: 'enviado', label: 'Enviado', color: '#A855F7', order: 4 },
                      { key: 'entregado', label: 'Entregado', color: '#059669', order: 5 },
                    ];

                    await tx.orderStatus.createMany({
                      data: defaultStatuses.map(status => ({
                        ...status,
                        tenantId: newTenant.id,
                        isActive: true,
                      })),
                      skipDuplicates: true
                    });
                    console.log('[OAuth]   ✅ Order statuses created');

                    return tx.user.findUnique({
                      where: { id: createdUser.id },
                      include: {
                        memberships: {
                          include: {
                            tenant: {
                              select: {
                                id: true,
                                name: true,
                                slug: true,
                                plan: true,
                                isActive: true,

                                trialEndsAt: true
                              }
                            }
                          }
                        }
                      }
                    });
                  });
                });
                console.log('[OAuth] ✅ Transaction completed successfully');
              } catch (userCreateError: any) {
                // Handle unique constraint violation (P2002)
                if (userCreateError.code === 'P2002') {
                  console.error(`[OAuth] ❌ Unique constraint violation - email already exists: ${normalizedEmail}`);
                  // Email already exists (race condition) - try to use existing user
                  const existingRaceUser = await prisma.user.findUnique({
                    where: { email: normalizedEmail },
                    include: {
                      memberships: {
                        include: {
                          tenant: {
                            select: {
                              id: true,
                              name: true,
                              slug: true,
                              plan: true,
                              isActive: true,

                              trialEndsAt: true
                            }
                          }
                        }
                      }
                    }
                  })
                  if (existingRaceUser) {
                    console.log(`[OAuth] ⚠️ Race condition - using existing user ${normalizedEmail}`)
                    newUser = existingRaceUser
                  } else {
                    console.error(`[OAuth] ❌ Failed to find user after constraint error`)
                    return false
                  }
                } else {
                  throw userCreateError // Re-throw other errors
                }
              }

              if (!newUser) {
                throw new Error('Failed to create new user');
              }

              // Update user object with new user data
              user.id = newUser.id;
              (user as any).email_verified = true;
              (user as any).active = true;
              (user as any).memberships = newUser.memberships || [];
              (user as any).role = 'MASTER';
              (user as any).tenantId = newUser.memberships?.[0]?.tenantId;

              return true;
            } catch (createError) {
              console.error('Error creating new user with tenant:', createError);
              return false;
            }
          } catch (error) {
            console.error('Error during OAuth sign-in:', error);
            return false;
          }

          return true;
        }

        return true;
      } catch (error) {
        console.error('Error during sign-in:', error);
        return false;
      }
    },

    async jwt({ token, user, account, trigger }) {
      // Business switcher (Phase 2b): `update()` from the client only forces the DB re-sync below,
      // which re-reads User.defaultTenantId (set by POST /api/tenant/switch after a membership
      // check). The client payload is NEVER read: a tenant id can't be injected from the browser.
      // Throttled (I1): a burst of update() calls cannot force a DB re-sync each time.
      if (trigger === 'update' && Date.now() - (token.lastDbSync || 0) > 2000) token.lastDbSync = 0

      // Initial sign in - populate all token fields
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || 'REGULAR';
        token.tenantId = (user as any).tenantId;
        token.email_verified = (user as any).email_verified || false;
        token.active = (user as any).active !== false;
        token.lastDbSync = Date.now();
        // Session version at sign-in; a password reset bumps it and ends this session.
        // Credentials logins carry the version read before their password check (race-free).
        if (typeof (user as any).sv === 'number') {
          (token as any).sv = (user as any).sv;
        } else {
          try {
            (token as any).sv = (await loadUserAuthState(user.id))?.sessionVersion ?? 0;
          } catch {
            (token as any).sv = 0;
          }
        }

        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { isLogisticsAdmin: true, isSuperAdmin: true },
          });
          token.isLogisticsAdmin = dbUser?.isLogisticsAdmin ?? false;
          (token as any).isSuperAdmin = dbUser?.isSuperAdmin ?? false;
        } catch {
          token.isLogisticsAdmin = false;
        }

        const memberships = (user as any).memberships || [];
        token.memberships = memberships;

        // CRITICAL: Set allTenantIds and currentTenant during initial sign-in
        if (memberships.length > 0) {
          token.allTenantIds = memberships.map((m: any) => m.tenantId || m.tenant?.id).filter(Boolean);

          // Resolve one explicit active tenant, then look up only that membership.
          const userTenantId = (user as any).tenantId;
          const selectedActiveTenantId = selectActiveTenantId(
            userTenantId,
            memberships.map((m: any) => m.tenantId || m.tenant?.id).filter(Boolean),
          );
          const currentMembership = memberships.find(
            (m: any) => (m.tenantId || m.tenant?.id) === selectedActiveTenantId,
          );

          // CRITICAL: Always set tenantId on token when user has memberships
          const selectedTenantId = currentMembership?.tenantId || currentMembership?.tenant?.id;
          if (selectedTenantId) {
            token.tenantId = selectedTenantId;
            console.log(`[JWT] ✅ Set tenantId on initial sign-in: ${selectedTenantId}`);
          }

          if (currentMembership) {
            const tenant = currentMembership.tenant;

            // If tenant data is not included, fetch it from database
            if (!tenant && currentMembership.tenantId) {
              try {
                const fetchedTenant = await prisma.tenant.findUnique({
                  where: { id: currentMembership.tenantId },
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive: true,
                    plan: true,

                    trialEndsAt: true
                  }
                });

                if (fetchedTenant) {
                  token.currentTenant = {
                    id: fetchedTenant.id,
                    role: currentMembership.role,
                    name: fetchedTenant.name,
                    slug: fetchedTenant.slug,
                    isActive: fetchedTenant.isActive,
                    plan: fetchedTenant.plan || 'FREE',


                    profileCompleted: false
                  };
                  console.log(`[JWT] ✅ Fetched tenant data for initial sign-in: ${fetchedTenant.name}`);
                }
              } catch (error) {
                console.error('[JWT] ❌ Error fetching tenant data:', error);
                // Fallback to basic tenant info
                token.currentTenant = {
                  id: currentMembership.tenantId || selectedTenantId,
                  role: currentMembership.role,
                  name: '',
                  slug: '',
                  isActive: true,
                  plan: 'FREE',


                  profileCompleted: false
                };
              }
            } else if (tenant) {
              // Tenant data is already included
              token.currentTenant = {
                id: tenant.id,
                role: currentMembership.role,
                name: tenant.name,
                slug: tenant.slug,
                isActive: tenant.isActive,
                plan: tenant.plan || 'FREE',


                profileCompleted: false
              };
              console.log(`[JWT] ✅ Using included tenant data: ${tenant.name}`);
            } else {
              // No tenant data available, use minimal fallback
              token.currentTenant = {
                id: currentMembership.tenantId || selectedTenantId,
                role: currentMembership.role,
                name: '',
                slug: '',
                isActive: true,
                plan: 'FREE',


                profileCompleted: false
              };
              console.log(`[JWT] ⚠️ Using fallback tenant data for: ${currentMembership.tenantId || selectedTenantId}`);
            }
          }
        } else {
          token.allTenantIds = [];
          token.currentTenant = null;
        }
      }

      // Only refresh from DB when token data is stale (every 5 minutes)
      const DB_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
      const isStale = !token.lastDbSync || (Date.now() - token.lastDbSync > DB_SYNC_INTERVAL);

      if (token.email && isStale) {
        token.lastDbSync = Date.now();
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email },
            select: {
              id: true,
              email: true,
              name: true,
              username: true,
              image: true,
              emailVerified: true,
              active: true,
              isSuperAdmin: true,
              isLogisticsAdmin: true,
              defaultTenantId: true,
              memberships: {
                where: { isActive: true },
                // Deterministic fallback when the default is gone: the oldest membership first.
                orderBy: { joinedAt: 'asc' },
                include: {
                  tenant: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      isActive: true,
                      plan: true,


                      createdAt: true
                    }
                  }
                }
              }
            }
          });

          if (dbUser) {
            let revoked = false;
            try {
              revoked = dbUser.active && !sessionMatches(await loadUserAuthState(dbUser.id), (token as any).sv);
            } catch {
              revoked = false; // auth-state hiccup: keep the session (next sync retries)
            }
            // Deactivated users / revoked sessions must not stay valid after DB sync
            if (!dbUser.active || revoked) {
              console.log(`[JWT] ❌ Clearing session for inactive user: ${dbUser.email}`);
              // Force middleware to treat this as unauthenticated on next request
              const cleared = { ...token } as JWT & { error?: string; active?: boolean };
              delete (cleared as { sub?: string }).sub;
              cleared.id = '';
              cleared.email = '';
              cleared.memberships = [];
              cleared.currentTenant = null;
              cleared.allTenantIds = [];
              cleared.tenantId = null;
              cleared.active = false;
              cleared.error = revoked ? 'session_revoked' : 'inactive_user';
              return cleared;
            }

            // Update token with latest user data
            token.id = dbUser.id;
            token.name = dbUser.name;
            token.email = dbUser.email;
            token.image = dbUser.image;
            token.isLogisticsAdmin = dbUser.isLogisticsAdmin ?? false;
            token.active = dbUser.active;

            // Update memberships and role
            const memberships = dbUser.memberships || [];
            // @ts-ignore - Membership type mismatch; runtime works correctly
            token.memberships = memberships;

            // Set role based on memberships
            if (memberships.length > 0) {
              const activeTenantIds = memberships.map((m) => m.tenantId);
              // The active business belongs to THIS session (SecureDog M1): a periodic re-sync keeps
              // it while the membership is still active; only an explicit switch (update()) or a
              // lost membership re-reads the default. Another device switching never moves this one.
              // Businesses that are themselves active (a deactivated business is never kept or picked
              // while another active one exists; SecureDog N2).
              const liveTenantIds = memberships.filter((m) => m.tenant?.isActive !== false).map((m) => m.tenantId);
              const selectable = liveTenantIds.length ? liveTenantIds : activeTenantIds;
              const keepCurrent =
                trigger !== 'update' &&
                typeof token.tenantId === 'string' &&
                selectable.includes(token.tenantId);
              const selectedTenantId = keepCurrent
                ? (token.tenantId as string)
                : selectActiveTenantId(dbUser.defaultTenantId, selectable);
              // Legacy MASTER = OWNER of the SELECTED business (L4; login already did this).
              token.role = memberships.find((m) => m.tenantId === selectedTenantId)?.role === 'OWNER' ? 'MASTER' : 'REGULAR';

              token.tenantId = selectedTenantId;

              // Store all tenant IDs for easy access
              token.allTenantIds = memberships.map(m => m.tenantId);

              // Find the membership for the selected tenant
              const currentMembership = memberships.find(m => m.tenantId === selectedTenantId);
              if (currentMembership?.tenant) {
                token.currentTenant = {
                  id: currentMembership.tenant.id,
                  role: currentMembership.role,
                  name: currentMembership.tenant.name,
                  slug: currentMembership.tenant.slug,
                  isActive: currentMembership.tenant.isActive,
                  plan: currentMembership.tenant.plan || 'FREE',


                  profileCompleted: false
                };
              }
            } else {
              // No active memberships found
              // IMPORTANT: Do NOT auto-create or reactivate tenants here. This runs on every JWT refresh.
              console.log(`[JWT] ⚠️ User ${dbUser.email} has no active memberships - not reactivating old tenants`);
              token.role = 'REGULAR';
              token.tenantId = null;
              token.allTenantIds = [];
              token.currentTenant = null;
            }
          }
        } catch (error) {
          console.error('Error updating token with user data:', error);
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.tenantId = token.tenantId;
        session.user.email_verified = token.email_verified;
        session.user.active = token.active;
        session.user.memberships = token.memberships;
        session.user.allTenantIds = token.allTenantIds || [];
        session.user.currentTenant = token.currentTenant || null;
        session.user.isLogisticsAdmin = token.isLogisticsAdmin ?? false;

        // Set membershipRole from currentTenant.role (this is the actual RBAC role: OWNER, ADMIN, etc.)
        // Map 'MASTER' to 'OWNER' for backward compatibility
        if (token.currentTenant?.role) {
          (session.user as any).membershipRole = token.currentTenant.role;
        } else if (token.role === 'MASTER') {
          (session.user as any).membershipRole = 'OWNER';
        } else if (token.memberships && token.memberships.length > 0) {
          const selectedMembership = token.memberships.find(
            membership => (membership.tenantId || membership.id) === token.tenantId,
          );
          (session.user as any).membershipRole = selectedMembership?.role || 'VIEWER';
        }
      }
      return session;
    }
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
}
