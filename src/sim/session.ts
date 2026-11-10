import { useSyncExternalStore } from 'react'

import type { CardDefs, SimDeck } from '@/sim/cards'
import { act, canAttack, canBlock, newGame, restore, snapshot, viewFor, type Action, type Game, type Step } from '@/sim/engine'
import { host as openHost, join as openJoin, localAddress, resolveAddress, type Link } from '@/sim/lan'
import { rulesFor } from '@/sim/load'
import { createListeners } from '@/utils/listeners'

// The game being played, for the Play screen. Three ways to play:
// - 'solo': both sides on this phone (or one side against nobody);
// - 'host': this phone runs the game and another phone joins it;
// - 'guest': this phone joined a game; it sends its moves and gets the game back.
// The host's phone is the only one that runs the rules; the guest sees its own view of the game
// (the host's hand and both libraries hidden).

// When a player is asked before the game moves on. Without a stop, priority passes by itself.
export type Prefs = {
  // Stop every time this player gets priority.
  fullControl: boolean
  // Steps to stop at on your own turn (the main phases always stop) and on the other player's.
  mine: Step[]
  theirs: Step[]
}

const SOLO_PREFS: Prefs = { fullControl: false, mine: [], theirs: [] }
// Against a person: a chance to act once attackers are declared.
const LAN_PREFS: Prefs = { fullControl: false, mine: [], theirs: ['attackers'] }

export type SessionState = {
  mode: 'none' | 'solo' | 'host' | 'guest'
  // A fresh copy after every change, so the screen redraws.
  g: Game | null
  // This phone's player (solo: 0, and the screen shows whoever acts).
  seat: number
  link: 'none' | 'opening' | 'waiting' | 'joining' | 'connected' | 'lost' | 'failed'
  // Why the link failed, or the host's address while waiting.
  note: string
  address: string | null
  // The last move the rules refused.
  error: { n: number; text: string } | null
  canUndo: boolean
  prefs: Prefs
}

const IDLE: SessionState = {
  mode: 'none', g: null, seat: 0, link: 'none', note: '', address: null, error: null, canUndo: false, prefs: SOLO_PREFS,
}

let state: SessionState = IDLE
const changes = createListeners()
const set = (patch: Partial<SessionState>) => {
  state = { ...state, ...patch }
  changes.notify()
}

// The working copy the rules run on (host and solo), its history for Undo, and each seat's stops.
let game: Game | null = null
let history: string[] = []
let prefs: Prefs[] = [SOLO_PREFS, SOLO_PREFS]
// The turn each seat pressed "End turn" on: they pass everything until it's over.
let skip: number[] = [-1, -1]
let decks: (SimDeck | null)[] = [null, null]
let names: string[] = ['You', 'Opponent']
let errors = 0

let link: Link | null = null
let closeServer: (() => void) | null = null
// Card definitions the guest already has (tokens add to them during the game).
let sentDefs = new Set<string>()
// Guest: every definition received so far.
let guestDefs: CardDefs = {}

export const useSession = () => useSyncExternalStore(changes.subscribe, () => state)
export const getSession = () => state

const fail = (text: string) => set({ error: { n: ++errors, text } })

// ---- Passing priority by itself ----

function shouldPass(g: Game, p: number) {
  const pr = prefs[p]
  if (pr.fullControl) return false
  if (g.stack.length) {
    // Your own spell: let it resolve. Someone else's: alone you just watch it resolve; against a
    // person, they get to answer.
    return g.stack[g.stack.length - 1].ctrl === p || state.mode === 'solo'
  }
  if (p === g.active) {
    if (skip[p] === g.turn) return true
    if (g.step === 'main1' || g.step === 'main2') return false
    return !pr.mine.includes(g.step)
  }
  return !pr.theirs.includes(g.step)
}

function autoPlay(g: Game) {
  for (let guard = 0; guard < 300 && g.phase === 'play'; guard++) {
    const w = g.wait
    const pl = g.players[w.p]
    if (w.kind === 'priority') {
      if (!shouldPass(g, w.p) || act(g, w.p, { t: 'pass' })) return
    } else if (w.kind === 'attackers') {
      const can = pl.battlefield.some((id) => canAttack(g, g.cards[id]))
      if (skip[w.p] !== g.turn && (can || prefs[w.p].fullControl)) return
      if (act(g, w.p, { t: 'attack', attackers: [] })) return
    } else if (w.kind === 'blockers') {
      const can = pl.battlefield.some((b) => g.combat.some((a) => canBlock(g, g.cards[b], g.cards[a])))
      if (can || prefs[w.p].fullControl) return
      if (act(g, w.p, { t: 'block', blocks: [] })) return
    } else return
  }
}

