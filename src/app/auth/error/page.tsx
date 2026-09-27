"use client"

import Link from 'next/link'
import { AuthShell, authPrimaryButtonClass } from '@/components/aurora/auth/AuthShell'

export default function ErrorPage() {
  return (
    <AuthShell
      brandPanel={false}
      title="Acceso denegado"
      subtitle="Lo sentimos, no tienes autorización para acceder a esta aplicación."
    >
      <Link href="/auth/signin" className={authPrimaryButtonClass}>
        Volver a iniciar sesión
      </Link>
    </AuthShell>
  )
}
