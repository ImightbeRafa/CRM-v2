'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/app/components/ui/card'
import { Button } from '@/app/components/ui/button'
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react'
import Link from 'next/link'

export default function VerifyEmailPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'pending'>('pending')
  const [message, setMessage] = useState<string>('')
  const email = searchParams?.get('email') || ''
  const token = searchParams?.get('token')

  useEffect(() => {
    // If token is provided, verify immediately
    if (token) {
      verifyEmail(token)
    }
  }, [token])

  const verifyEmail = async (verificationToken: string) => {
    setStatus('loading')
    try {
      const response = await fetch(`/api/auth/verify-email?token=${verificationToken}`)
      const data = await response.json()

      if (response.ok && data.success) {
        setStatus('success')
        setMessage('Email verified successfully! Your account has been activated. Redirecting to dashboard...')
        
        // Redirect to dashboard after a short delay
        // Use window.location.href for a full page reload to refresh the session
        setTimeout(() => {
          // Force a full page reload to refresh the session with new tenant info
          window.location.href = '/dashboard'
        }, 1500)
      } else {
        setStatus('error')
        setMessage(data.error || 'Email verification failed. The link may be invalid or expired.')
      }
    } catch (error) {
      setStatus('error')
      setMessage('An error occurred during email verification. Please try again.')
      console.error('Verification error:', error)
    }
  }

  const resendVerificationEmail = async () => {
    if (!email) {
      setMessage('Email address is required to resend verification email.')
      return
    }

    setStatus('loading')
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      if (!response.ok) {
        // Try to parse error message
        let errorMessage = 'Failed to resend verification email.';
        try {
          const data = await response.json()
          errorMessage = data.error || data.message || errorMessage
        } catch {
          // If JSON parsing fails, read as text
          try {
            const text = await response.text()
            errorMessage = text || errorMessage
          } catch {
            // Use default error message
          }
        }
        setStatus('error')
        setMessage(errorMessage)
        return
      }

      // Success response
      const data = await response.json()
      setStatus('pending')
      setMessage(data.message || 'Verification email sent! Please check your inbox.')
    } catch (error) {
      setStatus('error')
      setMessage('An error occurred. Please try again.')
      console.error('Resend error:', error)
    }
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-100 p-3 rounded-full">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">Email Verified!</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-600 mb-4">Redirecting you to the dashboard...</p>
            <Link href="/dashboard">
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-red-100 p-3 rounded-full">
                <XCircle className="w-12 h-12 text-red-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">Verification Failed</CardTitle>
            <CardDescription className="text-red-600">{message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>What to do:</strong>
              </p>
              <ul className="text-sm text-yellow-700 mt-2 space-y-1 list-disc list-inside">
                <li>Check that you clicked the link from your most recent verification email</li>
                <li>Verification links expire after 24 hours</li>
                <li>If the link expired, request a new verification email below</li>
              </ul>
            </div>
            {email && (
              <Button onClick={resendVerificationEmail} className="w-full" variant="outline">
                <Mail className="w-4 h-4 mr-2" />
                Resend Verification Email
              </Button>
            )}
            <Link href="/auth/signin" className="block">
              <Button variant="ghost" className="w-full">Back to Sign In</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            </div>
            <CardTitle className="text-2xl">Verifying Email...</CardTitle>
            <CardDescription>Please wait while we verify your email address.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  // Pending state - waiting for user to click link
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-blue-100 p-3 rounded-full">
              <Mail className="w-12 h-12 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-2xl">Verify Your Email</CardTitle>
          <CardDescription>
            {email ? `We've sent a verification email to ${email}` : 'Check your email for a verification link'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Next steps:</strong>
            </p>
            <ol className="text-sm text-blue-700 mt-2 space-y-1 list-decimal list-inside">
              <li>Check your email inbox (and spam folder)</li>
              <li>Click the verification link in the email</li>
              <li>You'll be redirected back here to complete verification</li>
            </ol>
          </div>
          {email && (
            <Button onClick={resendVerificationEmail} className="w-full" variant="outline">
              <Mail className="w-4 h-4 mr-2" />
              Resend Verification Email
            </Button>
          )}
          {message && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-800">{message}</p>
            </div>
          )}
          <Link href="/auth/signin" className="block">
            <Button variant="ghost" className="w-full">Back to Sign In</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