// ---- Publishing ----

function publish(json?: string) {
  if (!game) return
  const text = json ?? snapshot(game)
  set({ g: restore(text, game.defs), canUndo: history.length > 0 })
  if (state.mode === 'host' && link) {
    const fresh: CardDefs = {}
    for (const id of Object.keys(game.defs)) {
      if (sentDefs.has(id)) continue
      sentDefs.add(id)
      fresh[id] = game.defs[id]
    }
    link.send({ t: 'state', g: { ...viewFor(game, 1), defs: undefined }, defs: fresh })
  }
}

// Carries out a move on the host's (or the only) phone. Returns why the rules refused it.
function perform(p: number, a: Action) {
  if (!game) return 'No game'
  const before = snapshot(game)
  const error = act(game, p, a)
  if (error) return error
  // Looking at cards isn't something to undo.
  if (a.t !== 'look') {
    history.push(before)
    if (history.length > 40) history.shift()
  }
  autoPlay(game)
  publish()
  return null
}

// A move by this phone's player (`as`: the side being played, in a solo game).
export function dispatch(a: Action, as?: number) {
  if (state.mode === 'guest') {
    link?.send({ t: 'act', a })
    return
  }
  const error = perform(as ?? state.seat, a)
  if (error) fail(error)
}

export function undo() {
  if (state.mode === 'guest' || !game) return
  const last = history.pop()
  if (!last) return
  game = restore(last, game.defs)
  skip = [-1, -1]
  publish(last)
}

// "End turn": pass everything until this turn is over (still stopping for the other player's spells).
export function endTurn(as?: number) {
  if (state.mode === 'guest') {
    link?.send({ t: 'endTurn' })
    return
  }
  if (!game) return
  const p = as ?? state.seat
  skip[p] = game.turn
  const error = perform(p, { t: 'pass' })
  if (error) fail(error)
}

export function setPrefs(next: Prefs) {
  set({ prefs: next })
  if (state.mode === 'guest') link?.send({ t: 'prefs', prefs: next })
  else if (state.mode === 'solo') prefs = [next, next]
  else prefs[0] = next
  if (game && state.mode !== 'guest') {
    autoPlay(game)
    publish()
  }
}

// ---- Starting ----

function begin() {
  const rules = rulesFor(decks[0]?.format ?? 'Casual')
  game = newGame({
    decks,
    names,
    startingLife: rules.life,
    cmdLethal: rules.cmdLethal,
    freeMulligan: rules.freeMulligan,
    first: null,
    seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0,
  })
  history = []
  skip = [-1, -1]
  publish()
}

export function startSolo(mine: SimDeck, theirs: SimDeck | null) {
  leave()
  decks = [mine, theirs]
  // Each side goes by its deck's name.
  names = [mine.name, theirs ? (theirs.name === mine.name ? `${theirs.name} (2)` : theirs.name) : 'Nobody']
  prefs = [SOLO_PREFS, SOLO_PREFS]
  state = { ...IDLE, mode: 'solo', prefs: SOLO_PREFS }
  begin()
}

// A new game with the same decks and players.
export function rematch() {
  if (state.mode === 'guest') {
    link?.send({ t: 'rematch' })
    return
  }
  if (decks[0]) begin()
}

type Hello = { t: 'hello'; v: number; name: string; deck: SimDeck }
type FromGuest = Hello | { t: 'act'; a: Action } | { t: 'endTurn' } | { t: 'prefs'; prefs: Prefs } | { t: 'rematch' }
type FromHost = { t: 'state'; g: Game; defs: CardDefs } | { t: 'error'; text: string }

const PROTOCOL = 1

