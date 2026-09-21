'use client'

import React, { Suspense } from 'react'
import { ConocimientoWizardInner } from './ConocimientoWizard'

export default function ConocimientoWizardPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-600">Cargando…</div>}>
      <ConocimientoWizardInner />
    </Suspense>
  )
}
