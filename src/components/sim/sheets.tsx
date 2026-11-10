import { Image } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { PrimaryButton } from '@/components/controls'
import { ActionSheet, I, type SheetGroup, type SheetItem } from '@/components/sim/parts'
import { Colors, Fonts } from '@/constants/theme'
import { MANA, TOKENS, type Mana, type SimFace, type TokenSpec } from '@/sim/cards'
import { STEP_NAME, canTapForMana, faceOf, isType, type Action, type Game, type Inst, type Step, type Zone } from '@/sim/engine'
import { available, costLabel, parseCost } from '@/sim/mana'
import { manaSources } from '@/sim/engine'
import type { Prefs } from '@/sim/session'

// The Play screen's sheets: tools, tokens, a zone's cards, one card and everything that can be
// done with it, the stack, the log. Each is a list of actions (see ActionSheet).

export type TableSheet =
  | { t: 'tools' }
  | { t: 'stops' }
  | { t: 'tokens' }
  | { t: 'log' }
  | { t: 'stack' }
  | { t: 'addMana' }
  | { t: 'cmdDamage' }
  | { t: 'leave' }
  | { t: 'zone'; owner: number; zone: 'graveyard' | 'exile' | 'command' | 'library' }
  | { t: 'cast'; id: number; face: number }
  | { t: 'mana'; id: number }
  | { t: 'scry'; n: number }

const MANA_NAME: Record<Mana, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' }

