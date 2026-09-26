import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const DIR = 'src/components/aurora/estadisticas'
const componentFiles = () => readdirSync(join(process.cwd(), DIR)).map((f) => `${DIR}/${f}`)

describe('/estadisticas page (STAT-01)', () => {
  const page = read('src/app/estadisticas/page.tsx')
  it('renders inside AuroraShell with the Aurora mobile nav, no classic chrome', () => {
    assert.match(page, /<AuroraShell/)
    assert.match(page, /AuroraMobileNav/)
    assert.doesNotMatch(page, /AppShell/)
    assert.doesNotMatch(page, /MobileBottomNav|HomeButtom/)
  })
  it('keeps the view_statistics gate and the statistics readiness', () => {
    assert.match(page, /requirePermission\('view_statistics'\)/)
    assert.match(page, /readTenantUiReadiness/)
  })
  it('loading skeleton uses AuroraShell too', () => {
    assert.match(read('src/app/estadisticas/loading.tsx'), /AuroraShell/)
  })
  it('sidebar Estadísticas has no "Pronto" badge', () => {
    assert.doesNotMatch(read('src/components/aurora/aurora-nav.ts'), /pronto/i)
    assert.doesNotMatch(read('src/components/aurora/AuroraSidebar.tsx'), /pronto/i)
  })
})

describe('aurora-summary API', () => {
  const route = read('src/app/api/estadisticas/aurora-summary/route.ts')
  it('is read-only, permission-gated and tenant-scoped', () => {
    assert.match(route, /authenticateAPIWithPermission\(request, 'view_statistics'\)/)
    assert.match(route, /readTenantUiReadiness\(tenantId\)/)
    assert.match(route, /getTenantPrisma\(tenantId\)/)
    assert.doesNotMatch(route, /prisma\.\w+\.(create|update|upsert|delete|deleteMany|updateMany|createMany)\(/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  })
  it('every query carries tenantId', () => {
    const blocks = route.match(/\.(findMany|groupBy|count)\(\{[\s\S]*?\n\s{6,8}\}\)/g) ?? []
    assert.ok(blocks.length >= 5, `expected ≥5 query blocks, got ${blocks.length}`)
    for (const block of blocks) assert.match(block, /tenantId/, block.slice(0, 80))
  })
  it('does not fabricate chat→pedido', () => {
    assert.match(route, /chatOrderLink: \{ available: false/)
  })
})

describe('Estadísticas components copy', () => {
  it('no brands, Pro $29, Telegram, Soft or invented percentages', () => {
    for (const f of componentFiles()) {
      const src = read(f)
      assert.doesNotMatch(src, /Ventas por marca|Marca:|Pro \$29|Telegram|Soft/, f)
      assert.doesNotMatch(src, /La IA creó/, f)
    }
  })
  it('funnel shows "Sin datos" for purchase intent (no source)', () => {
    const funnel = read(`${DIR}/FunnelCard.tsx`)
    assert.match(funnel, /Con intención de compra/)
    assert.match(funnel, /Sin datos/)
  })
  it('status breakdown replaces "Ventas por marca"', () => {
    assert.match(read(`${DIR}/AuroraStatsDashboard.tsx`), /Pedidos por estado/)
    assert.match(read(`${DIR}/AuroraStatsDashboard.tsx`), /status-breakdown/)
  })
  it('each card has loading / error + Reintentar', () => {
    assert.match(read(`${DIR}/StatsCard.tsx`), /onRetry/)
    assert.match(read(`${DIR}/KpiCard.tsx`), /Reintentar/)
  })
  it('period control scrolls on mobile and mirrors ?periodo=', () => {
    assert.match(read(`${DIR}/StatsHeader.tsx`), /overflow-x-auto/)
    assert.match(read(`${DIR}/AuroraStatsDashboard.tsx`), /'periodo'/)
  })
  it('lines table degrades to card rows below md', () => {
    const lines = read(`${DIR}/LinePerformance.tsx`)
    assert.match(lines, /hidden w-full[^"]*md:table/)
    assert.match(lines, /md:hidden/)
  })
})

describe('CoS fixes (PR-H verification)', () => {
  it('F1: Billing plan list has no Telegram', () => {
    assert.doesNotMatch(read('src/app/config/components/BillingDashboard.tsx'), /Telegram/)
  })
  it('F3a: AuroraShell subtracts the global banner height so the bottom nav stays visible', () => {
    assert.match(read('src/components/aurora/AuroraShell.tsx'), /100dvh-var\(--app-top-offset,0px\)/)
    assert.match(read('src/app/components/AppTopBanners.tsx'), /--app-top-offset/)
    assert.match(read('src/app/layout.tsx'), /AppTopBanners/)
  })
  it('F3b: Config panel leaves room for the settings FAB', () => {
    assert.match(read('src/components/aurora/config/ConfigShell.tsx'), /pb-48/)
  })
  it('F3c: one shared cream canvas token', () => {
    assert.match(read('src/app/components/globals.css'), /--aurora-canvas: #F6F5F2/)
    for (const f of ['src/components/aurora/AuroraShell.tsx', 'src/components/aurora/config/ConfigShell.tsx']) {
      assert.match(read(f), /var\(--aurora-canvas\)/, f)
      assert.doesNotMatch(read(f), /#F7F8FA|#F6F5F2/, f)
    }
  })
})
