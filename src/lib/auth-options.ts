import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { prisma } from './db'
import { verifyPassword, isBcryptHash } from './password'
import { createDefaultOrderStatuses } from './default-statuses'

type UserRole = "MASTER" | "REGULAR"

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
              defaultTenantId: true,
              memberships: {
                where: { isActive: true },
                select: { role: true, tenantId: true }
              }
            }
          })
          
          if (!user || !user.active) {
            return null
          }
          
          // Verify password (supports both bcrypt and plain text for migration)
          let passwordValid = false;
          
          console.log('🔐 Login attempt for:', user.email);
          console.log('🔐 Password provided:', password ? 'YES' : 'NO');
          console.log('🔐 Password in DB:', user.password ? 'YES' : 'NO');
          console.log('🔐 Password starts with:', user.password?.substring(0, 7));
          console.log('🔐 Is bcrypt hash:', isBcryptHash(user.password || ''));
          
          if (user.password) {
            if (isBcryptHash(user.password)) {
              // Password is hashed with bcrypt - verify securely
              console.log('🔐 Using bcrypt verification...');
              passwordValid = await verifyPassword(password, user.password);
              console.log('🔐 Bcrypt verification result:', passwordValid);
            } else {
              // Legacy plain text password (for migration period)
              // TODO: Remove this after all passwords are migrated to bcrypt
              console.log('🔐 Using plain text comparison...');
              passwordValid = user.password === password;
              console.log('🔐 Plain text comparison result:', passwordValid);
              
              if (passwordValid) {
                console.warn(`User ${user.username || user.email} logged in with plain text password - needs migration`);
              }
            }
          }
          
          if (!passwordValid) {
            console.error('🔐 Password validation failed!');
            return null
          }
          
          console.log('🔐 Login successful!');
          
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
            tenantId: user.defaultTenantId || user.memberships[0]?.tenantId
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
      // Handle Google OAuth sign-in
      if (account?.provider === "google" && profile?.email) {
        try {
          // Check if user exists
          let dbUser = await prisma.user.findUnique({
            where: { email: profile.email },
            include: {
              memberships: {
                where: { isActive: true },
                include: { tenant: true }
              }
            }
          });

          // If user doesn't exist, create them with a new tenant
          if (!dbUser) {
            // Create tenant first
            const newTenant = await prisma.tenant.create({
              data: {
                name: `${profile.name || profile.email}'s Workspace`,
                slug: profile.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
                plan: 'FREE',
                isActive: true,
                trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
              }
            });

            // Create default order statuses for the new tenant (non-blocking)
            try {
              await createDefaultOrderStatuses(newTenant.id, newTenant.name);
            } catch (statusError) {
              console.warn('Failed to create default order statuses for new tenant:', statusError);
              // Don't fail the sign-up process if status creation fails
            }

            // Create user with membership
            dbUser = await prisma.user.create({
              data: {
                email: profile.email,
                username: profile.name || profile.email.split('@')[0],
                name: profile.name,
                image: (profile as any).picture,
                provider: 'google',
                providerId: account.providerAccountId,
                emailVerified: new Date(),
                active: true,
                defaultTenantId: newTenant.id,
                memberships: {
                  create: {
                    tenantId: newTenant.id,
                    role: 'OWNER',
                    isActive: true,
                    joinedAt: new Date().toISOString()
                  }
                }
              },
              include: {
                memberships: {
                  where: { isActive: true },
                  include: { tenant: true }
                }
              }
            });

            console.log(`✅ New Google user created: ${dbUser.email} with tenant: ${newTenant.name}`);
          }

          // Attach membership info to user object for JWT
          if (dbUser.memberships.length > 0) {
            (user as any).membershipRole = dbUser.memberships[0].role;
            (user as any).tenantId = dbUser.memberships[0].tenantId;
            (user as any).role = dbUser.memberships[0].role === 'OWNER' ? 'MASTER' : 'REGULAR';
          }

          return true;
        } catch (error) {
          console.error('Error during Google OAuth sign-in:', error);
          return false;
        }
      }
      
      return true;
    },
    async session({ session, token }) {
      if (!session?.user) return { expires: "" }
      // Attach role, membershipRole, and tenantId from token
      const role = (token.role as UserRole | undefined) || "REGULAR"
      session.user.role = role as any
      (session.user as any).membershipRole = token.membershipRole as any
      (session.user as any).tenantId = token.tenantId as any
      return session
    },
    async jwt({ token, user, account }) {
      if (account && user) {
        token.accessToken = (account as any).access_token
      }
      // Assign role, membershipRole, and tenantId from database user
      if (user) {
        token.role = (user as any).role || "REGULAR"
        token.membershipRole = (user as any).membershipRole
        token.tenantId = (user as any).tenantId
      }
      return token
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET || "dev-secret",
}
