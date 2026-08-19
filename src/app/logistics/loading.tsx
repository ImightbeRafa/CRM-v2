export default function LogisticsLoading() {
  return (
    <div className="space-y-4 p-2">
      <div className="h-8 w-56 rounded-md bg-white/10 animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-white/10 animate-pulse" />
        ))}
      </div>
      <div className="h-12 rounded-xl bg-white/10 animate-pulse" />
      <div className="h-80 rounded-xl bg-white/10 animate-pulse" />
    </div>
  )
}
