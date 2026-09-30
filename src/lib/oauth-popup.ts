/**
 * One OAuth popup per click. Browsers allow a single popup per user click (unless the site is
 * allow-listed), and Safari also blocks window.open after an await. So a flow that needs a URL
 * from the server opens its ONE window on the click, shows a loading note, and navigates it
 * once the URL is ready. Never open a second window on the same click.
 */
export const OAUTH_POPUP_FEATURES = 'width=640,height=760' as const
export const OAUTH_POPUP_LOADING_TEXT = 'Abriendo Meta…' as const

export type OpenWindow = (url: string, name: string, features: string) => Window | null

export function openPendingOauthWindow(
  name: string,
  openWindow: OpenWindow = (url, n, features) => window.open(url, n, features),
): Window | null {
  const popup = openWindow('about:blank', name, OAUTH_POPUP_FEATURES)
  if (!popup) return null
  try {
    popup.document.title = OAUTH_POPUP_LOADING_TEXT
    popup.document.body.style.cssText =
      'margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:15px system-ui,sans-serif;color:#475569'
    popup.document.body.textContent = OAUTH_POPUP_LOADING_TEXT
  } catch {
    // Reused named window already on another origin: it is navigated right after anyway.
  }
  return popup
}
