import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { OAUTH_POPUP_LOADING_TEXT, openPendingOauthWindow, type OpenWindow } from '../oauth-popup'

function fakePopup() {
  return {
    closed: false,
    document: { title: '', body: { style: { cssText: '' }, textContent: '' } },
  }
}

test('pending OAuth window opens once, blank, and shows a loading note', () => {
  const opens: string[] = []
  const popup = fakePopup()
  const openWindow: OpenWindow = (url, name) => {
    opens.push(`${name}:${url}`)
    return popup as unknown as Window
  }
  assert.equal(openPendingOauthWindow('instagram_oauth', openWindow), popup as unknown as Window)
  assert.deepEqual(opens, ['instagram_oauth:about:blank'])
  assert.equal(popup.document.title, OAUTH_POPUP_LOADING_TEXT)
  assert.equal(popup.document.body.textContent, OAUTH_POPUP_LOADING_TEXT)
})

test('blocked popup returns null; a cross-origin reused window does not throw', () => {
  assert.equal(openPendingOauthWindow('x', () => null), null)
  const crossOrigin = {
    get document(): Document {
      throw new Error('SecurityError')
    },
  }
  assert.equal(openPendingOauthWindow('x', () => crossOrigin as unknown as Window), crossOrigin as unknown as Window)
})

test('Instagram connect opens its window before awaiting the server, then navigates it', () => {
  const page = readFileSync('src/app/config/social/page.tsx', 'utf8')
  const start = page.indexOf('async function handleLinkInstagram()')
  const body = page.slice(start, page.indexOf('async function handleLinkWhatsApp', start))
  const openAt = body.indexOf("openPendingOauthWindow('instagram_oauth')")
  const fetchAt = body.indexOf("fetch('/api/auth/instagram/auth-url')")
  assert.ok(openAt > 0 && fetchAt > openAt, 'window must open before the first await')
  assert.doesNotMatch(body.slice(0, openAt), /\bawait\s+\w/)
  assert.match(body, /popup\.location\.replace\(authUrl\)/)
  assert.doesNotMatch(body, /window\.open\(authUrl/)
  // Error path never leaves the loading window behind.
  assert.match(body, /catch \(error\) \{\s*if \(!popup\.closed\) popup\.close\(\)/)
})
