'use client'

import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import s from '../landing.module.css'
import { LINKS, NAV } from '../content'

export function Nav() {
  const [solid, setSolid] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const on = () => setSolid(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header className={`${s.nav} ${solid || open ? s.navSolid : ''}`}>
      <nav aria-label="Principal" className={`${s.wrap} ${s.navInner}`}>
        <a href="#inicio" className={s.logo}>
          Betsy
        </a>
        <ul className={s.navLinks}>
          {NAV.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
        <div className={s.navCtas}>
          <a className={s.btnGhost} href={LINKS.signin}>
            Iniciar sesión
          </a>
          <a className={s.btn} href={LINKS.signup}>
            Probar gratis
          </a>
        </div>
        <button
          type="button"
          className={s.menuBtn}
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="lv2-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
        </button>
      </nav>
      {open && (
        <div id="lv2-menu" className={s.mobileMenu}>
          {NAV.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a href={LINKS.signin}>Iniciar sesión</a>
          <a className={s.btn} href={LINKS.signup} style={{ borderBottom: 0 }}>
            Probar 7 días gratis
          </a>
        </div>
      )}
    </header>
  )
}
