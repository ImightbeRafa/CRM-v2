'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Menu, X } from 'lucide-react'
import s from '../landing.module.css'
import { LINKS, NAV } from '../content'
import { BETSY_PLAN } from '@/lib/pricing/plan'
import { Logo } from '../brand'

/**
 * Top nav (Rafael 2026-10-23): the official lockup with the animated mark, links that mark the section on screen,
 * a quiet "Iniciar sesión" next to the primary CTA, glass (blur) once the page scrolls, and a full mobile sheet
 * (Escape closes, page scroll locked while open, focus moves into it).
 */
export function Nav() {
  const [solid, setSolid] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const on = () => setSolid(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  // The section in the middle of the screen marks its link (aria-current).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(`#${e.target.id}`)
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    for (const l of NAV) {
      const el = document.getElementById(l.href.slice(1))
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const prev = root.style.overflow
    root.style.overflow = 'hidden'
    sheet.current?.querySelector('a')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onWide = () => window.innerWidth >= 1024 && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onWide)
    return () => {
      root.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onWide)
    }
  }, [open])

  return (
    <>
      <header className={`${s.nav} ${solid || open ? s.navSolid : ''}`}>
        <nav aria-label="Principal" className={`${s.wrap} ${s.navInner}`}>
          <a href="#inicio" className={s.logoLink} aria-label="Betsy, inicio">
            <Logo lockup />
          </a>
          <ul className={s.navLinks}>
            {NAV.map((l) => (
              <li key={l.href}>
                <a href={l.href} aria-current={active === l.href ? 'location' : undefined}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className={s.navCtas}>
            <a className={s.navSignin} href={LINKS.signin}>
              Iniciar sesión
            </a>
            <a className={`${s.btn} ${s.navPrimary}`} href={LINKS.signup}>
              Probar gratis <ArrowRight size={15} aria-hidden />
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
      </header>
      {/* Outside the header: its backdrop-filter would make it the containing block of this fixed sheet. */}
      {open && (
        <div id="lv2-menu" ref={sheet} className={s.mobileMenu}>
          <div className={s.wrap}>
            <ul className={s.mobileLinks}>
              {NAV.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={active === l.href ? 'location' : undefined}
                  >
                    {l.label}
                    <ArrowRight size={16} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
            <div className={s.mobileCtas}>
              <a className={s.btn} href={LINKS.signup}>
                Probar {BETSY_PLAN.trialDays} días gratis <ArrowRight size={16} aria-hidden />
              </a>
              <a className={s.btnGhost} href={LINKS.signin}>
                Iniciar sesión
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
