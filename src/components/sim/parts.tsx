import { Image } from 'expo-image'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { Sheet, SheetHeader } from '@/components/controls'
import { CROWN, PathIcon } from '@/components/deck/parts'
import { ManaSymbol } from '@/components/mana-symbol'
import { Colors, Fonts } from '@/constants/theme'
import { MANA } from '@/sim/cards'
import { faceOf, isType, power, toughness, type Game, type Inst } from '@/sim/engine'
import type { Pool } from '@/sim/mana'

// Pieces of the Play screen: the icons, a card on the table, and the sheet of actions.

// Stroke icons from the design (24 × 24).
export const I = {
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  play: 'M8 5.5v13l10.5-6.5z',
  graveyard: 'M7 21V9a5 5 0 0 1 10 0v12z',
  exile: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
  hand: 'M6 11V6.5a1.5 1.5 0 0 1 3 0V11M9 10V5a1.5 1.5 0 0 1 3 0v5M12 10V6a1.5 1.5 0 0 1 3 0v6M15 11V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2-3.5a1.5 1.5 0 0 1 2.5-1.6L6 15',
  tap: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  bottom: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  top: 'M12 20V8M7 13l5-5 5 5M5 4h14',
  shuffle: 'M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c1.5 0 2.5-.9 3.3-2M14 7h6M17 4l3 3-3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4 4',
  dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h.01M15 15h.01M15 9h.01M9 15h.01',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M9.5 9.5h4a1.75 1.75 0 0 1 0 3.5h-3a1.75 1.75 0 0 0 0 3.5h4',
  mill: 'M6 4h9a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6M10 12h10M17 9l3 3-3 3',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  tools: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5',
  swap: 'M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5',
  more: 'M5.5 12h0M12 12h0M18.5 12h0',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  swords: 'M5 19L19 5M14 5h5v5M5 5l5 5M14 14l5 5',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  crown: CROWN,
  token: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  flip: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  wifi: 'M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M12 19.5h.01',
}

export const CARD_RATIO = 88 / 63

const COUNTER_LOOK: Record<string, { bg: string; fg: string; text: (n: number) => string }> = {
  '+1/+1': { bg: '#4CA36A', fg: '#0B1A10', text: (n) => `+${n}` },
  '-1/-1': { bg: '#C9573A', fg: '#1A0B07', text: (n) => `−${n}` },
  loyalty: { bg: '#B98AB0', fg: '#1A0F18', text: (n) => `${n}` },
  defense: { bg: '#A7B4C2', fg: '#10151A', text: (n) => `${n}` },
  lore: { bg: Colors.gold, fg: Colors.onGold, text: (n) => `Lore ${n}` },
}

