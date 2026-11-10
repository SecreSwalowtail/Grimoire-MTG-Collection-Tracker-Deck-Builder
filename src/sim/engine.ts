import { compileToken, tokenId, type CardDefs, type Mana, type SimDeck, type SimFace, type TokenSpec } from '@/sim/cards'
import { costLabel, emptyPool, parseCost, planPayment, type Payment, type Pool, type Source } from '@/sim/mana'

// The rules engine for a two-player game (or one player against nobody: "goldfish").
//
// What it enforces: London mulligans, the turn (untap, upkeep, draw, main, combat, second main,
// end, cleanup), priority and the stack, one land a turn, casting times, mana costs and the mana
// pool, summoning sickness, attacking and blocking (flying, reach, menace and the other evasion
// keywords), combat damage (first and double strike, trample, deathtouch, lifelink, infect,
// toxic), state-based actions (lethal damage, 0 toughness, 0 life, 10 poison, 21 commander damage,
// drawing from an empty library, the legend rule, counters cancelling out, tokens leaving the
// battlefield), hand size, and the commander rules (command zone, commander tax).
//
// What it leaves to the players: what a card's text does. No program reads every Magic card, so
// like at a table, the players carry out effects themselves with the manual actions at the end
// of this file (move a card, counters, tokens, life, draw, search…).
//
// The whole game is one plain object (`Game`), so it can be copied for Undo and sent to the other
// phone as JSON.

// 'removed': a token that left the battlefield (it stays in `cards` so ids never change).
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack' | 'removed'
type PlayerZone = Exclude<Zone, 'stack' | 'removed'>

export type Step =
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginCombat'
  | 'attackers'
  | 'blockers'
  | 'firstStrike'
  | 'damage'
  | 'endCombat'
  | 'main2'
  | 'end'
  | 'cleanup'

export const STEP_NAME: Record<Step, string> = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main phase',
  beginCombat: 'Beginning of combat',
  attackers: 'Declare attackers',
  blockers: 'Declare blockers',
  firstStrike: 'First-strike damage',
  damage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Second main phase',
  end: 'End step',
  cleanup: 'Cleanup',
}

// One card or token in the game.
export type Inst = {
  id: number
  // Key of `defs`; '' when this viewer may not see the card (the other hand, libraries).
  def: string
  owner: number
  ctrl: number
  zone: Zone
  // Which face is up (double-faced cards), or which half is being cast.
  face: number
  tapped: boolean
  // Came under its controller's control this turn (summoning sickness).
  sick: boolean
  token: boolean
  commander: boolean
  faceDown: boolean
  counters: Record<string, number>
  damage: number
  // Dealt damage by a deathtouch source this turn.
  deathtouched: boolean
  // +X/+Y until end of turn.
  mod: [number, number]
  attachedTo: number | null
  // -1: attacking the player; an id: that planeswalker or battle.
  attacking: number | null
  blocking: number | null
  blocked: boolean
  // Dealt combat damage in the first-strike step.
  struck: boolean
  loyaltyUsed: boolean
  // In exile after its Adventure resolved: the creature can be cast from there.
  adventure: boolean
  // The mana it was tapped for this step (untapping it takes that mana back).
  mana: { color: Mana; n: number } | null
}

export type Player = {
  name: string
  // The goldfish: no deck, never acts, can't deck out.
  dummy: boolean
  life: number
  poison: number
  pool: Pool
  // The top of the library and of the graveyard is the END of the array.
  library: number[]
  hand: number[]
  battlefield: number[]
  graveyard: number[]
  exile: number[]
  command: number[]
  // Combat damage taken from each commander, by its card id in the game.
  cmdDamage: Record<number, number>
  // Times each commander was cast from the command zone (commander tax).
  cmdCasts: Record<number, number>
  mulligans: number
  mull: 'deciding' | 'bottom' | 'kept'
  landsPlayed: number
  drewEmpty: boolean
  lost: boolean
  // Looking at their own library: the top N cards, or all of it (-1). 0: not looking.
  looking: number
}

export type StackItem = {
  sid: number
  kind: 'spell' | 'ability'
  // The spell's card, or the ability's source.
  id: number
  ctrl: number
  face: number
  x: number
  label: string
  // What an Aura will enchant.
  target: number | null
}

type Pending =
  | { p: number; kind: 'discard'; n: number }
  | { p: number; kind: 'legend'; ids: number[] }
  | { p: number; kind: 'commander'; id: number }

// Who the game is waiting for, and for what.
export type Wait = {
  p: number
  kind: 'mulligan' | 'bottom' | 'priority' | 'attackers' | 'blockers' | 'discard' | 'legend' | 'commander' | 'over'
  n?: number
  ids?: number[]
  id?: number
}

export type LogLine = { n: number; text: string; p: number }

export type Game = {
  defs: CardDefs
  cards: Inst[]
  players: Player[]
  rng: number
  // 1 for the first turn of the game; each player's turn counts.
  turn: number
  active: number
  step: Step
  phase: 'mulligan' | 'play' | 'over'
  priority: number
  passes: number
  stack: StackItem[]
  nextSid: number
  pending: Pending[]
  need: '' | 'attackers' | 'blockers'
  wait: Wait
  // Attacking creatures this combat.
  combat: number[]
  // -1: a draw.
  winner: number | null
  reason: string
  log: LogLine[]
  logN: number
  logging: boolean
  startingLife: number
  // Combat damage from one commander that loses the game (21; 0: no such rule).
  cmdLethal: number
  freeMulligan: boolean
  // The format has a command zone (shown on the table even while it's empty).
  commandZone: boolean
  first: number
  // Turns each player has taken.
  turns: number[]
}

export type GameConfig = {
  decks: (SimDeck | null)[]
  names: string[]
  startingLife: number
  cmdLethal: number
  freeMulligan: boolean
  commandZone?: boolean
  // Who plays first; null: random.
  first: number | null
  seed: number
}

// ---- Small helpers ----

// A random number in [0, 1), from the game's own seed: the same game replays the same way, and an
// undone draw comes back as the same card.
export function rand(g: Game) {
  g.rng = (g.rng + 0x6d2b79f5) | 0
  let t = g.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffle(g: Game, list: number[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1))
    const t = list[i]
    list[i] = list[j]
    list[j] = t
  }
}

const HIDDEN: SimFace = {
  name: 'Hidden card', typeLine: '', types: [], subtypes: [], legendary: false, cost: '', cmc: 0, colors: [],
  power: null, toughness: null, loyalty: null, defense: null, text: '', keywords: [], image: null, thumb: null,
  permanent: false, produces: [], manaAmount: 1, sacForMana: false, entersTapped: { kind: 'never' }, toxic: 0,
}

export const cardOf = (g: Game, c: Inst) => g.defs[c.def]
export function faceOf(g: Game, c: Inst): SimFace {
  const def = g.defs[c.def]
  return def ? def.faces[c.face] ?? def.faces[0] : HIDDEN
}
export const nameOf = (g: Game, c: Inst) => (c.faceDown ? 'a face-down card' : faceOf(g, c).name)
export const isType = (g: Game, c: Inst, type: string) => faceOf(g, c).types.includes(type)
export const has = (g: Game, c: Inst, keyword: string) => faceOf(g, c).keywords.includes(keyword)
export const other = (p: number) => 1 - p

