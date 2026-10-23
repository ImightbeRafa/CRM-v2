'use client'

import { useEffect, useRef, useState } from 'react'
import s from '../landing.module.css'
import { STORY } from '../content'
import { DemoFrame } from './DemoFrame'
import type { MarkState } from '../brand'
import { STORY_LAST, STORY_MARK_BEATS, STORY_STEP_MS, StoryStage } from './StoryStage'
import { useOnScreen, usePrefersReducedMotion, useTimeline } from './useTimeline'

/** The hero story, playing. Loaded only once the poster scrolls into view (see LazyDemo). */
export default function StoryPlayer() {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const visible = useOnScreen(ref)
  const t = useTimeline(STORY_STEP_MS, { restStep: STORY_LAST, reduced, visible })
  const { goTo } = t

  useEffect(() => {
    if (reduced) goTo(STORY_LAST)
  }, [reduced, goTo])

  // The mark follows the beats inside the current step while the story plays (paused/reduced: the step's pose).
  const [mark, setMark] = useState<MarkState | undefined>(undefined)
  useEffect(() => {
    const beats = STORY_MARK_BEATS[t.step]
    if (!t.running || !beats) {
      setMark(undefined)
      return
    }
    setMark(beats[0][1])
    const timers = beats.slice(1).map(([at, state]) => setTimeout(() => setMark(state), at))
    return () => timers.forEach(clearTimeout)
  }, [t.step, t.running])

  return (
    <div ref={ref}>
      <DemoFrame title="Betsy · Chats y pedidos" controls={reduced ? undefined : { paused: t.paused, onToggle: t.toggle, onReplay: t.replay }}>
        <StoryStage step={t.step} mark={mark} />
      </DemoFrame>
      <p className={s.caption} aria-hidden>
        <b>{t.step + 1}/{STORY.steps.length}</b> · {STORY.steps[t.step].caption}
      </p>
    </div>
  )
}
