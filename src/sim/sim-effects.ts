// What the simulation plays out of a card's rules text. A card is read line by line; every line
// has to be something the simulation plays, or something that does nothing when a deck plays
// alone (removal, counterspells, combat tricks), for the card to count as fully read. The rest
// (cost reducers, alternative costs, triggers the simulation doesn't follow) is listed in the
// statistics as "not fully played", so you know how far to trust the numbers.

export type SimFx = {
  // Cards drawn when it resolves or enters, and cards discarded after.
  draw: number
  discard: number
  // Look at this many and send the unwanted ones to the bottom (scry, surveil).
  scry: number
  // Lands fetched from the library: how many, onto the battlefield tapped or not, or to the hand.
  lands: number
  landsTapped: boolean
  landsToHand: boolean
  landsBasic: boolean
  // Treasures made, and mana added for this turn only (rituals).
  treasure: number
  ritual: number
  // Puts a card of your choice from the library into your hand.
  tutor: boolean
  // Total power of the creature tokens it makes.
  tokenPower: number
  // Damage or life loss it deals to the other player.
  burn: number
  // While it's on the battlefield: extra land drops each turn, extra cards each turn.
  extraLands: number
  drawEachTurn: number
  // "Cycling {2}": the mana to pay to swap it for a new card. -1: none.
  cycling: number
  // Deals its power twice (double strike) or not at all (defender, "can't attack").
  strikes: number
  // Every line of its text is played (or doesn't matter in a game alone).
  read: boolean
}

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const num = (s: string) => WORDS[s] ?? (Number.isFinite(Number(s)) ? Number(s) : 1)
const N = '(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)'
const LAND_TYPES = 'plains|island|swamp|mountain|forest'

// Keywords that change nothing for a deck playing alone, or that the simulation handles itself.
const PLAIN_KEYWORDS = new Set([
  'flying', 'reach', 'first strike', 'double strike', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'menace',
  'defender', 'indestructible', 'flash', 'hexproof', 'shroud', 'fear', 'intimidate', 'shadow', 'horsemanship', 'skulk',
  'prowess', 'infect', 'wither', 'protection', 'ward', 'toxic', 'flanking', 'banding', 'changeling', 'devoid', 'enchant',
  'equip', 'landwalk', 'islandwalk', 'swampwalk', 'forestwalk', 'mountainwalk', 'plainswalk', 'cycling', 'scry', 'surveil',
  'mill', 'fight', 'goad', 'exalted', 'bushido', 'unblockable', 'partner', 'treasure', 'food', 'role token',
])

// Effects that only matter with another player at the table: read, nothing to play.
const INTERACTION = new RegExp(
  '^(' +
    [
      'destroy (target|all|each|up to)', 'exile (target|all|each|up to)', 'counter target', 'return target [^.]* to (its|their) owner',
      'target creature (gets|gains|can\'t|doesn\'t|fights)', 'target (creature|permanent|artifact|land) (you control )?(gets|gains|becomes|doesn\'t)',
      'tap (target|up to|all)', 'untap (target|up to|all)', '~ deals \\w+ damage to (target|each|all) (creature|attacking|blocking|planeswalker)',
      '~ fights', 'target (player|opponent) (discards|sacrifices|reveals|mills)', 'each (opponent|player) (discards|sacrifices|mills)',
      'creatures you control (get|gain)', 'prevent ', 'you gain \\w+ life', 'gain control of target', 'target creature you control (gets|gains|fights)',
      'put (a|\\w+) \\+1/\\+1 counters? on', 'regenerate', 'detain', 'goad', 'this spell can\'t be countered', '~ can\'t be countered',
      'until end of turn', 'it gains', 'they gain', 'you may have', 'activate only',
    ].join('|') +
    ')',
)