const zoneOf = (g: Game, c: Inst) => g.players[c.zone === 'battlefield' ? c.ctrl : c.owner][c.zone as PlayerZone]

function log(g: Game, p: number, text: string) {
  if (!g.logging) return
  g.log.push({ n: g.logN++, text, p })
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200)
}

export function power(g: Game, c: Inst) {
  const base = c.faceDown ? 2 : faceOf(g, c).power ?? 0
  return base + (c.counters['+1/+1'] ?? 0) - (c.counters['-1/-1'] ?? 0) + c.mod[0]
}

export function toughness(g: Game, c: Inst) {
  const base = c.faceDown ? 2 : faceOf(g, c).toughness ?? 0
  return base + (c.counters['+1/+1'] ?? 0) - (c.counters['-1/-1'] ?? 0) + c.mod[1]
}

// ---- Setting up ----

function newInst(g: Game, def: string, owner: number, zone: Zone): Inst {
  const c: Inst = {
    id: g.cards.length, def, owner, ctrl: owner, zone, face: 0, tapped: false, sick: false, token: false,
    commander: false, faceDown: false, counters: {}, damage: 0, deathtouched: false, mod: [0, 0], attachedTo: null,
    attacking: null, blocking: null, blocked: false, struck: false, loyaltyUsed: false, adventure: false, mana: null,
  }
  g.cards.push(c)
  return c
}

export function newGame(cfg: GameConfig): Game {
  const g: Game = {
    defs: {},
    cards: [],
    players: [],
    rng: cfg.seed | 0,
    turn: 0,
    active: 0,
    step: 'upkeep',
    phase: 'mulligan',
    priority: 0,
    passes: 0,
    stack: [],
    nextSid: 1,
    pending: [],
    need: '',
    wait: { p: 0, kind: 'mulligan' },
    combat: [],
    winner: null,
    reason: '',
    log: [],
    logN: 1,
    logging: true,
    startingLife: cfg.startingLife,
    cmdLethal: cfg.cmdLethal,
    freeMulligan: cfg.freeMulligan,
    commandZone: cfg.commandZone ?? false,
    first: 0,
    turns: [0, 0],
  }
  cfg.decks.forEach((deck, p) => {
    const pl: Player = {
      name: cfg.names[p], dummy: deck == null, life: cfg.startingLife, poison: 0,
      pool: emptyPool(), library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [],
      cmdDamage: {}, cmdCasts: {}, mulligans: 0, mull: deck == null ? 'kept' : 'deciding', landsPlayed: 0,
      drewEmpty: false, lost: false, looking: 0,
    }
    g.players.push(pl)
    if (!deck) return
    Object.assign(g.defs, deck.defs)
    for (const line of deck.cards) {
      for (let i = 0; i < line.n; i++) {
        const c = newInst(g, line.def, p, line.commander ? 'command' : 'library')
        c.commander = !!line.commander
        ;(line.commander ? pl.command : pl.library).push(c.id)
      }
    }
    shuffle(g, pl.library)
    for (let i = 0; i < 7; i++) drawOne(g, p)
  })
  g.first = cfg.first ?? (g.players[1].dummy ? 0 : rand(g) < 0.5 ? 0 : 1)
  settle(g)
  return g
}

// ---- Moving cards ----

function drawOne(g: Game, p: number) {
  const pl = g.players[p]
  const id = pl.library.pop()
  if (id == null) {
    if (!pl.dummy) pl.drewEmpty = true
    return null
  }
  const c = g.cards[id]
  c.zone = 'hand'
  pl.hand.push(id)
  return c
}

export function drawCards(g: Game, p: number, n: number) {
  for (let i = 0; i < n; i++) drawOne(g, p)
}

// Whether a land comes in tapped (see EntersTapped). Shock lands and conditions the engine can't
// check come in untapped in Play: the player pays the life or taps it.
function comesInTapped(g: Game, c: Inst, face: SimFace) {
  const rule = face.entersTapped
  if (rule.kind === 'never') return false
  if (rule.kind === 'always') return true
  const lands = g.players[c.ctrl].battlefield.filter((id) => id !== c.id && isType(g, g.cards[id], 'Land'))
  if (rule.kind === 'fast') return lands.length > 2
  if (rule.kind === 'slow') return lands.length < 2
  if (rule.kind === 'check') return !lands.some((id) => rule.types.some((t) => faceOf(g, g.cards[id]).subtypes.includes(t)))
  return false
}

type MoveOptions = { ctrl?: number; bottom?: boolean; tapped?: boolean; face?: number }

// Puts a card in a zone (always its owner's, except the battlefield). Everything it carried stays
// behind: counters, damage, what was attached. A token that leaves the battlefield is gone.
export function moveCard(g: Game, id: number, to: Zone, opts: MoveOptions = {}) {
  const c = g.cards[id]
  if (to === 'removed') return
  if (c.zone !== 'stack' && c.zone !== 'removed') {
    const from = zoneOf(g, c)
    const i = from.lastIndexOf(id)
    if (i >= 0) from.splice(i, 1)
  }
  const wasOnBattlefield = c.zone === 'battlefield'
  if (wasOnBattlefield) {
    // Auras and Equipment on it come off (the Auras then die as a state-based action).
    for (const pl of g.players) {
      for (const other of pl.battlefield) {
        const a = g.cards[other]
        if (a.attachedTo === id) a.attachedTo = isType(g, a, 'Enchantment') && faceOf(g, a).subtypes.includes('Aura') ? -1 : null
      }
    }
  }
  c.tapped = false
  c.sick = false
  c.counters = {}
  c.damage = 0
  c.deathtouched = false
  c.mod = [0, 0]
  c.attachedTo = null
  c.attacking = null
  c.blocking = null
  c.blocked = false
  c.struck = false
  c.loyaltyUsed = false
  c.adventure = false
  c.mana = null
  c.faceDown = false
  c.ctrl = to === 'battlefield' ? opts.ctrl ?? c.ctrl : c.owner
  c.face = to === 'battlefield' || to === 'stack' ? opts.face ?? c.face : 0
  c.zone = to
  if (c.token && to !== 'battlefield' && to !== 'stack') {
    c.zone = 'removed'
    return
  }
  if (to === 'stack') return
  // A card put in the command zone by hand becomes a commander (a deck without one marked).
  if (to === 'command') c.commander = true
  const pl = g.players[to === 'battlefield' ? c.ctrl : c.owner]
  if (to === 'library' && opts.bottom) pl.library.unshift(id)
  else pl[to].push(id)
  if (to === 'battlefield') {
    const face = faceOf(g, c)
    c.sick = true
    c.tapped = opts.tapped ?? comesInTapped(g, c, face)
    if (face.loyalty != null && face.types.includes('Planeswalker')) c.counters.loyalty = face.loyalty
    if (face.defense != null && face.types.includes('Battle')) c.counters.defense = face.defense
    if (face.subtypes.includes('Saga')) c.counters.lore = 1
  } else if (c.commander && to !== 'command') {
    // A commander that leaves the battlefield or the stack for anywhere else may go to the command zone.
    if (!g.pending.some((q) => q.kind === 'commander' && q.id === id)) {
      g.pending.push({ p: c.owner, kind: 'commander', id })
    }
  }
}

