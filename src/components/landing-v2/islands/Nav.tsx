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

  const menuBtn = useRef<HTMLButtonElement>(null)

  // Glass once scrolled, and the link of the section crossing the middle of the screen (aria-current); sections
  // that are not in the nav clear it.
  useEffect(() => {
    let frame = 0
    const on = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setSolid(window.scrollY > 12)
        const mid = window.innerHeight / 2
        let hit: string | null = null
        for (const l of NAV) {
          const r = document.getElementById(l.href.slice(1))?.getBoundingClientRect()
          if (r && r.top <= mid && r.bottom >= mid) hit = l.href
        }
        setActive(hit)
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [])

  // Mobile sheet: a modal. Page behind is inert and does not scroll; Escape closes and returns focus to the button.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const prev = root.style.overflow
    root.style.overflow = 'hidden'
    const behind = Array.from(document.querySelectorAll<HTMLElement>('main, footer'))
    for (const el of behind) el.inert = true
    sheet.current?.querySelector('a')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      menuBtn.current?.focus()
    }
    const onWide = () => window.innerWidth >= 1024 && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onWide)
    return () => {
      root.style.overflow = prev
      for (const el of behind) el.inert = false
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onWide)
    }
  }, [open])

  return (
    <>
      <header className={`${s.nav} ${solid || open ? s.navSolid : ''}`}>
        <nav aria-label="Principal" className={`${s.wrap} ${s.navInner}`}>
          <a href="#inicio" className={s.logoLink} aria-label="Betsy, inicio">
            {/* The mark breathes at the top of the page; once you scroll it holds still (one live mark per view). */}
            <Logo lockup animated={!solid} />
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
            ref={menuBtn}
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
        <div id="lv2-menu" ref={sheet} className={s.mobileMenu} role="dialog" aria-modal="true" aria-label="Menú">
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
