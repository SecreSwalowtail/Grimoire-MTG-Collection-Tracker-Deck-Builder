import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SymbolText } from '@/components/card/oracle-text'
import { PathIcon } from '@/components/deck/parts'
import { ManaSymbol } from '@/components/mana-symbol'
import { I } from '@/components/sim/parts'
import { Colors, Fonts } from '@/constants/theme'
import { startRun, useRun } from '@/sim/sim-run'
import type { SimReport } from '@/sim/simulate'

// Simulation statistics (design S4–S7): what the deck's opening hands, mana and curve look like
// over all the games. Overview, Opening hand, Mana and Cards are tabs of one screen.

type Tab = 'overview' | 'hand' | 'mana' | 'cards'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'hand', label: 'Opening hand' },
  { id: 'mana', label: 'Mana' },
  { id: 'cards', label: 'Cards' },
]

const BAD = '#EE9A84'
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`
const number = (n: number) => n.toLocaleString('en-US')
const COLOR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' }

// A bar that grows to its value when it comes on screen.
function Grow({ value, color, vertical, delay = 0 }: { value: number; color: string; vertical?: boolean; delay?: number }) {
  const size = useSharedValue(0)
  useEffect(() => {
    size.set(withDelay(delay, withTiming(Math.max(0, Math.min(1, value)), { duration: 500 })))
  }, [size, value, delay])
  const style = useAnimatedStyle(() => (vertical ? { height: `${size.get() * 100}%` } : { width: `${size.get() * 100}%` }))
  return <Animated.View style={[vertical ? styles.growTall : styles.growWide, { backgroundColor: color }, style]} />
}

function Card({ children, index = 0 }: { children: ReactNode; index?: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(260).delay(index * 60)} style={styles.card}>
      {children}
    </Animated.View>
  )
}

// Columns with their value on top and a label underneath. `strong`: the columns in full gold.
function Columns({ values, labels, strong, texts, label }: { values: number[]; labels: string[]; strong?: (i: number) => boolean; texts?: string[]; label: string }) {
  const max = Math.max(...values, 0.0001)
  return (
    <View accessible accessibilityLabel={`${label}: ${values.map((v, i) => `${labels[i]} ${texts?.[i] ?? pct(v)}`).join(', ')}`}>
      <View style={styles.columns}>
        {values.map((v, i) => {
          const on = strong ? strong(i) : v === max
          return (
            <View key={i} style={styles.column}>
              <Text style={[styles.columnValue, on && { color: Colors.goldLight }]}>{texts?.[i] ?? (v > 0 && v < 0.005 ? '<1' : `${Math.round(v * 100)}`)}</Text>
              <View style={styles.columnTrack}>
                <Grow value={v / max} color={on ? Colors.gold : 'rgba(212,166,74,0.4)'} vertical delay={i * 30} />
              </View>
            </View>
          )
        })}
      </View>
      <View style={styles.columnLabels}>
        {labels.map((l, i) => <Text key={i} style={styles.columnLabel}>{l}</Text>)}
      </View>
    </View>
  )
}

function Line({ label, value, sub, color = Colors.gold, lead }: { label: string; value: number; sub?: string; color?: string; lead?: ReactNode }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${pct(value, 1)}${sub ? `. ${sub}` : ''}`}>
      {lead}
      <View style={styles.lineBody}>
        <View style={styles.lineTop}>
          <Text style={styles.lineLabel} numberOfLines={1}>{label}</Text>
          <Text style={styles.lineValue}>{pct(value, 1)}</Text>
        </View>
        <View style={styles.track}>
          <Grow value={value} color={color} />
        </View>
        {sub ? <Text style={styles.lineSub}>{sub}</Text> : null}
      </View>
    </View>
  )
}

function Tile({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, bad && { color: BAD }]}>{value}</Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  )
}

