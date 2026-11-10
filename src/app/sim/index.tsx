import { router } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PathIcon } from '@/components/deck/parts'
import { DeckThumb } from '@/components/decks/parts'
import { NearbySheet } from '@/components/sim/nearby-sheet'
import { I } from '@/components/sim/parts'
import { Colors, Fonts } from '@/constants/theme'
import { exactSize } from '@/rules/deck-stats'
import { loadSimDeck, rulesFor } from '@/sim/load'
import { hostGame, joinGame, startSolo, useSession } from '@/sim/session'
import { deckCardCount, useDeckStore, type Deck } from '@/utils/deck-store'

// Simulator (design S1), opened from Settings › Tools: pick your deck and who it plays against, then play it out by hand on this
// phone, or against someone on a second phone nearby.

type Slot = 'me' | 'opp'
// The opponent: a deck id, or nobody ("goldfish": your deck on its own).
const NOBODY = 'nobody'
const FISH = 'M3 12c3-4 7-5 11-3l4-3v12l-4-3c-4 2-8 1-11-3zM9.5 11h.01'

export default function SimulatorScreen() {
  const insets = useSafeAreaInsets()
  const db = useSQLiteContext()
  const store = useDeckStore()
  const session = useSession()
  const { decks, folders } = store
  const [slot, setSlot] = useState<Slot>('me')
  const [mine, setMine] = useState<string | null>(null)
  const [theirs, setTheirs] = useState<string>(NOBODY)
  const [folder, setFolder] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [nearby, setNearby] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const size = (d: Deck) => deckCardCount(d, store)
  const wanted = (d: Deck) => exactSize(d.format) ?? 60
  const myDeck = decks.find((d) => d.id === mine) ?? null
  const oppDeck = decks.find((d) => d.id === theirs) ?? null

  const text = query.trim().toLowerCase()
  const listed = decks.filter(
    (d) => (folder === 'all' || (folder === 'loose' ? d.folderId == null : d.folderId === folder)) && (!text || d.name.toLowerCase().includes(text)),
  )

  // The other phone answered: the game is on.
  const connected = session.link === 'connected' && session.g != null
  if (connected && nearby) setNearby(false)
  useEffect(() => {
    if (connected) router.push('/sim/play')
  }, [connected])

  const assign = (id: string) => {
    setProblem(null)
    if (slot === 'me') {
      setMine(id)
      setSlot('opp')
    } else setTheirs(id)
  }

  const play = async () => {
    if (!myDeck || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const a = await loadSimDeck(db, myDeck.id)
      const b = oppDeck ? await loadSimDeck(db, oppDeck.id) : null
      if (!a || (oppDeck && !b)) {
        setProblem('That deck couldn’t be read.')
        return
      }
      startSolo(a, b)
      router.push('/sim/play')
    } catch (e) {
      console.warn('Starting a game failed', e)
      setProblem('That deck couldn’t be read.')
    } finally {
      setBusy(false)
    }
  }

  const startNearby = async (name: string, address: string | null) => {
    if (!myDeck) return
    const deck = await loadSimDeck(db, myDeck.id).catch(() => null)
    if (!deck) {
      setProblem('That deck couldn’t be read.')
      setNearby(false)
      return
    }
    if (address == null) hostGame(deck, name)
    else joinGame(address, deck, name)
  }

  const meta = (d: Deck) => {
    const n = size(d)
    if (n === 0) return { text: 'Empty', warn: true }
    if (n < wanted(d)) return { text: `Incomplete · ${n} / ${wanted(d)}`, warn: true }
    return { text: `${d.format} · ${n}`, warn: false }
  }

  const slotCard = (key: Slot) => {
    const d = key === 'me' ? myDeck : oppDeck
    const active = slot === key
    return (
      <TouchableOpacity
        key={key}
        style={[styles.slot, active && styles.slotActive]}
        onPress={() => setSlot(key)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${key === 'me' ? 'Your deck' : 'Opponent'}: ${d ? d.name : key === 'me' ? 'not picked' : 'nobody'}${active ? ', picking now' : ', tap to change'}`}
      >
        <View style={styles.slotTop}>
          <Text style={[styles.slotCap, { color: key === 'me' ? Colors.goldLight : '#A9C4E2' }]}>{key === 'me' ? 'You' : 'Opponent'}</Text>
          {active && (
            <View style={styles.picking}>
              <Text style={styles.pickingText}>Picking</Text>
            </View>
          )}
        </View>
        {d ? <DeckThumb deckId={d.id} /> : (
          <View style={styles.noDeck}>
            <PathIcon d={key === 'me' ? I.plus : FISH} color="#CFC7B4" size={20} />
          </View>
        )}
        <View>
          <Text style={styles.slotName} numberOfLines={1}>{d ? d.name : key === 'me' ? 'Pick a deck' : 'Nobody'}</Text>
          <Text style={styles.slotMeta} numberOfLines={1}>{d ? meta(d).text : key === 'me' ? 'From the list below' : 'Your deck on its own'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  const rules = myDeck ? rulesFor(myDeck.format) : null
  const summary = !myDeck
    ? 'Pick your deck to start'
    : `${myDeck.name} vs ${oppDeck ? oppDeck.name : 'nobody'} · ${rules?.life} life${oppDeck && oppDeck.format !== myDeck.format ? ' · mixed formats' : ''}`

  return (
    <View style={styles.root}>
      <View style={styles.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 190 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <PathIcon d={I.back} color={Colors.text} size={22} weight={2} />
          <Text style={styles.backLabel}>Settings</Text>
        </TouchableOpacity>

        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">Simulator</Text>
          <Text style={styles.lead}>Play your decks out by hand, with the rules of the game keeping track: alone, both sides yourself, or against a friend on a second phone.</Text>
        </View>

        <View style={styles.slots}>
          {slotCard('me')}
          {slotCard('opp')}
          <TouchableOpacity
            style={styles.swap}
            onPress={() => {
              if (!oppDeck || !myDeck) return
              setMine(oppDeck.id)
              setTheirs(myDeck.id)
            }}
            accessibilityRole="button"
            accessibilityLabel="Swap decks"
          >
            <PathIcon d={I.swap} color={Colors.onGold} size={20} weight={2.2} />
          </TouchableOpacity>
        </View>

        <View style={styles.listHead}>
          <Text style={styles.section} accessibilityRole="header">Your decks</Text>
          <Text style={styles.setting}>Tap to set <Text style={styles.settingWho}>{slot === 'me' ? 'your deck' : 'the opponent'}</Text></Text>
        </View>
        <View style={styles.search}>
          <PathIcon d={I.search} color={Colors.textSecondary} size={18} weight={1.75} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search decks"
            placeholderTextColor={Colors.textMuted}
            accessibilityLabel="Search your decks"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {folders.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            {[{ id: 'all', name: 'All' }, { id: 'loose', name: 'Not in a folder' }, ...folders].map((f) => {
              const on = folder === f.id
              return (
                <TouchableOpacity key={f.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setFolder(f.id)} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{f.name}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}

        <View style={styles.list}>
          {slot === 'opp' && (
            <TouchableOpacity
              style={[styles.deck, theirs === NOBODY && styles.deckOpp]}
              onPress={() => setTheirs(NOBODY)}
              accessibilityRole="button"
              accessibilityState={{ selected: theirs === NOBODY }}
            >
              <View style={styles.fish}>
                <PathIcon d={FISH} color="#CFC7B4" size={22} weight={1.75} />
              </View>
              <View style={styles.deckText}>
                <Text style={styles.deckName}>No opponent (goldfish)</Text>
                <Text style={styles.deckMeta}>Your deck on its own: draws, mana, how fast it gets going</Text>
              </View>
              {theirs === NOBODY && <Tag label="OPP" blue />}
            </TouchableOpacity>
          )}
          {listed.map((d, i) => {
            const m = meta(d)
            const empty = size(d) === 0
            const isMe = d.id === mine
            const isOpp = d.id === theirs
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.deck, (i > 0 || slot === 'opp') && styles.deckRule, isMe && styles.deckMe, isOpp && styles.deckOpp, empty && { opacity: 0.5 }]}
                onPress={() => assign(d.id)}
                disabled={empty}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}, ${m.text}${isMe ? ', your deck' : ''}${isOpp ? ', opponent' : ''}${empty ? ', empty, can’t be played' : ''}`}
              >
                <DeckThumb deckId={d.id} />
                <View style={styles.deckText}>
                  <Text style={styles.deckName} numberOfLines={1}>{d.name}</Text>
                  <Text style={[styles.deckMeta, m.warn && { color: Colors.goldLight }]} numberOfLines={1}>{m.text}</Text>
                </View>
                {isMe && <Tag label="YOU" />}
                {isOpp && <Tag label="OPP" blue />}
              </TouchableOpacity>
            )
          })}
          {listed.length === 0 && (
            <Text style={styles.none}>{decks.length ? 'No decks match.' : 'No decks yet. Make one in Decks, then come back.'}</Text>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={[styles.summary, problem != null && { color: Colors.danger }]} numberOfLines={1}>{problem ?? summary}</Text>
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.button, styles.buttonPlain, !myDeck && styles.off]} onPress={() => setNearby(true)} disabled={!myDeck} accessibilityRole="button">
            <View style={styles.buttonRow}>
              <PathIcon d={I.wifi} color={Colors.text} size={18} weight={2} />
              <Text style={styles.buttonLabel}>Two phones</Text>
            </View>
            <Text style={styles.buttonSub}>same Wi-Fi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonGold, (!myDeck || busy) && styles.off]} onPress={play} disabled={!myDeck || busy} accessibilityRole="button">
            <View style={styles.buttonRow}>
              <PathIcon d={I.play} color={Colors.onGold} size={18} weight={2} />
              <Text style={[styles.buttonLabel, { color: Colors.onGold }]}>Play</Text>
            </View>
            <Text style={[styles.buttonSub, { color: '#3D2F12' }]}>{oppDeck ? 'both sides, this phone' : 'on your own'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <NearbySheet visible={nearby} deckName={myDeck?.name ?? null} onStart={startNearby} onClose={() => setNearby(false)} />
    </View>
  )
}