// A card or token on the table. Tapped cards lie on their side; a card this player may not see
// shows its back.
export function CardView({
  g,
  c,
  width,
  selected,
  mark,
  label,
  dim,
  plain,
  onPress,
  onLongPress,
}: {
  g: Game
  c: Inst
  width: number
  selected?: boolean
  // In combat: attacking (red), blocking (blue) or something to pick (gold dashes).
  mark?: 'attack' | 'block' | 'pick'
  // A letter that pairs blockers with what they block.
  label?: string
  dim?: boolean
  // Just the picture: no tapping, power and toughness or counters (hand, lists).
  plain?: boolean
  onPress?: () => void
  onLongPress?: () => void
}) {
  const height = Math.round(width * CARD_RATIO)
  const face = faceOf(g, c)
  const hidden = !g.defs[c.def] || c.faceDown
  const tapped = !plain && c.tapped
  const onTable = !plain && c.zone === 'battlefield'
  const creature = onTable && (isType(g, c, 'Creature') || c.faceDown)
  const counters = onTable ? Object.entries(c.counters).filter(([, n]) => n > 0) : []
  const border = selected ? Colors.gold : mark === 'attack' ? Colors.danger : mark === 'block' ? '#6FA3D6' : mark === 'pick' ? Colors.goldLight : 'rgba(237,230,214,0.2)'
  const strong = selected || mark != null
  const small = width < 50

  const words = [
    hidden ? 'Hidden card' : face.name,
    c.token ? 'token' : '',
    creature ? `${power(g, c)}/${toughness(g, c)}` : '',
    tapped ? 'tapped' : '',
    ...counters.map(([k, n]) => `${n} ${k} counters`),
    mark === 'attack' ? 'attacking' : mark === 'block' ? 'blocking' : '',
  ]

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={{ width: tapped ? height : width, height, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.45 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={words.filter(Boolean).join(', ')}
      accessibilityState={{ selected: !!selected }}
    >
      <View
        style={[
          styles.card,
          { width, height, borderRadius: Math.max(4, Math.round(width * 0.08)), borderColor: border, borderWidth: strong ? 2 : 1 },
          mark === 'pick' && { borderStyle: 'dashed' },
          tapped && { transform: [{ rotate: '90deg' }] },
          selected && !tapped && { transform: [{ translateY: -5 }] },
        ]}
      >
        {hidden ? (
          <View style={styles.back} />
        ) : face.thumb ? (
          <Image source={{ uri: small ? face.thumb : face.image ?? face.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
        ) : (
          <View style={styles.noArt}>
            <Text style={[styles.noArtName, small && { fontSize: 8, lineHeight: 10 }]} numberOfLines={3}>{face.name}</Text>
            {!small && <Text style={styles.noArtType} numberOfLines={2}>{face.typeLine.replace(/^Token /, '')}</Text>}
          </View>
        )}
        {c.token && !small && !hidden && (
          <View style={styles.tokenTag}>
            <Text style={styles.tokenText}>TOKEN</Text>
          </View>
        )}
        {c.commander && !hidden && (
          <View style={styles.crown}>
            <PathIcon d={CROWN} color={Colors.onGold} size={small ? 8 : 10} weight={2.4} />
          </View>
        )}
        {counters.length > 0 && (
          <View style={styles.counters}>
            {counters.slice(0, 2).map(([kind, n]) => {
              const look = COUNTER_LOOK[kind] ?? { bg: '#EDE6D6', fg: '#15130F', text: (k: number) => `${k} ${kind.slice(0, 4)}` }
              return (
                <View key={kind} style={[styles.pill, small && styles.pillSmall, { backgroundColor: look.bg }]}>
                  <Text style={[styles.pillText, small && styles.pillTextSmall, { color: look.fg }]}>{look.text(n)}</Text>
                </View>
              )
            })}
          </View>
        )}
        {creature && (
          <View style={[styles.pill, styles.pt, small && styles.pillSmall, c.damage > 0 && { backgroundColor: Colors.negative }]}>
            <Text style={[styles.pillText, small && styles.pillTextSmall]}>{power(g, c)}/{toughness(g, c)}</Text>
          </View>
        )}
        {label != null && (
          <View style={[styles.letter, { backgroundColor: mark === 'block' ? '#6FA3D6' : Colors.danger }]}>
            <Text style={styles.letterText}>{label}</Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}

// The mana in a player's pool, as symbols with a count each.
export function PoolRow({ pool, size = 16 }: { pool: Pool; size?: number }) {
  const shown = MANA.filter((m) => pool[m] > 0)
  if (!shown.length) return null
  return (
    <View style={styles.pool} accessible accessibilityLabel={`Mana pool: ${shown.map((m) => `${pool[m]} ${m}`).join(', ')}`}>
      {shown.map((m) => (
        <View key={m} style={styles.poolItem}>
          <ManaSymbol symbol={m} size={size} />
          {pool[m] > 1 && <Text style={styles.poolCount}>{pool[m]}</Text>}
        </View>
      ))}
    </View>
  )
}

export type SheetItem = {
  key: string
  label: string
  sub?: string
  // A stroke icon, a card picture or a mana symbol at the start of the row.
  icon?: string
  art?: string | null
  mana?: string
  // On: shown in gold with a check (switches).
  on?: boolean
  danger?: boolean
  // The sheet stays open after it (steppers, switches).
  keepOpen?: boolean
  run: () => void
}
export type SheetGroup = { title?: string; cols: 1 | 2; items: SheetItem[] }

// The design's sheet of actions: groups of buttons under small headings.
export function ActionSheet({
  visible,
  title,
  hint,
  groups,
  header,
  footer,
  tall,
  onBack,
  onClose,
}: {
  visible: boolean
  title: string
  hint?: string
  groups: SheetGroup[]
  header?: ReactNode
  footer?: ReactNode
  // Fills the screen (long lists).
  tall?: boolean
  onBack?: () => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose} fullHeight={tall}>
      <SheetHeader title={title} onClose={onClose} onBack={onBack} />
      <ScrollView style={tall ? styles.scrollTall : styles.scroll} contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {header}
        {groups.filter((group) => group.items.length).map((group, i) => (
          <View key={group.title ?? i} style={styles.group}>
            {group.title ? <Text style={styles.groupTitle} accessibilityRole="header">{group.title}</Text> : null}
            <View style={styles.grid}>
              {group.items.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.item, group.cols === 2 && styles.itemHalf, item.on && styles.itemOn]}
                  onPress={() => {
                    item.run()
                    if (!item.keepOpen) onClose()
                  }}
                  accessibilityRole={item.on != null ? 'switch' : 'button'}
                  accessibilityState={item.on != null ? { checked: item.on } : undefined}
                >
                  {item.art !== undefined ? (
                    <View style={styles.itemArt}>
                      {item.art ? <Image source={{ uri: item.art }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={styles.back} />}
                    </View>
                  ) : item.mana ? (
                    <ManaSymbol symbol={item.mana} size={26} />
                  ) : item.icon ? (
                    <View style={[styles.itemIcon, item.danger && { backgroundColor: 'rgba(238,132,102,0.12)' }]}>
                      <PathIcon d={item.on ? I.check : item.icon} color={item.danger ? Colors.danger : Colors.goldLight} size={17} weight={2} />
                    </View>
                  ) : null}
                  <View style={styles.itemText}>
                    <Text style={[styles.itemLabel, item.danger && { color: Colors.danger }]} numberOfLines={2}>{item.label}</Text>
                    {item.sub ? <Text style={styles.itemSub} numberOfLines={3}>{item.sub}</Text> : null}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        {footer}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceRaised,
    overflow: 'hidden',
    boxShadow: '0 6px 14px rgba(0,0,0,0.45)',
  },
  back: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: 'linear-gradient(135deg, #5A4220, #1E160A)',
    borderWidth: 3,
    borderColor: '#2A2214',
  },
  noArt: {
    flex: 1,
    padding: 4,
    gap: 2,
    experimental_backgroundImage: 'radial-gradient(circle at 50% 25%, #857C6C, #2D2A24 60%, #100F0D)',
  },
  noArtName: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  noArtType: {
    fontSize: 8,
    lineHeight: 10,
    fontFamily: Fonts.medium,
    color: '#CFC7B4',
  },
  tokenTag: {
    position: 'absolute',
    left: 3,
    top: 3,
    height: 13,
    paddingHorizontal: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(237,230,214,0.88)',
    justifyContent: 'center',
  },
  tokenText: {
    fontSize: 8,
    lineHeight: 10,
    fontFamily: Fonts.extraBold,
    letterSpacing: 0.4,
    color: '#15130F',
  },
  crown: {
    position: 'absolute',
    right: 2,
    top: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counters: {
    position: 'absolute',
    left: 2,
    bottom: 2,
    gap: 2,
    alignItems: 'flex-start',
  },
  pill: {
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 5,
    backgroundColor: Colors.text,
    justifyContent: 'center',
  },
  pillSmall: {
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 4,
  },
  pt: {
    position: 'absolute',
    right: 2,
    bottom: 2,
  },
  pillText: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: '#15130F',
  },
  pillTextSmall: {
    fontSize: 9,
    lineHeight: 11,
  },
  letter: {
    position: 'absolute',
    left: 2,
    top: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: Fonts.extraBold,
    color: '#0E0D0B',
  },
  pool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  poolItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  poolCount: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollTall: {
    flex: 1,
  },
  sheetBody: {
    gap: 14,
    paddingBottom: 8,
  },
  hint: {
    marginTop: -4,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  group: {
    gap: 8,
  },
  groupTitle: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  item: {
    width: '100%',
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.10)',
    backgroundColor: Colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemHalf: {
    width: '48.5%',
  },
  itemOn: {
    borderColor: 'rgba(212,166,74,0.45)',
    backgroundColor: 'rgba(212,166,74,0.08)',
  },
  itemArt: {
    width: 30,
    height: 42,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(212,166,74,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  itemSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
})