export const isGone = (c: Inst) => c.zone === 'removed'

export function createToken(g: Game, p: number, spec: TokenSpec, n = 1) {
  const def = tokenId(spec)
  if (!g.defs[def]) g.defs[def] = compileToken(spec)
  const made: number[] = []
  for (let i = 0; i < n; i++) {
    const c = newInst(g, def, p, 'removed')
    c.token = true
    moveCard(g, c.id, 'battlefield', { ctrl: p })
    made.push(c.id)
  }
  return made
}

// ---- Damage and life ----

export function dealDamage(g: Game, src: Inst | null, to: { player: number } | { id: number }, n: number, combat: boolean) {
  if (n <= 0) return
  const infect = src != null && has(g, src, 'infect')
  if ('player' in to) {
    const pl = g.players[to.player]
    if (infect) pl.poison += n
    else pl.life -= n
    if (combat && src) {
      if (src.commander && g.cmdLethal) pl.cmdDamage[src.id] = (pl.cmdDamage[src.id] ?? 0) + n
      const toxic = faceOf(g, src).toxic
      if (toxic) pl.poison += toxic
    }
  } else {
    const t = g.cards[to.id]
    if (t.zone !== 'battlefield') return
    if (isType(g, t, 'Creature')) {
      if (infect || (src != null && has(g, src, 'wither'))) t.counters['-1/-1'] = (t.counters['-1/-1'] ?? 0) + n
      else t.damage += n
      if (src != null && has(g, src, 'deathtouch')) t.deathtouched = true
    } else if (isType(g, t, 'Planeswalker')) {
      t.counters.loyalty = Math.max(0, (t.counters.loyalty ?? 0) - n)
    } else if (isType(g, t, 'Battle')) {
      t.counters.defense = Math.max(0, (t.counters.defense ?? 0) - n)
    }
  }
  if (src != null && has(g, src, 'lifelink')) g.players[src.ctrl].life += n
}

// Destroy: indestructible permanents stay.
export function destroy(g: Game, id: number) {
  const c = g.cards[id]
  if (c.zone !== 'battlefield' || has(g, c, 'indestructible')) return false
  moveCard(g, id, 'graveyard')
  return true
}

// ---- State-based actions ----

function stateBasedActions(g: Game) {
  for (let guard = 0; guard < 20; guard++) {
    let changed = false
    for (const pl of g.players) {
      if (pl.lost) continue
      if (pl.life <= 0 || pl.poison >= 10 || pl.drewEmpty) pl.lost = true
      if (g.cmdLethal && Object.values(pl.cmdDamage).some((d) => d >= g.cmdLethal)) pl.lost = true
    }
    if (g.players.some((pl) => pl.lost)) {
      finish(g)
      return
    }
    for (const pl of g.players) {
      for (const id of [...pl.battlefield]) {
        const c = g.cards[id]
        if (c.zone !== 'battlefield') continue
        const plus = c.counters['+1/+1'] ?? 0
        const minus = c.counters['-1/-1'] ?? 0
        if (plus > 0 && minus > 0) {
          const cut = Math.min(plus, minus)
          c.counters['+1/+1'] = plus - cut
          c.counters['-1/-1'] = minus - cut
          changed = true
        }
        const face = faceOf(g, c)
        if (face.types.includes('Creature') || c.faceDown) {
          const t = toughness(g, c)
          if (t <= 0) {
            log(g, c.ctrl, `${nameOf(g, c)} dies (0 toughness)`)
            moveCard(g, id, 'graveyard')
            changed = true
          } else if ((c.damage >= t || (c.deathtouched && c.damage > 0)) && !face.keywords.includes('indestructible')) {
            log(g, c.ctrl, `${nameOf(g, c)} dies`)
            moveCard(g, id, 'graveyard')
            changed = true
          }
        } else if (face.types.includes('Planeswalker') && (c.counters.loyalty ?? 0) <= 0) {
          log(g, c.ctrl, `${face.name} has no loyalty left`)
          moveCard(g, id, 'graveyard')
          changed = true
        } else if (face.types.includes('Battle') && (c.counters.defense ?? 0) <= 0) {
          log(g, c.ctrl, `${face.name} is defeated`)
          moveCard(g, id, 'graveyard')
          changed = true
        } else if (c.attachedTo === -1) {
          // An Aura whose creature is gone.
          moveCard(g, id, 'graveyard')
          changed = true
        }
      }
    }
    // The legend rule: two legendary permanents with the same name, one controller.
    if (!g.pending.some((q) => q.kind === 'legend')) {
      for (let p = 0; p < g.players.length; p++) {
        const seen = new Map<string, number[]>()
        for (const id of g.players[p].battlefield) {
          const c = g.cards[id]
          const face = faceOf(g, c)
          if (!face.legendary || c.faceDown) continue
          seen.set(face.name, [...(seen.get(face.name) ?? []), id])
        }
        for (const ids of seen.values()) {
          if (ids.length < 2) continue
          g.pending.push({ p, kind: 'legend', ids })
          break
        }
      }
    }
    if (!changed) return
  }
}

function finish(g: Game) {
  const losers = g.players.map((pl, p) => (pl.lost ? p : -1)).filter((p) => p >= 0)
  g.phase = 'over'
  if (losers.length !== 1) {
    g.winner = -1
    g.reason = 'Both players lost at once: the game is a draw'
  } else {
    const l = g.players[losers[0]]
    g.winner = other(losers[0])
    const why = l.poison >= 10 ? 'has 10 poison counters'
      : l.life <= 0 ? 'is at 0 life'
        : l.drewEmpty ? 'drew from an empty library'
          : g.cmdLethal && Object.values(l.cmdDamage).some((d) => d >= g.cmdLethal) ? `took ${g.cmdLethal} commander damage`
            : 'conceded'
    g.reason = `${l.name} ${why}`
  }
  log(g, g.winner, g.winner < 0 ? g.reason : `${g.players[g.winner].name} wins: ${g.reason}`)
}

// ---- The turn ----

function emptyPools(g: Game) {
  for (const pl of g.players) {
    const pool = pl.pool
    if (pool.W || pool.U || pool.B || pool.R || pool.G || pool.C) pl.pool = emptyPool()
    for (const id of pl.battlefield) g.cards[id].mana = null
  }
}

function startTurn(g: Game, first = false) {
  if (!first && !g.players[other(g.active)].dummy) g.active = other(g.active)
  if (first) g.active = g.first
  g.turn += 1
  g.turns[g.active] += 1
  const pl = g.players[g.active]
  pl.landsPlayed = 0
  for (const id of pl.battlefield) {
    const c = g.cards[id]
    c.tapped = false
    c.sick = false
    c.loyaltyUsed = false
  }
  g.step = 'upkeep'
  g.priority = g.active
  g.passes = 0
  log(g, g.active, `Turn ${g.turn}: ${pl.name}`)
}

