import type { CardFace, ScryfallCard } from '@/db/scryfall'

// Cards as the simulator plays them: a Scryfall card boiled down to what the rules engine needs
// (types, cost, power and toughness, keywords, the mana it taps for). Built once per deck.

export type Mana = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'
export const MANA: Mana[] = ['W', 'U', 'B', 'R', 'G', 'C']
const COLORS: Mana[] = ['W', 'U', 'B', 'R', 'G']

// When a land comes in tapped. 'shock': unless you pay 2 life; 'check': unless you control a land
// of one of `types`; 'fast': unless you control two or fewer other lands; 'slow': unless you
// control two or more other lands; 'maybe': some other condition the player decides.
export type EntersTapped =
  | { kind: 'never' | 'always' | 'shock' | 'fast' | 'slow' | 'maybe' }
  | { kind: 'check'; types: string[] }

// One side of a card: the whole card for most, a face of a double-faced card, a half of a split
// card, or the creature / Adventure parts of an adventure card.
export type SimFace = {
  name: string
  typeLine: string
  // 'Creature', 'Land', 'Artifact'…
  types: string[]
  subtypes: string[]
  legendary: boolean
  // "{2}{B}{B}"
  cost: string
  cmc: number
  colors: string[]
  power: number | null
  toughness: number | null
  loyalty: number | null
  defense: number | null
  text: string
  // Lowercase: 'flying', 'first strike'…
  keywords: string[]
  image: string | null
  thumb: string | null
  // Stays on the battlefield when it resolves.
  permanent: boolean
  // What "{T}: Add …" makes: one of these colors, `manaAmount` of it.
  produces: Mana[]
  manaAmount: number
  // "{T}, Sacrifice this: Add one mana of any color" (Treasure).
  sacForMana: boolean
  entersTapped: EntersTapped
  // Poison counters given with combat damage (toxic N).
  toxic: number
}

export type SimCard = {
  // Scryfall id, or "token:…" for tokens.
  id: string
  name: string
  // 'normal', 'split', 'adventure', 'modal_dfc', 'transform'…
  layout: string
  faces: SimFace[]
  identity: string[]
  token?: boolean
}

export type CardDefs = Record<string, SimCard>

const TYPES = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Kindred', 'Tribal']
const PERMANENT = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle']

// Keywords the engine acts on (combat, timing). Others stay in the text for the players.
const KEYWORDS = [
  'flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste',
  'menace', 'defender', 'indestructible', 'flash', 'hexproof', 'shroud', 'infect', 'wither', 'fear', 'intimidate',
  'shadow', 'horsemanship', 'skulk', 'ward', 'prowess',
]

// "3" -> 3; "*" and "1+*" count from 0 (the players set those with counters).
function stat(value: string | undefined) {
  if (value == null) return null
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

// Mana value of a cost: X counts 0, hybrid its larger half, each other symbol 1.
export function costValue(cost: string) {
  let total = 0
  for (const [, s] of cost.matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(s)) total += Number(s)
    else if (s === 'X' || s === 'Y' || s === 'Z') continue
    else if (s.startsWith('2/')) total += 2
    else total += 1
  }
  return total
}

