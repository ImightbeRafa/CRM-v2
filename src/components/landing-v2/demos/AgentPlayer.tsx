'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import s from '../landing.module.css'
import { AGENT } from '../content'
import { AGENT_STEP_MS, AgentStage, AgentSteps } from './AgentStage'
import { DemoFrame } from './DemoFrame'
import { useOnScreen, usePrefersReducedMotion, useTimeline } from './useTimeline'

/** Agent explainer: auto-advances every few seconds; picking a step pauses it on that step. */
export default function AgentPlayer() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const visible = useOnScreen(ref)
  const durations = useMemo(() => AGENT.steps.map(() => AGENT_STEP_MS), [])
  const t = useTimeline(durations, { restStep: 0, reduced, visible })
  const { goTo, setPaused } = t

  useEffect(() => {
    if (reduced) goTo(0)
  }, [reduced, goTo])

  const pick = useCallback(
    (i: number) => {
      goTo(i)
      setPaused(true)
      document.getElementById(`agent-tab-${AGENT.steps[i].key}`)?.focus()
    },
    [goTo, setPaused],
  )

  return (
    <div ref={ref} className={s.agentGrid}>
      <AgentSteps active={t.step} running={t.running} onPick={pick} />
      <div role="tabpanel" id="agent-panel" aria-labelledby={`agent-tab-${AGENT.steps[t.step].key}`}>
        <DemoFrame title="Betsy · Chats" light controls={reduced ? undefined : { paused: t.paused, onToggle: t.toggle, onReplay: t.replay }}>
          <AgentStage step={t.step} />
        </DemoFrame>
        <p className={s.agentText} aria-hidden>
          <b style={{ color: 'var(--ink)' }}>{AGENT.steps[t.step].title}.</b> {AGENT.steps[t.step].text}
        </p>
      </div>
    </div>
  )
}
