import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { avatarInitials, safeAvatarUrl } from '../aurora-avatar'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

test('safeAvatarUrl only accepts http(s) URLs', () => {
  assert.equal(safeAvatarUrl('https://lh3.googleusercontent.com/a/abc=s96-c'), 'https://lh3.googleusercontent.com/a/abc=s96-c')
  assert.equal(safeAvatarUrl('  http://example.com/p.png '), 'http://example.com/p.png')
  for (const bad of ['', '   ', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'blob:https://x/1', '/relative.png', 'not a url', null, undefined, 42]) {
    assert.equal(safeAvatarUrl(bad), null, String(bad))
  }
})

test('avatarInitials: first two words, fallback dot', () => {
  assert.equal(avatarInitials('rafael serrano perez'), 'RS')
  assert.equal(avatarInitials('Betsy'), 'B')
  assert.equal(avatarInitials('   '), '·')
})

test('AuroraAvatar: plain <img>, no-referrer, onError falls back to initials, no next/image', () => {
  const src = read('src/components/aurora/shell/AuroraAvatar.tsx')
  assert.match(src, /<img\b/)
  assert.match(src, /referrerPolicy="no-referrer"/)
  assert.match(src, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(src, /setFailed\(false\)/) // reset when `image` changes
  assert.match(src, /img\.complete && img\.naturalWidth === 0/) // failed before hydration
  assert.match(src, /avatarInitials\(name\)/)
  assert.doesNotMatch(src, /next\/image/)
})

test('useAuroraViewer exposes a validated image', () => {
  const src = read('src/components/aurora/shell/useAuroraViewer.ts')
  assert.match(src, /image: string \| null/)
  assert.match(src, /safeAvatarUrl\(user\?\.image\)/)
})

test('sidebar footer, profile menu and mobile profile use AuroraAvatar; tenant block does not', () => {
  const side = read('src/components/aurora/AuroraSidebar.tsx')
  assert.match(side, /<AuroraAvatar name=\{userName\} image=\{image\}/)
  assert.match(read('src/components/aurora/shell/AuroraProfileMenu.tsx'), /<AuroraAvatar name=\{viewer\.name\} image=\{viewer\.image\}/)
  assert.match(read('src/components/aurora/AuroraMobileNav.tsx'), /<AuroraAvatar name=\{viewer\.name\} image=\{viewer\.image\}/)
  assert.doesNotMatch(side, /<AuroraAvatar name=\{tenantName\}/)
  assert.match(side, /avatarInitials\(tenantName\)/)
})

test('sidebar polish: reduced-motion aware, focus rings, display-only tenant block', () => {
  const side = read('src/components/aurora/AuroraSidebar.tsx')
  assert.match(side, /motion-safe:/)
  assert.match(side, /motion-reduce:/)
  assert.match(side, /focus-visible:ring-2/)
  assert.match(side, /aria-current=\{active \? 'page' : undefined\}/)
  assert.doesNotMatch(side, /cursor-pointer|<button|role=|tabIndex/)
})