function manaAbility(text: string, produced: string[] | undefined) {
  // "{T}: Add {B} or {R}.", also inside reminder text on lands with basic types.
  const plain = /(?:^|\n|\()\{T\}: Add ([^.\n]+)\./.exec(text)
  const sac = /\{T\}, Sacrifice [^:\n]*: Add one mana of any color/.test(text)
  if (!plain && !sac) return { produces: [] as Mana[], manaAmount: 1, sacForMana: false }
  const clause = plain?.[1] ?? 'one mana of any color'
  let colors = MANA.filter((c) => clause.includes(`{${c}}`))
  let amount = 1
  if (/any (one )?(color|type)|chosen color|color identity/.test(clause)) {
    // "Any color in your commander's identity" and the like: Scryfall lists what it can make.
    const listed = COLORS.filter((c) => produced?.includes(c))
    colors = listed.length ? listed : COLORS
    if (/\btwo mana\b/.test(clause)) amount = 2
    if (/\bthree mana\b/.test(clause)) amount = 3
  } else if (colors.length === 1) {
    // "{C}{C}": the same symbol repeated.
    amount = clause.split(`{${colors[0]}}`).length - 1
  } else if (!/\bor\b/.test(clause) && colors.length > 1) {
    // "{R}{G}" (both at once): played as one of them, the players add the other by hand.
    amount = 1
  }
  if (!colors.length) return { produces: [] as Mana[], manaAmount: 1, sacForMana: false }
  return { produces: colors, manaAmount: Math.max(1, amount), sacForMana: !plain && sac }
}

function entersTapped(text: string): EntersTapped {
  const m = /enters(?: the battlefield)? tapped([^.\n]*)\./i.exec(text)
  if (!m) {
    // Shock lands: "you may pay 2 life. If you don't, it enters tapped."
    return /pay 2 life\. If you don't, it enters(?: the battlefield)? tapped/i.test(text) ? { kind: 'shock' } : { kind: 'never' }
  }
  if (/pay 2 life\. If you don't, it enters/i.test(text)) return { kind: 'shock' }
  const rest = m[1].trim()
  if (!rest) return { kind: 'always' }
  if (/unless you control two or fewer other lands/i.test(rest)) return { kind: 'fast' }
  if (/unless you control two or more other lands/i.test(rest)) return { kind: 'slow' }
  const check = /unless you control an? ([A-Z][a-z]+)(?: or an? ([A-Z][a-z]+))?$/.exec(rest)
  if (check) return { kind: 'check', types: [check[1], check[2]].filter(Boolean) as string[] }
  return { kind: 'maybe' }
}

function buildFace(card: ScryfallCard, face: CardFace | null, typeLine: string): SimFace {
  const text = face?.oracle_text ?? card.oracle_text ?? ''
  const cost = face?.mana_cost ?? card.mana_cost ?? ''
  const [left, right] = typeLine.split(' — ')
  const words = left.trim().split(/\s+/)
  const types = TYPES.filter((t) => words.includes(t))
  const lower = text.toLowerCase()
  const keywords = KEYWORDS.filter((k) => (card.keywords ?? []).some((c) => c.toLowerCase() === k) && lower.includes(k))
  // Evasion and restrictions written out as sentences.
  if (/(^|\n)[^\n]*can't be blocked\.(\s|$)/.test(text) && !/can't be blocked (by|except|as long)/.test(text)) keywords.push('unblockable')
  if (/(^|\n)[^\n]* can't block\./.test(text)) keywords.push('cantblock')
  const images = face?.image_uris ?? card.image_uris ?? card.card_faces?.[0]?.image_uris
  const toxic = /\bToxic (\d+)/.exec(text)
  const permanent = types.some((t) => PERMANENT.includes(t))
  const mana = manaAbility(text, card.produced_mana)
  const name = face?.name ?? card.name
  const colors = face?.colors ?? card.colors ?? []
  return {
    name,
    typeLine,
    types,
    subtypes: right ? right.trim().split(/\s+/) : [],
    legendary: words.includes('Legendary'),
    cost,
    // A face's own value (the card's `cmc` is the front face's, or both halves of a split card).
    cmc: face ? costValue(cost) : card.cmc ?? costValue(cost),
    colors,
    power: stat(face?.power ?? card.power),
    toughness: stat(face?.toughness ?? card.toughness),
    loyalty: stat(face?.loyalty ?? card.loyalty),
    defense: stat(face?.defense ?? card.defense),
    text,
    keywords,
    image: images?.normal ?? images?.large ?? null,
    thumb: images?.small ?? images?.normal ?? null,
    permanent,
    ...mana,
    entersTapped: types.includes('Land') ? entersTapped(text) : /enters(?: the battlefield)? tapped\./i.test(text) ? { kind: 'always' } : { kind: 'never' },
    toxic: toxic ? Number(toxic[1]) : 0,
  }
}

// A Scryfall card as the simulator plays it.
export function compileCard(card: ScryfallCard): SimCard {
  const lines = (card.type_line ?? '').split(' // ')
  const faces = card.card_faces?.length
    ? card.card_faces.map((f, i) => buildFace(card, f, f.type_line ?? lines[i] ?? lines[0] ?? ''))
    : [buildFace(card, null, lines[0] ?? '')]
  return { id: card.id, name: card.name, layout: card.layout ?? 'normal', faces, identity: card.color_identity ?? [] }
}

// A card saved before the app kept full card data: its name, type line and mana value are all
// that's known, so its cost is played as generic mana.
export function compileBare(id: string, name: string, typeLine: string | null, cmc: number | null): SimCard {
  const line = (typeLine ?? '').split(' // ')[0]
  const isLand = /\bLand\b/.test(line)
  const basic = /\b(Plains|Island|Swamp|Mountain|Forest|Wastes)\b/.exec(line)?.[1]
  const color = basic ? ({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' } as Record<string, string>)[basic] : null
  const text = isLand ? `{T}: Add ${color ? `{${color}}` : 'one mana of any color'}.` : ''
  const cost = !isLand && cmc ? `{${Math.round(cmc)}}` : ''
  const card = { id, name, type_line: line, mana_cost: cost, cmc: cmc ?? 0, oracle_text: text, produced_mana: color ? [color] : undefined } as ScryfallCard
  return compileCard(card)
}

// ---- Tokens ----

export type TokenSpec = {
  name: string
  types: string
  power?: number
  toughness?: number
  colors?: string[]
  keywords?: string[]
  text?: string
}

// The tokens players make most, for the Token sheet. Any other is typed in by hand.
export const TOKENS: TokenSpec[] = [
  { name: 'Treasure', types: 'Artifact — Treasure', text: '{T}, Sacrifice this artifact: Add one mana of any color.' },
  { name: 'Food', types: 'Artifact — Food', text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' },
  { name: 'Clue', types: 'Artifact — Clue', text: '{2}, Sacrifice this artifact: Draw a card.' },
  { name: 'Blood', types: 'Artifact — Blood', text: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.' },
  { name: 'Map', types: 'Artifact — Map', text: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.' },
  { name: 'Soldier', types: 'Creature — Soldier', power: 1, toughness: 1, colors: ['W'] },
  { name: 'Spirit', types: 'Creature — Spirit', power: 1, toughness: 1, colors: ['W'], keywords: ['flying'] },
  { name: 'Human', types: 'Creature — Human', power: 1, toughness: 1, colors: ['W'] },
  { name: 'Zombie', types: 'Creature — Zombie', power: 2, toughness: 2, colors: ['B'] },
  { name: 'Goblin', types: 'Creature — Goblin', power: 1, toughness: 1, colors: ['R'] },
  { name: 'Elf Warrior', types: 'Creature — Elf Warrior', power: 1, toughness: 1, colors: ['G'] },
  { name: 'Saproling', types: 'Creature — Saproling', power: 1, toughness: 1, colors: ['G'] },
  { name: 'Beast', types: 'Creature — Beast', power: 3, toughness: 3, colors: ['G'] },
  { name: 'Thopter', types: 'Artifact Creature — Thopter', power: 1, toughness: 1, keywords: ['flying'] },
  { name: 'Construct', types: 'Artifact Creature — Construct', power: 0, toughness: 0 },
  { name: 'Angel', types: 'Creature — Angel', power: 4, toughness: 4, colors: ['W'], keywords: ['flying'] },
  { name: 'Dragon', types: 'Creature — Dragon', power: 5, toughness: 5, colors: ['R'], keywords: ['flying'] },
  { name: 'Wurm', types: 'Creature — Wurm', power: 6, toughness: 6, colors: ['G'] },
]

// A token's card id: the same token always gets the same one, so both phones agree on it.
export function tokenId(t: TokenSpec) {
  const pt = t.power != null ? `${t.power}/${t.toughness ?? t.power}` : ''
  return `token:${t.name}|${t.types}|${pt}|${(t.colors ?? []).join('')}|${(t.keywords ?? []).join(',')}`
}

export function compileToken(t: TokenSpec): SimCard {
  const keywords = (t.keywords ?? []).map((k) => k.toLowerCase())
  const text = [keywords.map((k) => k[0].toUpperCase() + k.slice(1)).join(', '), t.text ?? ''].filter(Boolean).join('\n')
  const card = {
    id: tokenId(t),
    name: t.name,
    type_line: `Token ${t.types}`,
    mana_cost: '',
    cmc: 0,
    oracle_text: text,
    power: t.power != null ? String(t.power) : undefined,
    toughness: t.power != null ? String(t.toughness ?? t.power) : undefined,
    colors: t.colors ?? [],
    keywords: t.keywords ?? [],
    produced_mana: undefined,
  } as unknown as ScryfallCard
  return { ...compileCard(card), token: true }
}

// ---- Decks ----

// A deck ready to play: its main-deck cards (each with how many copies) and its commanders.
export type SimDeck = {
  id: string
  name: string
  format: string
  cards: { def: string; n: number; commander?: boolean }[]
  defs: CardDefs
}

export const deckSize = (deck: SimDeck) => deck.cards.reduce((n, c) => n + c.n, 0)

export const isLandCard = (card: SimCard) => card.faces[0].types.includes('Land')
