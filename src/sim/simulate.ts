import type { SimDeck } from '@/sim/cards'
import { rulesFor } from '@/sim/rules'
import { parseCost } from '@/sim/mana'
import { readEffects, readFetch, type SimFx } from '@/sim/sim-effects'

// Simulate: thousands of games of one deck on its own, to see how it draws. Each game shuffles,
// takes London mulligans, then for ten turns draws, plays its lands and casts what it can afford
// (the most expensive first), and attacks with its creatures.
//
// It plays what it can read of the cards (sim-effects.ts): card draw, looting, scry, land search
// and fetch lands, Treasures, rituals, tutors, tokens, burn, extra land drops, cycling, how each
// land comes in (tapped, shock, check, fast, slow), mana rocks and mana creatures. Removal and
// other cards aimed at another player do nothing here. Cards with text it can't play are named
// in the report, so you know how far to trust the numbers.
//
// Written for speed (a million games on a phone): the deck is boiled down to numbers once, and a
// game touches only small arrays.

const TURNS = 10
// W U B R G C as bits.
const BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16, C: 32 }
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C']

type Card = {
  def: string
  name: string
  land: boolean
  mv: number
  // Colored mana in its cost, per color bit (hybrid counts as its first color).
  pips: number[]
  // The mana it makes when tapped: which colors, how much. 0: it isn't a mana source.
  makes: number
  amount: number
  // Can't make mana the turn it arrives: a creature without haste, an artifact that enters tapped.
  slow: boolean
  // Lands: when it comes in tapped (0 never, 1 always, 2 shock, 3 fast, 4 slow, 5 check, 6 unknown),
  // the basic land types a check land looks for, and the ones this land has (bits, Plains first).
  tapped: number
  checks: number
  landTypes: number
  basic: boolean
  // A fetch land: what it finds.
  fetch: { types: number; basic: boolean; tapped: boolean } | null
  // A spell with a land on its other face: what that land makes.
  backLand: number
  power: number
  haste: boolean
  copies: number
  commander: boolean
  fx: SimFx
}

const TYPE_BIT: Record<string, number> = { Plains: 1, Island: 2, Swamp: 4, Mountain: 8, Forest: 16 }
const TAPPED_KIND: Record<string, number> = { never: 0, always: 1, shock: 2, fast: 3, slow: 4, check: 5, maybe: 6 }

export type SimCardRow = {
  def: string
  name: string
  mv: number
  copies: number
  commander: boolean
  // Share of games it's in the hand you keep.
  opening: number
  // Share of the times you held it on the turn equal to its mana value that you could cast it
  // then. Null: never came up (or it costs more than the game is long).
  onCurve: number | null
  // The turn it's cast on, on average, in games where it's cast. Null: never cast.
  castTurn: number | null
  // Share of the games you drew it in which you got to cast it within ten turns.
  cast: number
}

export type SimInsight = { value: string; good: boolean; text: string; tab: 'hand' | 'mana' | 'cards' }

export type SimReport = {
  deck: string
  format: string
  games: number
  size: number
  lands: number
  life: number
  freeMulligan: boolean
  // Kept 7, went to 6, went to 5 or fewer (shares).
  keep: [number, number, number]
  // Share of first hands with 0…7 lands, and of those the share that's kept.
  openingLands: number[]
  keptAt: number[]
  avgLands: number
  opener: { label: string; sub: string; value: number }[]
  screw: number
  flood: number
  // For turns 1…8: share of games with a land played every turn so far.
  drops: number[]
  colors: { color: string; sources: number; byTurn: number[] }[]
  // Share of games with every color of the deck available on turn 4.
  allColors: number | null
  // For turns 1…10: mana available, mana spent, and the share of games with a spell cast.
  available: number[]
  spent: number[]
  active: number[]
  // The most-played card of each mana value 1…6, and how often it's castable on that turn.
  curve: { name: string; def: string; mv: number; value: number }[]
  cards: SimCardRow[]
  commanders: { name: string; def: string; mv: number; castTurn: number | null; byTurn: number[] }[]
  // Cards whose text the simulation doesn't fully play, and the share of the deck's spells it does.
  unread: string[]
  read: number
  // Cards seen by turn 10, on average (the opening hand, draws and card draw spells).
  seen: number
  // For turns 1…10: share of games the creatures have dealt lethal damage to nobody's blockers
  // by then; and the average damage dealt so far.
  kill: number[]
  avgKill: number | null
  damage: number[]
  insights: SimInsight[]
}

