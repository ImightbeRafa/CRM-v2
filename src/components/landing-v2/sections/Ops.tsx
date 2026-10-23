import s from '../landing.module.css'
import { OPS } from '../content'
import { Reveal } from '../islands/Reveal'

/** Ops showcase: bento of real Betsy screens in miniature. Example data, labeled as such. */

const i = (n: number) => ({ ['--i' as string]: n })

function Example() {
  return (
    <span style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 10.5, color: 'var(--muted)' }} aria-hidden>
      Datos de ejemplo
    </span>
  )
}

export function Ops() {
  return (
    <section id="operacion" className={`${s.section} ${s.paper} ${s.light}`} aria-labelledby="lv2-ops-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>{OPS.label}</p>
          <h2 id="lv2-ops-title" className={`landing-h2 ${s.display}`}>
            {OPS.title}
            <em>{OPS.titleEm}</em>
          </h2>
          <p className={s.lead}>{OPS.lead}</p>
        </div>

        <div className={s.bento}>
          <article className={`${s.tile} ${s.span3}`}>
            <div>
              <h3 className={s.cardTitle}>{OPS.inbox.title}</h3>
              <p className={s.small}>{OPS.inbox.text}</p>
            </div>
            <Reveal className={s.tileVisual}>
              <div className={s.inboxMini} aria-hidden>
                {[
                  ['DR', 'Daniela R.', '¿Tienen los parches para dormir?', 'ig', s.chipIa, '✦ IA'],
                  ['CM', 'Carlos M.', 'Ya hice el SINPE 🙌', 'wa', s.chipPago, '💳 Revisar pago'],
                  ['AV', 'Andrea V.', 'Quiero hablar con alguien', 'wa', s.chipPersona, '👤 Persona'],
                  ['JS', 'José S.', 'Gracias, me llegó perfecto', 'ig', s.chipPedido, '📦 Pedido'],
                ].map(([ini, name, text, ch, chip, label], n) => (
                  <div key={name} className={`${s.inboxRow} ${s.anim}`} style={i(n)}>
                    <span className={s.avatar}>
                      {ini}
                      <i className={ch === 'wa' ? s.waDot : s.igDot} />
                    </span>
                    <span className={s.grow}>
                      <b>{name}</b>
                      <small>{text}</small>
                    </span>
                    <span className={`${s.chip} ${chip}`}>{label}</span>
                  </div>
                ))}
              </div>
              <Example />
            </Reveal>
          </article>

          <article className={`${s.tile} ${s.span3}`}>
            <div>
              <h3 className={s.cardTitle}>{OPS.guias.title}</h3>
              <p className={s.small}>{OPS.guias.text}</p>
            </div>
            <Reveal loop className={`${s.tileVisual} ${s.loop}`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 14 }} aria-hidden>
                <div className={`${s.label} ${s.anim}`}>
                  <div className={s.labelRow}>
                    <b>CORREOS DE COSTA RICA</b>
                  </div>
                  <div className={s.labelBar} />
                  <div className={s.labelRow}>
                    <span>Guía</span>
                    <b>CR 4021 7735 06</b>
                  </div>
                  <div className={s.labelRow}>
                    <span>Para</span>
                    <b>Daniela R. · 40101</b>
                  </div>
                  <div className={s.labelRow}>
                    <span>Peso</span>
                    <b>0,3 kg</b>
                  </div>
                </div>
                <ul className={s.timeline}>
                  {[
                    ['Guía creada', true],
                    ['Impreso', true],
                    ['En tránsito', 'now'],
                    ['Entregado', false],
                  ].map(([label, done], n) => (
                    <li key={String(label)} className={s.anim} style={i(n + 1)}>
                      <span className={`${s.tl} ${done ? s.tlDone : ''} ${done === 'now' ? s.tlNow : ''}`} />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              <Example />
            </Reveal>
          </article>

          <article className={`${s.tile} ${s.span2}`}>
            <div>
              <h3 className={s.cardTitle}>{OPS.cod.title}</h3>
              <p className={s.small}>{OPS.cod.text}</p>
            </div>
            <Reveal className={s.tileVisual}>
              <div aria-hidden>
                {[
                  ['#2036 · María F.', '₡18.500', s.chipLive, 'Cobrado ✓ SINPE'],
                  ['#2039 · Luis P.', '₡9.900', s.chipWait, 'Pendiente'],
                  ['#2040 · Ana J.', '₡24.000', s.chipLive, 'Cobrado ✓ Efectivo'],
                ].map(([who, amt, chip, label], n) => (
                  <div key={who} className={`${s.codRow} ${s.anim}`} style={i(n)}>
                    <span>
                      <b>{who}</b>
                      <br />
                      <span style={{ color: 'var(--muted)' }}>{amt} · contra entrega</span>
                    </span>
                    <span className={`${s.chip} ${chip}`}>{label}</span>
                  </div>
                ))}
              </div>
              <Example />
            </Reveal>
          </article>

          <article className={`${s.tile} ${s.span2}`}>
            <div>
              <h3 className={s.cardTitle}>{OPS.courier.title}</h3>
              <p className={s.small}>{OPS.courier.text}</p>
            </div>
            <Reveal loop className={`${s.tileVisual} ${s.loop}`}>
              <div className={s.courierBoard} aria-hidden>
                {[
                  ['En proceso', [['#2042', 'Escazú']]],
                  ['En tránsito', [['#2038', 'Curridabat'], ['#2041', 'Heredia']]],
                  ['Entregado', [['#2033', 'San Pedro']]],
                ].map(([col, cards], n) => (
                  <div key={String(col)} className={s.courierCol}>
                    <span>{String(col)}</span>
                    {(cards as string[][]).map(([id, place], k) => (
                      <div key={id} className={`${s.cCard} ${s.anim} ${id === '#2041' ? s.cMove : ''}`} style={i(n + k)}>
                        {id}
                        <small>{place}</small>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <Example />
            </Reveal>
          </article>

          <article className={`${s.tile} ${s.span2}`}>
            <div>
              <h3 className={s.cardTitle}>{OPS.ads.title}</h3>
              <p className={s.small}>{OPS.ads.text}</p>
            </div>
            <Reveal className={s.tileVisual}>
              <div aria-hidden>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 650 }}>Anuncio → chat → venta</p>
                <div className={s.funnel}>
                  {[
                    ['Chats', 1],
                    ['Pedidos', 0.42],
                    ['Pagados', 0.31],
                  ].map(([label, w]) => (
                    <div key={String(label)} className={s.funnelRow}>
                      <span>{label}</span>
                      <span className={s.funnelBar} style={{ ['--w' as string]: w }} />
                    </div>
                  ))}
                </div>
                <table className={s.adTable} style={{ marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th>Anuncio</th>
                      <th>Chats</th>
                      <th>Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Reel parches</td>
                      <td>48</td>
                      <td>20</td>
                    </tr>
                    <tr>
                      <td>Historia promo</td>
                      <td>31</td>
                      <td>9</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Example />
            </Reveal>
          </article>
        </div>
      </div>
    </section>
  )
}
