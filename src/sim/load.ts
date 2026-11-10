import type { SQLiteDatabase } from 'expo-sqlite'

import { getCardRows } from '@/db/cards'
import { compileBare, compileCard, type CardDefs, type SimDeck } from '@/sim/cards'
import { getDeckStore, isCommander } from '@/utils/deck-store'

// A deck's main deck as the simulator plays it, with each card's rules data read from the phone.
// Sideboard and maybe cards stay out; commanders start in the command zone.
export async function loadSimDeck(db: SQLiteDatabase, deckId: string): Promise<SimDeck | null> {
  const store = getDeckStore()
  const deck = store.decks.find((d) => d.id === deckId)
  if (!deck) return null
  const lines = store.cards.filter((c) => c.deckId === deckId && c.board === 'main')
  const rows = await getCardRows(db, [...new Set(lines.map((c) => c.cardId))])
  const defs: CardDefs = {}
  for (const row of rows) {
    defs[row.id] = row.card ? compileCard(row.card) : compileBare(row.id, row.name, row.type_line, row.cmc)
  }
  const cards = lines
    .filter((c) => defs[c.cardId])
    .map((c) => ({ def: c.cardId, n: c.quantity, commander: isCommander(c, store.decks) || undefined }))
  return { id: deck.id, name: deck.name, format: deck.format, cards, defs }
}
