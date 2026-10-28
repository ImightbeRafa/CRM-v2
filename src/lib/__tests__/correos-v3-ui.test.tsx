// Correos v3 guía-dialog pieces render (SSR) and the dialog keeps the SOAP flow intact.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  EMPTY_V3_ORDER,
  PackageBox,
  PickupPanel,
  V3OrderExtras,
  crc,
  statusTone,
} from '../../app/produccion/components/correos/CorreosV3Parts'

const noop = () => {}

describe('Correos v3 UI parts', () => {
  it('package box has labelled weight + size inputs', () => {
    const html = renderToStaticMarkup(<PackageBox value={{ pesoG: 800, alto: 10, largo: 20, ancho: 15 }} onChange={noop} />)
    for (const l of ['Peso', 'Largo', 'Ancho', 'Alto']) assert.match(html, new RegExp(`aria-label="${l}"`))
    assert.match(html, /value="800"/)
  })

  it('home delivery shows barrio + cost row, branch delivery shows the branch picker', () => {
    const home = renderToStaticMarkup(
      <V3OrderExtras province="San José" canton="San José" district="Carmen" deliveryType="Domicilio" pkg={{ pesoG: 500, alto: 0, largo: 0, ancho: 0 }} value={EMPTY_V3_ORDER} onChange={noop} />,
    )
    assert.match(home, /Barrio \(opcional\)/)
    assert.match(home, /Costo Correos/)
    assert.doesNotMatch(home, /Sucursal donde retira/)
    const branch = renderToStaticMarkup(
      <V3OrderExtras province="San José" canton="San José" district="Carmen" deliveryType="Sucursal" pkg={{ pesoG: 500, alto: 0, largo: 0, ancho: 0 }} value={EMPTY_V3_ORDER} onChange={noop} />,
    )
    assert.match(branch, /Sucursal donde retira el cliente/)
    assert.doesNotMatch(branch, /Barrio \(opcional\)/)
  })

  it('pickup panel names the guía count and has a confirm button', () => {
    const html = renderToStaticMarkup(<PickupPanel guias={['PY1CR', 'PY2CR']} onDone={noop} onCancel={noop} />)
    assert.match(html, /2 guía\(s\)/)
    assert.match(html, /Confirmar recolección/)
  })

  it('formats colones and status tones', () => {
    assert.equal(crc(2838), `₡${(2838).toLocaleString('es-CR')}`)
    assert.equal(crc(null), '—')
    assert.match(statusTone('delivered'), /emerald/)
    assert.match(statusTone('nope'), /muted/)
  })

  it('the guía dialog only switches to v3 for stores that chose it', () => {
    const src = readFileSync('src/app/produccion/components/GuiaGenerator.tsx', 'utf8')
    assert.match(src, /statusData\.v3\?\.enabled && correosConfig\?\.settings\?\.correos_api === 'v3'/)
    // SOAP flow untouched: same endpoint, same verification gate.
    assert.match(src, /fetch\('\/api\/shipping\/generate-guia'/)
    assert.match(src, /const v3Ready = \(orderId: string\) => !useV3 \|\| /)
  })
})
