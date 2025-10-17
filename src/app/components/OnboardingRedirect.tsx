'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export function OnboardingRedirect() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [hasChecked, setHasChecked] = useState(false)

  useEffect(() => {
    if (status === 'loading' || hasChecked) return

    if (session?.user?.role === 'MASTER') {
      // Check if this is first-time setup by looking for any existing config
      const checkSetup = async () => {
        try {
          const [fieldsRes, sellersRes] = await Promise.all([
            fetch('/api/config/fields').catch(() => ({ status: 500, json: () => ({ status: 'error', data: [] }) })),
            fetch('/api/config/sellers').catch(() => ({ status: 500, json: () => ({ status: 'error', data: [] }) }))
          ])
          
          const [fields, sellers] = await Promise.all([
            fieldsRes.json(),
            sellersRes.json()
          ])

          // If no fields or sellers exist (or API errors), redirect to config for setup
          if ((fields.status === 'error' || fields.data?.length === 0) && 
              (sellers.status === 'error' || sellers.data?.length === 0)) {
            router.push('/config?onboarding=true')
          }
        } catch (error) {
          console.error('Error checking setup:', error)
          // If there's an error (like database not migrated), redirect to config
          router.push('/config?onboarding=true')
        } finally {
          setHasChecked(true)
        }
      }

      checkSetup()
    } else {
      setHasChecked(true)
    }
  }, [session, status, router, hasChecked])

  return null
}
