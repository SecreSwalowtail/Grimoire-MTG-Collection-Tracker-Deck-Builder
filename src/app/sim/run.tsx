import { useKeepAwake } from 'expo-keep-awake'
import { router } from 'expo-router'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle } from 'react-native-svg'

import { PathIcon } from '@/components/deck/parts'
import { I } from '@/components/sim/parts'
import { Colors, Fonts } from '@/constants/theme'
import { cancelRun, startRun, useRun } from '@/sim/sim-run'

// Simulate (design S3): the games being played, with a few numbers as they come in. It keeps
// going if you leave the screen.

const R = 100
const ROUND = 2 * Math.PI * R
const number = (n: number) => n.toLocaleString('en-US')

function timeLeft(seconds: number | null) {
  if (seconds == null) return '…'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export default function RunScreen() {
  useKeepAwake()
  const insets = useSafeAreaInsets()
  const run = useRun()
  const done = run.status === 'done'
  const share = run.target ? Math.min(1, run.games / run.target) : 0
  const pct = (v: number) => (run.games ? `${(v * 100).toFixed(1)}%` : '—')

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.glow} pointerEvents="none" />
      <TouchableOpacity
        style={styles.back}
        onPress={() => router.back()}
        accessibilityRole="button"
      >
        <PathIcon d={I.back} color={Colors.text} size={22} weight={2} />
        <Text style={styles.backLabel}>Simulator</Text>
      </TouchableOpacity>

      <View style={styles.head}>
        <Text style={styles.status}>{done ? `${number(run.target)} games · done` : run.status === 'running' ? 'Simulating' : 'Stopped'}</Text>
        <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{run.deck?.name ?? 'No deck'}</Text>
      </View>

      <View
        style={styles.ring}
        accessibilityRole="progressbar"
        accessibilityLabel="Games simulated"
        accessibilityValue={{ min: 0, max: run.target, now: run.games }}
      >
        <Svg width={232} height={232} viewBox="0 0 232 232" style={styles.ringSvg}>
          <Circle cx={116} cy={116} r={R} fill="none" stroke="#221F17" strokeWidth={14} />
          <Circle cx={116} cy={116} r={R} fill="none" stroke={Colors.gold} strokeWidth={14} strokeLinecap="round" strokeDasharray={ROUND} strokeDashoffset={ROUND * (1 - share)} />
        </Svg>
        <Text style={styles.percent}>{Math.floor(share * 100)}%</Text>
        <Text style={styles.count}>{number(run.games)} / {number(run.target)}</Text>
      </View>

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={[styles.tileValue, { color: Colors.goldLight }]}>{pct(run.live.keep7)}</Text>
          <Text style={styles.tileLabel}>Hands kept at seven</Text>
        </View>
        <View style={[styles.tile, styles.tileRule]}>
          <Text style={styles.tileValue}>{pct(run.live.onCurve)}</Text>
          <Text style={styles.tileLabel}>Spells castable on curve</Text>
        </View>
        <View style={[styles.tile, styles.tileRule]}>
          <Text style={styles.tileValue}>{done ? 'Done' : timeLeft(run.secondsLeft)}</Text>
          <Text style={styles.tileLabel}>Time left</Text>
        </View>
      </View>

      <View style={styles.chips}>
        {['London mulligan', 'Half on the play, half on the draw', 'Ten turns a game', 'Runs on your phone'].map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipText}>{chip}</Text>
          </View>
        ))}
      </View>

      <View style={styles.spacer} />

      {done ? (
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.plain, { width: 120 }]} onPress={() => run.deck && startRun(run.deck, run.target)} accessibilityRole="button">
            <Text style={styles.plainLabel}>Run again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.gold} onPress={() => router.replace('/sim/stats')} accessibilityRole="button">
            <Text style={styles.goldLabel}>See statistics</Text>
            <PathIcon d="M5 12h14M13 6l6 6-6 6" color={Colors.onGold} size={18} weight={2.25} />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={styles.note}>You can leave this screen: it keeps going while the app is open.</Text>
          <TouchableOpacity
            style={styles.plain}
            onPress={() => {
              cancelRun()
              router.back()
            }}
            accessibilityRole="button"
          >
            <Text style={styles.plainLabel}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: Colors.background,
  },
  glow: {
    position: 'absolute',
    left: -125,
    top: 120,
    width: 640,
    height: 520,
    experimental_backgroundImage: 'radial-gradient(closest-side, rgba(212,166,74,0.14), rgba(212,166,74,0))',
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
    marginTop: 6,
    alignItems: 'center',
    gap: 8,
  },
  status: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  title: {
    fontSize: 34,
    lineHeight: 36,
    fontFamily: Fonts.serif,
    color: Colors.text,
    textAlign: 'center',
  },
  ring: {
    marginTop: 26,
    alignSelf: 'center',
    width: 232,
    height: 232,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSvg: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  percent: {
    fontSize: 44,
    lineHeight: 50,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  count: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: Fonts.bold,
    fontVariant: ['tabular-nums'],
    color: Colors.textSecondary,
  },
  tiles: {
    marginTop: 28,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
  },
  tile: {
    flex: 1,
    padding: 14,
    gap: 3,
  },
  tileRule: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  tileValue: {
    fontSize: 22,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.text,
  },
  tileLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  chips: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(237,230,214,0.05)',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: '#CFC7B4',
  },
  spacer: {
    flex: 1,
  },
  note: {
    marginBottom: 12,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  plain: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainLabel: {
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  gold: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  goldLabel: {
    fontSize: 16,
    fontFamily: Fonts.extraBold,
    color: Colors.onGold,
  },
})