function endCombat(g: Game) {
  for (const pl of g.players) {
    for (const id of pl.battlefield) {
      const c = g.cards[id]
      c.attacking = null
      c.blocking = null
      c.blocked = false
      c.struck = false
    }
  }
  g.combat = []
}

const strikesFirst = (g: Game, c: Inst) => has(g, c, 'first strike') || has(g, c, 'double strike')

function combatDamage(g: Game, first: boolean) {
  const defender = other(g.active)
  const hits: { src: Inst; to: { player: number } | { id: number }; n: number }[] = []
  const strikes = (c: Inst) => (first ? strikesFirst(g, c) : has(g, c, 'double strike') || !c.struck)
  for (const id of g.combat) {
    const a = g.cards[id]
    if (a.zone !== 'battlefield' || a.attacking == null || !strikes(a)) continue
    let p = power(g, a)
    if (p <= 0) continue
    const target = a.attacking === -1 ? { player: defender } : { id: a.attacking }
    if (!a.blocked) {
      hits.push({ src: a, to: target, n: p })
      continue
    }
    const blockers = g.players[defender].battlefield.map((b) => g.cards[b]).filter((b) => b.blocking === id)
    const trample = has(g, a, 'trample')
    if (!blockers.length) {
      if (trample) hits.push({ src: a, to: target, n: p })
      continue
    }
    // Lethal damage to each blocker, the easiest to kill first; trample carries the rest over.
    const deathtouch = has(g, a, 'deathtouch')
    const lethal = (b: Inst) => (deathtouch ? 1 : Math.max(1, toughness(g, b) - b.damage))
    blockers.sort((x, y) => lethal(x) - lethal(y))
    blockers.forEach((b, i) => {
      if (p <= 0) return
      const give = i === blockers.length - 1 && !trample ? p : Math.min(p, lethal(b))
      hits.push({ src: a, to: { id: b.id }, n: give })
      p -= give
    })
    if (p > 0 && trample) hits.push({ src: a, to: target, n: p })
  }
  for (const id of g.players[defender].battlefield) {
    const b = g.cards[id]
    if (b.blocking == null || !strikes(b)) continue
    const a = g.cards[b.blocking]
    const p = power(g, b)
    if (a.zone === 'battlefield' && p > 0) hits.push({ src: b, to: { id: a.id }, n: p })
  }
  // All combat damage is dealt at once.
  for (const h of hits) {
    if (first) h.src.struck = true
    dealDamage(g, h.src, h.to, h.n, true)
  }
  if (hits.length && g.logging) {
    const toPlayer = hits.filter((h) => 'player' in h.to).reduce((n, h) => n + h.n, 0)
    log(g, g.active, toPlayer ? `Combat damage: ${toPlayer} to ${g.players[defender].name}` : 'Combat damage dealt')
  }
}

// Moves to the next step once both players have passed on an empty stack.
function advance(g: Game) {
  emptyPools(g)
  g.passes = 0
  g.priority = g.active
  const pl = g.players[g.active]
  switch (g.step) {
    case 'upkeep':
      g.step = 'draw'
      // The player who goes first skips their first draw.
      if (g.turn > 1) {
        const c = drawOne(g, g.active)
        if (c && g.logging) log(g, g.active, `${pl.name} draws`)
      }
      break
    case 'draw':
      g.step = 'main1'
      for (const id of pl.battlefield) {
        const c = g.cards[id]
        if (faceOf(g, c).subtypes.includes('Saga') && !c.sick) {
          c.counters.lore = (c.counters.lore ?? 0) + 1
          log(g, g.active, `${nameOf(g, c)}: chapter ${c.counters.lore}`)
        }
      }
      break
    case 'main1':
      g.step = 'beginCombat'
      break
    case 'beginCombat':
      if (pl.battlefield.some((id) => isType(g, g.cards[id], 'Creature'))) {
        g.step = 'attackers'
        g.need = 'attackers'
      } else {
        g.step = 'main2'
      }
      break
    case 'attackers': {
      g.step = 'blockers'
      const defender = g.players[other(g.active)]
      const canBlock = defender.battlefield.some((id) => isType(g, g.cards[id], 'Creature') && !g.cards[id].tapped)
      if (canBlock && !defender.dummy) g.need = 'blockers'
      break
    }
    case 'blockers': {
      const fighters = [...g.combat, ...g.players[other(g.active)].battlefield.filter((id) => g.cards[id].blocking != null)]
      if (fighters.some((id) => strikesFirst(g, g.cards[id]))) {
        g.step = 'firstStrike'
        combatDamage(g, true)
      } else {
        g.step = 'damage'
        combatDamage(g, false)
      }
      break
    }
    case 'firstStrike':
      g.step = 'damage'
      combatDamage(g, false)
      break
    case 'damage':
      g.step = 'endCombat'
      break
    case 'endCombat':
      endCombat(g)
      g.step = 'main2'
      break
    case 'main2':
      g.step = 'end'
      break
    case 'end': {
      g.step = 'cleanup'
      // Damage wears off and "until end of turn" ends, for everyone.
      for (const q of g.players) {
        for (const id of q.battlefield) {
          const c = g.cards[id]
          c.damage = 0
          c.deathtouched = false
          if (c.mod[0] || c.mod[1]) c.mod = [0, 0]
        }
      }
      const over = pl.hand.length - 7
      if (over > 0) g.pending.push({ p: g.active, kind: 'discard', n: over })
      break
    }
    case 'cleanup':
      break
  }
}

// After every action: state-based actions, then who the game waits for next.
function settle(g: Game) {
  for (;;) {
    if (g.phase !== 'over') stateBasedActions(g)
    if (g.phase === 'over') {
      g.wait = { p: Math.max(0, g.winner ?? 0), kind: 'over' }
      return
    }
    const q = g.pending[0]
    if (q) {
      g.wait = q.kind === 'discard' ? { p: q.p, kind: 'discard', n: q.n } : q.kind === 'legend' ? { p: q.p, kind: 'legend', ids: q.ids } : { p: q.p, kind: 'commander', id: q.id }
      return
    }
    if (g.phase === 'mulligan') {
      const order = [g.first, other(g.first)]
      const next = order.find((p) => g.players[p].mull !== 'kept')
      if (next == null) {
        g.phase = 'play'
        startTurn(g, true)
        continue
      }
      const pl = g.players[next]
      const n = Math.max(0, pl.mulligans - (g.freeMulligan ? 1 : 0))
      g.wait = pl.mull === 'bottom' ? { p: next, kind: 'bottom', n } : { p: next, kind: 'mulligan' }
      return
    }
    if (g.step === 'cleanup') {
      startTurn(g)
      continue
    }
    if (g.need === 'attackers') {
      g.wait = { p: g.active, kind: 'attackers' }
      return
    }
    if (g.need === 'blockers') {
      g.wait = { p: other(g.active), kind: 'blockers' }
      return
    }
    // The goldfish never gets priority.
    if (g.players[g.priority].dummy) g.priority = other(g.priority)
    g.wait = { p: g.priority, kind: 'priority' }
    return
  }
}

