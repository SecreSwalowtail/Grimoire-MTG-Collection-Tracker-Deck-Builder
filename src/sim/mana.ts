import { MANA, type Mana } from '@/sim/cards'

// Mana costs and how to pay them: which lands (and other mana sources) to tap for which color.

export type Pool = Record<Mana, number>
export const emptyPool = (): Pool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
export const poolTotal = (pool: Pool) => pool.W + pool.U + pool.B + pool.R + pool.G + pool.C

// One way to pay a symbol: mana of a color, any `generic` mana, or life (Phyrexian).
type Option = { color?: Mana; generic?: number; life?: number }

export type Cost = {
  generic: number
  // How many {X} the cost has.
  x: number
  // One entry per colored, hybrid or Phyrexian symbol: the ways to pay it.
  symbols: Option[][]
}

const isColor = (s: string): s is Mana => (MANA as string[]).includes(s)

// "{2}{B/R}{G/P}" -> what has to be paid. Snow ({S}) is paid as generic.
export function parseCost(cost: string): Cost {
  const out: Cost = { generic: 0, x: 0, symbols: [] }
  for (const [, s] of cost.split(' // ')[0].matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(s)) out.generic += Number(s)
    else if (s === 'X' || s === 'Y' || s === 'Z') out.x += 1
    else if (s === 'S') out.generic += 1
    else if (isColor(s)) out.symbols.push([{ color: s }])
    else {
      const parts = s.split('/')
      const options: Option[] = []
      for (const p of parts) {
        if (isColor(p)) options.push({ color: p })
        else if (p === 'P') options.push({ life: 2 })
        else if (/^\d+$/.test(p)) options.push({ generic: Number(p) })
      }
      // Mana of the color first, then generic ("2/W"), then life (Phyrexian).
      const rank = (o: Option) => (o.color ? 0 : o.generic != null ? 1 : 2)
      options.sort((a, b) => rank(a) - rank(b))
      if (options.length) out.symbols.push(options)
    }
  }
  return out
}

// Something that can be tapped for mana: `amount` mana of one of `colors`.
export type Source = { id: number; colors: Mana[]; amount: number }

export type Payment = {
  // Sources to tap, each for one color.
  taps: { id: number; color: Mana }[]
  // Mana taken from the pool as it will be after those taps.
  spend: Pool
  life: number
}

// How to pay `cost` (with `x` chosen for X, and `extra` generic mana on top, e.g. commander tax)
// from the mana in `pool` and by tapping `sources`. Null: it can't be paid.
// Colored symbols are matched first (to the sources with the fewest colors, so flexible lands are
// kept), then generic mana takes what's left, colorless and single-color sources first.
export function planPayment(cost: Cost, x: number, extra: number, pool: Pool, sources: Source[], life = Infinity): Payment | null {
  const have: Pool = { ...pool }
  const used = new Array<boolean>(sources.length).fill(false)
  const taps: { id: number; color: Mana }[] = []
  const spend = emptyPool()
  let lifePaid = 0
  // Least flexible first.
  const order = sources.map((_, i) => i).sort((a, b) => sources[a].colors.length - sources[b].colors.length || sources[a].amount - sources[b].amount)

  const takeColor = (c: Mana) => {
    if (have[c] > 0) {
      have[c] -= 1
      spend[c] += 1
      return () => {
        have[c] += 1
        spend[c] -= 1
      }
    }
    for (const i of order) {
      const s = sources[i]
      if (used[i] || !s.colors.includes(c)) continue
      used[i] = true
      taps.push({ id: s.id, color: c })
      have[c] += s.amount - 1
      spend[c] += 1
      return () => {
        used[i] = false
        taps.pop()
        have[c] -= s.amount - 1
        spend[c] -= 1
      }
    }
    return null
  }

  // Generic mana: from the pool first (colorless, then the color there's most of), then sources.
  const takeGeneric = (n: number) => {
    const undo: (() => void)[] = []
    for (let k = 0; k < n; k++) {
      let c: Mana | null = have.C > 0 ? 'C' : null
      if (!c) {
        let best = 0
        for (const m of MANA) {
          if (have[m] > best) {
            best = have[m]
            c = m
          }
        }
      }
      if (c) {
        const color = c
        have[color] -= 1
        spend[color] += 1
        undo.push(() => {
          have[color] += 1
          spend[color] -= 1
        })
        continue
      }
      const i = order.find((j) => !used[j])
      if (i == null) {
        undo.reverse().forEach((u) => u())
        return null
      }
      const s = sources[i]
      const color = s.colors[0]
      used[i] = true
      taps.push({ id: s.id, color })
      have[color] += s.amount - 1
      spend[color] += 1
      undo.push(() => {
        used[i] = false
        taps.pop()
        have[color] -= s.amount - 1
        spend[color] -= 1
      })
    }
    return () => undo.reverse().forEach((u) => u())
  }

  // Colored symbols first, the ones with a single way to pay before hybrids.
  const symbols = [...cost.symbols].sort((a, b) => a.length - b.length)
  const solve = (k: number, generic: number): boolean => {
    if (k === symbols.length) return takeGeneric(generic) != null
    for (const option of symbols[k]) {
      if (option.color) {
        const undo = takeColor(option.color)
        if (!undo) continue
        if (solve(k + 1, generic)) return true
        undo()
      } else if (option.generic != null) {
        if (solve(k + 1, generic + option.generic)) return true
      } else if (option.life != null && lifePaid + option.life < life) {
        lifePaid += option.life
        if (solve(k + 1, generic)) return true
        lifePaid -= option.life
      }
    }
    return false
  }

  if (!solve(0, cost.generic + cost.x * x + extra)) return null
  return { taps, spend, life: lifePaid }
}

// The most mana these sources and the pool can make in all (for "X = everything I have").
export const available = (pool: Pool, sources: Source[]) => poolTotal(pool) + sources.reduce((n, s) => n + s.amount, 0)

// "{2}{B}{B}" with X filled in and a tax added: what the player is told a spell costs.
export function costLabel(cost: string, x: number, extra: number) {
  let out = cost
  if (/\{X\}/.test(out)) out = out.replace(/\{X\}/g, `{${x}}`)
  return extra > 0 ? `${out}+{${extra}}` : out || '{0}'
}
