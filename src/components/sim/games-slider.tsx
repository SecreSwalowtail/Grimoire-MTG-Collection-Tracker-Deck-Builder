import { useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import { Colors } from '@/constants/theme'

// How many games to simulate: a slider from 1,000 to 1,000,000. The scale is logarithmic, so the
// small numbers aren't squeezed into the first few pixels, and values are round numbers.

const MIN = 1000
const MAX = 1000000
const THUMB = 26

// 0…1 along the track -> games, rounded to two digits (1,000 · 1,500 · 2,000 … 950,000 · 1,000,000).
function gamesAt(share: number) {
  const raw = MIN * Math.pow(MAX / MIN, Math.min(1, Math.max(0, share)))
  const unit = Math.pow(10, Math.floor(Math.log10(raw)) - 1)
  const rounded = Math.round(raw / (unit * 5)) * unit * 5
  return Math.min(MAX, Math.max(MIN, rounded))
}
const shareOf = (games: number) => Math.log(games / MIN) / Math.log(MAX / MIN)

export function GamesSlider({ value, onChange }: { value: number; onChange: (games: number) => void }) {
  const track = useRef<View>(null)
  // Where the track is on screen, measured when a drag starts.
  const box = useRef({ x: 0, width: 1 })
  const move = (pageX: number) => onChange(gamesAt((pageX - box.current.x - THUMB / 2) / Math.max(1, box.current.width - THUMB)))

  const share = shareOf(value)
  return (
    <View
      ref={track}
      style={styles.track}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        const pageX = e.nativeEvent.pageX
        track.current?.measureInWindow((x, _y, width) => {
          box.current = { x, width }
          move(pageX)
        })
      }}
      onResponderMove={(e) => move(e.nativeEvent.pageX)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Games to simulate"
      accessibilityValue={{ text: `${value.toLocaleString('en-US')} games` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(gamesAt(share + (e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)))}
    >
      <View style={styles.rail}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
      <View style={[styles.thumbBox, { left: `${share * 100}%` }]} pointerEvents="none">
        <View style={styles.thumb} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: THUMB / 2,
  },
  rail: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(237,230,214,0.12)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: Colors.gold,
  },
  // Spans the rail, so `left` in percent runs along it.
  thumbBox: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    marginHorizontal: THUMB / 2,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: Colors.goldLight,
    borderWidth: 3,
    borderColor: Colors.background,
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
})