// ---- Casting and mana ----

export function canTapForMana(g: Game, c: Inst) {
  const face = faceOf(g, c)
  if (c.zone !== 'battlefield' || c.tapped || c.faceDown || !face.produces.length) return false
  return !(face.types.includes('Creature') && c.sick && !face.keywords.includes('haste'))
}

export function manaSources(g: Game, p: number): Source[] {
  const out: Source[] = []
  for (const id of g.players[p].battlefield) {
    const c = g.cards[id]
    if (!canTapForMana(g, c)) continue
    const face = faceOf(g, c)
    out.push({ id, colors: face.produces, amount: face.manaAmount })
  }
  return out
}

function tapForMana(g: Game, c: Inst, color: Mana) {
  const face = faceOf(g, c)
  const pl = g.players[c.ctrl]
  c.tapped = true
  pl.pool[color] += face.manaAmount
  c.mana = { color, n: face.manaAmount }
  if (face.sacForMana) moveCard(g, c.id, 'graveyard')
}

const isMain = (step: Step) => step === 'main1' || step === 'main2'

// Why a player can't act at instant speed right now, or null.
function needsPriority(g: Game, p: number) {
  if (g.phase !== 'play') return 'The game hasn’t started'
  if (g.wait.kind !== 'priority' || g.wait.p !== p) return 'You don’t have priority'
  return null
}

function needsSorceryTime(g: Game, p: number) {
  if (g.active !== p) return 'Only on your own turn'
  if (!isMain(g.step)) return 'Only in your main phase'
  if (g.stack.length) return 'Only when the stack is empty'
  return null
}

export type CastCheck = { error: string | null; plan: Payment | null; tax: number; cost: string }

// Whether `p` can cast this card now, and how it would be paid. `free`: skip the mana cost (the
// card's text gives another way to cast it); `force`: skip the timing rules too.
export function checkCast(g: Game, p: number, id: number, faceIndex = 0, x = 0, free = false, force = false): CastCheck {
  const c = g.cards[id]
  const def = g.defs[c.def]
  const none = (error: string): CastCheck => ({ error, plan: null, tax: 0, cost: '' })
  if (!def) return none('Unknown card')
  if (c.owner !== p && c.ctrl !== p) return none('Not your card')
  if (c.zone === 'battlefield' || c.zone === 'stack' || c.zone === 'library') return none('Not castable from there')
  const face = def.faces[faceIndex] ?? def.faces[0]
  if (face.types.includes('Land')) return none('Lands are played, not cast')
  const tax = c.zone === 'command' ? 2 * (g.players[p].cmdCasts[id] ?? 0) : 0
  const label = costLabel(face.cost, x, tax)
  if (!force) {
    const wrong = needsPriority(g, p) ?? (face.types.includes('Instant') || face.keywords.includes('flash') ? null : needsSorceryTime(g, p))
    if (wrong) return { error: wrong, plan: null, tax, cost: label }
  }
  if (free) return { error: null, plan: { taps: [], spend: emptyPool(), life: 0 }, tax, cost: label }
  const plan = planPayment(parseCost(face.cost), x, tax, g.players[p].pool, manaSources(g, p), g.players[p].life)
  return { error: plan ? null : `Not enough mana for ${label}`, plan, tax, cost: label }
}

function pay(g: Game, p: number, plan: Payment) {
  const pl = g.players[p]
  for (const t of plan.taps) tapForMana(g, g.cards[t.id], t.color)
  for (const m of Object.keys(plan.spend) as Mana[]) pl.pool[m] = Math.max(0, pl.pool[m] - plan.spend[m])
  if (plan.life) pl.life -= plan.life
}

function resolveTop(g: Game) {
  const item = g.stack.pop()
  if (!item) return
  const c = g.cards[item.id]
  if (item.kind === 'ability') {
    log(g, item.ctrl, `${item.label} resolves`)
    return
  }
  if (c.zone !== 'stack') return
  const def = g.defs[c.def]
  const face = def.faces[item.face] ?? def.faces[0]
  log(g, item.ctrl, `${face.name} resolves`)
  if (face.permanent) {
    moveCard(g, item.id, 'battlefield', { ctrl: item.ctrl, face: item.face })
    if (face.subtypes.includes('Aura')) {
      const host = item.target != null ? g.cards[item.target] : null
      if (host && host.zone === 'battlefield') c.attachedTo = host.id
      else if (item.target != null) c.attachedTo = -1
    }
    return
  }
  if (def.layout === 'adventure' && item.face === 1) {
    // On an adventure: exiled, and its creature can be cast from there later.
    moveCard(g, item.id, 'exile')
    c.adventure = true
  } else {
    moveCard(g, item.id, 'graveyard')
  }
}

// ---- Attacking and blocking ----

export function canAttack(g: Game, c: Inst) {
  if (c.zone !== 'battlefield' || c.tapped || !(isType(g, c, 'Creature') || c.faceDown)) return false
  if (has(g, c, 'defender')) return false
  return !c.sick || has(g, c, 'haste')
}

// Whether `b` may block `a` (flying, shadow and the other evasion keywords; menace is checked on
// the whole declaration).
export function canBlock(g: Game, b: Inst, a: Inst) {
  if (b.zone !== 'battlefield' || b.tapped || !(isType(g, b, 'Creature') || b.faceDown)) return false
  if (has(g, b, 'cantblock') || has(g, a, 'unblockable')) return false
  if (has(g, a, 'flying') && !has(g, b, 'flying') && !has(g, b, 'reach')) return false
  if (has(g, a, 'shadow') !== has(g, b, 'shadow')) return false
  if (has(g, a, 'horsemanship') && !has(g, b, 'horsemanship')) return false
  const bf = faceOf(g, b)
  const af = faceOf(g, a)
  if (has(g, a, 'fear') && !bf.types.includes('Artifact') && !bf.colors.includes('B')) return false
  if (has(g, a, 'intimidate') && !bf.types.includes('Artifact') && !bf.colors.some((col) => af.colors.includes(col))) return false
  if (has(g, a, 'skulk') && power(g, b) > power(g, a)) return false
  return true
}

// ---- Actions ----

