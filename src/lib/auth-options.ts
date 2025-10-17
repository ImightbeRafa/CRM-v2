import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

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
        const username = (credentials?.email || "").toString().trim()
        const password = (credentials?.password || "").toString()
        if (!username || !password) return null
        
        try {
          // Find user in database
          const user = await prisma.user.findUnique({
            where: { username },
            select: { id: true, username: true, password: true, role: true, active: true }
          })
          
          if (!user || !user.active) {
            return null
          }
          
          // Verify password
          const isValidPassword = await bcrypt.compare(password, user.password)
          if (!isValidPassword) {
            return null
          }
          
          return { 
            id: user.id, 
            email: user.username, 
            name: user.username,
            role: user.role 
          }
        } catch (error) {
          console.error('Auth error:', error)
          return null
        }
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    async signIn() {
      return true
    },
    async session({ session, token }) {
      if (!session?.user) return { expires: "" }
      // Attach role from token
      const role = (token.role as UserRole | undefined) || "REGULAR"
      session.user.role = role as any
      return session
    },
    async jwt({ token, user, account }) {
      if (account && user) {
        token.accessToken = (account as any).access_token
      }
      // Assign role from database user
      if (user) {
        token.role = (user as any).role || "REGULAR"
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
