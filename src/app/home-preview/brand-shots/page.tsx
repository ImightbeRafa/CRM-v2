'use client'
// TEMPORARY local screenshot harness — NOT committed.
import { AgentListPanel } from '@/components/aurora/agentes/AgentListPanel'
import { AgentDetailHeader } from '@/components/aurora/agentes/AgentDetailHeader'
import { AgentAppearanceCard } from '@/components/aurora/agentes/AgentAppearanceCard'

const b = (n: number) => Array.from({ length: n }, () => ({ isActive: true, socialAccountId: 'x' }))
const AGENTS = [
  { id: 'a1', name: 'Forge ventas', introductionNames: ['Andrés'], status: 'live', description: 'Vende el Arnés ForgeCR por WhatsApp/Instagram', bindings: b(2), operationMode: 'ai_full' },
  { id: 'a2', name: 'Pura Sonrisa ventas', introductionNames: ['Laura'], status: 'live', description: 'Vende tiras blanqueadoras Pura Sonrisa por WhatsApp/Instagram', bindings: b(2), operationMode: 'ai_full' },
  { id: 'a3', name: 'Betsy ventas', introductionNames: ['Betsy'], status: 'draft', description: 'Vende Betsy CRM: explica qué hace, el plan y la prueba', bindings: b(0), operationMode: 'ai_full', appearance: { ring: true } },
  { id: 'a4', name: 'Sleeping ventas', introductionNames: ['Vale'], status: 'live', description: 'Vende Sleeping Patches por WhatsApp/Instagram', bindings: b(2), operationMode: 'ai_full' },
  { id: 'a5', name: 'PatchHouse ventas', introductionNames: ['Sofi'], status: 'live', description: 'Vende parches PatchHouse por WhatsApp/Instagram', bindings: b(2), operationMode: 'ai_full' },
  { id: 'a6', name: 'DeepClean ventas', introductionNames: ['Caro'], status: 'draft', description: 'Vende el limpiador de oídos DeepClean por WhatsApp', bindings: b(0), operationMode: 'ai_full' },
  { id: 'a7', name: 'Prototipo ventas', introductionNames: ['Dani'], status: 'draft', description: 'Vende el kit DIY de avión RC de papel de Prototipo', bindings: b(1), operationMode: 'ai_full' },
  { id: 'a8', name: 'Predeterminado', introductionNames: [], status: 'live', description: 'Tenant default — solo humanos', bindings: b(0), operationMode: 'human_only' },
]

export default function Shots() {
  return (
    <div className="min-h-screen bg-[var(--aurora-canvas)] p-6">
      <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white px-5 pt-5">
        <AgentDetailHeader agent={AGENTS[4]} status="live" mode="ai_full" subtitle="Atiende 2 líneas: Instagram @patchhouse.cr · WhatsApp +506 7052 4184" tab="resumen" onTab={() => {}} onBack={() => {}} onProbar={() => {}} onPublish={() => {}} />
      </div>
      <AgentListPanel agents={AGENTS} selectedId={null} onConfigure={() => {}} onProbar={() => {}} onCreate={() => {}} />
      <div className="mt-6 max-w-xl" id="appearance">
        <AgentAppearanceCard agent={AGENTS[4]} canEdit onSaved={() => {}} />
      </div>
    </div>
  )
}
