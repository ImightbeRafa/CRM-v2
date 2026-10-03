/**
 * Tiny FIFO semaphore with a bounded waiting line (pure, no I/O). Used to cap how many analytics statements hold a
 * pooled DB connection at once; when the line is full, `acquire` throws instead of queueing forever.
 */
export class SlotQueueFullError extends Error {
  constructor() {
    super('SLOT_QUEUE_FULL')
    this.name = 'SlotQueueFullError'
  }
}

export function createSlotQueue(maxActive: number, maxWaiting: number) {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    async acquire(): Promise<void> {
      if (active < maxActive) {
        active += 1
        return
      }
      if (waiters.length >= maxWaiting) throw new SlotQueueFullError()
      // The releasing caller hands its slot straight to the next waiter (active stays the same).
      await new Promise<void>((resolve) => waiters.push(resolve))
    },
    release(): void {
      const next = waiters.shift()
      if (next) next()
      else active = Math.max(0, active - 1)
    },
    stats() {
      return { active, waiting: waiters.length }
    },
  }
}
