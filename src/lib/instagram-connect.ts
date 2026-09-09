import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

export type FacebookPageCandidate = {
  id: string
  name: string
  accessToken: string
}

export type InstagramPageMatch = {
  pageId: string
  pageName: string
  pageAccessToken: string
  igBusinessAccountId: string
  igUsername?: string | null
}

export type FacebookUserSummary = {
  id: string | null
  name: string | null
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function readJson(response: Response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

export async function fetchFacebookUserSummary(userAccessToken: string): Promise<FacebookUserSummary> {
  const url = addAppSecretProofToUrl(
    `${buildMetaGraphUrl('me')}?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
    userAccessToken,
  )
  try {
    const res = await fetch(url)
    const data = await readJson(res)
    if (!res.ok) return { id: null, name: null }
    return {
      id: data?.id ? String(data.id) : null,
      name: data?.name ? String(data.name) : null,
    }
  } catch {
    return { id: null, name: null }
  }
}

export async function listFacebookPages(userAccessToken: string): Promise<{
  pages: FacebookPageCandidate[]
  source: 'me/accounts' | 'business_owned_pages' | 'business_client_pages' | 'none'
}> {
  const accountsUrl = addAppSecretProofToUrl(
    `${buildMetaGraphUrl('me/accounts')}?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`,
    userAccessToken,
  )
  const accountsRes = await fetch(accountsUrl)
  const accountsData = await readJson(accountsRes)
  const fromAccounts: FacebookPageCandidate[] = Array.isArray(accountsData?.data)
    ? accountsData.data
        .filter((page: { id?: string; access_token?: string }) => page?.id && page?.access_token)
        .map((page: { id: string; name?: string; access_token: string }) => ({
          id: String(page.id),
          name: String(page.name || page.id),
          accessToken: String(page.access_token),
        }))
    : []

  if (fromAccounts.length > 0) {
    return { pages: fromAccounts, source: 'me/accounts' }
  }

  // Login for Business / BM tokens often return empty me/accounts; walk businesses.
  const businessesUrl = addAppSecretProofToUrl(
    `${buildMetaGraphUrl('me/businesses')}?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
    userAccessToken,
  )
  try {
    const businessesRes = await fetch(businessesUrl)
    const businessesData = await readJson(businessesRes)
    const businesses: Array<{ id: string; name?: string }> = Array.isArray(businessesData?.data)
      ? businessesData.data
      : []

    for (const edge of ['owned_pages', 'client_pages'] as const) {
      const collected: FacebookPageCandidate[] = []
      for (const business of businesses) {
        const pagesUrl = addAppSecretProofToUrl(
          `${buildMetaGraphUrl(`${business.id}/${edge}`)}?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`,
          userAccessToken,
        )
        const pagesRes = await fetch(pagesUrl)
        const pagesData = await readJson(pagesRes)
        if (!pagesRes.ok || !Array.isArray(pagesData?.data)) continue
        for (const page of pagesData.data) {
          if (!page?.id || !page?.access_token) continue
          collected.push({
            id: String(page.id),
            name: String(page.name || page.id),
            accessToken: String(page.access_token),
          })
        }
      }
      if (collected.length > 0) {
        return {
          pages: collected,
          source: edge === 'owned_pages' ? 'business_owned_pages' : 'business_client_pages',
        }
      }
    }
  } catch {
    // Fall through to empty
  }

  return { pages: [], source: 'none' }
}

export async function findInstagramBusinessOnPages(
  pages: FacebookPageCandidate[],
): Promise<{ matches: InstagramPageMatch[]; pagesWithoutIg: string[] }> {
  const matches: InstagramPageMatch[] = []
  const pagesWithoutIg: string[] = []

  for (const page of pages) {
    const igAccountUrl = addAppSecretProofToUrl(
      `${buildMetaGraphUrl(page.id)}?fields=instagram_business_account{id,username},connected_instagram_account{id,username},name&access_token=${encodeURIComponent(page.accessToken)}`,
      page.accessToken,
    )
    try {
      const igAccountRes = await fetch(igAccountUrl)
      const igAccountData = await readJson(igAccountRes)
      if (!igAccountRes.ok) {
        pagesWithoutIg.push(`${page.name} (API: ${igAccountData?.error?.message || 'error'})`)
        continue
      }
      const igId =
        igAccountData?.instagram_business_account?.id ||
        igAccountData?.connected_instagram_account?.id ||
        null
      const igUsername =
        igAccountData?.instagram_business_account?.username ||
        igAccountData?.connected_instagram_account?.username ||
        null
      if (igId) {
        matches.push({
          pageId: page.id,
          pageName: String(igAccountData?.name || page.name),
          pageAccessToken: page.accessToken,
          igBusinessAccountId: String(igId),
          igUsername: igUsername ? String(igUsername) : null,
        })
      } else {
        pagesWithoutIg.push(String(igAccountData?.name || page.name))
      }
    } catch {
      pagesWithoutIg.push(`${page.name} (exception)`)
    }
  }

  return { matches, pagesWithoutIg }
}

export function buildNoPagesHtml(params: {
  facebookUserName?: string | null
  facebookUserId?: string | null
  pageCount: number
  pageSource: string
}): string {
  const userLabel = params.facebookUserName
    ? escHtml(params.facebookUserName)
    : 'la cuenta de Facebook que usaste'
  const userIdNote = params.facebookUserId
    ? `<p class="meta">Usuario de Facebook: <code>${escHtml(params.facebookUserId)}</code></p>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>No se encontraron páginas</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.5; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    .box { background: #fff7ed; border: 1px solid #fdba74; border-radius: 10px; padding: 16px; margin: 16px 0; }
    ol { padding-left: 1.2rem; }
    li { margin: 0.45rem 0; }
    code { background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.9em; }
    a { color: #1d4ed8; }
    .meta { color: #6b7280; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>No se encontraron páginas de Facebook</h1>
  <p>Iniciaste sesión como <strong>${userLabel}</strong>, pero Meta no devolvió ninguna Página administrable para vincular Instagram Business.</p>
  ${userIdNote}
  <p class="meta">Páginas detectadas: <strong>${params.pageCount}</strong> (fuente: <code>${escHtml(params.pageSource)}</code>). No se registraron tokens.</p>
  <div class="box">
    <strong>Cómo solucionarlo</strong>
    <ol>
      <li>Confirma que entraste con el usuario de Facebook que es <strong>administrador</strong> de la Página (no solo editor de Instagram).</li>
      <li>En Facebook, abre tu <strong>Página</strong> → Configuración → Roles de la Página y verifica el rol Admin.</li>
      <li>En Instagram, convierte la cuenta a <strong>Profesional → Empresa</strong> (no Creador) y vincúlala a esa Página.</li>
      <li>Si la app de Meta está en <strong>modo Development</strong>, el usuario debe ser <strong>Administrador, Desarrollador o Tester</strong> de la app en Meta for Developers.</li>
      <li>Cierra sesión de Facebook en el navegador, vuelve a <a href="/config/social">/config/social</a> y conecta de nuevo eligiendo la Página + Instagram en el selector de Meta.</li>
    </ol>
  </div>
  <p><a href="/config/social">← Volver a configuración social</a></p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'ig_oauth_complete', success: false, reason: 'no_pages' }, window.location.origin);
      }
    } catch (e) {}
  </script>
</body>
</html>`
}

export function buildNoInstagramHtml(params: {
  pageCount: number
  pagesWithoutIg: string[]
}): string {
  const list =
    params.pagesWithoutIg.length > 0
      ? `<p><strong>Páginas sin Instagram Business:</strong></p><ul>${params.pagesWithoutIg
          .map((name) => `<li>${escHtml(name)}</li>`)
          .join('')}</ul>`
      : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Instagram Business no encontrado</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.5; }
    .box { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 10px; padding: 16px; margin: 16px 0; }
    ol { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>No se encontró Instagram Business</h1>
  <p>Revisamos <strong>${params.pageCount}</strong> página(s) de Facebook, pero ninguna tiene una cuenta de Instagram <strong>Empresa</strong> vinculada.</p>
  ${list}
  <div class="box">
    <strong>Pasos</strong>
    <ol>
      <li>Abre Instagram → Configuración → Cuenta → Cambiar a cuenta profesional.</li>
      <li>Elige <strong>Empresa</strong> (no Creador).</li>
      <li>Vincula la Página de Facebook correcta.</li>
      <li>Vuelve a <a href="/config/social">/config/social</a> y conecta de nuevo.</li>
    </ol>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'ig_oauth_complete', success: false, reason: 'no_instagram' }, window.location.origin);
      }
    } catch (e) {}
  </script>
