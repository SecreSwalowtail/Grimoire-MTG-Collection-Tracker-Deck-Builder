import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { CardView } from '@/components/sim/parts'
import type { Game, Inst } from '@/sim/engine'

// Dragging a card this far up out of the hand plays it.
const PLAY_DISTANCE = 90
const SETTLE = { damping: 18, stiffness: 240 }

// A card in the hand's fan. Tap it to hold it up close; drag it up onto the battlefield to play
// or cast it. It slides to its new place when the hand changes.
export function HandCard({
  g,
  c,
  width,
  left,
  // How far from the middle of the fan, in cards (negative: to the left).
  offset,
  order,
  onTap,
  onPlay,
  onDrag,
}: {
  g: Game
  c: Inst
  width: number
  left: number
  offset: number
  order: number
  onTap: () => void
  onPlay: () => void
  // Dragging started or stopped (the battlefield lights up as the place to drop).
  onDrag: (dragging: boolean) => void
}) {
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const held = useSharedValue(0)
  const place = useSharedValue(left)
  const fan = useSharedValue(offset)
  useEffect(() => {
    place.set(withTiming(left, { duration: 220 }))
    fan.set(withTiming(offset, { duration: 220 }))
  }, [place, fan, left, offset])

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onStart(() => {
      held.set(withTiming(1, { duration: 120 }))
      scheduleOnRN(onDrag, true)
    })
    .onChange((e) => {
      x.set(x.get() + e.changeX)
      y.set(y.get() + e.changeY)
    })
    .onEnd(() => {
      if (y.get() < -PLAY_DISTANCE) scheduleOnRN(onPlay)
    })
    .onFinalize(() => {
      x.set(withSpring(0, SETTLE))
      y.set(withSpring(0, SETTLE))
      held.set(withTiming(0, { duration: 160 }))
      scheduleOnRN(onDrag, false)
    })

  const style = useAnimatedStyle(() => {
    const flat = 1 - held.get()
    const off = fan.get()
    return {
      left: place.get(),
      zIndex: held.get() > 0 ? 100 : order,
      transform: [
        { translateX: x.get() },
        { translateY: y.get() + off * off * 2.2 * flat },
        { rotate: `${off * 3.5 * flat}deg` },
        { scale: 1 + 0.12 * held.get() },
      ],
    }
  })

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, style]} entering={FadeInDown.duration(220)}>
        <CardView g={g} c={c} width={width} plain onPress={onTap} onLongPress={onTap} />
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 18,
  },
})
