import { Loading } from '@/app/components/ui/loading'

export default function VentasLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loading size="lg" text="Cargando ventas..." />
    </div>
  )
}
