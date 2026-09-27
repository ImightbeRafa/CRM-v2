import Link from 'next/link'
import { Shield, ArrowLeft } from 'lucide-react'
import {
  AuthShell,
  authPrimaryButtonClass,
  authLinkClass,
} from '@/components/aurora/auth/AuthShell'

export default function UnauthorizedPage() {
  return (
    <AuthShell
      brandPanel={false}
      icon={
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Shield className="h-6 w-6" aria-hidden />
        </span>
      }
      title="Acceso denegado"
      subtitle="No tenés permiso para ver esta página. Si creés que es un error, hablá con quien administra tu cuenta."
    >
      <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
        <p className="text-[13px] font-medium text-slate-800">Cada rol accede a secciones distintas:</p>
        <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
          <li>• <strong>Owner / Admin:</strong> acceso completo</li>
          <li>• <strong>Manager:</strong> ventas, producción y estadísticas</li>
          <li>• <strong>Ventas:</strong> solo el módulo de ventas</li>
          <li>• <strong>Producción:</strong> solo el módulo de producción</li>
          <li>• <strong>Solo lectura:</strong> puede ver, no editar</li>
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <Link href="/dashboard" className={authPrimaryButtonClass}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Ir al inicio
        </Link>
        <Link href="/auth/signin" className={`${authLinkClass} text-center text-[13px]`}>
          Iniciar sesión con otra cuenta
        </Link>
      </div>
    </AuthShell>
  )
}
