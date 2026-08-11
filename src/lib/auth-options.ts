import { NextAuthOptions, Session, User } from "next-auth"
import { JWT } from "next-auth/jwt"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from './db'
import { verifyPassword, isBcryptHash } from './password'
import { createDefaultOrderStatuses } from './default-statuses'
import { withoutTenantIsolation } from './tenantContext'
import { rateLimit } from './rate-limit'

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
      async authorize(credentials) {
        const email = (credentials?.email || "").toString().trim()
        const password = (credentials?.password || "").toString()
        if (!email || !password) return null

        try {
          // Normalize email (trim and lowercase) for consistent lookup
          const normalizedEmail = email.toLowerCase()

          // Per-email rate limit to slow password spraying (memory/Redis via rateLimit)
          const loginLimit = rateLimit(`credentials:${normalizedEmail}`, {
            windowMs: 15 * 60 * 1000,
            maxRequests: 10,
            identifier: 'credentials-auth',
          })
          if (!loginLimit.allowed) {
            console.log(`[Credentials Auth] Rate limited: ${normalizedEmail}`)
            return null
          }

          // Find user by email (CASE-INSENSITIVE to handle legacy data with mixed casing)
          const user = await prisma.user.findFirst({
            where: {
              email: {
                equals: normalizedEmail,
                mode: 'insensitive'
              }
            },
            select: {
              id: true,
              username: true,
              email: true,
              password: true,
              active: true,
              emailVerified: true,
              defaultTenantId: true,
              memberships: {
                where: { isActive: true },
                select: { role: true, tenantId: true }
              }
            }
          })

          // Check if user exists
          if (!user) {
            console.log(`[Credentials Auth] User not found: ${normalizedEmail}`)
            return null
          }

          // Check if user is active
          if (!user.active) {
            console.log(`[Credentials Auth] User is inactive: ${normalizedEmail}`)
            return null
          }

          // Email verification is non-blocking: users can log in immediately
          // after registration and verify their email later.

          // Verify password (bcrypt only - plaintext support removed for security)
          let passwordValid = false;

          if (user.password) {
            if (!isBcryptHash(user.password)) {
              // Password is not bcrypt hashed - reject login
              console.error(`[Credentials Auth] User ${normalizedEmail} has non-bcrypt password - login rejected`);
              return null;
            }
            // Password is hashed with bcrypt - verify securely
            passwordValid = await verifyPassword(password, user.password);
          }

          if (!passwordValid) {
            return null
          }

          // Get membership role (OWNER, ADMIN, MANAGER, SALES, PRODUCTION, VIEWER)
          const membershipRole = user.memberships.length > 0 ? user.memberships[0].role : null

          // Legacy role for compatibility (OWNER -> MASTER)
          const role = membershipRole === 'OWNER' ? 'MASTER' : 'REGULAR'

          return {
            id: user.id,
            email: user.email,
            name: user.username || user.email, // Username for display, fallback to email
            role: role,
            membershipRole: membershipRole, // Actual role from Membership table
            tenantId: user.defaultTenantId || user.memberships[0]?.tenantId,
            email_verified: !!user.emailVerified,
            active: user.active,
            memberships: user.memberships.map(m => ({
              id: m.tenantId,
              role: m.role,
              tenantId: m.tenantId
            }))
          }
        } catch (error) {
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

            // Normalize email for storage (trim and lowercase)
            const normalizedEmail = email.trim().toLowerCase();

            // CRITICAL: Use case-insensitive search to find existing users
            // This prevents duplicate users when email casing differs (e.g., "User@gmail.com" vs "user@gmail.com")
            let dbUser = await prisma.user.findFirst({
              where: {
                email: {
                  equals: normalizedEmail,
                  mode: 'insensitive'
                }
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

              // Update user with latest info from OAuth provider, including OAuth provider info
              const updatedUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                  name: user.name || dbUser.name,
                  image: user.image || dbUser.image,
                  emailVerified: dbUser.emailVerified || new Date(),
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

              // Set role based on memberships - use existing tenant memberships
              if (updatedUser.memberships.length > 0) {
                const hasOwnerRole = updatedUser.memberships.some(m => m.role === 'OWNER');
                (user as any).role = hasOwnerRole ? 'MASTER' : 'REGULAR';
                // Prioritize defaultTenantId if set, otherwise use first active membership
                let selectedTenantId = updatedUser.defaultTenantId;
                if (selectedTenantId) {
                  // Verify defaultTenantId is in active memberships
                  const hasDefaultTenant = updatedUser.memberships.some(m => m.tenantId === selectedTenantId);
                  if (!hasDefaultTenant) {
                    // Default tenant not in active memberships, use first one
                    selectedTenantId = updatedUser.memberships[0]?.tenantId;
                  }
                } else {
                  // No defaultTenantId, use first active membership
                  selectedTenantId = updatedUser.memberships[0]?.tenantId;
                }
                (user as any).tenantId = selectedTenantId;
                (user as any).memberships = updatedUser.memberships;
                console.log(`[OAuth] ✅ User logged in with tenant: ${selectedTenantId} (${updatedUser.memberships.length} active membership(s))`);
                return true; // SUCCESS - User has active memberships
              } else {
                // User exists but has no ACTIVE memberships
                // CRITICAL: This happens when users are added via API - they have defaultTenantId but inactive membership
                console.log(`[OAuth] ⚠️ User ${updatedUser.email} has no active memberships, checking for inactive ones...`);

                if (updatedUser.defaultTenantId) {
                  // User has a defaultTenantId - they were added to a tenant
                  // Find and reactivate their membership
                  try {
                    // Look for ANY membership (active or inactive) for the default tenant
                    const membership = await prisma.membership.findFirst({
                      where: {
                        userId: updatedUser.id,
                        tenantId: updatedUser.defaultTenantId
                      },
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
                    });

                    if (membership) {
                      // Membership exists - reactivate it if inactive
                      if (!membership.isActive) {
                        await prisma.membership.update({
                          where: { id: membership.id },
                          data: { isActive: true }
                        });
                        console.log(`[OAuth] ✅ Reactivated membership for ${updatedUser.email} in tenant ${updatedUser.defaultTenantId}`);
                      }

                      // Set user data for session
                      (user as any).role = membership.role === 'OWNER' ? 'MASTER' : 'REGULAR';
                      (user as any).tenantId = updatedUser.defaultTenantId;
                      (user as any).memberships = [membership];
                      console.log(`[OAuth] ✅ User ${updatedUser.email} logged in with reactivated membership`);
                      return true;
                    } else {
                      // No membership exists yet - create one (user was added to User table with defaultTenantId but no membership record)
                      const newMembership = await prisma.membership.create({
                        data: {
                          userId: updatedUser.id,
                          tenantId: updatedUser.defaultTenantId,
                          role: 'VIEWER', // Default role for API-added users
                          isActive: true,
                          joinedAt: new Date()
                        },
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
                      });

                      (user as any).role = 'REGULAR';
                      (user as any).tenantId = updatedUser.defaultTenantId;
                      (user as any).memberships = [newMembership];
                      console.log(`[OAuth] ✅ Created new membership for ${updatedUser.email}`);
                      return true;
                    }
                  } catch (membershipError) {
                    console.error(`[OAuth] ❌ Error handling membership:`, membershipError);
                    return false;
                  }
                }

                // No defaultTenantId set - check if user has ANY old memberships to reactivate
                console.log(`[OAuth] ⚠️ User ${updatedUser.email} has no defaultTenantId, checking for old memberships...`);
                const anyMembership = await prisma.membership.findFirst({
                  where: { userId: updatedUser.id },
                  orderBy: { joinedAt: 'desc' },
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
                });

                if (anyMembership) {
                  // Found an old membership - reactivate it
                  await prisma.membership.update({
                    where: { id: anyMembership.id },
                    data: { isActive: true }
                  });
                  // Set defaultTenantId
                  await prisma.user.update({
                    where: { id: updatedUser.id },
                    data: { defaultTenantId: anyMembership.tenantId }
                  });

                  (user as any).role = anyMembership.role === 'OWNER' ? 'MASTER' : 'REGULAR';
                  (user as any).tenantId = anyMembership.tenantId;
                  (user as any).memberships = [anyMembership];
                  console.log(`[OAuth] ✅ Reactivated old membership for ${updatedUser.email}`);
                  return true;
                }

                // No memberships at all - user needs to be invited to a tenant first
                console.error(`[OAuth] ❌ Access Denied: User ${updatedUser.email} has no tenant memberships. They must be invited by a tenant owner.`);
                return false;
              }

              return true;
            }

            // If we get here, user doesn't exist - create new user with tenant
            console.log(`[OAuth] Creating new user: ${normalizedEmail}`);
            try {
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

    async jwt({ token, user, account }) {
      // Initial sign in - populate all token fields
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || 'REGULAR';
        token.tenantId = (user as any).tenantId;
        token.email_verified = (user as any).email_verified || false;
        token.active = (user as any).active !== false;
        token.lastDbSync = Date.now();

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

          // Find current tenant details - prioritize user's tenantId, fallback to first membership
          const userTenantId = (user as any).tenantId;
          const currentMembership = memberships.find((m: any) => (m.tenantId || m.tenant?.id) === userTenantId) || memberships[0];

          // CRITICAL: Always set tenantId on token when user has memberships
          const selectedTenantId = currentMembership.tenantId || currentMembership.tenant?.id;
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
            // Deactivated users must not keep a valid session after DB sync
            if (!dbUser.active) {
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
              cleared.error = 'inactive_user';
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
              const hasOwnerRole = memberships.some(m => m.role === 'OWNER');
              token.role = hasOwnerRole ? 'MASTER' : 'REGULAR';

              // Prioritize defaultTenantId if set and in active memberships
              let selectedTenantId = dbUser.defaultTenantId;
              if (selectedTenantId) {
                // Verify defaultTenantId is in active memberships
                const hasDefaultTenant = memberships.some(m => m.tenantId === selectedTenantId);
                if (!hasDefaultTenant) {
                  // Default tenant not in active memberships, use first one
                  selectedTenantId = memberships[0]?.tenantId;
                }
              } else {
                // No defaultTenantId, use first active membership
                selectedTenantId = memberships[0]?.tenantId;
              }

              token.tenantId = selectedTenantId;

              // Store all tenant IDs for easy access
              token.allTenantIds = memberships.map(m => m.tenantId);

              // Find the membership for the selected tenant
              const currentMembership = memberships.find(m => m.tenantId === selectedTenantId) || memberships[0];
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
              // IMPORTANT: Do NOT auto-create tenants here! This runs on every JWT refresh.
              // Tenants should only be created during explicit registration or first-time OAuth sign-up.
              // Users without memberships need to be invited to a tenant or go through proper registration.
              console.log(`[JWT] ⚠️ User ${dbUser.email} has no active memberships - not creating auto-tenant`);

              // Check if user has a defaultTenantId but no membership (inconsistent state)
              if (dbUser.defaultTenantId) {
                // Try to find ANY membership (even inactive) and reactivate it
                const anyMembership = await prisma.membership.findFirst({
                  where: {
                    userId: dbUser.id,
                    tenantId: dbUser.defaultTenantId
                  },
                  include: {
                    tenant: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                        isActive: true,
                        plan: true,
                        trialEndsAt: true
                      }
                    }
                  }
                });

                if (anyMembership) {
                  // Found membership - reactivate if inactive
                  if (!anyMembership.isActive) {
                    await prisma.membership.update({
                      where: { id: anyMembership.id },
                      data: { isActive: true }
                    });
                    console.log(`[JWT] ✅ Reactivated membership for ${dbUser.email}`);
                  }

                  token.role = anyMembership.role === 'OWNER' ? 'MASTER' : 'REGULAR';
                  token.tenantId = dbUser.defaultTenantId;
                  token.allTenantIds = [dbUser.defaultTenantId];
                  token.currentTenant = {
                    id: anyMembership.tenant.id,
                    role: anyMembership.role,
                    name: anyMembership.tenant.name,
                    slug: anyMembership.tenant.slug,
                    isActive: anyMembership.tenant.isActive,
                    plan: anyMembership.tenant.plan || 'FREE',
                    profileCompleted: false
                  };
                  // @ts-ignore
                  token.memberships = [anyMembership];
                } else {
                  // No membership at all - user needs to be properly invited or registered
                  console.log(`[JWT] ❌ User ${dbUser.email} has defaultTenantId but no membership record`);
                  token.role = 'REGULAR';
                  token.tenantId = null;
                  token.allTenantIds = [];
                  token.currentTenant = null;
                }
              } else {
                // No defaultTenantId and no memberships - user needs proper registration
                token.role = 'REGULAR';
                token.tenantId = null;
                token.allTenantIds = [];
                token.currentTenant = null;
              }
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
          // Fallback: get role from first active membership
          const firstMembership = token.memberships[0];
          (session.user as any).membershipRole = firstMembership?.role || 'VIEWER';
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