const ZONE_TITLE = { graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone', library: 'Search library' }

// A card's abilities that go on the stack, read from its text: "cost: effect" lines, keyword
// abilities with a cost, and a planeswalker's loyalty abilities.
type Ability = { label: string; text: string; tap: boolean; cost: string; loyalty: number | null }

const COST_KEYWORDS = /^(Equip|Cycling|Crew|Flashback|Unearth|Ninjutsu|Level up|Morph|Outlast|Reinforce|Channel|Boast|Embalm|Eternalize|Scavenge|Transmute|Fortify|Reconfigure|Adapt|Monstrosity|Encore|Disturb|Plot|Warp|Station|Harmonize)\b/

function abilitiesOf(face: SimFace): Ability[] {
  const out: Ability[] = []
  for (const raw of face.text.split('\n')) {
    const line = raw.replace(/\([^)]*\)/g, '').trim()
    if (!line) continue
    const loyal = /^([+−-]?\d+): (.+)$/.exec(line)
    if (loyal) {
      out.push({ label: loyal[1], text: loyal[2], tap: false, cost: '', loyalty: Number(loyal[1].replace('−', '-')) })
      continue
    }
    const colon = /^([^:"“]+): (.+)$/.exec(line)
    const keyword = COST_KEYWORDS.test(line)
    if (!colon && !keyword) continue
    const costPart = colon ? colon[1] : line
    // "{T}: Add {G}" is done by tapping the card.
    if (colon && /^\{T\}$/.test(costPart.trim()) && /^Add /.test(colon[2]) && face.produces.length) continue
    const mana = [...costPart.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).filter((s) => !['T', 'Q', 'E'].includes(s))
    out.push({
      label: colon ? costPart.trim() : line,
      text: colon ? colon[2] : '',
      tap: /\{T\}/.test(costPart),
      cost: mana.map((s) => `{${s}}`).join(''),
      loyalty: null,
    })
  }
  return out
}

export function TableSheets({
  g,
  me,
  solo,
  canHost,
  sheet,
  setSheet,
  act,
  prefs,
  onPrefs,
  onCard,
  onSwitch,
  onNewGame,
  onLeave,
}: {
  g: Game
  me: number
  solo: boolean
  // This phone runs the game (solo or host): it can start a new one.
  canHost: boolean
  sheet: TableSheet | null
  setSheet: (sheet: TableSheet | null) => void
  act: (a: Action) => void
  prefs: Prefs
  onPrefs: (prefs: Prefs) => void
  // Holds a card up close (the Play screen's pop-out), from a list.
  onCard: (id: number) => void
  onSwitch: () => void
  onNewGame: () => void
  onLeave: () => void
}) {
  // What each looked-at card will do (Scry sheet), and the custom token being typed.
  const [fate, setFate] = useState<Record<number, 'top' | 'bottom' | 'graveyard'>>({})
  const [tokenName, setTokenName] = useState('')
  const [tokenStats, setTokenStats] = useState('')
  const [query, setQuery] = useState('')
  let search: { value: string; onChange: (text: string) => void; placeholder: string } | undefined

  const pl = g.players[me]
  const opp = g.players[1 - me]
  const close = () => {
    // Stop looking at the library.
    if (sheet && (sheet.t === 'scry' || (sheet.t === 'zone' && sheet.zone === 'library')) && pl.looking) act({ t: 'look', n: 0 })
    setFate({})
    setQuery('')
    setSheet(null)
  }
  const item = (key: string, label: string, icon: string, run: () => void, more: Partial<SheetItem> = {}): SheetItem => ({ key, label, icon, run, ...more })

  let title = ''
  let hint: string | undefined
  let groups: SheetGroup[] = []
  let header: React.ReactNode = null
  let footer: React.ReactNode = null
  let tall = false
  let onBack: (() => void) | undefined

  if (!sheet) {
    // Nothing open.
  } else if (sheet.t === 'tools') {
    title = 'Tools'
    groups = [
      {
        title: `Library · ${pl.library.length}`,
        cols: 2,
        items: [
          item('draw', 'Draw a card', I.plus, () => act({ t: 'draw', n: 1 })),
          item('shuffle', 'Shuffle', I.shuffle, () => act({ t: 'shuffle' })),
          ...[1, 2, 3, 5].map((n) =>
            item(`look${n}`, `Look at top ${n}`, I.eye, () => {
              act({ t: 'look', n })
              setSheet({ t: 'scry', n })
            }, { keepOpen: true, sub: n === 1 ? 'Scry, surveil' : undefined }),
          ),
          item('mill', 'Mill 1', I.mill, () => act({ t: 'mill', n: 1 })),
          item('search', 'Search', I.search, () => {
            act({ t: 'look', n: -1 })
            setSheet({ t: 'zone', owner: me, zone: 'library' })
          }, { keepOpen: true }),
        ],
      },
      {
        title: 'You',
        cols: 2,
        items: [
          item('untap', 'Untap all', I.tap, () => act({ t: 'untapAll' })),
          item('mana', 'Add mana', I.bolt, () => setSheet({ t: 'addMana' }), { keepOpen: true }),
          item('poison+', 'Poison +1', I.plus, () => act({ t: 'poison', p: me, by: 1 }), { keepOpen: true, sub: `${pl.poison} now` }),
          item('poison-', 'Poison −1', I.minus, () => act({ t: 'poison', p: me, by: -1 }), { keepOpen: true }),
          item('discard', 'Discard at random', I.graveyard, () => act({ t: 'discardRandom' })),
          ...(g.cmdLethal ? [item('cmd', 'Commander damage', I.crown, () => setSheet({ t: 'cmdDamage' }), { keepOpen: true })] : []),
        ],
      },
      {
        title: 'Random',
        cols: 2,
        items: [
          item('d20', 'Roll d20', I.dice, () => act({ t: 'roll', sides: 20 })),
          item('d6', 'Roll d6', I.dice, () => act({ t: 'roll', sides: 6 })),
          item('coin', 'Flip a coin', I.coin, () => act({ t: 'coin' })),
        ],
      },
      {
        title: 'Game',
        cols: 2,
        items: [
          item('stops', 'Stops', I.flag, () => setSheet({ t: 'stops' }), { keepOpen: true, sub: 'When the game waits for you' }),
          item('log', 'Game log', I.list, () => setSheet({ t: 'log' }), { keepOpen: true }),
          ...(solo && !opp.dummy ? [item('switch', 'Switch sides', I.swap, onSwitch, { sub: `Play as ${opp.name}` })] : []),
          ...(canHost ? [item('new', 'New game', I.reset, onNewGame, { sub: 'Shuffle up and deal 7' })] : []),
          item('concede', 'Concede', I.flag, () => act({ t: 'concede' }), { danger: true }),
          item('leave', 'Leave', I.close, () => setSheet({ t: 'leave' }), { keepOpen: true, danger: true }),
        ],
      },
    ]
  } else if (sheet.t === 'stops') {
    title = 'Stops'
    hint = 'The game stops for you in your main phases, to attack and block, and when the other player casts something. Add stops for the moments you want to act in; everywhere else it moves on by itself.'
    onBack = () => setSheet({ t: 'tools' })
    const toggle = (key: 'mine' | 'theirs', step: Step) => {
      const has = prefs[key].includes(step)
      onPrefs({ ...prefs, [key]: has ? prefs[key].filter((s) => s !== step) : [...prefs[key], step] })
    }
    const stop = (key: 'mine' | 'theirs', step: Step, label = STEP_NAME[step]) =>
      item(`${key}${step}`, label, I.flag, () => toggle(key, step), { on: prefs[key].includes(step), keepOpen: true })
    groups = [
      { cols: 1, items: [item('full', 'Stop every time', I.flag, () => onPrefs({ ...prefs, fullControl: !prefs.fullControl }), { on: prefs.fullControl, keepOpen: true, sub: 'Every step, and after your own spells (to cast another in response)' })] },
      { title: 'On your turn', cols: 2, items: [stop('mine', 'upkeep'), stop('mine', 'draw'), stop('mine', 'beginCombat'), stop('mine', 'attackers', 'After attackers'), stop('mine', 'blockers', 'After blockers'), stop('mine', 'end')] },
      { title: 'On their turn', cols: 2, items: [stop('theirs', 'upkeep'), stop('theirs', 'draw'), stop('theirs', 'beginCombat'), stop('theirs', 'attackers', 'After attackers'), stop('theirs', 'blockers', 'After blockers'), stop('theirs', 'end')] },
    ]
  } else if (sheet.t === 'addMana') {
    title = 'Add mana'
    hint = 'For mana a card’s text gives you. It empties at the end of the step, like any mana.'
    onBack = () => setSheet({ t: 'tools' })
    groups = [{ cols: 2, items: MANA.map((m) => ({ key: m, label: MANA_NAME[m], mana: m, sub: `${pl.pool[m]} in pool`, keepOpen: true, run: () => act({ t: 'addMana', color: m, by: 1 }) })) }]
  } else if (sheet.t === 'cmdDamage') {
    title = 'Commander damage'
    hint = `Combat damage from commanders is counted by itself. ${g.cmdLethal} from one commander loses the game.`
    onBack = () => setSheet({ t: 'tools' })
    const commanders = g.cards.filter((c) => c.commander)
    groups = g.players.filter((p) => !p.dummy).map((p, i) => ({
      title: `Dealt to ${p.name}`,
      cols: 2 as const,
      items: commanders
        .filter((c) => c.owner !== i)
        .flatMap((c) => [
          item(`${i}+${c.id}`, `${faceOf(g, c).name} +1`, I.plus, () => act({ t: 'cmdDamage', p: i, id: c.id, by: 1 }), { keepOpen: true, sub: `${p.cmdDamage[c.id] ?? 0} so far` }),
          item(`${i}-${c.id}`, `${faceOf(g, c).name} −1`, I.minus, () => act({ t: 'cmdDamage', p: i, id: c.id, by: -1 }), { keepOpen: true }),
        ]),
    }))
  } else if (sheet.t === 'leave') {
    title = 'Leave the game?'
    hint = solo ? 'The game isn’t saved.' : 'The other player is told you left. The game isn’t saved.'
    groups = [{ cols: 2, items: [item('stay', 'Keep playing', I.play, () => undefined), item('go', 'Leave', I.close, onLeave, { danger: true })] }]
  } else if (sheet.t === 'tokens') {
    title = 'Add a token'
    const make = (token: TokenSpec) => act({ t: 'token', token, n: 1 })
    const stats = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(tokenStats)
    const custom: TokenSpec | null = tokenName.trim()
      ? stats
        ? { name: tokenName.trim(), types: `Creature — ${tokenName.trim()}`, power: Number(stats[1]), toughness: Number(stats[2]) }
        : { name: tokenName.trim(), types: `Artifact — ${tokenName.trim()}` }
      : null
    header = (
      <View style={styles.custom}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={tokenName}
          onChangeText={setTokenName}
          placeholder="Any other token: its name"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Token name"
          maxLength={40}
        />
        <TextInput
          style={[styles.input, { width: 72 }]}
          value={tokenStats}
          onChangeText={setTokenStats}
          placeholder="2/2"
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel="Power and toughness, like 2/2. Empty for a token that isn’t a creature"
          maxLength={7}
        />
        <TouchableOpacity
          style={[styles.create, !custom && { opacity: 0.4 }]}
          disabled={!custom}
          onPress={() => custom && make(custom)}
          accessibilityRole="button"
        >
          <Text style={styles.createLabel}>Create</Text>
        </TouchableOpacity>
      </View>
    )
    groups = [{
      cols: 2,
      items: TOKENS.map((t) => ({
        key: t.name,
        label: t.power != null ? `${t.name} ${t.power}/${t.toughness}` : t.name,
        sub: [t.types.split(' — ')[0], ...(t.keywords ?? [])].join(' · '),
        icon: I.token,
        keepOpen: true,
        run: () => make(t),
      })),
    }]
    tall = true
  } else if (sheet.t === 'log') {
    title = 'Game log'
    onBack = () => setSheet({ t: 'tools' })
    tall = true
    header = (
      <View style={styles.log}>
        {[...g.log].reverse().map((line) => (
          <Text key={line.n} style={[styles.logLine, line.text.startsWith('Turn ') && styles.logTurn]}>{line.text}</Text>
        ))}
      </View>
    )
  } else if (sheet.t === 'stack') {
    title = 'The stack'
    hint = g.stack.length ? 'The top one resolves first. Pass priority to let it resolve, or cast something in response.' : 'Nothing on the stack.'
    groups = [{
      cols: 1,
      items: [...g.stack].reverse().map((s, i) => {
        const c = g.cards[s.id]
        const face = g.defs[c.def]?.faces[s.face]
        return {
          key: String(s.sid),
          label: s.label,
          sub: `${g.players[s.ctrl].name}${i === 0 ? ' · resolves next' : ''} · tap to counter it`,
          art: face?.thumb ?? null,
          run: () => act({ t: 'removeStack', sid: s.sid }),
        }
      }),
    }]
  } else if (sheet.t === 'zone') {
    const owner = g.players[sheet.owner]
    const mine = sheet.owner === me
    title = sheet.zone === 'library' ? 'Search library' : `${mine ? 'Your' : `${owner.name}’s`} ${ZONE_TITLE[sheet.zone].toLowerCase()}`
    tall = true
    const ids = sheet.zone === 'library'
      ? [...owner.library].sort((a, b) => faceOf(g, g.cards[a]).name.localeCompare(faceOf(g, g.cards[b]).name))
      : [...owner[sheet.zone]].reverse()
    hint = !ids.length ? 'Nothing here.' : sheet.zone === 'library' ? 'Pick a card. The library is shuffled when you take one.' : 'Tap a card for what you can do with it.'
    // The same card once, with how many there are (library).
    const seen = new Map<string, number>()
    if (sheet.zone === 'library') for (const id of ids) seen.set(g.cards[id].def, (seen.get(g.cards[id].def) ?? 0) + 1)
    const text = query.trim().toLowerCase()
    const matches = (id: number) => {
      if (!text) return true
      const face = faceOf(g, g.cards[id])
      return `${face.name} ${face.typeLine} ${face.text}`.toLowerCase().includes(text)
    }
    const listed = (sheet.zone === 'library' ? ids.filter((id, i) => ids.findIndex((o) => g.cards[o].def === g.cards[id].def) === i) : ids).filter(matches)
    if (ids.length > 6) search = { value: query, onChange: setQuery, placeholder: sheet.zone === 'library' ? 'Search by name, type or text' : 'Search these cards' }
    if (ids.length && !listed.length) hint = 'No card matches.'
    groups = [{
      cols: 1,
      items: listed.map((id) => {
        const c = g.cards[id]
        const face = faceOf(g, c)
        const known = !!g.defs[c.def]
        return {
          key: String(id),
          label: known ? face.name : 'Loading…',
          sub: sheet.zone === 'library' ? `${seen.get(c.def)} left · ${face.typeLine}` : face.typeLine,
          art: face.thumb,
          run: () => onCard(id),
        }
      }),
    }]
  } else if (sheet.t === 'mana') {
    const c = g.cards[sheet.id]
    const face = faceOf(g, c)
    title = `Tap ${face.name} for`
    groups = [{ cols: 2, items: face.produces.map((m) => ({ key: m, label: MANA_NAME[m], mana: m, run: () => act({ t: 'mana', id: c.id, color: m }) })) }]
  } else if (sheet.t === 'cast') {
    const c = g.cards[sheet.id]
    const face = g.defs[c.def]?.faces[sheet.face]
    title = `Cast ${face?.name ?? 'card'}`
    hint = 'Choose X. The lands to tap are picked for you; tap your own first if you want others.'
    if (face) {
      const fixed = parseCost(face.cost)
      const per = Math.max(1, fixed.x)
      const max = Math.max(0, Math.floor((available(pl.pool, manaSources(g, me)) - fixed.generic - fixed.symbols.length) / per))
      groups = [{
        cols: 2,
        items: Array.from({ length: Math.min(max, 20) + 1 }, (_, x) => ({
          key: String(x),
          label: `X = ${x}`,
          sub: costLabel(face.cost, x, 0),
          icon: I.play,
          run: () => act({ t: 'cast', id: c.id, face: sheet.face, x }),
        })),
      }]
    }
  } else if (sheet.t === 'scry') {
    const top = pl.library.slice(-sheet.n).reverse()
    title = top.length === 1 ? 'Top card' : `Top ${top.length} cards`
    hint = top.length ? 'The first one is on top. Choose where each goes, then confirm.' : 'Your library is empty.'
    onBack = () => {
      act({ t: 'look', n: 0 })
      setFate({})
      setSheet({ t: 'tools' })
    }
    header = (
      <View style={styles.looks}>
        {top.map((id) => {
          const face = faceOf(g, g.cards[id])
          const where = fate[id] ?? 'top'
          return (
            <View key={id} style={styles.look}>
              <View style={styles.lookArt}>
                {face.thumb ? <Image source={{ uri: face.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </View>
              <View style={styles.lookText}>
                <Text style={styles.lookName} numberOfLines={1}>{g.defs[g.cards[id].def] ? face.name : 'Loading…'}</Text>
                <View style={styles.lookChoices}>
                  {(['top', 'bottom', 'graveyard'] as const).map((w) => (
                    <TouchableOpacity
                      key={w}
                      style={[styles.choice, where === w && styles.choiceOn]}
                      onPress={() => setFate({ ...fate, [id]: w })}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: where === w }}
                    >
                      <Text style={[styles.choiceLabel, where === w && styles.choiceLabelOn]}>{w === 'top' ? 'Top' : w === 'bottom' ? 'Bottom' : 'Graveyard'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )
        })}
      </View>
    )
    footer = top.length ? (
      <PrimaryButton
        label="Confirm"
        onPress={() => {
          const where = (id: number) => fate[id] ?? 'top'
          for (const id of top) if (where(id) === 'graveyard') act({ t: 'move', id, to: 'graveyard' })
          const rest = top.filter((id) => where(id) !== 'graveyard')
          if (rest.length) act({ t: 'scry', top: rest.filter((id) => where(id) === 'top'), bottom: rest.filter((id) => where(id) === 'bottom') })
          act({ t: 'look', n: 0 })
          setFate({})
          setSheet(null)
        }}
      />
    ) : null
  }

  return (
    <ActionSheet
      visible={sheet != null}
      title={title}
      hint={hint}
      groups={groups}
      header={header}
      footer={footer}
      tall={tall}
      search={search}
      onBack={onBack}
      onClose={close}
    />
  )
}

// Everything that can be done with one card, by where it is.
export function cardGroups(
  g: Game,
  me: number,
  c: Inst,
  act: (a: Action) => void,
  setSheet: (sheet: TableSheet | null) => void,
  // Pick a permanent on the table to attach this one to.
  onPick: (id: number) => void,
): SheetGroup[] {
  const def = g.defs[c.def]
  const face = faceOf(g, c)
  const id = c.id
  const item = (key: string, label: string, icon: string, run: () => void, more: Partial<SheetItem> = {}): SheetItem => ({ key, label, icon, run, ...more })
  // Taking a card out of the library shuffles it (a search); putting it on top shuffles first.
  const fromLibrary = c.zone === 'library'
  const move = (to: Zone, bottom = false) => () => {
    if (fromLibrary && to === 'library') act({ t: 'shuffle' })
    act({ t: 'move', id, to, bottom })
    if (fromLibrary) {
      if (to !== 'library') act({ t: 'shuffle' })
    }
  }
  const moves = (zones: Zone[]): SheetItem[] =>
    zones.filter((z) => z !== c.zone || z === 'library').flatMap((z) => {
      if (z === 'library') return [item('top', 'Top of library', I.top, move('library')), item('bot', 'Bottom of library', I.bottom, move('library', true))]
      if (z === 'command') return c.commander ? [item('cmd', 'Command zone', I.crown, move('command'))] : []
      const label = { hand: 'Hand', battlefield: 'Battlefield', graveyard: 'Graveyard', exile: 'Exile' }[z as 'hand']
      const icon = { hand: I.hand, battlefield: I.play, graveyard: I.graveyard, exile: I.exile }[z as 'hand']
      return [item(z, label, icon, move(z))]
    })

  // Ways to play it from where it is.
  const plays: SheetItem[] = []
  if (c.zone !== 'battlefield' && c.zone !== 'stack' && c.owner === me) {
    def.faces.forEach((f, i) => {
      if (def.layout === 'transform' && i > 0) return
      if (f.types.includes('Land')) {
        plays.push(item(`land${i}`, `Play ${f.name}`, I.play, () => act({ t: 'land', id, face: i, force: c.zone !== 'hand' }), { sub: 'Your land for the turn' }))
        return
      }
      const hasX = /\{X\}/.test(f.cost)
      plays.push(item(`cast${i}`, `Cast ${f.name}`, I.play, () => (hasX ? setSheet({ t: 'cast', id, face: i }) : act({ t: 'cast', id, face: i })), { sub: f.cost || 'No mana cost', keepOpen: hasX }))
      plays.push(item(`free${i}`, 'Cast without paying', I.bolt, () => act({ t: 'cast', id, face: i, free: true }), { sub: def.faces.length > 1 ? f.name : 'Another cost, or an effect lets you' }))
    })
  }

  if (c.zone !== 'battlefield') {
    return [
      { title: 'Play', cols: 2, items: plays },
      { title: 'Move to', cols: 2, items: moves(['hand', 'battlefield', 'graveyard', 'exile', 'library', 'command']) },
    ]
  }

  const mineNow = c.ctrl === me
  const abilities = mineNow ? abilitiesOf(face) : []
  const now: SheetItem[] = [item('tap', c.tapped ? 'Untap' : 'Tap', I.tap, () => act({ t: 'tap', id }))]
  if (mineNow && canTapForMana(g, c)) {
    for (const m of face.produces) now.push({ key: `mana${m}`, label: `Tap for ${MANA_NAME[m].toLowerCase()}`, mana: m, run: () => act({ t: 'mana', id, color: m }) })
  }
  const stack: SheetItem[] = abilities.map((a, i) =>
    item(`ab${i}`, a.label, a.loyalty != null ? I.exile : I.bolt, () =>
      act(a.loyalty != null
        ? { t: 'ability', id, kind: 'loyalty', loyalty: a.loyalty, label: `${face.name} ${a.label}: ${a.text}`.slice(0, 90) }
        : { t: 'ability', id, kind: 'activated', tap: a.tap, cost: a.cost || undefined, label: `${face.name}: ${a.text || a.label}`.slice(0, 90) }),
    { sub: a.text }),
  )
  if (mineNow) stack.push(item('trigger', 'Put a trigger on the stack', I.bolt, () => act({ t: 'ability', id, kind: 'triggered' }), { sub: 'For “when” and “whenever” abilities' }))

  const kind = isType(g, c, 'Planeswalker') ? 'loyalty' : face.subtypes.includes('Saga') ? 'lore' : isType(g, c, 'Battle') ? 'defense' : 'charge'
  const kindName = kind[0].toUpperCase() + kind.slice(1)
  const count = (k: string) => `${c.counters[k] ?? 0} now`
  const counters: SheetItem[] = [
    item('p+', '+1/+1 counter', I.plus, () => act({ t: 'counter', id, kind: '+1/+1', by: 1 }), { keepOpen: true, sub: count('+1/+1') }),
    item('p-', 'Remove +1/+1', I.minus, () => act({ t: 'counter', id, kind: '+1/+1', by: -1 }), { keepOpen: true }),
    item('m+', '−1/−1 counter', I.plus, () => act({ t: 'counter', id, kind: '-1/-1', by: 1 }), { keepOpen: true, sub: count('-1/-1') }),
    item('m-', 'Remove −1/−1', I.minus, () => act({ t: 'counter', id, kind: '-1/-1', by: -1 }), { keepOpen: true }),
    item('k+', `${kindName} +1`, I.plus, () => act({ t: 'counter', id, kind, by: 1 }), { keepOpen: true, sub: count(kind) }),
    item('k-', `${kindName} −1`, I.minus, () => act({ t: 'counter', id, kind, by: -1 }), { keepOpen: true }),
  ]
  const pt = (dp: number, dt: number, label: string) => item(`pt${label}`, label, dp + dt >= 0 ? I.plus : I.minus, () => act({ t: 'pt', id, dp, dt }), { keepOpen: true })
  const more: SheetItem[] = [
    item('attach', 'Attach to…', I.link, () => onPick(id), { sub: 'Auras and Equipment' }),
    ...(c.attachedTo != null && c.attachedTo >= 0 ? [item('unattach', 'Unattach', I.link, () => act({ t: 'attach', id, to: null }))] : []),
    ...(def.faces.length > 1 ? [item('flip', 'Turn over', I.flip, () => act({ t: 'flip', id }), { sub: def.faces[(c.face + 1) % def.faces.length].name })] : []),
    item('down', c.faceDown ? 'Turn face up' : 'Turn face down', I.flip, () => act({ t: 'faceDown', id })),
    item('copy', 'Copy as a token', I.copy, () => act({ t: 'copy', id })),
    ...(!g.players[1 - c.ctrl].dummy ? [item('control', `Give to ${g.players[1 - c.ctrl].name}`, I.swap, () => act({ t: 'control', id }), { sub: 'Change of control' })] : []),
  ]
  return [
    { cols: 2, items: now },
    { title: 'Abilities', cols: 1, items: stack },
    { title: 'Counters', cols: 2, items: counters },
    { title: 'Until end of turn', cols: 2, items: [pt(1, 1, '+1/+1'), pt(-1, -1, '−1/−1'), pt(1, 0, '+1/+0'), pt(0, 1, '+0/+1')] },
    { title: 'Move to', cols: 2, items: moves(['hand', 'graveyard', 'exile', 'library', 'command']) },
    { title: 'More', cols: 2, items: more },
  ]
}

const styles = StyleSheet.create({
  custom: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
    backgroundColor: Colors.background,
    color: Colors.text,
    fontSize: 15,
    fontFamily: Fonts.medium,
  },
  create: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createLabel: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
  log: {
    gap: 6,
  },
  logLine: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.regular,
    color: '#CFC7B4',
  },
  logTurn: {
    marginTop: 6,
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  looks: {
    gap: 10,
  },
  look: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lookArt: {
    width: 56,
    height: 78,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
  },
  lookText: {
    flex: 1,
    gap: 8,
  },
  lookName: {
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  lookChoices: {
    flexDirection: 'row',
    gap: 6,
  },
  choice: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: {
    borderColor: Colors.gold,
    backgroundColor: 'rgba(212,166,74,0.14)',
  },
  choiceLabel: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: '#CFC7B4',
  },
  choiceLabelOn: {
    color: '#F0D8A0',
  },
})