export type Action =
  // The game's own moves.
  | { t: 'keep' }
  | { t: 'mull' }
  | { t: 'bottom'; ids: number[] }
  | { t: 'pass' }
  | { t: 'land'; id: number; face?: number; force?: boolean }
  | { t: 'cast'; id: number; face?: number; x?: number; free?: boolean; force?: boolean; target?: number | null }
  | { t: 'mana'; id: number; color?: Mana }
  | { t: 'ability'; id: number; kind: 'activated' | 'triggered' | 'loyalty'; label?: string; tap?: boolean; loyalty?: number; cost?: string }
  | { t: 'attack'; attackers: { id: number; target: number }[]; force?: boolean }
  | { t: 'block'; blocks: { id: number; attacker: number }[]; force?: boolean }
  | { t: 'choose'; ids: number[] }
  | { t: 'commandZone'; yes: boolean }
  | { t: 'concede' }
  // Carrying out card text by hand.
  | { t: 'move'; id: number; to: Zone; bottom?: boolean; tapped?: boolean }
  | { t: 'tap'; id: number }
  | { t: 'untapAll' }
  | { t: 'counter'; id: number; kind: string; by: number }
  | { t: 'life'; p: number; by: number }
  | { t: 'poison'; p: number; by: number }
  | { t: 'cmdDamage'; p: number; id: number; by: number }
  | { t: 'draw'; n: number }
  | { t: 'mill'; n: number }
  | { t: 'shuffle' }
  | { t: 'look'; n: number }
  | { t: 'scry'; top: number[]; bottom: number[] }
  | { t: 'discardRandom' }
  | { t: 'token'; token: TokenSpec; n: number }
  | { t: 'copy'; id: number }
  | { t: 'pt'; id: number; dp: number; dt: number }
  | { t: 'attach'; id: number; to: number | null }
  | { t: 'flip'; id: number }
  | { t: 'faceDown'; id: number }
  | { t: 'control'; id: number }
  | { t: 'addMana'; color: Mana; by: number }
  | { t: 'removeStack'; sid: number }
  | { t: 'roll'; sides: number }
  | { t: 'coin' }

// Carries out `p`'s action. Returns why it isn't allowed, or null when it was done.
export function act(g: Game, p: number, a: Action): string | null {
  const error = apply(g, p, a)
  if (error == null) settle(g)
  return error
}