function Tag({ label, blue }: { label: string; blue?: boolean }) {
  return (
    <View style={[styles.tag, blue && { backgroundColor: '#6FA3D6' }]}>
      <Text style={[styles.tagText, blue && { color: '#0E1520' }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
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
    gap: 18,
  },
  back: {
    alignSelf: 'flex-start',
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
  head: {
    marginTop: -10,
    gap: 8,
  },
  title: {
    fontSize: 42,
    lineHeight: 46,
    fontFamily: Fonts.serif,
    color: Colors.text,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  slots: {
    flexDirection: 'row',
    gap: 10,
  },
  slot: {
    flex: 1,
    height: 148,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.10)',
    backgroundColor: Colors.surface,
    justifyContent: 'space-between',
  },
  slotActive: {
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  slotTop: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotCap: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  picking: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: 'rgba(212,166,74,0.16)',
    justifyContent: 'center',
  },
  pickingText: {
    fontSize: 11,
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  noDeck: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(237,230,214,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotName: {
    fontSize: 15,
    lineHeight: 19,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  slotMeta: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  swap: {
    position: 'absolute',
    left: '50%',
    top: 52,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 5px #0E0D0B',
  },
  listHead: {
    marginHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  section: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  setting: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: '#CFC7B4',
  },
  settingWho: {
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  search: {
    height: 46,
    marginTop: -8,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    height: 46,
    padding: 0,
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Colors.text,
  },
  chips: {
    flexGrow: 0,
    marginTop: -8,
    marginHorizontal: -20,
  },
  chipsContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
    backgroundColor: Colors.surface,
    justifyContent: 'center',
  },
  chipOn: {
    borderWidth: 1.5,
    borderColor: Colors.gold,
    backgroundColor: 'rgba(212,166,74,0.14)',
  },
  chipLabel: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: '#CFC7B4',
  },
  chipLabelOn: {
    color: '#F0D8A0',
  },
  list: {
    marginTop: -8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  deck: {
    minHeight: 68,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deckRule: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(237,230,214,0.07)',
  },
  deckMe: {
    backgroundColor: 'rgba(212,166,74,0.07)',
  },
  deckOpp: {
    backgroundColor: 'rgba(111,163,214,0.07)',
  },
  fish: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(237,230,214,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  deckName: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Colors.text,
  },
  deckMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  none: {
    padding: 20,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  tag: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 11,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 40,
    paddingHorizontal: 20,
    gap: 12,
    experimental_backgroundImage: 'linear-gradient(to bottom, rgba(14,13,11,0), #0E0D0B 30%)',
  },
  summary: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: '#CFC7B4',
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPlain: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.18)',
    backgroundColor: Colors.surface,
  },
  buttonGold: {
    flex: 1.35,
    backgroundColor: Colors.gold,
    boxShadow: '0 10px 26px rgba(212,166,74,0.22)',
  },
  off: {
    opacity: 0.45,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  buttonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  buttonSub: {
    fontSize: 12,
    lineHeight: 15,
    fontFamily: Fonts.bold,
    color: Colors.textSecondary,
  },
})
