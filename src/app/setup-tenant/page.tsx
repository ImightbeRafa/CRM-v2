'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { AuthShell } from '@/components/aurora/auth/AuthShell'
import { Loader2 } from 'lucide-react'

export default function SetupTenantPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === 'loading') return

    // Authenticated users go straight to dashboard; setup wizard is optional
    if (session?.user) {
      router.replace('/dashboard')
    } else {
      // Not authenticated, redirect to sign in
      router.replace('/auth/signin')
    }
  }, [session, status, router])

  // Show loading state while checking session
  return (
    <AuthShell
      brandPanel={false}
      icon={<Loader2 className="h-10 w-10 animate-spin text-[#5B6CFF]" aria-hidden />}
      title="Redirigiendo..."
    >
      <span className="sr-only" role="status">Redirigiendo</span>
    </AuthShell>
  )
}
