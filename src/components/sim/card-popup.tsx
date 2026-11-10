import { BlurView } from 'expo-blur'
import { Image } from 'expo-image'
import type { RefObject } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { OracleText } from '@/components/card/oracle-text'
import { PathIcon } from '@/components/deck/parts'
import { CostRow } from '@/components/mana-symbol'
import { CARD_RATIO, GroupList, I, type SheetGroup } from '@/components/sim/parts'
import { Colors, Fonts } from '@/constants/theme'
import { faceOf, isType, power, toughness, type Game, type Inst } from '@/sim/engine'

// A card held up close: tap any card and it comes out over the blurred table, with its text and
// everything that can be done with it underneath. Tap beside it (or the cross) to put it down.
export function CardPopup({
  g,
  c,
  groups,
  blurTarget,
  onClose,
}: {
  g: Game
  c: Inst
  groups: SheetGroup[]
  // The table behind, for Android's blur (iOS blurs whatever is underneath).
  blurTarget: RefObject<View | null>
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const def = g.defs[c.def]
  const hidden = !def || (c.faceDown && c.zone === 'battlefield')
  const face = faceOf(g, c)
  const cardWidth = Math.min(width - 110, Math.round((height * 0.42) / CARD_RATIO), 300)
  const cardHeight = Math.round(cardWidth * CARD_RATIO)
  const onTable = c.zone === 'battlefield'
  const creature = onTable && isType(g, c, 'Creature')
  const counters = Object.entries(c.counters).filter(([, n]) => n > 0)
  const facts = [
    creature ? `${power(g, c)}/${toughness(g, c)}` : '',
    ...counters.map(([kind, n]) => `${n} ${kind}`),
    onTable && c.tapped ? 'Tapped' : '',
    onTable && c.sick && creature ? 'Summoning sick' : '',
    c.damage ? `${c.damage} damage` : '',
    c.token ? 'Token' : '',
    c.attachedTo != null && c.attachedTo >= 0 ? `On ${faceOf(g, g.cards[c.attachedTo]).name}` : '',
  ].filter(Boolean)

  return (
    <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(140)} exiting={FadeOut.duration(110)} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <BlurView style={StyleSheet.absoluteFill} intensity={60} tint="dark" blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" />
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable
          style={[styles.content, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 28, minHeight: height }]}
          onPress={onClose}
          accessibilityLabel="Put the card down"
        >
          <View style={[styles.card, { width: cardWidth, height: cardHeight, borderRadius: Math.round(cardWidth * 0.05) }]}>
            {hidden ? (
              <View style={styles.back} />
            ) : face.image ? (
              <Image source={{ uri: face.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={styles.plain}>
                <View style={styles.plainTop}>
                  <Text style={styles.plainName} numberOfLines={2}>{face.name}</Text>
                  <CostRow cost={face.cost} size={15} />
                </View>
                <Text style={styles.plainType}>{face.typeLine}</Text>
                {face.power != null && <Text style={styles.plainStats}>{face.power}/{face.toughness}</Text>}
              </View>
            )}
          </View>

          {/* Taps on what follows don't put the card down. */}
          <View style={styles.below} onStartShouldSetResponder={() => true}>
            {facts.length > 0 && (
              <View style={styles.facts}>
                {facts.map((fact) => (
                  <View key={fact} style={styles.fact}>
                    <Text style={styles.factText}>{fact}</Text>
                  </View>
                ))}
              </View>
            )}
            {!hidden && def.faces.some((f) => f.text) && (
              <View style={styles.text}>
                {def.faces.map((f, i) => (
                  <View key={i} style={styles.face}>
                    {def.faces.length > 1 && <Text style={styles.faceName}>{f.name}</Text>}
                    {f.text ? <OracleText text={f.text} /> : null}
                  </View>
                ))}
              </View>
            )}
            <GroupList groups={groups} onDone={onClose} />
          </View>
        </Pressable>
      </ScrollView>
      <TouchableOpacity style={[styles.close, { top: insets.top + 6 }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <PathIcon d={I.close} color={Colors.text} size={20} weight={2} />
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(8,7,5,0.62)',
  },
  content: {
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 16,
  },
  card: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.22)',
    boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
  },
  back: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: 'linear-gradient(135deg, #5A4220, #1E160A)',
    borderWidth: 8,
    borderColor: '#2A2214',
  },
  plain: {
    flex: 1,
    padding: 14,
    gap: 8,
    experimental_backgroundImage: 'radial-gradient(circle at 50% 25%, #857C6C, #2D2A24 60%, #100F0D)',
  },
  plainTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  plainName: {
    flex: 1,
    fontSize: 20,
    lineHeight: 23,
    fontFamily: Fonts.serifBold,
    color: Colors.text,
  },
  plainType: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: '#CFC7B4',
  },
  plainStats: {
    marginTop: 'auto',
    alignSelf: 'flex-end',
    fontSize: 22,
    fontFamily: Fonts.extraBold,
    color: Colors.text,
  },
  below: {
    alignSelf: 'stretch',
    gap: 14,
  },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  fact: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(212,166,74,0.16)',
    justifyContent: 'center',
  },
  factText: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  text: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.10)',
    backgroundColor: 'rgba(23,21,15,0.82)',
    gap: 10,
  },
  face: {
    gap: 4,
  },
  faceName: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: Colors.goldLight,
  },
  close: {
    position: 'absolute',
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.16)',
    backgroundColor: 'rgba(23,21,15,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
