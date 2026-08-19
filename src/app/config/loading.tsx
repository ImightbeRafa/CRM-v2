export default function ConfigLoading() {
  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 w-24 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-96 rounded-xl bg-muted animate-pulse" />
    </div>
  )
}
