import { useSyncExternalStore } from 'react'

import type { SimDeck } from '@/sim/cards'
import { createSimulation, type SimReport, type Simulation } from '@/sim/simulate'
import { createListeners } from '@/utils/listeners'

// The simulation that's running (or the last one finished), kept outside the screens so it goes
// on while you look elsewhere in the app. Games are played a few milliseconds at a time between
// frames, so the phone stays responsive.

export type RunState = {
  status: 'idle' | 'running' | 'done'
  deck: SimDeck | null
  target: number
  games: number
  // A few numbers so far, while it runs.
  live: { keep7: number; avgLands: number; onCurve: number }
  secondsLeft: number | null
  report: SimReport | null
}

const IDLE: RunState = { status: 'idle', deck: null, target: 0, games: 0, live: { keep7: 0, avgLands: 0, onCurve: 0 }, secondsLeft: null, report: null }

let state = IDLE
const changes = createListeners()
let sim: Simulation | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const set = (patch: Partial<RunState>) => {
  state = { ...state, ...patch }
  changes.notify()
}

export const useRun = () => useSyncExternalStore(changes.subscribe, () => state)

export function startRun(deck: SimDeck, target: number) {
  cancelRun()
  const mine = createSimulation(deck)
  sim = mine
  const started = Date.now()
  let shown = 0
  state = { ...IDLE, status: 'running', deck, target }
  changes.notify()
  const tick = () => {
    if (sim !== mine) return
    mine.step(target, 14)
    const games = mine.games()
    if (games >= target) {
      timer = null
      set({ status: 'done', games, live: mine.live(), secondsLeft: 0, report: mine.report() })
      return
    }
    const now = Date.now()
    if (now - shown > 120) {
      shown = now
      const perMs = games / Math.max(1, now - started)
      set({ games, live: mine.live(), secondsLeft: perMs ? Math.ceil((target - games) / perMs / 1000) : null })
    }
    timer = setTimeout(tick, 0)
  }
  timer = setTimeout(tick, 0)
}

export function cancelRun() {
  if (timer) clearTimeout(timer)
  timer = null
  sim = null
  if (state.status === 'running') set({ status: 'idle' })
}