// Opens a game on this phone and waits for the other one.
export async function hostGame(deck: SimDeck, name: string) {
  leave()
  state = { ...IDLE, mode: 'host', link: 'opening', prefs: LAN_PREFS }
  changes.notify()
  const address = await localAddress()
  if (state.mode !== 'host') return
  if (!address) {
    set({ link: 'failed', note: 'This phone isn’t on a Wi-Fi network. Join the same Wi-Fi as the other phone, or turn on your hotspot and have them join it.' })
    return
  }
  decks = [deck, null]
  names = [name, 'Opponent']
  prefs = [LAN_PREFS, LAN_PREFS]
  try {
    closeServer = await openHost(
      (connect) => {
        const mine = connect({
          onMessage: (raw) => {
            const m = raw as FromGuest
            if (m.t === 'hello') {
              if (m.v !== PROTOCOL) {
                mine.send({ t: 'error', text: 'The two phones run different versions of the app. Update both.' })
                return
              }
              const theirName = m.name === names[0] ? `${m.name} (2)` : m.name
              // The same player coming back after a dropped connection picks the game up again.
              const back = game != null && game.phase !== 'over' && decks[1]?.id === m.deck.id && names[1] === theirName
              decks = [decks[0], m.deck]
              names = [names[0], theirName]
              sentDefs = new Set()
              link = mine
              set({ link: 'connected', note: '' })
              if (back) publish()
              else begin()
            } else if (!game || link !== mine) {
              return
            } else if (m.t === 'act') {
              const error = perform(1, m.a)
              if (error) mine.send({ t: 'error', text: error })
            } else if (m.t === 'endTurn') {
              skip[1] = game.turn
              const error = perform(1, { t: 'pass' })
              if (error) mine.send({ t: 'error', text: error })
            } else if (m.t === 'prefs') {
              prefs[1] = m.prefs
              autoPlay(game)
              publish()
            } else if (m.t === 'rematch') {
              begin()
            }
          },
          onClose: () => {
            if (link === mine) {
              link = null
              set({ link: 'lost', note: `${names[1]} disconnected.` })
            }
          },
        })
      },
      (text) => set({ link: 'failed', note: text }),
    )
    if (state.mode !== 'host') {
      closeServer?.()
      closeServer = null
      return
    }
    set({ link: 'waiting', address })
  } catch (e) {
    set({ link: 'failed', note: e instanceof Error ? e.message : 'Couldn’t open a game.' })
  }
}

// Joins the game another phone opened. `typed`: the host's address or its last number.
export async function joinGame(typed: string, deck: SimDeck, name: string) {
  leave()
  state = { ...IDLE, mode: 'guest', seat: 1, link: 'joining', prefs: LAN_PREFS }
  changes.notify()
  const address = resolveAddress(typed, await localAddress())
  if (state.mode !== 'guest') return
  if (!address) {
    set({ link: 'failed', note: 'Type the number the other phone shows (or its full address, like 192.168.1.23).' })
    return
  }
  guestDefs = {}
  const timeout = setTimeout(() => {
    if (state.mode === 'guest' && state.link === 'joining') {
      link?.close()
      link = null
      set({ link: 'failed', note: 'No answer. Check that both phones are on the same Wi-Fi and that the other phone is waiting for you.' })
    }
  }, 8000)
  try {
    const mine = await openJoin(address, {
      onOpen: () => mine.send({ t: 'hello', v: PROTOCOL, name, deck } satisfies Hello),
      onMessage: (raw) => {
        const m = raw as FromHost
        if (m.t === 'state') {
          clearTimeout(timeout)
          Object.assign(guestDefs, m.defs)
          set({ g: { ...m.g, defs: guestDefs }, link: 'connected', note: '' })
        } else if (m.t === 'error') {
          if (state.g) fail(m.text)
          else set({ link: 'failed', note: m.text })
        }
      },
      onClose: () => {
        if (link !== mine) return
        clearTimeout(timeout)
        link = null
        set(state.g ? { link: 'lost', note: 'The other phone disconnected.' } : { link: 'failed', note: 'Couldn’t reach the other phone. Check that both are on the same Wi-Fi.' })
      },
    })
    if (state.mode !== 'guest') {
      mine.close()
      return
    }
    link = mine
  } catch (e) {
    clearTimeout(timeout)
    set({ link: 'failed', note: e instanceof Error ? e.message : 'Couldn’t join.' })
  }
}

// Ends the game on this phone and closes the connection.
export function leave() {
  link?.close()
  link = null
  closeServer?.()
  closeServer = null
  game = null
  history = []
  state = IDLE
  changes.notify()
}
