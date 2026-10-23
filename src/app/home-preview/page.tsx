import type { Metadata } from 'next'
import { Instrument_Serif } from 'next/font/google'
import { LandingV2 } from '@/components/landing-v2/LandingV2'

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-home-serif',
  // optional, not swap: the preloaded serif is used when it is ready in time; otherwise the fallback stays for this
  // view instead of re-flowing the hero headline and pushing the CTAs (layout shift).
  display: 'optional',
})

/** Home v2 preview for Rafael: public, not indexed, not linked. Replaces /home only when he says so. */
export const metadata: Metadata = {
  title: 'Betsy · Vista previa de la nueva página',
  description:
    'Betsy junta WhatsApp e Instagram en una bandeja, convierte cada chat en un pedido y lo sigue hasta la entrega con Correos de Costa Rica. Agentes de IA hechos para tu negocio.',
  robots: { index: false, follow: false, nocache: true },
}

// Static, refreshed hourly so contact details from env follow the container's values.
export const revalidate = 3600

export default function HomePreview() {
  // Own look in any theme (like /home).
  return (
    <div className={`theme-static ${serif.variable}`} lang="es-CR">
      <LandingV2 />
    </div>
  )
}
