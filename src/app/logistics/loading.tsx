import { Loading } from '@/app/components/ui/loading'

export default function LogisticsLoading() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <Loading size="lg" text="Cargando logística..." />
    </div>
  )
}