function empty(): SimFx {
  return {
    draw: 0, discard: 0, scry: 0, lands: 0, landsTapped: false, landsToHand: false, landsBasic: false, treasure: 0, ritual: 0,
    tutor: false, tokenPower: 0, burn: 0, extraLands: 0, drawEachTurn: 0, cycling: -1, strikes: 1, read: true,
  }
}

// One sentence of an effect. False: not something the simulation plays.
function sentence(raw: string, fx: SimFx, spell: boolean): boolean {
  const s = raw.trim().replace(/\.$/, '').toLowerCase()
  if (!s) return true
  let m: RegExpExecArray | null
  if ((m = new RegExp(`^(?:you )?draws? ${N} cards?(?:, then discard ${N} cards?)?$`).exec(s)) || (m = new RegExp(`^target player draws ${N} cards?()$`).exec(s))) {
    fx.draw += num(m[1])
    if (m[2]) fx.discard += num(m[2])
    return true
  }
  if ((m = new RegExp(`^discard ${N} cards?$`).exec(s))) {
    fx.discard += num(m[1])
    return true
  }
  if ((m = new RegExp(`^(?:scry|surveil) ${N}$`).exec(s))) {
    fx.scry += num(m[1])
    return true
  }
  if ((m = new RegExp(`^search your library for (an?|up to two|two|up to three|three) (basic land|basic|land|(?:basic )?(?:${LAND_TYPES})(?:(?:,| or|, or) (?:${LAND_TYPES}))*) cards?,? (?:and )?(?:reveal (?:it|them|that card|those cards),? )?(?:and )?put (?:it|them|that card|those cards|one) (onto the battlefield( tapped)?|into your hand)`).exec(s))) {
    fx.lands += m[1].includes('three') ? 3 : m[1].includes('two') ? 2 : 1
    fx.landsBasic = m[2].startsWith('basic')
    fx.landsToHand = m[3].startsWith('into')
    fx.landsTapped = !!m[4]
    return true
  }
  if ((m = new RegExp(`^create ${N} treasure tokens?$`).exec(s))) {
    fx.treasure += num(m[1])
    return true
  }
  if (spell && (m = /^add ((?:\{[wubrgc]\})+)$/.exec(s))) {
    fx.ritual += m[1].split('}').length - 1
    return true
  }
  if (/^search your library for an? [^.]*card[^.]*put (it|that card) into your hand/.test(s)) {
    fx.tutor = true
    return true
  }
  if ((m = new RegExp(`^create ${N} (\\d+)/\\d+ [^.]*creature tokens?`).exec(s))) {
    fx.tokenPower += num(m[1]) * Number(m[2])
    return true
  }
  if ((m = new RegExp(`^~ deals ${N} damage to (any target|target player|target opponent|each opponent|target player or planeswalker|target creature or player|any one target)`).exec(s))) {
    fx.burn += num(m[1])
    return true
  }
  if ((m = new RegExp(`^(?:each opponent|target opponent|target player) loses ${N} life`).exec(s))) {
    fx.burn += num(m[1])
    return true
  }
  if (/^(then )?shuffle/.test(s)) return true
  return INTERACTION.test(s)
}

function effect(text: string, fx: SimFx, spell: boolean) {
  let all = true
  for (const part of text.split(/\.\s+|, then (?=shuffle|draw|discard|scry|surveil)| and (?=you gain|you draw|draw|create|each opponent|scry)/)) {
    if (!sentence(part, fx, spell)) all = false
  }
  return all
}

