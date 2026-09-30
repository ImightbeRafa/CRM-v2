import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { classifyConnectOutcome } from '../connect-outcome'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(process.cwd(), rel)).isDirectory()) out.push(...walk(rel))
    else if (/\.(tsx?|mdx)$/.test(name)) out.push(rel)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ── Canales modals ────────────────────────────────────────────────────────────
test('ConnectLineModal has the coexistence copy and launches the existing flow on click', () => {
  const modal = read('src/components/aurora/channels/ConnectLineModal.tsx')
  assert.match(
    modal,
    /Seguí usando WhatsApp Business en tu teléfono\. Betsy recibe los mismos chats en la bandeja, así tu\s+equipo y la IA responden desde acá sin perder la app\./,
  )
  assert.match(modal, /Cada número queda como una línea propia con su agente\./)
  assert.match(modal, /Continuar con Meta/)
  assert.match(modal, /onClick=\{launch\}/)
  // launch must call onLaunch synchronously (keeps the popup user gesture): no await before it
  const launch = modal.slice(modal.indexOf('const launch = () => {'), modal.indexOf('const showResult'))
  assert.match(launch, /onLaunch\(\)/)
  assert.doesNotMatch(launch, /await|setTimeout|\.then\(/)
})

test('social page only CALLS the existing flows from the modals and keeps its protected code', () => {
  const page = read('src/app/config/social/page.tsx')
  assert.match(page, /onLaunch=\{launchWhatsAppEmbeddedSignup\}/)
  assert.match(page, /<ReconnectChannelModal/)
  assert.match(page, /handleUnlinkAccount\(target\.id, target\.platform, true\)/)
  assert.match(page, /\/api\/auth\/whatsapp\/exchange/)
  assert.match(page, /prepareWhatsAppDirectOauthFallback/)
  assert.match(page, /openWhatsAppDirectOauthFromClick/)
  assert.match(page, /\/api\/auth\/instagram\/auth-url/)
  assert.match(page, />Cuentas conectadas<\/h1>/)
  assert.doesNotMatch(page, /confirmAddAnother/)
})

test('connect outcome classification', () => {
  assert.equal(classifyConnectOutcome('WhatsApp conectado y suscrito a webhooks.'), 'success')
  assert.equal(classifyConnectOutcome('Instagram conectado. Actualizando cuentas…'), 'success')
  assert.equal(classifyConnectOutcome('Re-suscripción realizada. La cuenta quedó activa para /chats.'), 'success')
  assert.equal(classifyConnectOutcome('Conexión de WhatsApp cancelada en Meta.'), 'cancelled')
  assert.equal(classifyConnectOutcome('Token recibido. Completa el registro en la ventana de Meta para guardar el número.'), 'waiting')
  assert.equal(classifyConnectOutcome('No se pudo re-suscribir'), 'error')
  assert.equal(classifyConnectOutcome('El navegador bloqueó la ventana emergente. Permite popups e intenta de nuevo.'), 'error')
  assert.equal(classifyConnectOutcome(''), 'error')
})

// ── Equipo ────────────────────────────────────────────────────────────────────
test('InviteMemberModal uses POST/PUT /api/users: emailed invite by default, password path kept', () => {
  const modal = read('src/components/aurora/config/InviteMemberModal.tsx')
  assert.match(modal, /fetch\('\/api\/users'/)
  assert.match(modal, /'POST'/)
  assert.match(modal, /'PUT'/)
  assert.match(modal, /password/)
  assert.match(modal, /status === 402/)
  for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'SALES', 'PRODUCTION', 'VIEWER']) assert.match(modal, new RegExp(`'${role}'`))
  // Live TenantInvite flow (#77): `invite: true` on POST, no OWNER via emailed invite.
  assert.match(modal, /invite: true/)
  assert.match(modal, /emailSent/)
  assert.match(modal, /r\.value !== 'OWNER'/)
  assert.doesNotMatch(modal, /invite-token|inviteToken/i)
  const panel = read('src/components/aurora/config/panels/UsersPanel.tsx')
  assert.match(panel, /Invitar persona/)
  assert.match(panel, /user\.image/)
  assert.match(panel, /referrerPolicy="no-referrer"/)
})

