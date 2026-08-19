export default function DashboardLoading() {
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <div className="h-9 w-56 rounded-md bg-muted animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted animate-pulse" />
    </div>
  )
}
