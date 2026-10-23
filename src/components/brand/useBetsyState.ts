'use client';
import * as React from 'react';
import type { BetsyState } from './BetsyMark';

/** Chat events → mark state. Wire these from your inbox/composer code. */
export type BetsyEvent =
  | { type: 'message_received' }      // a customer message lands → listen briefly
  | { type: 'reply_started' }         // AI is forming a reply → think
  | { type: 'reply_streaming' }       // tokens/draft streaming → typing (three dots)
  | { type: 'voice_level'; level: number } // TTS/voice → speak
  | { type: 'reply_done' }            // back to idle
  | { type: 'payment_verified' }      // "Pago verificado" → yes + double blink
  | { type: 'read' }                  // conversation marked read → double blink only
  | { type: 'paused' } | { type: 'resumed' }; // agent paused / "Borrador"

export function useBetsyState(initial: BetsyState = 'idle') {
  const [state, setState] = React.useState<BetsyState>(initial);
  const [level, setLevel] = React.useState(0);
  const [readSignal, setReadSignal] = React.useState<number | undefined>(undefined);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = React.useRef(initial === 'paused');

  const settle = React.useCallback((s: BetsyState, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(pausedRef.current ? 'paused' : 'idle'), ms);
    setState(s);
  }, []);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const dispatch = React.useCallback((e: BetsyEvent) => {
    if (e.type === 'paused') { pausedRef.current = true; setState('paused'); return; }
    if (e.type === 'resumed') { pausedRef.current = false; setState('idle'); return; }
    if (pausedRef.current) return;
    switch (e.type) {
      case 'message_received': settle('listen', 1200); break;
      case 'reply_started': if (timer.current) clearTimeout(timer.current); setState('think'); break;
      case 'reply_streaming': setState('typing'); break;
      case 'voice_level': setLevel(Math.max(0, Math.min(1, e.level))); setState('speak'); break;
      case 'reply_done': setState('idle'); break;
      case 'payment_verified': settle('yes', 2000); break;
      case 'read': setReadSignal((n) => (n ?? 0) + 1); break;
    }
  }, [settle]);

  return { state, level, readSignal, dispatch } as const;
}
