import { redirect } from 'next/navigation'

/** The AI usage dashboard lives in the owner's Admin Dashboard (Logística › Admin › IA). */
export default function AiUsagePage() {
  redirect('/logistics/admin?tab=ia')
}
