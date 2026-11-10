// What a format changes about a game between two players: starting life, how much combat damage
// from one commander loses the game (0: no such rule), and whether the first mulligan is free.
export function rulesFor(format: string): { life: number; cmdLethal: number; freeMulligan: boolean } {
  switch (format) {
    // Commander games give everyone one free mulligan (back to seven cards).
    case 'Commander':
    case 'PreDH':
      return { life: 40, cmdLethal: 21, freeMulligan: true }
    case 'Pauper Commander':
      return { life: 30, cmdLethal: 16, freeMulligan: true }
    case 'Duel Commander':
      return { life: 20, cmdLethal: 21, freeMulligan: true }
    case 'Oathbreaker':
      return { life: 20, cmdLethal: 0, freeMulligan: true }
    case 'Brawl':
    case 'Standard Brawl':
    case 'Competitive Brawl':
      return { life: 25, cmdLethal: 0, freeMulligan: true }
    default:
      return { life: 20, cmdLethal: 0, freeMulligan: false }
  }
}

// Formats played with a commander (or an Oathbreaker): the table has a command zone.
export const hasCommandZone = (format: string) =>
  ['Commander', 'PreDH', 'Pauper Commander', 'Duel Commander', 'Oathbreaker', 'Brawl', 'Standard Brawl', 'Competitive Brawl'].includes(format)
