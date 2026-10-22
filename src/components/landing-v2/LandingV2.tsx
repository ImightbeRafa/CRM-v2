import s from './landing.module.css'
import { getSupportContactConfig } from '@/lib/support/contact-config'
import { BETSY_PLAN, planPriceLabels } from '@/lib/pricing/plan'
import { Nav } from './islands/Nav'
import { Hero } from './sections/Hero'
import { Agent } from './sections/Agent'
import { Ops } from './sections/Ops'
import { Build, ComingSoon, Trust } from './sections/Story'
import { Contact, Faq, Footer, Pricing } from './sections/Closing'

/**
 * Home v2. Server-rendered; client islands: Nav, NicheTabs, Reveal, and the two demo players (loaded on view).
 * Sections are plain components in order, so one can be swapped for an external design without touching the rest.
 */
export function LandingV2() {
  const price = planPriceLabels()
  const contact = getSupportContactConfig()
  const trialDays = BETSY_PLAN.trialDays

  const sections = [
    <Hero key="hero" priceShort={price.short} trialDays={trialDays} />,
    <Agent key="agent" />,
    <Ops key="ops" />,
    <Build key="build" />,
    <Trust key="trust" />,
    <ComingSoon key="soon" />,
    <Pricing key="pricing" price={price} trialDays={trialDays} />,
    <Faq key="faq" />,
    <Contact key="contact" contact={contact} />,
  ]

  return (
    <div className={s.root}>
      <Nav />
      <main>{sections}</main>
      <Footer />
    </div>
  )
}
