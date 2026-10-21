# The house player
When nobody else is waiting at your stake for about 20 seconds, the table offers **Play the house instead**. If you accept, the other seat is played by the casino. It is always labelled **House player**. It is never shown as a person, and it never sits down unless you ask.

## What it may know

The house knows only what a human in its seat would know. It never sees your hidden cards, dice or box. The rules are the same as against a person: the same stakes, the same 2% rake and the same commit-reveal seals.

### Carrot in a Box

- **House as guesser:** it flips a coin for keep or swap at the start of the round, before you peek or speak. That choice is sealed with SHA-256 (“zecasino:commit:v1”‖len‖salt‖choice), and you see the seal straight away. At the reveal the seal opens, and your browser checks that it matches both the seal and what the house actually did. Your bluff cannot change its choice.
- **House as holder:** like every holder, it knows its own box. It picks one of the four lines at random. The box itself is sealed before anyone peeks, as in every round.

### Liar's Dice

The house uses a fixed, public rule that looks only at its own five dice and the current bid. The expected count of a face is its own matches plus one third of the unknown dice. If the bid is more than one die above that, it calls liar. Otherwise it makes the cheapest legal raise on the face it holds most of. All dice are sealed before the first bid. After the call, your browser replays every house move from its opened dice and confirms that none of them depended on yours.

### Heads-up Hold'em

Every card is encrypted to three keys. Against the house, the house holds two of them: the dealer key and its seat key. That is still not enough. A card opens only with all three shares, and you never send the share for your own hole cards. You also shuffle the deck yourself, with a proof checked in the browser. So the house can neither see your cards nor stack the deck. It checks when it can. It calls with a pair or an ace, or when the price is at most half the pot. Otherwise it folds.

## Money

The house's half of the pot comes from the house bankroll, not from any player's balance. Your bet and any payout are written to the ledger exactly as in a normal PvP game, so house profit and loss moves by exactly the house's result. What the casino owes players (its liabilities, shown on [/solvency](/solvency)) stays the sum of player balances.

## Timers, reconnects, rematch

Every turn shows a clock to both seats. When it runs out, a safe default is played: the guesser keeps their box, a Liar's Dice turn calls (or opens with one die), and in Hold'em you check, or fold if there is a bet. If a player drops, their opponent sees *Opponent reconnecting*, and the seat is held for 30 seconds before the clock may act. When a round ends, Rematch deals again with the same opponent once both of you agree. Against the house it deals at once.

## Implementation

- Server: `crates/game-server/src/house_bot.rs` (policies, Hold'em seat), `lib.rs` (`start_match`, `house_act`, `liars_house_turn`, `start_carrot`). House tokens look like `house:<id>`. They are never ledger sessions, and `App::debit` / `App::credit` skip them.
- Browser checks: `apps/web/src/lib/housePolicy.ts` (Liar's Dice replay) and the Carrot page (house decision seal).
- Tests: `crates/game-server/tests/pvp_smooth.rs`, `tests/ws.rs::house_player_plays_holdem_and_cannot_see_hole_cards`, and `qa/pvp-smooth.js`.
- Messages: `*_join` takes `{stake, house?, invite?, code?}`; `queue_leave`; `pvp_rematch {room}` gets `rematch_wait` / `pvp_rematch_offer`; `pvp_presence {room, online, grace_ms}`; start and bid messages carry `turn_ms` and `at`. `/lobby` `tables.<game>.by_stake` counts public waiting players by stake (in zatoshi). Private invite tables are not listed.