function apply(g: Game, p: number, a: Action): string | null {
  const pl = g.players[p]
  const name = pl.name
  const w = g.wait
  if (g.phase === 'over' && a.t !== 'concede') return 'The game is over'

  switch (a.t) {
    // ---- Mulligans ----
    case 'keep': {
      if (w.kind !== 'mulligan' || w.p !== p) return 'Not now'
      const bottom = Math.max(0, pl.mulligans - (g.freeMulligan ? 1 : 0))
      pl.mull = bottom > 0 ? 'bottom' : 'kept'
      log(g, p, `${name} keeps ${7 - bottom}`)
      return null
    }
    case 'mull': {
      if (w.kind !== 'mulligan' || w.p !== p) return 'Not now'
      if (pl.mulligans - (g.freeMulligan ? 1 : 0) >= 7) return 'No cards left to mulligan to'
      pl.mulligans += 1
      for (const id of pl.hand) g.cards[id].zone = 'library'
      pl.library.push(...pl.hand)
      pl.hand = []
      shuffle(g, pl.library)
      for (let i = 0; i < 7; i++) drawOne(g, p)
      log(g, p, `${name} mulligans`)
      return null
    }
    case 'bottom': {
      if (w.kind !== 'bottom' || w.p !== p) return 'Not now'
      const ids = [...new Set(a.ids)]
      if (ids.length !== w.n || ids.some((id) => !pl.hand.includes(id))) return `Choose ${w.n} cards from your hand`
      for (const id of ids) moveCard(g, id, 'library', { bottom: true })
      pl.mull = 'kept'
      return null
    }

    // ---- Priority ----
    case 'pass': {
      const wrong = needsPriority(g, p)
      if (wrong) return wrong
      g.passes += 1
      const alone = g.players[other(p)].dummy
      if (g.passes < 2 && !alone) {
        g.priority = other(p)
        return null
      }
      if (g.stack.length) {
        resolveTop(g)
        g.passes = 0
        g.priority = g.active
      } else {
        advance(g)
      }
      return null
    }

    case 'land': {
      const c = g.cards[a.id]
      const def = g.defs[c.def]
      if (!def || c.owner !== p) return 'Not your card'
      const index = a.face ?? 0
      const face = def.faces[index] ?? def.faces[0]
      if (!face.types.includes('Land')) return 'Not a land'
      if (!a.force) {
        if (c.zone !== 'hand') return 'Lands are played from your hand'
        const wrong = needsPriority(g, p) ?? needsSorceryTime(g, p)
        if (wrong) return wrong
        if (pl.landsPlayed >= 1) return 'You already played a land this turn'
      }
      pl.landsPlayed += 1
      moveCard(g, a.id, 'battlefield', { ctrl: p, face: index })
      log(g, p, `${name} plays ${face.name}`)
      return null
    }

    case 'cast': {
      const index = a.face ?? 0
      const check = checkCast(g, p, a.id, index, a.x ?? 0, a.free, a.force)
      if (check.error || !check.plan) return check.error ?? 'Can’t cast that'
      const c = g.cards[a.id]
      const face = g.defs[c.def].faces[index] ?? g.defs[c.def].faces[0]
      pay(g, p, check.plan)
      if (c.zone === 'command') pl.cmdCasts[a.id] = (pl.cmdCasts[a.id] ?? 0) + 1
      moveCard(g, a.id, 'stack', { face: index })
      c.ctrl = p
      g.stack.push({ sid: g.nextSid++, kind: 'spell', id: a.id, ctrl: p, face: index, x: a.x ?? 0, label: face.name, target: a.target ?? null })
      g.passes = 0
      g.priority = p
      log(g, p, `${name} casts ${face.name}${a.free ? ' without paying its mana cost' : ''}`)
      return null
    }

    case 'mana': {
      const c = g.cards[a.id]
      if (c.ctrl !== p) return 'Not yours'
      if (!canTapForMana(g, c)) return c.tapped ? 'Already tapped' : 'It can’t be tapped for mana now'
      const face = faceOf(g, c)
      const color = a.color && face.produces.includes(a.color) ? a.color : face.produces[0]
      tapForMana(g, c, color)
      return null
    }

    case 'ability': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield' && a.kind !== 'triggered' && a.kind !== 'activated') return 'Not on the battlefield'
      const face = faceOf(g, c)
      if (a.kind === 'loyalty') {
        if (c.ctrl !== p || !face.types.includes('Planeswalker')) return 'Not your planeswalker'
        const wrong = needsPriority(g, p) ?? needsSorceryTime(g, p)
        if (wrong) return wrong
        if (c.loyaltyUsed) return 'One loyalty ability a turn for each planeswalker'
        const by = a.loyalty ?? 0
        const now = c.counters.loyalty ?? 0
        if (now + by < 0) return 'Not enough loyalty'
        c.counters.loyalty = now + by
        c.loyaltyUsed = true
      } else if (a.kind === 'activated') {
        const wrong = needsPriority(g, p)
        if (wrong) return wrong
        if (a.tap) {
          if (c.tapped) return 'Already tapped'
          if (face.types.includes('Creature') && c.sick && !face.keywords.includes('haste')) return 'Summoning sick: it can’t use {T} yet'
        }
        // The mana in its cost is paid here; anything else it asks for (sacrifice, discard, life)
        // the player does by hand.
        if (a.cost) {
          const plan = planPayment(parseCost(a.cost), 0, 0, pl.pool, manaSources(g, p).filter((s) => !(a.tap && s.id === c.id)), pl.life)
          if (!plan) return `Not enough mana for ${a.cost}`
          pay(g, p, plan)
        }
        if (a.tap) c.tapped = true
      }
      const label = a.label ?? `${face.name}: ${a.kind === 'loyalty' ? `${(a.loyalty ?? 0) >= 0 ? '+' : '−'}${Math.abs(a.loyalty ?? 0)} ability` : a.kind === 'triggered' ? 'trigger' : 'ability'}`
      g.stack.push({ sid: g.nextSid++, kind: 'ability', id: a.id, ctrl: p, face: c.face, x: 0, label, target: null })
      g.passes = 0
      if (g.wait.kind === 'priority') g.priority = p
      log(g, p, `${name}: ${label}`)
      return null
    }

    // ---- Combat ----
    case 'attack': {
      if (w.kind !== 'attackers' || w.p !== p) return 'Not the time to declare attackers'
      const ids = new Set<number>()
      for (const at of a.attackers) {
        const c = g.cards[at.id]
        if (!c || c.ctrl !== p || c.zone !== 'battlefield' || ids.has(at.id)) return 'Not a creature you can attack with'
        if (!a.force && !canAttack(g, c)) return `${nameOf(g, c)} can’t attack`
        if (at.target !== -1) {
          const t = g.cards[at.target]
          if (!t || t.ctrl === p || t.zone !== 'battlefield' || !(isType(g, t, 'Planeswalker') || isType(g, t, 'Battle'))) return 'Not something to attack'
        }
        ids.add(at.id)
      }
      g.need = ''
      g.passes = 0
      g.priority = p
      if (!a.attackers.length) {
        g.step = 'main2'
        return null
      }
      for (const at of a.attackers) {
        const c = g.cards[at.id]
        c.attacking = at.target
        if (!has(g, c, 'vigilance')) c.tapped = true
        g.combat.push(at.id)
      }
      log(g, p, `${name} attacks with ${a.attackers.map((at) => nameOf(g, g.cards[at.id])).join(', ')}`)
      return null
    }
    case 'block': {
      if (w.kind !== 'blockers' || w.p !== p) return 'Not the time to declare blockers'
      const count = new Map<number, number>()
      const used = new Set<number>()
      for (const b of a.blocks) {
        const blocker = g.cards[b.id]
        const attacker = g.cards[b.attacker]
        if (!blocker || blocker.ctrl !== p || used.has(b.id)) return 'Not a creature you can block with'
        if (!attacker || attacker.attacking == null) return 'That creature isn’t attacking'
        if (!a.force && !canBlock(g, blocker, attacker)) return `${nameOf(g, blocker)} can’t block ${nameOf(g, attacker)}`
        used.add(b.id)
        count.set(b.attacker, (count.get(b.attacker) ?? 0) + 1)
      }
      if (!a.force) {
        for (const [id, n] of count) {
          if (n === 1 && has(g, g.cards[id], 'menace')) return `${nameOf(g, g.cards[id])} has menace: block it with two or more creatures`
        }
      }
      for (const b of a.blocks) {
        g.cards[b.id].blocking = b.attacker
        g.cards[b.attacker].blocked = true
      }
      g.need = ''
      g.passes = 0
      g.priority = g.active
      log(g, p, a.blocks.length ? `${name} blocks with ${a.blocks.map((b) => nameOf(g, g.cards[b.id])).join(', ')}` : `${name} doesn’t block`)
      return null
    }

    // ---- Choices the game asks for ----
    case 'choose': {
      const q = g.pending[0]
      if (!q || q.p !== p) return 'Nothing to choose'
      if (q.kind === 'discard') {
        const ids = [...new Set(a.ids)]
        if (ids.length !== q.n || ids.some((id) => !pl.hand.includes(id))) return `Discard ${q.n}`
        for (const id of ids) moveCard(g, id, 'graveyard')
        log(g, p, `${name} discards down to seven`)
      } else if (q.kind === 'legend') {
        const keep = a.ids[0]
        if (!q.ids.includes(keep)) return 'Choose one to keep'
        for (const id of q.ids) if (id !== keep && g.cards[id].zone === 'battlefield') moveCard(g, id, 'graveyard')
        log(g, p, `Legend rule: ${name} keeps one ${nameOf(g, g.cards[keep])}`)
      } else return 'Nothing to choose'
      g.pending.shift()
      return null
    }
    case 'commandZone': {
      const q = g.pending[0]
      if (!q || q.kind !== 'commander' || q.p !== p) return 'Nothing to choose'
      g.pending.shift()
      const c = g.cards[q.id]
      if (a.yes && c.zone !== 'command' && c.zone !== 'battlefield' && c.zone !== 'stack') {
        moveCard(g, q.id, 'command')
        log(g, p, `${nameOf(g, c)} goes back to the command zone`)
      }
      return null
    }
    case 'concede':
      if (g.phase === 'over') return 'The game is over'
      pl.lost = true
      return null

    // ---- By hand ----
    case 'move': {
      const c = g.cards[a.id]
      if (!c || isGone(c)) return 'That card is gone'
      const stackAt = g.stack.findIndex((s) => s.kind === 'spell' && s.id === a.id)
      if (stackAt >= 0) g.stack.splice(stackAt, 1)
      if (a.to === 'stack' || a.to === 'removed') return 'Not a place to put a card'
      const from = c.zone
      // A card going from the hand to the library stays unnamed: the other player hasn't seen it.
      const what = from === 'hand' && a.to === 'library' ? 'a card' : nameOf(g, c)
      const wasToken = c.token
      moveCard(g, a.id, a.to, { ctrl: a.to === 'battlefield' ? (from === 'battlefield' ? c.ctrl : p) : undefined, bottom: a.bottom, tapped: a.tapped })
      const where: Record<PlayerZone, string> = {
        library: a.bottom ? 'on the bottom of the library' : 'on top of the library',
        battlefield: 'onto the battlefield',
        command: 'into the command zone',
        hand: 'into hand',
        graveyard: 'into the graveyard',
        exile: 'into exile',
      }
      log(g, p, wasToken && a.to !== 'battlefield' ? `${what} token removed` : `${name} puts ${what} ${where[a.to]}`)
      return null
    }
    case 'tap': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      if (c.tapped && c.mana) {
        // Untapping a land takes back the mana it made, if it's still there.
        const owner = g.players[c.ctrl]
        if (owner.pool[c.mana.color] >= c.mana.n) owner.pool[c.mana.color] -= c.mana.n
        c.mana = null
      }
      c.tapped = !c.tapped
      return null
    }
    case 'untapAll':
      for (const id of pl.battlefield) g.cards[id].tapped = false
      log(g, p, `${name} untaps everything`)
      return null
    case 'counter': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      const next = Math.max(0, (c.counters[a.kind] ?? 0) + a.by)
      if (next) c.counters[a.kind] = next
      else delete c.counters[a.kind]
      log(g, p, `${nameOf(g, c)}: ${next} ${a.kind} counter${next === 1 ? '' : 's'}`)
      return null
    }
    case 'life': {
      const t = g.players[a.p]
      t.life += a.by
      log(g, p, `${t.name}: ${t.life} life (${a.by > 0 ? '+' : '−'}${Math.abs(a.by)})`)
      return null
    }
    case 'poison': {
      const t = g.players[a.p]
      t.poison = Math.max(0, t.poison + a.by)
      log(g, p, `${t.name}: ${t.poison} poison`)
      return null
    }
    case 'cmdDamage': {
      const t = g.players[a.p]
      t.cmdDamage[a.id] = Math.max(0, (t.cmdDamage[a.id] ?? 0) + a.by)
      log(g, p, `${t.name}: ${t.cmdDamage[a.id]} commander damage from ${nameOf(g, g.cards[a.id])}`)
      return null
    }
    case 'draw':
      drawCards(g, p, a.n)
      log(g, p, `${name} draws ${a.n === 1 ? 'a card' : `${a.n} cards`}`)
      return null
    case 'mill': {
      const names: string[] = []
      for (let i = 0; i < a.n; i++) {
        const id = pl.library[pl.library.length - 1]
        if (id == null) break
        names.push(nameOf(g, g.cards[id]))
        moveCard(g, id, 'graveyard')
      }
      log(g, p, names.length ? `${name} mills ${names.join(', ')}` : `${name}'s library is empty`)
      return null
    }
    case 'shuffle':
      shuffle(g, pl.library)
      log(g, p, `${name} shuffles`)
      return null
    case 'look':
      pl.looking = a.n
      if (a.n) log(g, p, a.n < 0 ? `${name} searches their library` : `${name} looks at the top ${a.n === 1 ? 'card' : `${a.n} cards`} of their library`)
      return null
    case 'scry': {
      // `top`: the cards kept on top, the first one on top of all; `bottom`: the rest, in order.
      const all = [...a.top, ...a.bottom]
      const seen = pl.library.slice(-all.length)
      if (new Set(all).size !== all.length || all.some((id) => !seen.includes(id))) return 'Those aren’t the top cards'
      pl.library.splice(pl.library.length - all.length, all.length)
      pl.library.unshift(...[...a.bottom].reverse())
      pl.library.push(...[...a.top].reverse())
      log(g, p, `${name} looks at ${all.length === 1 ? 'the top card' : `the top ${all.length} cards`}: ${a.top.length} on top, ${a.bottom.length} on the bottom`)
      return null
    }
    case 'discardRandom': {
      if (!pl.hand.length) return 'No cards in hand'
      const id = pl.hand[Math.floor(rand(g) * pl.hand.length)]
      const what = nameOf(g, g.cards[id])
      moveCard(g, id, 'graveyard')
      log(g, p, `${name} discards ${what} at random`)
      return null
    }
    case 'token':
      createToken(g, p, a.token, Math.max(1, Math.min(a.n, 50)))
      log(g, p, `${name} creates ${a.n > 1 ? `${a.n} ` : 'a '}${a.token.name} token${a.n > 1 ? 's' : ''}`)
      return null
    case 'copy': {
      const src = g.cards[a.id]
      if (src.zone !== 'battlefield' || !g.defs[src.def]) return 'Not on the battlefield'
      const c = newInst(g, src.def, p, 'removed')
      c.token = true
      moveCard(g, c.id, 'battlefield', { ctrl: p, face: src.face })
      log(g, p, `${name} creates a token copy of ${nameOf(g, src)}`)
      return null
    }
    case 'pt': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      c.mod = [c.mod[0] + a.dp, c.mod[1] + a.dt]
      const sign = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`
      log(g, p, `${nameOf(g, c)} gets ${sign(a.dp)}/${sign(a.dt)} until end of turn`)
      return null
    }
    case 'attach': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      const host = a.to != null ? g.cards[a.to] : null
      if (host && (host.zone !== 'battlefield' || host.id === c.id)) return 'Not something to attach to'
      c.attachedTo = host ? host.id : null
      log(g, p, host ? `${nameOf(g, c)} attached to ${nameOf(g, host)}` : `${nameOf(g, c)} unattached`)
      return null
    }
    case 'flip': {
      const c = g.cards[a.id]
      const def = g.defs[c.def]
      if (!def || def.faces.length < 2) return 'That card has one face'
      c.face = (c.face + 1) % def.faces.length
      log(g, p, `${name} turns over ${faceOf(g, c).name}`)
      return null
    }
    case 'faceDown': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      c.faceDown = !c.faceDown
      log(g, p, c.faceDown ? `${name} turns a permanent face down` : `${name} turns ${nameOf(g, c)} face up`)
      return null
    }
    case 'control': {
      const c = g.cards[a.id]
      if (c.zone !== 'battlefield') return 'Not on the battlefield'
      const to = other(c.ctrl)
      if (g.players[to].dummy) return 'There’s no opponent'
      const from = g.players[c.ctrl].battlefield
      from.splice(from.indexOf(c.id), 1)
      c.ctrl = to
      c.sick = true
      c.attacking = null
      c.blocking = null
      g.players[to].battlefield.push(c.id)
      log(g, p, `${g.players[to].name} takes control of ${nameOf(g, c)}`)
      return null
    }
    case 'addMana':
      pl.pool[a.color] = Math.max(0, pl.pool[a.color] + a.by)
      return null
    case 'removeStack': {
      const i = g.stack.findIndex((s) => s.sid === a.sid)
      if (i < 0) return 'It already left the stack'
      const [item] = g.stack.splice(i, 1)
      if (item.kind === 'spell' && g.cards[item.id].zone === 'stack') moveCard(g, item.id, 'graveyard')
      g.passes = 0
      log(g, p, `${item.label} is countered`)
      return null
    }
    case 'roll': {
      const n = 1 + Math.floor(rand(g) * a.sides)
      log(g, p, `${name} rolls a d${a.sides}: ${n}`)
      return null
    }
    case 'coin':
      log(g, p, `${name} flips a coin: ${rand(g) < 0.5 ? 'heads' : 'tails'}`)
      return null
  }
}

// ---- For the other phone ----

// The game as player `p` may see it: the other hand, the libraries and face-down cards hidden.
// `defs` is left out (it's sent once, and again when tokens add to it).
export function viewFor(g: Game, p: number): Game {
  const lib = g.players[p].library
  const looking = g.players[p].looking
  const seen = new Set(looking < 0 ? lib : looking > 0 ? lib.slice(-looking) : [])
  const hidden = (c: Inst) => (c.zone === 'library' && !seen.has(c.id)) || (c.zone === 'hand' && c.owner !== p) || (c.faceDown && c.ctrl !== p)
  return { ...g, defs: {}, rng: 0, cards: g.cards.map((c) => (hidden(c) ? { ...c, def: '' } : c)) }
}

// A copy for Undo: everything but the card definitions, which never change.
export function snapshot(g: Game): string {
  return JSON.stringify({ ...g, defs: undefined })
}

export function restore(json: string, defs: CardDefs): Game {
  return { ...(JSON.parse(json) as Game), defs }
}