export type Simulation = {
  // Plays games until `ms` milliseconds have passed or `target` games are done.
  step: (target: number, ms: number) => void
  games: () => number
  // A few live numbers while it runs.
  live: () => { keep7: number; avgLands: number; onCurve: number }
  report: () => SimReport
}

export function createSimulation(deck: SimDeck): Simulation {
  const rules = rulesFor(deck.format)

  // ---- The deck as numbers ----
  const cards: Card[] = []
  const library: number[] = []
  const command: number[] = []
  for (const line of deck.cards) {
    const def = deck.defs[line.def]
    if (!def) continue
    const face = def.faces[0]
    const cost = parseCost(face.cost)
    const pips = [0, 0, 0, 0, 0, 0]
    for (const symbol of cost.symbols) {
      const color = symbol.find((o) => o.color)?.color
      // Phyrexian mana can be paid with life: no color needed.
      if (color && !symbol.some((o) => o.life)) pips[COLOR_ORDER.indexOf(color)] += 1
    }
    const land = face.types.includes('Land')
    const creature = face.types.includes('Creature')
    const index = cards.length
    const back = def.faces[1]
    const rule = face.entersTapped
    cards.push({
      def: line.def,
      name: face.name,
      land,
      mv: Math.round(face.cmc),
      pips,
      makes: face.produces.reduce((mask, c) => mask | BIT[c], 0),
      amount: face.produces.length ? face.manaAmount : 0,
      slow: creature ? !face.keywords.includes('haste') : rule.kind === 'always',
      tapped: TAPPED_KIND[rule.kind],
      checks: rule.kind === 'check' ? rule.types.reduce((mask, t) => mask | (TYPE_BIT[t] ?? 0), 0) : 0,
      landTypes: land ? face.subtypes.reduce((mask, t) => mask | (TYPE_BIT[t] ?? 0), 0) : 0,
      basic: land && /\bBasic\b/.test(face.typeLine),
      fetch: land ? readFetch(face.text) : null,
      backLand: !land && def.layout === 'modal_dfc' && back?.types.includes('Land') ? back.produces.reduce((mask, c) => mask | BIT[c], 0) || 32 : 0,
      power: creature ? Math.max(0, face.power ?? 0) : 0,
      haste: face.keywords.includes('haste'),
      copies: line.n,
      commander: !!line.commander,
      fx: readEffects(face.text, face.name, face.permanent, land, face.keywords),
    })
    for (let i = 0; i < line.n; i++) (line.commander ? command : library).push(index)
  }
  const N = library.length
  const landCount = library.reduce((n, c) => n + (cards[c].land ? 1 : 0), 0)
  const landShare = N ? landCount / N : 0
  // Hands worth keeping, by lands in seven cards.
  const keepLow = landShare > 0.25 ? 2 : landShare > 0.1 ? 1 : 0
  const keepHigh = landShare > 0.5 ? 6 : 5

  // The colors the deck's costs ask for, and every group of them (for the "can these lands pay
  // for these spells" check: each group of colors needs at least as many sources as symbols).
  let used = 0
  for (const c of cards) c.pips.forEach((n, i) => (used |= n ? 1 << i : 0))
  const groups: number[] = []
  for (let s = 1; s < 64; s++) if ((s & used) === s) groups.push(s)
  const colorBits = [1, 2, 4, 8, 16, 32].filter((b) => b & used)

  // ---- Totals ----
  let games = 0
  const kept = [0, 0, 0, 0, 0, 0, 0, 0]
  const firstLands = [0, 0, 0, 0, 0, 0, 0, 0]
  const firstKept = [0, 0, 0, 0, 0, 0, 0, 0]
  let keptLands = 0
  let openerPlay = 0
  let openerSource = 0
  let openerColors = 0
  let screw = 0
  let flood = 0
  const drops = new Array<number>(TURNS + 1).fill(0)
  const colorTurn = colorBits.map(() => new Array<number>(TURNS + 1).fill(0))
  let allColors = 0
  const available = new Array<number>(TURNS + 1).fill(0)
  const spent = new Array<number>(TURNS + 1).fill(0)
  const active = new Array<number>(TURNS + 1).fill(0)
  const kill = new Array<number>(TURNS + 1).fill(0)
  const damage = new Array<number>(TURNS + 1).fill(0)
  let killSum = 0
  let kills = 0
  const C = cards.length
  const inOpening = new Array<number>(C).fill(0)
  const curveTries = new Array<number>(C).fill(0)
  const curveHits = new Array<number>(C).fill(0)
  const castSum = new Array<number>(C).fill(0)
  const castGames = new Array<number>(C).fill(0)
  const drawnGames = new Array<number>(C).fill(0)
  let seenCards = 0
  const cmdByTurn = cards.map(() => new Array<number>(TURNS + 1).fill(0))

  // ---- One game's working memory ----
  const order = library.slice()
  const hand: number[] = []
  const cover = new Array<number>(64).fill(0)
  const need = [0, 0, 0, 0, 0, 0]
  const stamp = new Array<number>(C).fill(-1)
  const castStamp = new Array<number>(C).fill(-1)
  const curveStamp = new Array<number>(C).fill(-1)
  let seed = (Date.now() ^ 0x9e3779b9) | 0 || 1

  const random = (n: number) => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) % n) | 0
  }

  function play() {
    const g = games++
    let top = 0
    // Shuffles just the cards this game can reach.
    const deal = () => {
      const reach = Math.min(N, 7 + TURNS + 8)
      for (let i = 0; i < reach; i++) {
        const j = i + random(N - i)
        const t = order[i]
        order[i] = order[j]
        order[j] = t
      }
      hand.length = 0
      top = 0
      for (let i = 0; i < 7 && top < N; i++) hand.push(order[top++])
    }
    const landsInHand = () => {
      let n = 0
      for (let i = 0; i < hand.length; i++) if (cards[hand[i]].land) n++
      return n
    }

    // ---- Mulligans (London) ----
    deal()
    const first = landsInHand()
    firstLands[first]++
    let mulligans = 0
    for (;;) {
      const size = 7 - Math.max(0, mulligans - (rules.freeMulligan ? 1 : 0))
      const lands = landsInHand()
      const keep = size <= 4 || (lands >= (size <= 5 ? Math.min(1, keepLow) : keepLow) && lands <= keepHigh)
      if (keep) {
        if (mulligans === 0) firstKept[first]++
        // Bottom the extra cards: lands when there are plenty, else the most expensive spell.
        while (hand.length > size) {
          const many = landsInHand() > Math.max(3, hand.length >> 1)
          let at = -1
          let worst = -1
          for (let i = 0; i < hand.length; i++) {
            const c = cards[hand[i]]
            const score = c.land ? (many ? 100 : -1) : c.mv
            if (score > worst) {
              worst = score
              at = i
            }
          }
          hand.splice(at < 0 ? 0 : at, 1)
        }
        kept[hand.length]++
        break
      }
      mulligans++
      deal()
    }
    keptLands += landsInHand()
    let hasPlay = false
    let hasSource = false
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i]
      const card = cards[c]
      if (stamp[c] !== g) {
        stamp[c] = g
        inOpening[c]++
        drawnGames[c]++
      }
      if (!card.land && card.mv <= 2) hasPlay = true
      if (!card.land && card.makes) hasSource = true
    }
    if (hasPlay) openerPlay++
    if (hasSource) openerSource++

    // ---- Ten turns ----
    cover.fill(0)
    let mana = 0
    let lands = 0
    let typesOut = 0
    let streak = true
    // Mana that arrives next turn (tapped lands, creatures that can't tap yet).
    let lateMask: number[] = []
    let lateAmount: number[] = []
    let ready = 0
    let fresh = 0
    let dealt = 0
    let dead = false
    // Treasures (kept until spent) and ritual mana (this turn only): mana of any color.
    let treasure = 0
    let burst = 0
    let landsPerTurn = 1
    let drawsPerTurn = 0
    let seen = hand.length
    const onDraw = (g & 1) === 1
    const addSource = (mask: number, amount: number) => {
      if (!amount) return
      mana += amount
      for (let k = 0; k < groups.length; k++) if (groups[k] & mask) cover[groups[k]] += amount
    }
    const draw = () => {
      if (top >= N) return
      const c = order[top++]
      hand.push(c)
      seen++
      if (stamp[c] !== g) {
        stamp[c] = g
        drawnGames[c]++
      }
    }
    // The card in hand the deck needs least: a land when it has plenty, else the dearest spell.
    const discard = () => {
      if (!hand.length) return
      const many = lands + landsInHand() > 6
      let at = 0
      let worst = -1
      for (let i = 0; i < hand.length; i++) {
        const c = cards[hand[i]]
        const score = c.land ? (many ? 100 : -1) : c.mv
        if (score > worst) {
          worst = score
          at = i
        }
      }
      hand.splice(at, 1)
    }
    // A land comes onto the battlefield: now, or tapped (its mana from next turn).
    const enter = (card: Card, forceTapped: boolean) => {
      let isTapped = forceTapped
      if (!isTapped) {
        if (card.tapped === 1 || card.tapped === 6) isTapped = true
        else if (card.tapped === 3) isTapped = lands > 2
        else if (card.tapped === 4) isTapped = lands < 2
        else if (card.tapped === 5) isTapped = (typesOut & card.checks) === 0
      }
      lands++
      typesOut |= card.landTypes
      if (isTapped) {
        lateMask.push(card.makes)
        lateAmount.push(card.amount)
      } else addSource(card.makes, card.amount)
    }
    // Takes a land out of the library: one of these types (0: any), a basic or not; the one that
    // adds a color the deck is missing, if there's a choice. -1: none left.
    const findLand = (types: number, basic: boolean) => {
      let found = -1
      let best = -1
      for (let i = top; i < N; i++) {
        const card = cards[order[i]]
        if (!card.land || (basic && !card.basic) || (types && !(card.landTypes & types))) continue
        let score = 0
        for (let k = 0; k < colorBits.length; k++) if (card.makes & colorBits[k] && cover[colorBits[k]] === 0) score++
        if (score > best) {
          best = score
          found = i
        }
      }
      if (found < 0) return -1
      const c = order[found]
      order[found] = order[top]
      order[top] = c
      top++
      return c
    }
    // Scry and surveil: lands go to the bottom when there are plenty, spells that are far too
    // expensive when lands are short.
    const scry = (n: number) => {
      for (let i = 0; i < n && top < N; i++) {
        const card = cards[order[top]]
        const have = lands + landsInHand()
        const unwanted = card.land ? have >= 6 : have < 3 && card.mv > have + 2
        if (!unwanted) return
        const j = top + 1 + random(Math.max(1, N - top - 1))
        if (j < N) {
          const t = order[top]
          order[top] = order[j]
          order[j] = t
        }
      }
    }
    const resolve = (fx: SimFx) => {
      for (let i = 0; i < fx.lands; i++) {
        const c = findLand(0, fx.landsBasic)
        if (c < 0) break
        if (fx.landsToHand) hand.push(c)
        else enter(cards[c], fx.landsTapped)
      }
      if (fx.tutor) {
        // The card it wants: a land when it's short of them, else the most expensive spell it
        // could cast within two turns.
        let found = -1
        let best = -1
        const short = lands + landsInHand() < 4
        for (let i = top; i < N; i++) {
          const card = cards[order[i]]
          const score = card.land ? (short ? 100 : -1) : card.mv <= lands + 2 ? card.mv : 0
          if (score > best) {
            best = score
            found = i
          }
        }
        if (found >= 0) {
          const c = order[found]
          order[found] = order[top]
          order[top] = c
          top++
          hand.push(c)
        }
      }
      if (fx.scry) scry(fx.scry)
      for (let i = 0; i < fx.draw; i++) draw()
      for (let i = 0; i < fx.discard; i++) discard()
      treasure += fx.treasure
      burst += fx.ritual
      fresh += fx.tokenPower
      dealt += fx.burn
      landsPerTurn += fx.extraLands
      drawsPerTurn += fx.drawEachTurn
    }

    let openColors = 0
    for (let i = 0; i < hand.length; i++) if (cards[hand[i]].land) openColors |= cards[hand[i]].makes
    if ((openColors & used) === used) openerColors++

    for (let turn = 1; turn <= TURNS; turn++) {
      for (let i = 0; i < lateMask.length; i++) addSource(lateMask[i], lateAmount[i])
      if (lateMask.length) {
        lateMask = []
        lateAmount = []
      }
      ready += fresh
      fresh = 0
      burst = 0
      if (turn > 1 || onDraw) draw()
      for (let i = 0; i < drawsPerTurn; i++) draw()

      let landsPlayed = 0
      need.fill(0)
      let left = 0
      let spentNow = 0
      let cast = 0
      let checkedCurve = false
      // Lands, then spells, again and again: a spell may draw a land or more spells.
      for (let round = 0; round < 40; round++) {
        let progress = false

        // The land for the turn: one that comes in untapped if that lets a spell be cast now,
        // a tapped one otherwise; among those, the one that adds a color the deck is missing.
        while (landsPlayed < landsPerTurn) {
          let pick = -1
          let best = -1
          let wantsUntapped = false
          for (let i = 0; i < hand.length; i++) {
            const c = cards[hand[i]]
            if (!c.land && c.mv === mana + 1) wantsUntapped = true
          }
          for (let i = 0; i < hand.length; i++) {
            const c = cards[hand[i]]
            // A spell with a land on its back is played as a land only when there's no other.
            if (!c.land && !(c.backLand && lands < 4)) continue
            let score = c.land ? 10 : 1
            const makes = c.land ? c.makes : c.backLand
            for (let k = 0; k < colorBits.length; k++) if (makes & colorBits[k] && cover[colorBits[k]] === 0) score += 4
            const slow = c.tapped === 1 || c.tapped === 6
            if (slow !== wantsUntapped) score += 2
            // Best of all: a land that lets a spell in hand be cast this very turn.
            if (!slow) {
              for (let j = 0; j < hand.length; j++) {
                const spell = cards[hand[j]]
                if (spell.land || spell.mv > mana + 1 || spell.mv < 1) continue
                let pays = true
                for (let b = 0; b < 6; b++) if (spell.pips[b] && !(makes & (1 << b)) && cover[1 << b] < spell.pips[b]) pays = false
                if (pays) {
                  score += 16 + spell.mv
                  break
                }
              }
            }
            if (score > best) {
              best = score
              pick = i
            }
          }
          if (pick < 0) break
          const c = cards[hand[pick]]
          hand.splice(pick, 1)
          landsPlayed++
          progress = true
          const before = mana
          if (!c.land) {
            // The land on the back of a spell: comes in tapped more often than not.
            lands++
            lateMask.push(c.backLand)
            lateAmount.push(1)
          } else if (c.fetch) {
            // Sacrificed for the land it finds.
            const found = findLand(c.fetch.types === 31 ? 0 : c.fetch.types, c.fetch.basic)
            if (found >= 0) enter(cards[found], c.fetch.tapped)
          } else enter(c, false)
          left += mana - before
        }

        if (round === 0) {
          left = mana
          if (landsPlayed < 1) streak = false
          if (streak) drops[turn]++
          for (let k = 0; k < colorBits.length; k++) if (cover[colorBits[k]] > 0) colorTurn[k][turn]++
          if (turn === 4) {
            if (lands <= 2) screw++
            let every = true
            for (let k = 0; k < colorBits.length; k++) if (cover[colorBits[k]] === 0) every = false
            if (every) allColors++
          }
          available[turn] += mana
        }

        // On curve: each card in hand whose mana value is this turn, castable right now?
        if (!checkedCurve) {
          checkedCurve = true
          for (let i = 0; i < hand.length; i++) {
            const c = hand[i]
            const card = cards[c]
            if (card.land || card.mv !== turn || curveStamp[c] === g * 16 + turn) continue
            curveStamp[c] = g * 16 + turn
            curveTries[c]++
            if (card.mv <= mana + treasure) {
              for (let k = 0; k < 6; k++) need[k] = card.pips[k]
              let lack = 0
              for (let k = 0; k < groups.length; k++) {
                const s = groups[k]
                let want = 0
                for (let b = 0; b < 6; b++) if (s & (1 << b)) want += need[b]
                if (want - cover[s] > lack) lack = want - cover[s]
              }
              if (lack <= treasure) curveHits[c]++
            }
          }
          need.fill(0)
        }

        // Cast the most expensive thing that fits (the commander too). Treasures and ritual
        // mana fill in for mana or colors the lands can't give.
        let at = -1
        let which = -1
        let cost = -1
        let wild = 0
        for (let i = 0; i < hand.length + command.length; i++) {
          const fromHand = i < hand.length
          const c = fromHand ? hand[i] : command[i - hand.length]
          const card = cards[c]
          if (card.land || card.mv > left + treasure + burst || card.mv <= cost) continue
          if (!fromHand && castStamp[c] === g) continue
          let lack = 0
          for (let k = 0; k < groups.length; k++) {
            const s = groups[k]
            let want = 0
            for (let b = 0; b < 6; b++) if (s & (1 << b)) want += need[b] + card.pips[b]
            if (want - cover[s] > lack) lack = want - cover[s]
          }
          const extra = Math.max(lack, card.mv - left)
          if (extra > treasure + burst) continue
          at = fromHand ? i : -1
          which = c
          cost = card.mv
          wild = Math.max(0, extra)
        }
        if (which >= 0) {
          const card = cards[which]
          progress = true
          if (!wild) for (let k = 0; k < 6; k++) need[k] += card.pips[k]
          const fromBurst = Math.min(burst, wild)
          burst -= fromBurst
          treasure -= wild - fromBurst
          left -= card.mv - wild
          spentNow += card.mv
          cast++
          if (at >= 0) hand.splice(at, 1)
          if (castStamp[which] !== g) {
            castStamp[which] = g
            castSum[which] += turn
            castGames[which]++
            if (card.commander) for (let t = turn; t <= TURNS; t++) cmdByTurn[which][t]++
          }
          if (card.makes && !card.land) {
            if (card.slow) {
              lateMask.push(card.makes)
              lateAmount.push(card.amount)
            } else {
              // A mana rock taps the turn it arrives.
              addSource(card.makes, card.amount)
              left += card.amount
            }
          }
          if (card.power) {
            if (card.haste) ready += card.power * card.fx.strikes
            else fresh += card.power * card.fx.strikes
          }
          resolve(card.fx)
        } else if (left + treasure > 0) {
          // Nothing to cast: cycle a card that's stuck in hand.
          for (let i = 0; i < hand.length; i++) {
            const card = cards[hand[i]]
            if (card.fx.cycling < 0 || card.fx.cycling > left || (!card.land && card.mv <= lands + 1)) continue
            left -= card.fx.cycling
            spentNow += card.fx.cycling
            hand.splice(i, 1)
            draw()
            progress = true
            break
          }
        }
        if (!progress || cast > 30) break
      }
      if (turn === 6 && lands + landsInHand() >= 7) flood++
      spent[turn] += Math.min(spentNow, mana + 12)
      if (cast) active[turn]++

      dealt += ready
      damage[turn] += dealt
      if (!dead && dealt >= rules.life) {
        dead = true
        killSum += turn
        kills++
        for (let t = turn; t <= TURNS; t++) kill[t]++
      }
      // Hand size.
      while (hand.length > 7) discard()
    }
    seenCards += seen
  }

  const share = (n: number, of: number) => (of ? n / of : 0)

  function report(): SimReport {
    const keep7 = share(kept[7], games)
    const keep6 = share(kept[6], games)
    const rows: SimCardRow[] = cards
      .filter((c) => !c.land)
      .map((c) => {
        const i = cards.indexOf(c)
        return {
          def: c.def,
          name: c.name,
          mv: c.mv,
          copies: c.copies,
          commander: c.commander,
          opening: share(inOpening[i], games),
          onCurve: curveTries[i] >= 20 ? curveHits[i] / curveTries[i] : null,
          castTurn: castGames[i] ? castSum[i] / castGames[i] : null,
          cast: c.commander ? share(castGames[i], games) : share(castGames[i], drawnGames[i]),
        }
      })
    // The card with the most copies at each mana value (and enough tries to say something).
    const curve: SimReport['curve'] = []
    for (let mv = 1; mv <= 6; mv++) {
      const at = rows.filter((r) => r.mv === mv && r.onCurve != null && !r.commander).sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name))[0]
      if (at) curve.push({ name: at.name, def: at.def, mv, value: at.onCurve ?? 0 })
    }
    const colors = colorBits.map((bit, k) => ({
      color: COLOR_ORDER[Math.log2(bit)],
      sources: cards.reduce((n, c) => n + (c.makes & bit && (c.land || c.makes) ? c.copies : 0), 0),
      byTurn: colorTurn[k].slice(1, 7).map((n) => share(n, games)),
    }))
    const screwRate = share(screw, games)
    const floodRate = share(flood, games)
    const pct = (v: number) => `${Math.round(v * 100)}%`

    const insights: SimInsight[] = []
    insights.push({
      value: pct(keep7),
      good: keep7 >= 0.8,
      tab: 'hand',
      text: keep7 >= 0.8 ? 'of your first hands are keepable: the land count is about right.' : `of your first hands are keepable. With ${landCount} lands in ${N} cards, you mulligan a lot.`,
    })
    if (screwRate > 0.15 || floodRate > 0.2) {
      const worse = screwRate / 0.15 >= floodRate / 0.2
      insights.push({
        value: pct(worse ? screwRate : floodRate),
        good: false,
        tab: 'mana',
        text: worse ? 'of games you’re stuck on two lands or fewer on turn 4. A land or two more would help.' : 'of games you have seven or more lands by turn 6. You could cut a land or two.',
      })
    } else {
      insights.push({ value: pct(share(drops[4], games)), good: true, tab: 'mana', text: 'of games you play a land on each of your first four turns.' })
    }
    const weakColor = colors.filter((c) => c.color !== 'C').sort((a, b) => a.byTurn[2] - b.byTurn[2])[0]
    if (weakColor && colors.length > 1 && weakColor.byTurn[2] < 0.85) {
      insights.push({ value: pct(1 - weakColor.byTurn[2]), good: false, tab: 'mana', text: `of games you have no {${weakColor.color}} on turn 3: only ${weakColor.sources} of your cards make it.` })
    }
    const stuck = rows.filter((r) => r.onCurve != null && r.copies >= 2 && r.mv <= 6).sort((a, b) => (a.onCurve ?? 1) - (b.onCurve ?? 1))[0]
    if (stuck && (stuck.onCurve ?? 1) < 0.6) {
      insights.push({ value: pct(stuck.onCurve ?? 0), good: false, tab: 'cards', text: `is how often ${stuck.name} can be cast on turn ${stuck.mv} when you hold it: the hardest card to cast on time.` })
    }

    return {
      deck: deck.name,
      format: deck.format,
      games,
      size: N,
      lands: landCount,
      life: rules.life,
      freeMulligan: rules.freeMulligan,
      keep: [keep7, keep6, Math.max(0, 1 - keep7 - keep6)],
      openingLands: firstLands.map((n) => share(n, games)),
      keptAt: firstLands.map((n, i) => share(firstKept[i], n)),
      avgLands: share(keptLands, games),
      opener: [
        { label: 'Something to cast by turn 2', sub: `A spell of mana value 2 or less · ${cards.reduce((n, c) => n + (!c.land && !c.commander && c.mv <= 2 ? c.copies : 0), 0)} in the deck`, value: share(openerPlay, games) },
        ...(cards.some((c) => !c.land && c.makes) ? [{ label: 'A mana rock or mana creature', sub: `${cards.reduce((n, c) => n + (!c.land && c.makes ? c.copies : 0), 0)} in the deck`, value: share(openerSource, games) }] : []),
        ...(colorBits.length > 1 ? [{ label: 'Lands for every color you play', sub: 'Among the lands in the hand you keep', value: share(openerColors, games) }] : []),
      ],
      screw: screwRate,
      flood: floodRate,
      drops: drops.slice(1, 9).map((n) => share(n, games)),
      colors,
      allColors: colorBits.length > 1 ? share(allColors, games) : null,
      available: available.slice(1).map((n) => share(n, games)),
      spent: spent.slice(1).map((n) => share(n, games)),
      active: active.slice(1).map((n) => share(n, games)),
      curve,
      cards: rows,
      unread: cards.filter((c) => !c.fx.read).map((c) => c.name),
      read: share(cards.reduce((n, c) => n + (c.fx.read ? c.copies : 0), 0), cards.reduce((n, c) => n + c.copies, 0)),
      seen: share(seenCards, games),
      commanders: cards.filter((c) => c.commander).map((c) => {
        const i = cards.indexOf(c)
        return { name: c.name, def: c.def, mv: c.mv, castTurn: castGames[i] ? castSum[i] / castGames[i] : null, byTurn: cmdByTurn[i].slice(1).map((n) => share(n, games)) }
      }),
      kill: kill.slice(1).map((n) => share(n, games)),
      avgKill: kills ? killSum / kills : null,
      damage: damage.slice(1).map((n) => share(n, games)),
      insights,
    }
  }

  return {
    step(target, ms) {
      if (N < 7) {
        games = target
        return
      }
      const until = Date.now() + ms
      while (games < target) {
        for (let i = 0; i < 200 && games < target; i++) play()
        if (Date.now() >= until) break
      }
    },
    games: () => games,
    live: () => {
      let tries = 0
      let hits = 0
      for (let i = 0; i < C; i++) {
        tries += curveTries[i]
        hits += curveHits[i]
      }
      return { keep7: share(kept[7], games), avgLands: share(keptLands, games), onCurve: share(hits, tries) }
    },
    report,
  }
}
