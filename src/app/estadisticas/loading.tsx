export default function EstadisticasLoading() {
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <div className="h-9 w-72 rounded-md bg-muted animate-pulse" />
      <div className="h-12 w-full max-w-xl rounded-md bg-muted animate-pulse" />
      <div className="h-80 rounded-xl bg-muted animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-72 rounded-xl bg-muted animate-pulse" />
        <div className="h-72 rounded-xl bg-muted animate-pulse" />
      </div>
    </div>
  )
}
