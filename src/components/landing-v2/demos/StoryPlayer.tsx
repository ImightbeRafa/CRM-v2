'use client'

import { useEffect, useRef } from 'react'
import s from '../landing.module.css'
import { STORY } from '../content'
import { DemoFrame } from './DemoFrame'
import { STORY_LAST, STORY_STEP_MS, StoryStage } from './StoryStage'
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

  return (
    <div ref={ref}>
      <DemoFrame title="Betsy · Chats y pedidos" controls={reduced ? undefined : { paused: t.paused, onToggle: t.toggle, onReplay: t.replay }}>
        <StoryStage step={t.step} />
      </DemoFrame>
      <p className={s.caption} aria-hidden>
        <b>{t.step + 1}/{STORY.steps.length}</b> · {STORY.steps[t.step].caption}
      </p>
    </div>
  )
}
