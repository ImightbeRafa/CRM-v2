import NextAuth, { DefaultSession } from "next-auth"

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
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: "MASTER" | "REGULAR"
      tenantId?: string | null
      email_verified?: boolean
      active?: boolean
      memberships?: Membership[]
      allTenantIds?: string[]
      currentTenant?: {
        id: string;
        role: MemberRole;
        name?: string;
        slug?: string;
        isActive?: boolean;
      } | null
    } & DefaultSession["user"]
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    role?: "MASTER" | "REGULAR"
    tenantId?: string | null
    email_verified?: boolean
    active?: boolean
    memberships?: Membership[]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role?: "MASTER" | "REGULAR"
    tenantId?: string | null
    email_verified?: boolean
    active?: boolean
    memberships?: Membership[]
    allTenantIds?: string[]
    tenantId?: string | null
    email_verified?: boolean
    accessToken?: string
  }
}
