import type { ReactNode } from 'react'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import type { SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

// Makes a card draggable. The card itself stays where it is: the Play screen draws a copy of it
// under the finger, above everything else, and decides what the drop means from where it lands.
// `x` and `y` are the finger's place on screen while dragging.
export function Draggable({
  id,
  x,
  y,
  hold,
  onStart,
  onDrop,
  children,
}: {
  id: number
  x: SharedValue<number>
  y: SharedValue<number>
  // Start only after holding the card for a moment (cards in rows that scroll sideways).
  hold?: boolean
  onStart: (id: number) => void
  // Where it was let go, or (-1, -1) when the drag was cancelled.
  onDrop: (id: number, x: number, y: number) => void
  children: ReactNode
}) {
  const base = Gesture.Pan()
  const pan = (hold ? base.activateAfterLongPress(220) : base.minDistance(10))
    .onStart((e) => {
      x.set(e.absoluteX)
      y.set(e.absoluteY)
      scheduleOnRN(onStart, id)
    })
    .onChange((e) => {
      x.set(e.absoluteX)
      y.set(e.absoluteY)
    })
    .onEnd((e) => {
      scheduleOnRN(onDrop, id, e.absoluteX, e.absoluteY)
    })
    .onFinalize((_e, success) => {
      if (!success) scheduleOnRN(onDrop, id, -1, -1)
    })
  return <GestureDetector gesture={pan}>{children}</GestureDetector>
}
