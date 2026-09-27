import Link from 'next/link'
import { AuthShell, authPrimaryButtonClass } from '@/components/aurora/auth/AuthShell'

export default function NotFound() {
  return (
    <AuthShell
      brandPanel={false}
      icon={<span className="text-[44px] font-bold leading-none tracking-tight text-slate-300">404</span>}
      title="Página no encontrada"
      subtitle="La página que buscás no existe o se movió."
    >
      <Link href="/" className={authPrimaryButtonClass}>
        Volver al inicio
      </Link>
    </AuthShell>
  )
}
