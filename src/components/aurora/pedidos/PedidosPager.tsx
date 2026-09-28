import { ChevronLeft, ChevronRight } from 'lucide-react'

function pageWindow(page: number, totalPages: number): number[] {
  const size = Math.min(5, totalPages)
  let start = Math.max(1, page - Math.floor(size / 2))
  start = Math.min(start, totalPages - size + 1)
  return Array.from({ length: size }, (_, i) => start + i)
}

const BTN = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] transition-colors'

export function PedidosPager({
  page,
  totalPages,
  shown,
  total,
  onPage,
}: {
  page: number
  totalPages: number
  shown: number
  total: number
  onPage: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
      <p className="text-[12px] text-slate-400">
        Mostrando {shown} de {total} {total === 1 ? 'pedido' : 'pedidos'}
      </p>
      {totalPages > 1 ? (
        <nav className="flex items-center gap-1" aria-label="Paginación">
          <button
            type="button"
            className={`${BTN} text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40`}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageWindow(page, totalPages).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`${BTN} ${
                p === page
                  ? 'bg-gradient-to-br from-[#5B6CFF] to-[#8B5CF6] font-semibold text-white'
                  : 'text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className={`${BTN} text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40`}
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
            aria-label="Página siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      ) : null}
    </div>
  )
}
