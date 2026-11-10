import Storage from 'expo-sqlite/kv-store'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import { PrimaryButton, Segmented, Sheet, SheetHeader } from '@/components/controls'
import { NameField } from '@/components/decks/parts'
import { Colors, Fonts } from '@/constants/theme'
import { leave, useSession } from '@/sim/session'

// Two phones: one opens a game and shows a number, the other types it in. Both have to be on the
// same Wi-Fi (or one on the other's hotspot); nothing goes over the internet.

const NAME_KEY = 'sim-name'

function savedName() {
  try {
    return Storage.getItemSync(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function NearbySheet({
  visible,
  deckName,
  onStart,
  onClose,
}: {
  visible: boolean
  // The deck this phone plays; null while nothing is picked.
  deckName: string | null
  // Opens or joins with the name typed in. `address`: what the joining player typed.
  onStart: (name: string, address: string | null) => void
  onClose: () => void
}) {
  const session = useSession()
  const [role, setRole] = useState<'host' | 'join'>('host')
  const [name, setName] = useState(savedName)
  const [address, setAddress] = useState('')
  const busy = session.mode === 'host' || session.mode === 'guest'
  const working = busy && (session.link === 'opening' || session.link === 'joining')
  const waiting = session.mode === 'host' && session.link === 'waiting'
  const failed = busy && session.link === 'failed'

  const start = () => {
    const who = name.trim() || (role === 'host' ? 'Host' : 'Guest')
    try {
      Storage.setItemSync(NAME_KEY, name.trim())
    } catch {}
    onStart(who, role === 'join' ? address : null)
  }
  const cancel = () => {
    if (busy && session.link !== 'connected') leave()
    onClose()
  }

  // Leaving the sheet any other way (back button, drag) also stops waiting.
  useEffect(() => {
    if (!visible && busy && session.link !== 'connected') leave()
  }, [visible, busy, session.link])

  const room = session.address?.split('.').pop()

  return (
    <Sheet visible={visible} onClose={cancel}>
      <SheetHeader title="Two phones" onClose={cancel} />
      <View style={styles.body}>
        {waiting ? (
          <>
            <Text style={styles.hint}>On the other phone: Settings, Tools, Simulator, pick a deck, Two phones, Join. Then type this number.</Text>
            <View style={styles.room} accessible accessibilityLabel={`Game number ${room}. Full address ${session.address}`}>
              <Text style={styles.roomLabel}>Game number</Text>
              <Text style={styles.roomNumber}>{room}</Text>
              <Text style={styles.roomAddress}>or the full address: {session.address}</Text>
            </View>
            <View style={styles.status}>
              <ActivityIndicator color={Colors.gold} />
              <Text style={styles.statusText}>Waiting for the other player…</Text>
            </View>
            <TouchableOpacity style={styles.plain} onPress={cancel} accessibilityRole="button">
              <Text style={styles.plainLabel}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Play against someone next to you, each on your own phone. Both phones need the same Wi-Fi, or one joins the other’s hotspot.
            </Text>
            <Segmented
              options={[{ value: 'host', label: 'Open a game' }, { value: 'join', label: 'Join a game' }]}
              value={role}
              onChange={setRole}
              label="Open or join a game"
            />
            <NameField label="Your name" value={name} onChange={setName} placeholder="Shown to the other player" />
            {role === 'join' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Game number</Text>
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="The number on the other phone"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numbers-and-punctuation"
                  autoCorrect={false}
                  accessibilityLabel="Game number, or the other phone's full address"
                  maxLength={15}
                />
              </View>
            )}
            {failed && <Text style={styles.error} accessibilityRole="alert">{session.note}</Text>}
            {working ? (
              <View style={styles.status}>
                <ActivityIndicator color={Colors.gold} />
                <Text style={styles.statusText}>{role === 'host' ? 'Opening…' : 'Joining…'}</Text>
              </View>
            ) : deckName == null ? (
              <Text style={styles.error}>Pick your deck first.</Text>
            ) : (
              <PrimaryButton label={role === 'host' ? `Open with ${deckName}` : `Join with ${deckName}`} onPress={start} />
            )}
          </>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: {
    gap: 16,
    paddingBottom: 8,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  room: {
    paddingVertical: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(212,166,74,0.35)',
    backgroundColor: 'rgba(212,166,74,0.08)',
    alignItems: 'center',
    gap: 2,
  },
  roomLabel: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  roomNumber: {
    fontSize: 64,
    lineHeight: 70,
    fontFamily: Fonts.extraBold,
    fontVariant: ['tabular-nums'],
    color: Colors.goldLight,
  },
  roomAddress: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: '#CFC7B4',
  },
  status: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Colors.text,
  },
  plain: {
    height: 54,
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
  field: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: Fonts.extraBold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: Colors.textSecondary,
  },
  input: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(237,230,214,0.12)',
    backgroundColor: Colors.background,
    color: Colors.text,
    fontSize: 17,
    fontFamily: Fonts.bold,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Fonts.bold,
    color: Colors.danger,
  },
})