export default function StatsScreen() {
  const insets = useSafeAreaInsets()
  const run = useRun()
  const r = run.report
  const [tab, setTab] = useState<Tab>('overview')
  const [worstFirst, setWorstFirst] = useState(true)
  const thumb = (def: string) => run.deck?.defs[def]?.faces[0].thumb ?? null

  if (!r) {
    return (
      <View style={[styles.root, styles.empty]}>
        <Text style={styles.note}>No simulation yet.</Text>
        <TouchableOpacity style={styles.again} onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.againLabel}>Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const art = (def: string) => (
    <View style={styles.art}>
      {thumb(def) ? <Image source={{ uri: thumb(def)! }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
    </View>
  )

  const overview = (r: SimReport) => {
    // The share of games that win on exactly each turn.
    const wins = r.kill.map((v, i) => v - (i ? r.kill[i - 1] : 0))
    const from = Math.max(0, wins.findIndex((v) => v > 0.005))
    const efficiency = r.available.slice(0, 6).reduce((a, b) => a + b, 0)
    const used = efficiency ? r.spent.slice(0, 6).reduce((a, b) => a + b, 0) / efficiency : 0
    return (
      <>
        <Card>
          <Text style={styles.cap}>Hands you keep at seven</Text>
          <View style={styles.heroRow}>
            <Text style={styles.hero}>{pct(r.keep[0], 1)}</Text>
          </View>
          <Text style={styles.sub}>{r.lands} lands in {r.size} cards · {r.avgLands.toFixed(1)} lands in the hand you keep, on average</Text>
          <View style={styles.split} accessible accessibilityLabel={`Kept at seven ${pct(r.keep[0])}, at six ${pct(r.keep[1])}, at five or fewer ${pct(r.keep[2])}`}>
            <View style={{ flex: Math.max(0.01, r.keep[0]), backgroundColor: Colors.gold }} />
            <View style={{ flex: Math.max(0.01, r.keep[1]), backgroundColor: '#8C7A45' }} />
            <View style={{ flex: Math.max(0.01, r.keep[2]), backgroundColor: '#C9573A' }} />
          </View>
          <View style={styles.legend}>
            <Text style={[styles.legendText, { color: Colors.goldLight }]}>Seven {pct(r.keep[0])}</Text>
            <Text style={styles.legendText}>Six {pct(r.keep[1])}</Text>
            <Text style={[styles.legendText, { color: BAD }]}>Five or fewer {pct(r.keep[2])}</Text>
          </View>
        </Card>

        <View style={styles.tiles}>
          <Tile label="On curve" value={pct(r.drops[3])} sub="A land on each of turns 1 to 4" />
          <Tile label="Mana used" value={pct(used)} sub="Of your mana over six turns" />
        </View>

        {r.commanders.map((c, i) => (
          <Card key={c.def} index={1 + i}>
            <View style={styles.cardHead}>
              <Text style={styles.heading}>Your commander</Text>
              {c.castTurn != null && <Text style={styles.aside}>Avg. <Text style={styles.asideStrong}>turn {c.castTurn.toFixed(1)}</Text></Text>}
            </View>
            <Line label={`${c.name} by turn ${Math.min(10, Math.max(1, c.mv))}`} value={c.byTurn[Math.min(9, Math.max(0, c.mv - 1))]} sub={`Cast by turn ${Math.min(10, c.mv + 2)} in ${pct(c.byTurn[Math.min(9, c.mv + 1)])} of games`} lead={art(c.def)} />
          </Card>
        ))}

        {r.avgKill != null && r.kill[9] > 0.02 && (
          <Card index={2}>
            <View style={styles.cardHead}>
              <Text style={styles.heading}>Turn your creatures win on</Text>
              <Text style={styles.aside}>Avg. <Text style={styles.asideStrong}>turn {r.avgKill.toFixed(1)}</Text></Text>
            </View>
            <Columns label="Share of games won on each turn" values={wins.slice(from)} labels={wins.slice(from).map((_, i) => `T${from + i + 1}`)} />
            <Text style={styles.foot}>Against nobody: {r.life} damage from your creatures alone, no blockers, no removal. Won within ten turns in {pct(r.kill[9])} of games.</Text>
          </Card>
        )}

        <Card index={3}>
          <Text style={styles.heading}>What to look at</Text>
          {r.insights.map((insight, i) => (
            <TouchableOpacity key={i} style={[styles.insight, i > 0 && styles.rule]} onPress={() => setTab(insight.tab)} accessibilityRole="button">
              <Text style={[styles.insightValue, { color: insight.good ? Colors.goldLight : BAD }]}>{insight.value}</Text>
              <SymbolText text={insight.text} style={styles.insightText} size={14} />
              <PathIcon d="M9 6l6 6-6 6" color={Colors.textMuted} size={16} weight={2} />
            </TouchableOpacity>
          ))}
        </Card>

        <Card index={4}>
          <View style={styles.cardHead}>
            <Text style={styles.heading}>How much of the deck is played</Text>
            <Text style={styles.aside}><Text style={styles.asideStrong}>{pct(r.read)}</Text> of cards</Text>
          </View>
          <View style={styles.track}>
            <Grow value={r.read} color={r.read < 0.8 ? '#C9573A' : Colors.gold} />
          </View>
          <Text style={styles.foot}>
            {r.unread.length
              ? `These have text the simulation doesn’t fully play, so they count as plain cards of their cost: ${r.unread.join(' · ')}.`
              : 'Every card’s text is played, or doesn’t matter when the deck plays alone.'}
          </Text>
          <Text style={styles.foot}>You see {r.seen.toFixed(1)} cards by turn 10 on average, card draw included.</Text>
        </Card>
      </>
    )
  }

  const hand = (r: SimReport) => (
    <>
      <View style={styles.tiles}>
        <Tile label="Keep 7" value={pct(r.keep[0], 1)} sub="First hand kept" />
        <Tile label="Mull to 6" value={pct(r.keep[1], 1)} sub="One card down" bad={r.keep[1] > 0.2} />
        <Tile label="5 or fewer" value={pct(r.keep[2], 1)} sub="Two or more" bad={r.keep[2] > 0.05} />
      </View>
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.heading}>Lands in your first seven</Text>
          <View style={styles.key}>
            <View style={styles.keyDot} />
            <Text style={styles.aside}>Kept</Text>
          </View>
        </View>
        <Columns label="Share of first hands by number of lands" values={r.openingLands} labels={r.openingLands.map((_, i) => String(i))} strong={(i) => r.keptAt[i] > 0.5} />
        <Text style={styles.foot}>{r.avgLands.toFixed(2)} lands on average in the hand you keep. A hand is kept with 2 to 5 lands{r.freeMulligan ? '; the first mulligan is free in this format' : ''}.</Text>
      </Card>
      <Card index={1}>
        <Text style={styles.heading}>Chance the hand you keep has…</Text>
        {r.opener.map((o) => <Line key={o.label} label={o.label} value={o.value} sub={o.sub} />)}
      </Card>
    </>
  )

  const mana = (r: SimReport) => (
    <>
      <View style={styles.tiles}>
        <Tile label="Mana screw" value={pct(r.screw, 1)} sub="2 or fewer lands on turn 4" bad={r.screw > 0.15} />
        <Tile label="Mana flood" value={pct(r.flood, 1)} sub="7 or more lands by turn 6" bad={r.flood > 0.2} />
      </View>
      <Card>
        <Text style={styles.heading}>Hitting every land drop</Text>
        <Columns label="Share of games with a land played every turn so far" values={r.drops} labels={r.drops.map((_, i) => `T${i + 1}`)} strong={(i) => i === 3} />
      </Card>
      {r.colors.length > 0 && (
        <Card index={1}>
          <View style={styles.cardHead}>
            <Text style={styles.heading}>Your colors by turn 3</Text>
            {r.allColors != null && <Text style={styles.aside}>All by turn 4: <Text style={styles.asideStrong}>{pct(r.allColors)}</Text></Text>}
          </View>
          {r.colors.map((c) => (
            <Line
              key={c.color}
              label={COLOR_NAME[c.color]}
              value={c.byTurn[2]}
              sub={`${c.sources} cards make it · turn 1: ${pct(c.byTurn[0])} · turn 2: ${pct(c.byTurn[1])}`}
              color={c.byTurn[2] < 0.85 ? '#C9573A' : Colors.gold}
              lead={<ManaSymbol symbol={c.color} size={26} />}
            />
          ))}
        </Card>
      )}
      {r.curve.length > 0 && (
        <Card index={2}>
          <Text style={styles.heading}>Castable on curve, right colors</Text>
          {r.curve.map((c) => (
            <Line key={c.def} label={c.name} value={c.value} sub={`Held on turn ${c.mv}: the lands and colors are there`} color={c.value < 0.6 ? '#C9573A' : Colors.gold} lead={art(c.def)} />
          ))}
        </Card>
      )}
      <Card index={3}>
        <View style={styles.cardHead}>
          <Text style={styles.heading}>Mana you have and use</Text>
          <View style={styles.key}>
            <View style={styles.keyDot} />
            <Text style={styles.aside}>Spent</Text>
          </View>
        </View>
        <View style={styles.columns} accessible accessibilityLabel={`Mana available and spent per turn: ${r.available.slice(0, 8).map((v, i) => `turn ${i + 1}, ${v.toFixed(1)} available, ${r.spent[i].toFixed(1)} spent`).join('; ')}`}>
          {r.available.slice(0, 8).map((v, i) => {
            const max = Math.max(...r.available.slice(0, 8), 0.001)
            return (
              <View key={i} style={styles.column}>
                <Text style={styles.columnValue}>{r.spent[i].toFixed(1)}</Text>
                <View style={styles.columnTrack}>
                  <View style={[styles.growTall, { height: `${(v / max) * 100}%`, backgroundColor: 'rgba(237,230,214,0.14)' }]} />
                  <View style={[StyleSheet.absoluteFill, styles.columnOver]}>
                    <Grow value={r.spent[i] / max} color={Colors.gold} vertical delay={i * 30} />
                  </View>
                </View>
              </View>
            )
          })}
        </View>
        <View style={styles.columnLabels}>
          {r.available.slice(0, 8).map((_, i) => <Text key={i} style={styles.columnLabel}>T{i + 1}</Text>)}
        </View>
        <Text style={styles.foot}>Numbers on top: mana spent that turn. The pale column is what your lands, rocks and mana creatures could make.</Text>
      </Card>
    </>
  )

  const cards = (r: SimReport) => {
    const rows = r.cards
      .filter((c) => c.onCurve != null)
      .sort((a, b) => (worstFirst ? (a.onCurve ?? 0) - (b.onCurve ?? 0) : (b.onCurve ?? 0) - (a.onCurve ?? 0)))
    const rest = r.cards.filter((c) => c.onCurve == null)
    return (
      <>
        <View style={styles.sortRow}>
          <Text style={styles.sortText}>How often each spell can be cast on the turn of its mana value, when you hold it then.</Text>
          <TouchableOpacity style={styles.sort} onPress={() => setWorstFirst(!worstFirst)} accessibilityRole="button" accessibilityLabel={worstFirst ? 'Sorted hardest to cast first. Tap for easiest first' : 'Sorted easiest to cast first. Tap for hardest first'}>
            <PathIcon d={I.swap} color={Colors.goldLight} size={16} weight={2} />
            <Text style={styles.sortLabel}>{worstFirst ? 'Hardest first' : 'Easiest first'}</Text>
          </TouchableOpacity>
        </View>
        <Card>
          {rows.map((c, i) => (
            <View key={c.def} style={i > 0 && styles.rule}>
              <Line
                label={c.name}
                value={c.onCurve ?? 0}
                sub={`${c.copies > 1 ? `${c.copies} copies · ` : ''}in your hand at the start ${pct(c.opening)}${c.castTurn != null ? ` · cast on turn ${c.castTurn.toFixed(1)} on average` : ''}`}
                color={(c.onCurve ?? 0) < 0.6 ? '#C9573A' : Colors.gold}
                lead={art(c.def)}
              />
            </View>
          ))}
          {rows.length === 0 && <Text style={styles.foot}>No spells to measure.</Text>}
        </Card>
        {rest.length > 0 && (
          <Card index={1}>
            <Text style={styles.heading}>Too rare or too expensive to measure</Text>
            <Text style={styles.foot}>{rest.map((c) => c.name).join(' · ')}</Text>
          </Card>
        )}
      </>
    )
  }

  return (
    <View style={styles.root}>
      <View style={styles.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
            <PathIcon d={I.back} color={Colors.text} size={22} weight={2} />
            <Text style={styles.backLabel}>Simulator</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rerun}
            onPress={() => {
              if (!run.deck) return
              startRun(run.deck, run.target)
              router.replace('/sim/run')
            }}
            accessibilityRole="button"
          >
            <PathIcon d={I.reset} color={Colors.goldLight} size={16} weight={2} />
            <Text style={styles.rerunLabel}>Run again</Text>
          </TouchableOpacity>
        </View>

        <View>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{r.deck}</Text>
          <Text style={styles.meta}>{r.format} · {number(r.games)} games</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsContent} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <TouchableOpacity key={t.id} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>

        <View key={tab} style={styles.sections}>
          {tab === 'overview' ? overview(r) : tab === 'hand' ? hand(r) : tab === 'mana' ? mana(r) : cards(r)}
        </View>

        <Text style={styles.note}>
          Each game: London mulligans, then ten turns of drawing, playing lands and casting what the mana allows, biggest first. Played from the cards’ text: card draw, looting, scry, land search and fetch lands, Treasures, rituals, tutors, tokens, burn, extra land drops, cycling, how each land comes in, mana rocks and mana creatures. Removal and other cards aimed at another player do nothing in a game alone. Cards it can’t fully play are listed in Overview.
        </Text>
      </ScrollView>
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
  glow: {
    position: 'absolute',
    left: -120,
    top: -200,
    width: 640,
    height: 480,
    experimental_backgroundImage: 'radial-gradient(closest-side, rgba(212,166,74,0.13), rgba(212,166,74,0))',
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    height: 44,
    marginLeft: -6,
    paddingLeft: 4,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backLabel: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Colors.text,
  },
  rerun: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rerunLabel: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  title: {
    fontSize: 38,
    lineHeight: 40,
    fontFamily: Fonts.serif,
    color: Colors.text,
  },
  meta: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Colors.textSecondary,
  },
  tabs: {
    flexGrow: 0,
    marginHorizontal: -20,
  },
  tabsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tab: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
    backgroundColor: Colors.surface,
    justifyContent: 'center',
  },
  tabOn: {
    borderWidth: 1.5,
    borderColor: Colors.gold,
    backgroundColor: 'rgba(212,166,74,0.14)',
  },
  tabLabel: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: '#CFC7B4',
  },
  tabLabelOn: {
    color: '#F0D8A0',
  },
  sections: {
    gap: 12,
  },
  card: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 12,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  cap: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  heading: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  aside: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Colors.textSecondary,
  },
  asideStrong: {
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  heroRow: {
    marginTop: -6,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  hero: {
    fontSize: 52,
    lineHeight: 58,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.goldLight,
  },
  sub: {
    marginTop: -8,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  split: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 2,
  },
  legend: {
    marginTop: -4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: '#CFC7B4',
  },
  tiles: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 2,
  },
  tileLabel: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.textSecondary,
  },
  tileValue: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  tileSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  columns: {
    height: 136,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  column: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    gap: 4,
  },
  columnValue: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: '#CFC7B4',
  },
  columnTrack: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'flex-end',
  },
  columnOver: {
    justifyContent: 'flex-end',
  },
  columnLabels: {
    marginTop: -6,
    flexDirection: 'row',
    gap: 6,
  },
  columnLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Colors.textMuted,
  },
  growTall: {
    width: '100%',
    minHeight: 2,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  growWide: {
    height: '100%',
    borderRadius: 4,
  },
  line: {
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lineBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  lineTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  lineLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Colors.text,
  },
  lineValue: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(237,230,214,0.08)',
    overflow: 'hidden',
  },
  lineSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  art: {
    width: 34,
    height: 48,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
  },
  key: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  keyDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: Colors.gold,
  },
  foot: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  insight: {
    minHeight: 56,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rule: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(237,230,214,0.07)',
  },
  insightValue: {
    width: 58,
    fontSize: 22,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.regular,
    color: '#CFC7B4',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sortText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  sort: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortLabel: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.regular,
    color: Colors.textMuted,
  },
  again: {
    height: 48,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againLabel: {
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
})
