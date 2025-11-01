'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

export default function SetupTenantPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === 'loading') return

    // Redirect to setup-wizard if authenticated
    if (session?.user) {
      router.replace('/setup-wizard')
    } else {
      // Not authenticated, redirect to sign in
      router.replace('/auth/signin')
    }
  }, [session, status, router])

  // Show loading state while checking session
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
        <p className="mt-4 text-gray-600">Redirigiendo...</p>
      </div>
    </div>
  )
}

