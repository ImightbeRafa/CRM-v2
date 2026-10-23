// Official BetsyMark (docs/design/betsy-mascot-handoff): the designer's test, run with the CSS-module shim.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BetsyMark, BETSY_STATES } from '../../components/brand/BetsyMark'

test('renders accessible img with gradient', () => {
  const html = renderToStaticMarkup(<BetsyMark size={40} />)
  assert.match(html, /role="img"/)
  assert.match(html, /aria-label="Betsy"/)
  assert.match(html, /linearGradient/)
  assert.equal((html.match(/<path d="M[\d.]+ [\d.]+H/g) ?? []).length >= 2, true)
})
test('16px renders merged bar and no light', () => {
  const html = renderToStaticMarkup(<BetsyMark size={16} />)
  assert.match(html, /<rect[^>]*width="38"/)
  assert.doesNotMatch(html, /bmw/)
})
test('decorative hides from AT', () => {
  const html = renderToStaticMarkup(<BetsyMark decorative />)
  assert.match(html, /aria-hidden="true"/)
  assert.doesNotMatch(html, /role="img"/)
})
test('unique ids per instance', () => {
  const html = renderToStaticMarkup(
    <>
      <BetsyMark />
      <BetsyMark />
    </>,
  )
  const ids = [...html.matchAll(/id="(bmg[^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, 2)
})
test('states render', () => {
  for (const st of BETSY_STATES) assert.ok(renderToStaticMarkup(<BetsyMark state={st} size={64} />).includes(`data-state="${st}"`))
  assert.match(renderToStaticMarkup(<BetsyMark state="typing" />), /class="dot"/)
  assert.match(renderToStaticMarkup(<BetsyMark tone="mono-ink" />), /#0B0B12/)
})
test('still pose: animated={false} and paused never animate', () => {
  assert.doesNotMatch(renderToStaticMarkup(<BetsyMark animated={false} />), /data-on/)
  assert.doesNotMatch(renderToStaticMarkup(<BetsyMark state="paused" />), /data-on/)
  assert.match(renderToStaticMarkup(<BetsyMark />), /data-on=""/)
})
