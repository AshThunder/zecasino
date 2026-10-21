/** The seven tables. Stake ranges are the game server's limits (MAX_STAKE 0.5 TAZ; Hold'em buy-in 0.2–0.5). Shared by the lobby grid and the header Games menu. */
export const GAMES: { id: string; name: string; kind: string; why: string; stakes: string; href: string; feature?: boolean; wide?: boolean }[] = [
  { id: "carrot", name: "Carrot in a Box", kind: "Player vs player", why: "Only the holder peeks. The box is sealed with a SHA-256 commitment before anyone bluffs.", stakes: "ⓩ 0.001 – 0.5", href: "/table/carrot", feature: true },
  { id: "holdem", name: "Heads-up Hold'em", kind: "Player vs player", why: "Mental-poker shuffle: even the house can't see your hole cards.", stakes: "Buy-in ⓩ 0.2 – 0.5", href: "/table/holdem" },
  { id: "liars", name: "Liar's Dice", kind: "Player vs player · heads-up", why: "Dice committed under the cup; opened only when someone calls liar.", stakes: "ⓩ 0.001 – 0.5", href: "/table/liars" },
  { id: "roulette", name: "European Roulette", kind: "House · single zero", why: "Seed committed before you bet; every spin verifiable.", stakes: "ⓩ 0.001 – 0.5", href: "/table/roulette" },
  { id: "blackjack", name: "Blackjack", kind: "House · 6 decks", why: "The whole shoe order is committed before the first card.", stakes: "ⓩ 0.001 – 0.5", href: "/table/blackjack" },
  { id: "dice", name: "Dice", kind: "House · over / under", why: "HMAC(server seed, your seed, nonce). Check it yourself.", stakes: "ⓩ 0.001 – 0.5", href: "/table/dice" },
  { id: "crash", name: "Crash", kind: "House · multiplayer", why: "Cash out before it busts. Bettors are just session hashes.", stakes: "ⓩ 0.001 – 0.5", href: "/table/crash", wide: true },
];