// Reads one face of a card. `name` is replaced by "~" in the text; `keywords` are Scryfall's.
export function readEffects(text: string, name: string, permanent: boolean, land: boolean, keywords: string[]): SimFx {
  const fx = empty()
  const lower = keywords.map((k) => k.toLowerCase())
  if (lower.includes('double strike')) fx.strikes = 2
  if (lower.includes('defender')) fx.strikes = 0
  const short = name.split(',')[0]
  const clean = text
    .replace(/\([^)]*\)/g, '')
    .split(name).join('~')
    .split(short).join('~')
    .replace(/\bthis (creature|artifact|enchantment|land|permanent|spell|aura|equipment|vehicle|saga|planeswalker)\b/gi, '~')
    .replace(/\bit deals\b/gi, '~ deals')
  for (const raw of clean.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const low = line.toLowerCase()
    // "Flying, vigilance", "Ward {2}", "Protection from red": keyword lines.
    const words = low.split(/[,;]\s*/).map((k) => k.replace(/\s*(\{[^}]+\})+$/, '').replace(/ \d+$/, '').replace(/^protection from .*/, 'protection').replace(/^enchant .*/, 'enchant').trim())
    const cycling = /^cycling ((?:\{[^}]+\})+)$/.exec(low)
    if (cycling) {
      fx.cycling = [...cycling[1].matchAll(/\{([^}]+)\}/g)].reduce((n, [, sym]) => n + (/^\d+$/.test(sym) ? Number(sym) : 1), 0)
      continue
    }
    if (words.every((k) => PLAIN_KEYWORDS.has(k))) continue
    // Mana abilities and how a land comes in are handled by the simulation itself.
    if (/^\{t\}(, pay \d+ life)?: add [^.]+\.( ~ deals 1 damage to you\.)?$/.test(low)) continue
    if (/^\{t\}, sacrifice ~: add one mana of any color\.$/.test(low)) continue
    if (/enters(?: the battlefield)? tapped/.test(low) || /^as ~ enters, you may pay 2 life/.test(low)) continue
    if (land && /sacrifice ~: search your library for/.test(low)) continue
    if (/^~ can't (block|be blocked)/.test(low)) continue
    if (/^~ can't attack/.test(low) && !/unless/.test(low)) {
      fx.strikes = 0
      continue
    }
    if (/^you may play an additional land on each of your turns\.?$/.test(low)) {
      fx.extraLands += 1
      continue
    }
    if (/^you may play two additional lands on each of your turns\.?$/.test(low)) {
      fx.extraLands += 2
      continue
    }
    if (/^at the beginning of your (upkeep|draw step|end step|precombat main phase), (you )?draw a card( and (you )?lose \d+ life)?\.?$/.test(low) || /^at the beginning of your draw step, draw an additional card\.?$/.test(low)) {
      fx.drawEachTurn += 1
      continue
    }
    if (/^(enchanted|equipped) creature (gets|has|gains)/.test(low)) continue
    if (permanent) {
      const enters = /^when(?:ever)? ~ enters(?: the battlefield)?,? (?:you may )?(.+)$/i.exec(line)
      if (enters) {
        if (!effect(enters[1], fx, false)) fx.read = false
        continue
      }
      // Abilities that only do something to another player's board.
      if (/^(\{[^}]+\},? ?)+: /.test(low) && INTERACTION.test(low.replace(/^[^:]+: /, ''))) continue
      fx.read = false
      continue
    }
    if (!effect(line, fx, true)) fx.read = false
  }
  return fx
}

// A land that fetches another when sacrificed ("Search your library for a Forest or Plains card,
// put it onto the battlefield"): which basic land types it finds (bits, Plains first; 31: any),
// basics only or not, and whether the land found comes in tapped. Null: not a fetch land.
export function readFetch(text: string): { types: number; basic: boolean; tapped: boolean } | null {
  const m = new RegExp(`sacrifice [^:]*: search your library for an? (basic land|(?:basic )?(?:${LAND_TYPES})(?:(?:,| or|, or) (?:${LAND_TYPES}))*) card,? (?:and )?put it onto the battlefield( tapped)?`, 'i').exec(text.replace(/\([^)]*\)/g, ''))
  if (!m) return null
  const what = m[1].toLowerCase()
  let types = 0
  LAND_TYPES.split('|').forEach((t, i) => {
    if (what.includes(t)) types |= 1 << i
  })
  return { types: types || 31, basic: what.startsWith('basic'), tapped: !!m[2] }
}
