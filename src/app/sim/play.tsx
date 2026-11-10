import { useKeepAwake } from 'expo-keep-awake'
import { router } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PathIcon } from '@/components/deck/parts'
import { CostRow } from '@/components/mana-symbol'
import { CardView, CARD_RATIO, I, PoolRow } from '@/components/sim/parts'
import { TableSheets, type TableSheet } from '@/components/sim/sheets'
import { Colors, Fonts } from '@/constants/theme'
import { STEP_NAME, canAttack, canBlock, canTapForMana, faceOf, isType, nameOf, type Action, type Inst } from '@/sim/engine'
import { dispatch, endTurn, leave, rematch, setPrefs, undo, useSession } from '@/sim/session'
import { thump, tick } from '@/utils/motion'

// Play (design S2, grown from a one-player sandbox into a full game): your side of the table at
// the bottom, the other player's at the top. The rules run the turn, priority, mana and combat;
// what a card's text does, you do by hand (hold a card for everything you can do with it).

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

type ToolbarButton = { key: string; label: string; sub?: string; icon?: string; primary?: boolean; flex?: number; disabled?: boolean; run: () => void }

export default function PlayScreen() {
  useKeepAwake()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const session = useSession()
  const g = session.g
  const solo = session.mode === 'solo'

  // Solo: the side shown follows whoever the game is waiting for; "Switch sides" overrides it
  // until the game waits for someone else.
  const waitingFor = g ? g.wait.p : 0
  const [side, setSide] = useState({ p: waitingFor, followed: waitingFor })
  if (solo && g && g.wait.kind !== 'over' && side.followed !== waitingFor) setSide({ p: waitingFor, followed: waitingFor })
  const me = solo ? side.p : session.seat

  const [sel, setSel] = useState<number | null>(null)
  const [sheet, setSheet] = useState<TableSheet | null>(null)
  // The permanent being attached to something (tap its new host).
  const [pick, setPick] = useState<number | null>(null)
  // Attackers being chosen: creature -> what it attacks (-1: the player).
  const [attack, setAttack] = useState<Record<number, number>>({})
  const [forced, setForced] = useState(false)
  // Blocks being chosen: blocker -> attacker; and the blocker waiting for its attacker.
  const [blocks, setBlocks] = useState<Record<number, number>>({})
  const [blocker, setBlocker] = useState<number | null>(null)
  // Cards chosen in a prompt (to bottom, discard, keep).
  const [chosen, setChosen] = useState<number[]>([])
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [leaving, setLeaving] = useState(false)

  usePreventRemove(g != null && !leaving, () => setSheet({ t: 'leave' }))
  useEffect(() => {
    if (!leaving) return
    leave()
    router.back()
  }, [leaving])

  // The newest log line and refused moves show as a toast.
  const lastLog = g?.log[g.log.length - 1]
  const [seen, setSeen] = useState({ log: lastLog?.n ?? 0, error: session.error?.n ?? 0 })
  if (lastLog && lastLog.n !== seen.log) {
    setSeen({ ...seen, log: lastLog.n })
    setNote({ text: lastLog.text })
  } else if (session.error && session.error.n !== seen.error) {
    setSeen({ ...seen, error: session.error.n })
    setNote({ text: session.error.text, bad: true })
  }
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), note.bad ? 3600 : 2600)
    return () => clearTimeout(timer)
  }, [note])

  // A new prompt starts with nothing chosen.
  const waitKey = g ? `${g.wait.kind}:${g.wait.p}:${g.turn}:${g.players[g.wait.p]?.mulligans}` : ''
  const [promptKey, setPromptKey] = useState(waitKey)
  if (promptKey !== waitKey) {
    setPromptKey(waitKey)
    setChosen([])
    setAttack({})
    setForced(false)
    setBlocks({})
    setBlocker(null)
  }

  if (!g) {
    return (
      <View style={[styles.root, styles.empty, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>No game in progress.</Text>
        <TouchableOpacity style={styles.emptyButton} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.emptyLabel}>Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const act = (a: Action) => dispatch(a, me)
  const say = (text: string) => setNote({ text, bad: true })
  const pl = g.players[me]
  const opp = g.players[1 - me]
  const alone = opp.dummy
  const w = g.wait
  const mine = w.p === me
  const attackMode = mine && w.kind === 'attackers'
  const blockMode = mine && w.kind === 'blockers'
  const selected = sel != null && g.cards[sel] && (g.cards[sel].zone === 'battlefield' || (g.cards[sel].zone === 'hand' && g.cards[sel].owner === me)) ? g.cards[sel] : null

  const isLand = (c: Inst) => isType(g, c, 'Land') && !isType(g, c, 'Creature')
  const perms = (p: number) => g.players[p].battlefield.map((id) => g.cards[id])
  const attackerLetter = (id: number) => LETTERS[g.combat.indexOf(id) % 26]

  // ---- Tapping cards ----

  const tapCard = (c: Inst) => {
    if (pick != null) {
      if (c.zone === 'battlefield' && c.id !== pick) act({ t: 'attach', id: pick, to: c.id })
      setPick(null)
      return
    }
    if (attackMode && c.zone === 'battlefield') {
      if (c.ctrl === me) {
        if (attack[c.id] != null) {
          const next = { ...attack }
          delete next[c.id]
          setAttack(next)
        } else if (canAttack(g, c)) {
          setAttack({ ...attack, [c.id]: -1 })
          tick()
        } else say(`${nameOf(g, c)} can’t attack${c.sick ? ' (summoning sick)' : c.tapped ? ' (tapped)' : ''}. Hold it to attack anyway.`)
      } else if (isType(g, c, 'Planeswalker') || isType(g, c, 'Battle')) {
        // The attacker chosen last goes for this instead of the player.
        const last = Object.keys(attack).map(Number).pop()
        if (last != null) setAttack({ ...attack, [last]: attack[last] === c.id ? -1 : c.id })
        else say('Choose an attacker first, then what it attacks.')
      }
      return
    }
    if (blockMode && c.zone === 'battlefield') {
      if (c.ctrl === me) {
        if (blocks[c.id] != null) {
          const next = { ...blocks }
          delete next[c.id]
          setBlocks(next)
          setBlocker(null)
        } else setBlocker(blocker === c.id ? null : c.id)
      } else if (c.attacking != null) {
        if (blocker == null) say('Choose one of your creatures first, then the attacker it blocks.')
        else if (canBlock(g, g.cards[blocker], c)) {
          setBlocks({ ...blocks, [blocker]: c.id })
          setBlocker(null)
          tick()
        } else say(`${nameOf(g, g.cards[blocker])} can’t block ${nameOf(g, c)}.`)
      }
      return
    }
    // Lands tap for mana (and untap, giving it back) with one tap.
    if (c.zone === 'battlefield' && c.ctrl === me && isLand(c)) {
      if (canTapForMana(g, c)) {
        const colors = faceOf(g, c).produces
        if (colors.length > 1) setSheet({ t: 'mana', id: c.id })
        else act({ t: 'mana', id: c.id })
        return
      }
      if (c.tapped && c.mana) {
        act({ t: 'tap', id: c.id })
        return
      }
    }
    setSel(sel === c.id ? null : c.id)
  }

  const holdCard = (c: Inst) => {
    if (attackMode && c.zone === 'battlefield' && c.ctrl === me && attack[c.id] == null) {
      setAttack({ ...attack, [c.id]: -1 })
      setForced(true)
      thump()
      return
    }
    setSel(null)
    setSheet({ t: 'card', id: c.id })
  }

  // ---- The bar at the bottom ----

  let bar: ToolbarButton[] = []
  let barNote = ''
  const close: ToolbarButton = { key: 'close', label: 'Close', icon: I.close, run: () => setSel(null) }
  if (pick != null) {
    barNote = `Tap what ${nameOf(g, g.cards[pick])} goes on`
    bar = [{ key: 'cancel', label: 'Cancel', primary: true, run: () => setPick(null) }]
  } else if (attackMode) {
    const n = Object.keys(attack).length
    barNote = n ? 'Tap a planeswalker to attack it instead' : 'Tap the creatures that attack'
    bar = [
      { key: 'none', label: 'No attack', run: () => act({ t: 'attack', attackers: [] }) },
      {
        key: 'go', label: n ? `Attack with ${n}` : 'Attack', primary: true, flex: 1.4, disabled: !n,
        run: () => act({ t: 'attack', attackers: Object.entries(attack).map(([id, target]) => ({ id: Number(id), target })), force: forced }),
      },
    ]
  } else if (blockMode) {
    const n = Object.keys(blocks).length
    barNote = blocker != null ? 'Now tap the attacker it blocks' : 'Tap a creature, then the attacker it blocks'
    bar = [
      { key: 'none', label: 'No blocks', run: () => act({ t: 'block', blocks: [] }) },
      {
        key: 'go', label: n ? `Block with ${n}` : 'Block', primary: true, flex: 1.4, disabled: !n,
        run: () => act({ t: 'block', blocks: Object.entries(blocks).map(([id, attacker]) => ({ id: Number(id), attacker })) }),
      },
    ]
  } else if (selected && selected.zone === 'hand') {
    const def = g.defs[selected.def]
    const face = def.faces[0]
    const choices = def.faces.filter((f, i) => !(def.layout === 'transform' && i > 0)).length
    const land = face.types.includes('Land')
    bar = [
      {
        key: 'play', label: land ? 'Play' : 'Cast', icon: I.play, primary: true, flex: 1.3,
        run: () => {
          if (choices > 1) setSheet({ t: 'card', id: selected.id })
          else if (land) act({ t: 'land', id: selected.id })
          else if (/\{X\}/.test(face.cost)) setSheet({ t: 'cast', id: selected.id, face: 0 })
          else act({ t: 'cast', id: selected.id })
          setSel(null)
        },
      },
      { key: 'more', label: 'More', icon: I.more, run: () => { setSheet({ t: 'card', id: selected.id }); setSel(null) } },
      { key: 'gy', label: 'Discard', icon: I.graveyard, run: () => { act({ t: 'move', id: selected.id, to: 'graveyard' }); setSel(null) } },
      close,
    ]
  } else if (selected) {
    const id = selected.id
    const kind = isType(g, selected, 'Planeswalker') ? 'loyalty' : faceOf(g, selected).subtypes.includes('Saga') ? 'lore' : '+1/+1'
    const kindLabel = kind === '+1/+1' ? '+1/+1' : kind === 'lore' ? 'Lore' : 'Loyalty'
    bar = selected.ctrl === me
      ? [
        { key: 'tap', label: selected.tapped ? 'Untap' : 'Tap', icon: I.tap, primary: true, flex: 1.2, run: () => act({ t: 'tap', id }) },
        { key: 'plus', label: kind === '+1/+1' ? '+1/+1' : `${kindLabel} +1`, icon: I.plus, run: () => act({ t: 'counter', id, kind, by: 1 }) },
        { key: 'minus', label: '−1', icon: I.minus, run: () => act({ t: 'counter', id, kind, by: -1 }) },
        { key: 'more', label: 'More', icon: I.more, run: () => { setSheet({ t: 'card', id }); setSel(null) } },
        close,
      ]
      : [
        { key: 'more', label: 'Details', icon: I.eye, primary: true, flex: 1.2, run: () => { setSheet({ t: 'card', id }); setSel(null) } },
        { key: 'gy', label: 'Graveyard', icon: I.graveyard, run: () => { act({ t: 'move', id, to: 'graveyard' }); setSel(null) } },
        { key: 'ex', label: 'Exile', icon: I.exile, run: () => { act({ t: 'move', id, to: 'exile' }); setSel(null) } },
        { key: 'hand', label: 'Hand', icon: I.hand, run: () => { act({ t: 'move', id, to: 'hand' }); setSel(null) } },
        close,
      ]
  } else if (w.kind === 'priority' && mine) {
    const top = g.stack[g.stack.length - 1]
    if (top) {
      barNote = top.ctrl === me ? 'Your priority' : `${g.players[top.ctrl].name}: ${top.label}`
      bar = [{ key: 'pass', label: top.ctrl === me ? 'Resolve' : 'OK', sub: top.ctrl === me ? 'pass priority' : 'no response', primary: true, run: () => act({ t: 'pass' }) }]
    } else if (g.active === me && (g.step === 'main1' || g.step === 'main2')) {
      const attackers = g.step === 'main1' && pl.battlefield.some((id) => canAttack(g, g.cards[id]))
      bar = [
        ...(attackers ? [{ key: 'combat', label: 'Combat', icon: I.swords, run: () => act({ t: 'pass' }) }] : []),
        { key: 'end', label: 'End turn', sub: alone ? 'untap + draw' : `${opp.name}'s turn next`, primary: true, flex: 1.4, run: () => endTurn(me) },
      ]
    } else {
      barNote = g.active === me ? STEP_NAME[g.step] : `${opp.name}'s ${STEP_NAME[g.step].toLowerCase()}`
      bar = [{ key: 'pass', label: 'Continue', sub: 'pass priority', primary: true, run: () => act({ t: 'pass' }) }]
    }
  } else if (w.kind !== 'over') {
    barNote = `Waiting for ${g.players[w.p].name}…`
  }

  // ---- Prompts over the table ----

  const prompt = (() => {
    if (w.kind === 'over') {
      const won = g.winner === me
      return {
        cap: 'Game over',
        title: g.winner === -1 ? 'A draw' : solo ? `${g.players[g.winner ?? 0].name} wins` : won ? 'You win' : 'You lose',
        sub: g.reason,
        cards: [] as number[],
        pickN: 0,
        buttons: [
          { label: 'Leave', run: () => setLeaving(true) },
          { label: session.mode === 'guest' ? 'Play again' : 'New game', primary: true, run: () => rematch() },
        ],
      }
    }
    if (!mine) {
      if (w.kind === 'mulligan' || w.kind === 'bottom') {
        return { cap: 'Opening hands', title: `Waiting for ${g.players[w.p].name}`, sub: 'They’re deciding whether to keep their hand.', cards: pl.hand, pickN: 0, buttons: [{ label: 'Leave', run: () => setSheet({ t: 'leave' }) }] }
      }
      return null
    }
    const lands = pl.hand.filter((id) => faceOf(g, g.cards[id]).types.includes('Land')).length
    const who = solo && !alone ? `${pl.name} · ` : ''
    if (w.kind === 'mulligan') {
      const keepN = 7 - Math.max(0, pl.mulligans - (g.freeMulligan ? 1 : 0))
      return {
        cap: `${who}${pl.mulligans ? `Mulligan ${pl.mulligans} · London` : 'Opening hand'}`,
        title: 'Keep or mulligan?',
        sub: `${lands} lands · ${pl.hand.length - lands} spells${g.first === me ? ' · you go first' : ''}`,
        cards: pl.hand,
        pickN: 0,
        buttons: [
          { label: 'Mulligan', run: () => act({ t: 'mull' }) },
          { label: `Keep ${keepN}`, primary: true, run: () => act({ t: 'keep' }) },
        ],
      }
    }
    if (w.kind === 'bottom' || w.kind === 'discard') {
      const n = w.n ?? 0
      const left = n - chosen.length
      return {
        cap: `${who}${w.kind === 'bottom' ? `Mulligan ${pl.mulligans} · London` : 'Cleanup · hand size is 7'}`,
        title: w.kind === 'bottom' ? `Put ${n} on the bottom` : `Discard ${n}`,
        sub: `${lands} lands · ${pl.hand.length - lands} spells`,
        cards: pl.hand,
        pickN: n,
        tag: w.kind === 'bottom' ? 'BOTTOM' : 'DISCARD',
        buttons: [{
          label: left > 0 ? `Choose ${left} more` : w.kind === 'bottom' ? `Keep these ${7 - n}` : 'Discard',
          primary: left === 0,
          disabled: left > 0,
          run: () => act(w.kind === 'bottom' ? { t: 'bottom', ids: chosen } : { t: 'choose', ids: chosen }),
        }],
      }
    }
    if (w.kind === 'legend') {
      return {
        cap: 'Legend rule',
        title: 'Keep which one?',
        sub: 'You control two legendary permanents with the same name. The other goes to the graveyard.',
        cards: w.ids ?? [],
        pickN: 1,
        tag: 'KEEP',
        buttons: [{ label: 'Keep it', primary: chosen.length === 1, disabled: chosen.length !== 1, run: () => act({ t: 'choose', ids: chosen }) }],
      }
    }
    if (w.kind === 'commander') {
      const c = g.cards[w.id ?? 0]
      return {
        cap: 'Your commander',
        title: 'Back to the command zone?',
        sub: `${faceOf(g, c).name} left for ${c.zone === 'hand' ? 'your hand' : c.zone === 'library' ? 'your library' : c.zone === 'graveyard' ? 'the graveyard' : 'exile'}. You may put it in the command zone instead.`,
        cards: [c.id],
        pickN: 0,
        buttons: [
          { label: 'Leave it there', run: () => act({ t: 'commandZone', yes: false }) },
          { label: 'Command zone', primary: true, run: () => act({ t: 'commandZone', yes: true }) },
        ],
      }
    }
    return null
  })()

  // ---- Layout ----

  const hand = pl.hand.map((id) => g.cards[id])
  const HAND_W = 80
  const area = width - 32
  const step = hand.length > 1 ? Math.min(62, (area - HAND_W) / (hand.length - 1)) : 0
  const start = 16 + (area - (HAND_W + step * (hand.length - 1))) / 2

  const row = (cards: Inst[], cardWidth: number, key: string) => (
    <ScrollView
      key={key}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, height: Math.round(cardWidth * CARD_RATIO) + 8 }}
      contentContainerStyle={styles.row}
    >
      {cards.map((c) => {
        const attacking = c.attacking != null || attack[c.id] != null
        const blocking = c.blocking ?? blocks[c.id]
        const letter = c.attacking != null && g.combat.length > 1 ? attackerLetter(c.id) : blocking != null && g.combat.length > 1 ? attackerLetter(blocking) : undefined
        const target = Object.values(attack).includes(c.id)
        return (
          <CardView
            key={c.id}
            g={g}
            c={c}
            width={cardWidth}
            selected={sel === c.id || blocker === c.id || pick === c.id}
            mark={attacking || target ? 'attack' : blocking != null ? 'block' : pick != null && pick !== c.id ? 'pick' : undefined}
            label={letter}
            onPress={() => tapCard(c)}
            onLongPress={() => holdCard(c)}
          />
        )
      })}
    </ScrollView>
  )

  const half = (p: number, top: boolean) => {
    const all = perms(p)
    const lands = all.filter(isLand)
    const others = all.filter((c) => !isLand(c))
    const big = top ? 50 : 62
    const small = top ? 34 : 44
    const rows = [
      others.length || !top ? (others.length ? row(others, big, 'perms') : <Text key="hint" style={styles.tableHint}>{top ? '' : hand.length ? 'Play a card from your hand' : ''}</Text>) : null,
      lands.length ? row(lands, small, 'lands') : null,
    ]
    return <View style={[styles.half, top && styles.halfTop]}>{top ? rows.reverse() : rows}</View>
  }

  const zoneButton = (label: string, count: number, icon: string, open: () => void, gold?: boolean) => (
    <TouchableOpacity key={label} style={[styles.zone, gold && styles.zoneGold]} onPress={open} accessibilityRole="button" accessibilityLabel={`${label}, ${count} cards`}>
      <PathIcon d={icon} color={gold ? Colors.goldLight : Colors.textSecondary} size={18} />
      <View>
        <Text style={styles.zoneCount}>{count}</Text>
        <Text style={[styles.zoneName, gold && { color: Colors.goldLight }]} numberOfLines={1}>{label}</Text>
      </View>
    </TouchableOpacity>
  )

  const lifeBox = (p: number) => {
    const who = g.players[p]
    const extra = [who.poison ? `${who.poison} poison` : '', ...Object.values(who.cmdDamage).filter((d) => d > 0).map((d) => `${d} cmd`)].filter(Boolean).join(' · ')
    return (
      <View key={p} style={[styles.life, p === me && styles.lifeMine, g.active === p && g.phase === 'play' && styles.lifeActive]} accessible={false}>
        <TouchableOpacity style={styles.lifeButton} onPress={() => act({ t: 'life', p, by: -1 })} accessibilityRole="button" accessibilityLabel={`${who.name} life minus 1`}>
          <Text style={styles.lifeSign}>−</Text>
        </TouchableOpacity>
        <View style={styles.lifeMiddle} accessible accessibilityLabel={`${who.name}: ${who.life} life${extra ? `, ${extra}` : ''}`}>
          <Text style={[styles.lifeValue, p !== me && { color: '#A9C4E2' }]}>{who.life}</Text>
          <Text style={styles.lifeLabel} numberOfLines={1}>{extra || who.name}</Text>
        </View>
        <TouchableOpacity style={styles.lifeButton} onPress={() => act({ t: 'life', p, by: 1 })} accessibilityRole="button" accessibilityLabel={`${who.name} life plus 1`}>
          <Text style={styles.lifeSign}>+</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const top = g.stack[g.stack.length - 1]
  const caption = session.mode === 'solo' ? (alone ? `Solo · ${pl.name}` : `Playing as ${pl.name}`) : session.link === 'lost' ? session.note : `Against ${opp.name}`
  const turnOf = g.phase === 'play' ? `Turn ${g.turn} · ${STEP_NAME[g.step]}` : g.phase === 'over' ? 'Game over' : 'Opening hands'

  return (
    <View style={[styles.root, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 10 }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => setSheet({ t: 'leave' })} accessibilityRole="button" accessibilityLabel="Leave the game">
          <PathIcon d={I.back} color="#CFC7B4" size={22} weight={2} />
        </TouchableOpacity>
        <View style={styles.headerMiddle}>
          <Text style={[styles.caption, session.link === 'lost' && { color: Colors.danger }]} numberOfLines={1}>{caption}</Text>
          <Text style={styles.turn} numberOfLines={1}>{turnOf}</Text>
        </View>
        {session.mode !== 'guest' && (
          <TouchableOpacity style={styles.headerButton} onPress={undo} disabled={!session.canUndo} accessibilityRole="button" accessibilityLabel="Undo">
            <PathIcon d={I.undo} color={session.canUndo ? Colors.text : '#6B6556'} size={20} weight={2} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.headerButton, styles.toolsButton]} onPress={() => { setSel(null); setSheet({ t: 'tools' }) }} accessibilityRole="button" accessibilityLabel="Tools: library, dice, stops, new game">
          <PathIcon d={I.tools} color={Colors.text} size={20} weight={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.lifes}>{alone ? lifeBox(me) : [lifeBox(me), lifeBox(1 - me)]}</View>

      <View style={styles.table}>
        {!alone && (
          <>
            <View style={styles.oppInfo}>
              <Text style={styles.oppText}>Hand {opp.hand.length} · Library {opp.library.length}</Text>
              <TouchableOpacity style={styles.oppChip} onPress={() => setSheet({ t: 'zone', owner: 1 - me, zone: 'graveyard' })} accessibilityRole="button">
                <Text style={styles.oppChipText}>Graveyard {opp.graveyard.length}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.oppChip} onPress={() => setSheet({ t: 'zone', owner: 1 - me, zone: 'exile' })} accessibilityRole="button">
                <Text style={styles.oppChipText}>Exile {opp.exile.length}</Text>
              </TouchableOpacity>
              {opp.command.length > 0 && (
                <TouchableOpacity style={styles.oppChip} onPress={() => setSheet({ t: 'zone', owner: 1 - me, zone: 'command' })} accessibilityRole="button">
                  <Text style={styles.oppChipText}>Command {opp.command.length}</Text>
                </TouchableOpacity>
              )}
              <PoolRow pool={opp.pool} size={14} />
            </View>
            {half(1 - me, true)}
            <TouchableOpacity style={styles.divider} onPress={() => setSheet({ t: 'stack' })} disabled={!top} accessibilityRole="button" accessibilityLabel={top ? `The stack: ${top.label} on top, ${g.stack.length} in all` : 'The stack is empty'}>
              <View style={styles.rule} />
              {top ? (
                <View style={styles.stackPill}>
                  <PathIcon d={I.bolt} color={Colors.onGold} size={13} weight={2.2} />
                  <Text style={styles.stackText} numberOfLines={1}>{top.label}{g.stack.length > 1 ? ` +${g.stack.length - 1}` : ''}</Text>
                </View>
              ) : (
                <Text style={styles.dividerText}>{g.phase === 'play' ? `${g.players[g.active].name}'s turn` : ''}</Text>
              )}
              <View style={styles.rule} />
            </TouchableOpacity>
          </>
        )}
        {alone && top && (
          <TouchableOpacity style={styles.divider} onPress={() => setSheet({ t: 'stack' })} accessibilityRole="button">
            <View style={styles.stackPill}>
              <PathIcon d={I.bolt} color={Colors.onGold} size={13} weight={2.2} />
              <Text style={styles.stackText} numberOfLines={1}>{top.label}{g.stack.length > 1 ? ` +${g.stack.length - 1}` : ''}</Text>
            </View>
          </TouchableOpacity>
        )}
        {half(me, false)}
        <View style={styles.myPool}>
          <PoolRow pool={pl.pool} />
        </View>
      </View>

      <View style={styles.zones}>
        {zoneButton('Library', pl.library.length, I.search, () => setSheet({ t: 'tools' }), true)}
        {zoneButton('Graveyard', pl.graveyard.length, I.graveyard, () => setSheet({ t: 'zone', owner: me, zone: 'graveyard' }))}
        {zoneButton('Exile', pl.exile.length, I.exile, () => setSheet({ t: 'zone', owner: me, zone: 'exile' }))}
        {g.cards.some((c) => c.commander && c.owner === me) && zoneButton('Command', pl.command.length, I.crown, () => setSheet({ t: 'zone', owner: me, zone: 'command' }))}
        <TouchableOpacity style={[styles.zone, styles.zoneDashed]} onPress={() => setSheet({ t: 'tokens' })} accessibilityRole="button" accessibilityLabel="Add a token">
          <PathIcon d={I.plus} color="#CFC7B4" size={18} weight={2} />
          <Text style={styles.zoneName}>Token</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.hand} accessibilityLabel={`Your hand, ${hand.length} cards`}>
        {hand.map((c, i) => {
          const on = sel === c.id
          const off = i - (hand.length - 1) / 2
          const face = faceOf(g, c)
          return (
            <View
              key={c.id}
              style={[
                styles.handCard,
                { left: Math.round(start + i * step), zIndex: on ? 30 : i + 1 },
                { transform: on ? [{ translateY: -22 }, { scale: 1.05 }] : [{ translateY: Math.round(off * off * 2.2) }, { rotate: `${(off * 3.5).toFixed(1)}deg` }] },
              ]}
            >
              <CardView g={g} c={c} width={HAND_W} plain selected={on} onPress={() => tapCard(c)} onLongPress={() => holdCard(c)} />
              {!face.thumb && face.cost ? (
                <View style={styles.handCost}>
                  <CostRow cost={face.cost} size={13} gap={1} />
                </View>
              ) : null}
            </View>
          )
        })}
      </View>

      <View style={styles.bar}>
        {barNote ? <Text style={styles.barNote} numberOfLines={1}>{barNote}</Text> : null}
        {bar.length > 0 && (
          <View style={[styles.barRow, selected && !attackMode && !blockMode && pick == null && styles.barSelected]}>
            {bar.map((b) => (
              <TouchableOpacity
                key={b.key}
                style={[styles.barButton, { flex: b.flex ?? 1 }, b.primary && styles.barPrimary, b.disabled && { opacity: 0.4 }, selected && !b.primary && styles.barPlain]}
                onPress={b.run}
                disabled={b.disabled}
                accessibilityRole="button"
              >
                {b.icon && <PathIcon d={b.icon} color={b.primary ? Colors.onGold : Colors.text} size={17} weight={2} />}
                <Text style={[styles.barLabel, b.primary && { color: Colors.onGold }, b.icon != null && styles.barLabelSmall]} numberOfLines={1}>{b.label}</Text>
                {b.sub && <Text style={[styles.barSub, b.primary && { color: '#3D2F12' }]} numberOfLines={1}>{b.sub}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {note && !sheet && !prompt && (
        <View style={[styles.toast, note.bad && styles.toastBad, { bottom: insets.bottom + 252 }]} accessibilityRole="alert" accessibilityLiveRegion="polite" pointerEvents="none">
          <Text style={styles.toastText} numberOfLines={2}>{note.text}</Text>
        </View>
      )}

      {prompt && (
        <View style={[styles.prompt, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.promptHead}>
            <Text style={styles.promptCap}>{prompt.cap}</Text>
            <Text style={styles.promptTitle} accessibilityRole="header">{prompt.title}</Text>
            <Text style={styles.promptSub}>{prompt.sub}</Text>
          </View>
          {prompt.cards.length > 0 && (
            <View style={styles.promptCards}>
              {prompt.cards.map((id) => {
                const on = chosen.includes(id)
                const pickable = prompt.pickN > 0
                return (
                  <View key={id}>
                    <CardView
                      g={g}
                      c={g.cards[id]}
                      width={prompt.cards.length > 8 ? 62 : 76}
                      plain
                      selected={on}
                      dim={pickable && !on && chosen.length >= prompt.pickN && prompt.pickN > 1}
                      onPress={pickable ? () => setChosen(on ? chosen.filter((x) => x !== id) : prompt.pickN === 1 ? [id] : chosen.length < prompt.pickN ? [...chosen, id] : chosen) : undefined}
                      onLongPress={() => setSheet({ t: 'card', id })}
                    />
                    {on && 'tag' in prompt && (
                      <View style={styles.promptTag}>
                        <Text style={styles.promptTagText}>{prompt.tag}</Text>
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}
          <View style={styles.promptButtons}>
            {prompt.buttons.map((b) => {
              const more = b as { primary?: boolean; disabled?: boolean }
              return (
                <TouchableOpacity
                  key={b.label}
                  style={[styles.promptButton, more.primary ? styles.promptPrimary : styles.promptPlain, { flex: more.primary ? 1.3 : 1 }]}
                  onPress={b.run}
                  disabled={more.disabled}
                  accessibilityRole="button"
                >
                  <Text style={[styles.promptLabel, more.primary && { color: Colors.onGold }, more.disabled && { color: Colors.textSecondary }]}>{b.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}

      <TableSheets
        g={g}
        me={me}
        solo={solo}
        canHost={session.mode !== 'guest'}
        sheet={sheet}
        setSheet={setSheet}
        act={act}
        prefs={session.prefs}
        onPrefs={setPrefs}
        onPick={setPick}
        onSwitch={() => setSide({ p: 1 - me, followed: waitingFor })}
        onNewGame={rematch}
        onLeave={() => setLeaving(true)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Colors.textSecondary,
  },
  emptyButton: {
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
  header: {
    height: 44,
    marginHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsButton: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
  },
  headerMiddle: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  caption: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  turn: {
    fontSize: 21,
    lineHeight: 24,
    fontFamily: Fonts.serif,
    color: Colors.goldLight,
  },
  lifes: {
    marginTop: 6,
    marginHorizontal: 16,
    flexDirection: 'row',
    gap: 10,
  },
  life: {
    flex: 1,
    height: 52,
    paddingHorizontal: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.10)',
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lifeMine: {
    borderColor: 'rgba(212,166,74,0.30)',
  },
  lifeActive: {
    borderColor: Colors.gold,
  },
  lifeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lifeSign: {
    fontSize: 22,
    lineHeight: 26,
    fontFamily: Fonts.bold,
    color: '#CFC7B4',
  },
  lifeMiddle: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  lifeValue: {
    fontSize: 24,
    lineHeight: 26,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  lifeLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: Fonts.extraBold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  table: {
    flex: 1,
    marginTop: 8,
    marginHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.06)',
    experimental_backgroundImage: 'radial-gradient(90% 70% at 50% 40%, #1A1712 0%, #12100C 100%)',
    overflow: 'hidden',
  },
  oppInfo: {
    minHeight: 30,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  oppText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Colors.textSecondary,
  },
  oppChip: {
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: 'rgba(237,230,214,0.06)',
    justifyContent: 'center',
  },
  oppChipText: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: '#CFC7B4',
  },
  half: {
    flex: 1.25,
    justifyContent: 'flex-start',
    gap: 2,
  },
  halfTop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  row: {
    flexGrow: 1,
    paddingHorizontal: 10,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHint: {
    paddingTop: 30,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.textMuted,
  },
  divider: {
    height: 30,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(212,166,74,0.22)',
  },
  dividerText: {
    fontSize: 11,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  stackPill: {
    maxWidth: 240,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: Colors.gold,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stackText: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
  myPool: {
    position: 'absolute',
    left: 12,
    bottom: 6,
  },
  zones: {
    height: 56,
    marginTop: 8,
    marginHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
  },
  zone: {
    flex: 1,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.10)',
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  zoneGold: {
    borderColor: 'rgba(212,166,74,0.30)',
  },
  zoneDashed: {
    flex: 0.7,
    flexDirection: 'column',
    gap: 2,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(237,230,214,0.18)',
  },
  zoneCount: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  zoneName: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: Fonts.bold,
    color: Colors.textSecondary,
  },
  hand: {
    height: 136,
  },
  handCard: {
    position: 'absolute',
    top: 18,
  },
  handCost: {
    position: 'absolute',
    right: 4,
    top: 4,
  },
  bar: {
    minHeight: 76,
    marginHorizontal: 16,
    justifyContent: 'flex-end',
    gap: 4,
  },
  barNote: {
    textAlign: 'center',
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: '#CFC7B4',
  },
  barRow: {
    height: 56,
    flexDirection: 'row',
    gap: 8,
  },
  barSelected: {
    gap: 4,
    padding: 4,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.40)',
    backgroundColor: Colors.surface,
  },
  barButton: {
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.16)',
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  barPlain: {
    borderWidth: 0,
    borderRadius: 13,
    backgroundColor: 'transparent',
  },
  barPrimary: {
    borderWidth: 0,
    backgroundColor: Colors.gold,
  },
  barLabel: {
    fontSize: 15,
    lineHeight: 18,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  barLabelSmall: {
    fontSize: 12,
    lineHeight: 15,
  },
  barSub: {
    fontSize: 11,
    lineHeight: 13,
    fontFamily: Fonts.bold,
    color: Colors.textSecondary,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 340,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    backgroundColor: Colors.selected,
    boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
  },
  toastBad: {
    borderColor: 'rgba(238,132,102,0.55)',
  },
  toastText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.bold,
    color: Colors.text,
    textAlign: 'center',
  },
  prompt: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(8,7,5,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  promptHead: {
    alignItems: 'center',
    gap: 6,
  },
  promptCap: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  promptTitle: {
    fontSize: 38,
    lineHeight: 40,
    fontFamily: Fonts.serif,
    color: Colors.goldLight,
    textAlign: 'center',
  },
  promptSub: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.regular,
    color: '#CFC7B4',
    textAlign: 'center',
  },
  promptCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  promptTag: {
    position: 'absolute',
    left: 5,
    top: 5,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 5,
    backgroundColor: Colors.gold,
    justifyContent: 'center',
  },
  promptTagText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
  promptButtons: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
  },
  promptButton: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptPlain: {
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.18)',
  },
  promptPrimary: {
    backgroundColor: Colors.gold,
  },
  promptLabel: {
    fontSize: 16,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
})
