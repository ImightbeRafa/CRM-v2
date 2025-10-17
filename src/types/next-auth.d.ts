import NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null
      email?: string | null
      image?: string | null
      role?: "MASTER" | "REGULAR"
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "MASTER" | "REGULAR"
    accessToken?: string
  }
}


