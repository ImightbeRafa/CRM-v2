import { NextAuthOptions, Session, User } from "next-auth"
import { JWT } from "next-auth/jwt"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from './db'
import { verifyPassword, isBcryptHash } from './password'
import { createDefaultOrderStatuses } from './default-statuses'

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

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
      currentTenant?: {
        id: string;
        role: MemberRole;
        name?: string;
        slug?: string;
        isActive?: boolean;
        setupWizardCompleted?: boolean;
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
    currentTenant?: {
      id: string;
      role: MemberRole;
      name?: string;
      slug?: string;
      isActive?: boolean;
      plan?: string;
      subscriptionStatus?: string | null;
      trialEndsAt?: Date | null;
      setupWizardCompleted?: boolean;
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
      async authorize(credentials) {
        const email = (credentials?.email || "").toString().trim()
        const password = (credentials?.password || "").toString()
        if (!email || !password) return null
        
        try {
          // Find user by email only (username is for display/tracking purposes)
          const user = await prisma.user.findUnique({
            where: { 
              email: email
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
          
          // Check if user exists and is active
          if (!user) {
            throw new Error('Invalid credentials')
          }
          
          // Check if email is verified (only for non-OAuth users with password)
          // Temporarily disabled to allow immediate login after registration
          // if (user.password && !user.emailVerified) {
          //   throw new Error('Please verify your email before signing in')
          // }
          
          // Check if account is active
          if (!user.active) {
            // Allow login but they'll be restricted in the session callback
            // until they verify their email
          }
          
          // Verify password (supports both bcrypt and plain text for migration)
          let passwordValid = false;
          
          if (user.password) {
            if (isBcryptHash(user.password)) {
              // Password is hashed with bcrypt - verify securely
              passwordValid = await verifyPassword(password, user.password);
            } else {
              // Legacy plain text password (for migration period)
              // TODO: Remove this after all passwords are migrated to bcrypt
              passwordValid = user.password === password;
            }
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

            // Check if user exists
            const dbUser = await prisma.user.findUnique({
              where: { email },
              include: {
                memberships: {
                  where: { isActive: true },
                  include: { tenant: true }
                }
              }
            });

            // If user exists, update their information and return
            if (dbUser) {
              // Update user with latest info from OAuth provider
              const updatedUser = await prisma.user.update({
                where: { id: dbUser.id },
                data: {
                  name: user.name || dbUser.name,
                  image: user.image || dbUser.image,
                  emailVerified: dbUser.emailVerified || new Date()
                },
                include: {
                  memberships: {
                    where: { isActive: true },
                    include: { tenant: true }
                  }
                }
              });

              // Update user object with latest data
              user.id = updatedUser.id;
              (user as any).email_verified = !!updatedUser.emailVerified;
              (user as any).active = updatedUser.active !== false;
              (user as any).memberships = updatedUser.memberships || [];
              
              // Set role based on memberships
              if (updatedUser.memberships.length > 0) {
                const hasOwnerRole = updatedUser.memberships.some(m => m.role === 'OWNER');
                (user as any).role = hasOwnerRole ? 'MASTER' : 'REGULAR';
                (user as any).tenantId = updatedUser.memberships[0]?.tenantId;
              }
              
              return true;
            }

            // If we get here, user doesn't exist - create new user with tenant
            try {
              const emailPrefix = email.split('@')[0];
              const tenantName = `${user.name || emailPrefix}'s Organization`;
              
              // Create tenant first
              const newTenant = await prisma.tenant.create({
                data: {
                  name: tenantName,
                  slug: emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                  plan: 'FREE',
                  isActive: true,
                  trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
                }
              });

              // Create default order statuses for the new tenant
              try {
                await createDefaultOrderStatuses(newTenant.id);
              } catch (statusError) {
                console.warn('Failed to create default order statuses for new tenant:', statusError);
                // Don't fail the sign-up process if status creation fails
              }

              // Create user with membership in a transaction to ensure data consistency
              const newUser = await prisma.$transaction(async (tx) => {
                const createdUser = await tx.user.create({
                  data: {
                    email: email,
                    username: user.name || emailPrefix,
                    name: user.name || undefined,
                    image: user.image || undefined,
                    provider: 'google',
                    emailVerified: new Date(),
                    active: true
                  }
                });

                await tx.membership.create({
                  data: {
                    role: 'OWNER',
                    isActive: true,
                    joinedAt: new Date(),
                    user: { connect: { id: createdUser.id } },
                    tenant: { connect: { id: newTenant.id } }
                  }
                });

                return tx.user.findUnique({
                  where: { id: createdUser.id },
                  include: {
                    memberships: {
                      include: { tenant: true }
                    }
                  }
                });
              });

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
      // Initial sign in
      if (user) {
        token.id = user.id;
        token.role = (user as any).role || 'REGULAR';
        token.tenantId = (user as any).tenantId;
        token.email_verified = (user as any).email_verified || false;
        token.active = (user as any).active !== false; // Default to true if not set
        token.memberships = (user as any).memberships || [];
      }
      
      // Update token with latest user data if needed
      if (token.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email },
            include: { 
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
                      subscriptionStatus: true,
                      trialEndsAt: true,
                      setupWizardCompleted: true,
                      createdAt: true
                    }
                  }
                }
              }
            }
          });
          
          if (dbUser) {
            // Update token with latest user data
            token.id = dbUser.id;
            token.name = dbUser.name;
            token.email = dbUser.email;
            token.image = dbUser.image;
            
            // Update memberships and role
            const memberships = dbUser.memberships || [];
            token.memberships = memberships;
            
            // Set role based on memberships
            if (memberships.length > 0) {
              const hasOwnerRole = memberships.some(m => m.role === 'OWNER');
              token.role = hasOwnerRole ? 'MASTER' : 'REGULAR';
              token.tenantId = memberships[0]?.tenantId;
              
              // Store all tenant IDs for easy access
              token.allTenantIds = memberships.map(m => m.tenantId);
              
              // Store current tenant info (first one by default)
              const currentMembership = memberships[0];
              if (currentMembership?.tenant) {
                // Safely access setupWizardCompleted - it may not exist in all database schemas
                const tenant = currentMembership.tenant as any;
                token.currentTenant = {
                  id: currentMembership.tenant.id,
                  role: currentMembership.role,
                  name: currentMembership.tenant.name,
                  slug: currentMembership.tenant.slug,
                  isActive: currentMembership.tenant.isActive,
                  plan: currentMembership.tenant.plan || 'FREE',
                  subscriptionStatus: currentMembership.tenant.subscriptionStatus || null,
                  trialEndsAt: currentMembership.tenant.trialEndsAt || null,
                  setupWizardCompleted: tenant.setupWizardCompleted ?? false // Default to false if not present
                };
              }
            } else {
              // No tenant found - check if user is verified and create tenant automatically
              if (dbUser.emailVerified && dbUser.active) {
                try {
                  const { createDefaultOrderStatuses } = await import('@/lib/default-statuses');
                  
                  const newTenant = await prisma.tenant.create({
                    data: {
                      name: `${dbUser.username || dbUser.email.split('@')[0]}'s Organization`,
                      slug: dbUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
                      plan: 'FREE',
                      isActive: true,
                      trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
                      setupWizardCompleted: false, // New tenants must complete setup wizard
                    }
                  });
                  
                  // Update user default tenant
                  await prisma.user.update({
                    where: { id: dbUser.id },
                    data: { defaultTenantId: newTenant.id }
                  });
                  
                  // Create membership with OWNER role
                  const membership = await prisma.membership.create({
                    data: {
                      userId: dbUser.id,
                      tenantId: newTenant.id,
                      role: 'OWNER',
                      isActive: true,
                      joinedAt: new Date()
                    },
                    include: { tenant: true }
                  });
                  
                  // Create default order statuses
                  await createDefaultOrderStatuses(newTenant.id);
                  
                  // Update token with new tenant info
                  token.role = 'MASTER';
                  token.tenantId = newTenant.id;
                  token.allTenantIds = [newTenant.id];
                  token.currentTenant = {
                    id: newTenant.id,
                    role: 'OWNER',
                    name: newTenant.name,
                    slug: newTenant.slug,
                    isActive: newTenant.isActive,
                    plan: newTenant.plan || 'FREE',
                    subscriptionStatus: newTenant.subscriptionStatus || null,
                    trialEndsAt: newTenant.trialEndsAt || null,
                    setupWizardCompleted: newTenant.setupWizardCompleted || false
                  };
                  token.memberships = [membership];
                } catch (error) {
                  // Continue with null tenant - user will be redirected to setup
                  token.role = 'REGULAR';
                  token.tenantId = null;
                  token.allTenantIds = [];
                  token.currentTenant = null;
                }
              } else {
                // User not verified or inactive - no tenant yet
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
  secret: process.env.NEXTAUTH_SECRET || "dev-secret",
  debug: process.env.NODE_ENV === 'development',
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  }
}
