export default function VentasLoading() {
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <div className="h-9 w-40 rounded-md bg-muted animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-muted animate-pulse" />
    </div>
  )
}