</body>
</html>`
}

export function buildInstagramPickerHtml(matches: InstagramPageMatch[], completePath = '/api/auth/instagram/complete'): string {
  const options = matches
    .map((match, index) => {
      const label = match.igUsername
        ? `@${match.igUsername} · ${match.pageName}`
        : `${match.pageName} · IG ${match.igBusinessAccountId}`
      return `<label style="display:block;padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin:8px 0;cursor:pointer;">
        <input type="radio" name="selection" value="${index}" ${index === 0 ? 'checked' : ''} />
        <span style="margin-left:8px;">${escHtml(label)}</span>
      </label>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Elegir Instagram</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
    button { background:#111827;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:600;cursor:pointer;width:100%;margin-top:12px; }
  </style>
</head>
<body>
  <h1>Elige la cuenta de Instagram</h1>
  <p>Encontramos varias Páginas con Instagram Business. Selecciona cuál conectar a Betsy.</p>
  <form method="POST" action="${escHtml(completePath)}">
    ${options}
    <button type="submit">Conectar cuenta seleccionada</button>
  </form>
</body>
</html>`
}

export function buildInstagramSuccessHtml(params: {
  pageName?: string | null
  igUsername?: string | null
}): string {
  const detail = params.igUsername
    ? `@${escHtml(params.igUsername)}`
    : params.pageName
      ? escHtml(params.pageName)
      : 'tu cuenta'

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Instagram conectado</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 48px auto; padding: 0 20px; text-align: center; }
  </style>
</head>
<body>
  <h1>Instagram conectado</h1>
  <p>${detail} quedó vinculada a Betsy.</p>
  <p>Puedes cerrar esta ventana. La lista de cuentas en /config/social se actualizará sola.</p>
  <p><a href="/config/social">Ir a configuración social</a> · <a href="/chats">Ir a chats</a></p>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'ig_oauth_complete', success: true }, window.location.origin);
      }
      setTimeout(function () { window.close(); }, 1200);
    } catch (e) {}
  </script>
</body>
</html>`
}

export function logInstagramPageDiscovery(params: {
  pageCount: number
  pageSource: string
  matchCount: number
  facebookUserId?: string | null
}): void {
  console.log('[instagram/callback] page discovery', {
    pageCount: params.pageCount,
    pageSource: params.pageSource,
    matchCount: params.matchCount,
    facebookUserId: params.facebookUserId || null,
    // Intentionally omit tokens and page access tokens
  })
}