test('ConfigPageClient uses the Aurora modal / confirm (no classic user modal, no native confirm for members)', () => {
  const cfg = read('src/app/config/ConfigPageClient.tsx')
  assert.match(cfg, /<InviteMemberModal/)
  assert.match(cfg, /auroraConfirm\(\{[\s\S]*?¿Quitar a esta persona\?/)
  assert.doesNotMatch(cfg, /handleUserSubmit/)
  assert.doesNotMatch(cfg, /confirm\('⚠️ ¿Eliminar este usuario/)
  assert.doesNotMatch(read('src/components/aurora/config/panels/IntegrationsPanel.tsx'), /[^.]confirm\('¿Estás seguro/)
})

// ── Shell ─────────────────────────────────────────────────────────────────────
test('tenant block is display-only: name, no switcher, no plan tier, no invented copy', () => {
  const side = read('src/components/aurora/AuroraSidebar.tsx')
  assert.doesNotMatch(side, /ChevronsUpDown|ChevronDown|useTenantPlan|\/api\/billing\/current/)
  assert.doesNotMatch(side, /Plan Pro|marcas|Cambiar (de )?negocio/i)
  assert.match(side, /\{tenantName\}/)
  const mobile = read('src/components/aurora/AuroraMobileNav.tsx')
  assert.doesNotMatch(mobile, /useTenantPlan|Plan \$\{|cambiar negocio/i)
  assert.equal(existsSync(join(process.cwd(), 'src/components/aurora/shell/useTenantPlan.ts')), false)
})

test('Más sheet keeps Estadísticas, Agentes, Configuración and Ayuda (filters AURORA_NAV)', () => {
  const mobile = read('src/components/aurora/AuroraMobileNav.tsx')
  assert.match(mobile, /AURORA_NAV\.map/)
  const nav = read('src/components/aurora/aurora-nav.ts')
  for (const label of ['Estadísticas', 'Agentes', 'Configuración', 'Ayuda']) assert.match(nav, new RegExp(`label: '${label}'`))
  assert.match(mobile, /Cerrar sesión/)
  assert.match(mobile, /Avisos/)
})

test('one shared header: bell only, no fake search input anywhere', () => {
  const top = read('src/components/aurora/shell/AuroraTopActions.tsx')
  assert.match(top, /AuroraBell/)
  assert.doesNotMatch(stripComments(top), /<input|Buscar|⌘K/)
  for (const f of [
    'src/app/ventas/components/VentasComponent.tsx',
    'src/app/help/layout.tsx',
  ]) assert.match(read(f), /AuroraPageHeader/)
  for (const f of [
    'src/app/dashboard/components/AuroraHome.tsx',
    'src/components/aurora/estadisticas/StatsHeader.tsx',
    'src/components/aurora/config/ConfigTopbar.tsx',
    'src/components/chats/SoftCopilotInboxV2.tsx',
  ]) assert.match(read(f), /AuroraTopActions/, f)
})

test('profile menu: name, email, real role, Ayuda, signOut', () => {
  const menu = read('src/components/aurora/shell/AuroraProfileMenu.tsx')
  assert.match(menu, /viewer\.email/)
  assert.match(menu, /viewer\.roleLabel/)
  assert.match(menu, /href="\/help"/)
  assert.match(menu, /signOut\(\{ callbackUrl: '\/auth\/signin' \}\)/)
})

// ── Auth / help / onboarding ──────────────────────────────────────────────────
test('signin keeps register / Tilopay / tracking logic and validates the return path', () => {
  const src = read('src/app/auth/signin/page.tsx')
  for (const needle of [
    "trackMetaEvent('CompleteRegistration'",
    '/api/auth/register',
    'tp.cr/l/',
    '/api/billing/change-plan',
    "signIn('google'",
    "signIn('credentials'",
    'safeReturnPath(',
  ]) assert.ok(src.includes(needle), needle)
  assert.match(src, /AuthShell/)
})

test('middleware keeps the query in callbackUrl (single-line change)', () => {
  assert.match(read('src/middleware.ts'), /url\.pathname \+ url\.search/)
})

test('every auth / error screen renders in the Aurora AuthShell', () => {
  for (const f of [
    'src/app/auth/signin/page.tsx',
    'src/app/auth/forgot-password/page.tsx',
    'src/app/auth/reset-password/page.tsx',
    'src/app/auth/verify-email/page.tsx',
    'src/app/auth/verify-phone/page.tsx',
    'src/app/auth/error/page.tsx',
    'src/app/unauthorized/page.tsx',
    'src/app/not-found.tsx',
    'src/app/error.tsx',
    'src/app/setup-tenant/page.tsx',
  ]) assert.match(read(f), /AuthShell/, f)
  assert.match(read('src/app/setup-wizard/components/SetupWizard.tsx'), /AuroraStepper/)
})

test('/help lives inside AuroraShell, without the "← Dashboard" link; staff doc hidden; /docs untouched', () => {
  const layout = read('src/app/help/layout.tsx')
  assert.match(layout, /AuroraShell/)
  assert.doesNotMatch(layout, /&larr; Dashboard|← Dashboard/)
  assert.match(read('src/lib/help-docs.ts'), /HELP_HIDDEN_SLUGS[\s\S]*'ai-assistant'/)
  assert.match(read('src/app/help/[slug]/page.tsx'), /isHelpHidden\(slug\)/)
})

// ── Copy sweep ────────────────────────────────────────────────────────────────
test('owner-facing copy: no "Telegram" and no user-visible "Soft" in the surfaces touched by PR-J', () => {
  const files = [
    ...walk('src/components/aurora'),
    'src/app/ventas/components/VentasComponent.tsx',
    'src/app/ventas/components/PedidosBoard.tsx',
    'src/app/dashboard/components/AuroraHome.tsx',
    'src/app/config/social/page.tsx',
    'src/app/config/ConfigPageClient.tsx',
    'src/components/chats/SoftThreadPane.tsx',
    'src/components/chats/SoftCopilotInboxV2.tsx',
    'src/app/help/page.tsx',
    'src/app/help/layout.tsx',
    'src/app/unauthorized/page.tsx',
    'src/app/not-found.tsx',
    'src/app/error.tsx',
    ...walk('src/app/auth'),
    ...walk('src/app/setup-wizard'),
    ...['billing', 'social-accounts', 'faq'].map((s) => `src/content/docs/${s}.mdx`),
  ].filter((f) => !/\.test\./.test(f) && !f.includes('/api/'))
  for (const file of files) {
    const src = stripComments(read(file))
    assert.doesNotMatch(src, /Telegram/, `${file}: Telegram`)
    assert.doesNotMatch(src, /\bSoft\b/, `${file}: Soft`)
  }
})

test('Chats: the locked Rail gets the human order number, never the internal id', () => {
  const v2 = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(v2, /`#\$\{selectedConversation\.orderNumber\}`/)
  assert.equal((v2.match(/conversation=\{railConversation\}/g) ?? []).length, 2)
  assert.doesNotMatch(v2, /<SoftCopilotRail[\s\S]{0,80}conversation=\{selectedConversation\}/)
})
