import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

import { Draggable } from '@/components/sim/draggable'
import { CardView } from '@/components/sim/parts'
import type { Game, Inst } from '@/sim/engine'

const GLIDE = { duration: 200, easing: Easing.out(Easing.cubic) }

// A card in the hand's fan. Tap it to hold it up close; drag it onto the table to play it, or
// onto the graveyard, exile or library. It glides to its new place when the hand changes.
export function HandCard({
  g,
  c,
  width,
  left,
  // How far from the middle of the fan, in cards (negative: to the left).
  offset,
  order,
  dragging,
  dragX,
  dragY,
  onTap,
  onDragStart,
  onDrop,
}: {
  g: Game
  c: Inst
  width: number
  left: number
  offset: number
  order: number
  // This card is the one being dragged: it fades where it was.
  dragging: boolean
  dragX: SharedValue<number>
  dragY: SharedValue<number>
  onTap: () => void
  onDragStart: (id: number) => void
  onDrop: (id: number, x: number, y: number) => void
}) {
  const place = useSharedValue(left)
  const fan = useSharedValue(offset)
  useEffect(() => {
    place.set(withTiming(left, GLIDE))
    fan.set(withTiming(offset, GLIDE))
  }, [place, fan, left, offset])

  const style = useAnimatedStyle(() => {
    const off = fan.get()
    return { left: place.get(), transform: [{ translateY: off * off * 2.2 }, { rotate: `${off * 3.5}deg` }] }
  })

  return (
    <Draggable id={c.id} x={dragX} y={dragY} onStart={onDragStart} onDrop={onDrop}>
      <Animated.View style={[styles.card, { zIndex: order, opacity: dragging ? 0.25 : 1 }, style]} entering={FadeIn.duration(160)}>
        <CardView g={g} c={c} width={width} plain onPress={onTap} />
      </Animated.View>
    </Draggable>
  )
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 18,
  },
})
