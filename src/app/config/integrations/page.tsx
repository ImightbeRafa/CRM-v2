import { redirect } from 'next/navigation'

/** Integraciones API now lives in the single Config layout: `/config?tab=integrations`. */
export default function IntegrationsRedirectPage() {
  redirect('/config?tab=integrations')
}
