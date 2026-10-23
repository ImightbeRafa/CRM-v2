import { ArrowRight } from 'lucide-react'
import s from '../landing.module.css'
import { HERO, LINKS, STORY } from '../content'
import { DemoFrame } from '../demos/DemoFrame'
import { LazyDemo } from '../demos/LazyDemo'
import { StorySteps, StoryStage } from '../demos/StoryStage'
import { NightSky } from '@/components/sky/NightSky'

/** Dark hero: static headline (the LCP element never animates in) + the story demo poster, swapped for the player. */
export function Hero({ priceShort, trialDays }: { priceShort: string; trialDays: number }) {
  return (
    <section id="inicio" className={`${s.hero} ${s.fadeBottom}`} aria-labelledby="lv2-hero-title">
      <div className={s.lightField} aria-hidden />
      <NightSky seed={7} bottom="canvas" stars={64} constellation={{ x: 43, y: 9, w: 112 }} />
      <div className={`${s.wrap} ${s.heroGrid}`}>
        <div className={s.heroCopy}>
          <p className={s.heroPill}>
            <span className={s.liveDot} aria-hidden />
            {HERO.pill}
          </p>
          <h1 id="lv2-hero-title" className={`landing-hero ${s.heroTitle}`}>
            Tus chats, tus pedidos y tus envíos <em>en un solo lugar.</em>
          </h1>
          <p className={s.lead}>{HERO.lead}</p>
          <div className={s.heroCtas}>
            <a className={s.btn} href={LINKS.signup}>
              Probar {trialDays} días gratis <ArrowRight size={16} aria-hidden />
            </a>
            <a className={s.btnGhost} href={LINKS.agent}>
              Quiero mi agente de IA
            </a>
          </div>
          <p className={s.fine}>{priceShort} · sin tarjeta para la prueba</p>
        </div>
        <div id="como-funciona" className={s.heroDemo}>
          <h2 className={s.srOnly}>Cómo funciona: un chat de principio a fin</h2>
          <StorySteps className={s.srOnly} />
          <LazyDemo which="story">
            <DemoFrame title="Betsy · Chats y pedidos">
              <StoryStage step={0} />
            </DemoFrame>
            <p className={s.caption} aria-hidden>
              <b>1/{STORY.steps.length}</b> · {STORY.steps[0].caption}
            </p>
          </LazyDemo>
        </div>
      </div>
    </section>
  )
}
