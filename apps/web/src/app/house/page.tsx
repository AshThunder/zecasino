import Link from "next/link";

export const metadata = { title: "The house player · Zecasino" };

/** Plain-language account of the House player: when it appears, what it knows, how to check it. */
export default function HousePlayer() {
  return (
    <div className="doc-page">
      <p className="eyebrow">Player vs player · fallback seat</p>
      <h1>The house player</h1>
      <p className="lede">When nobody else is waiting at your stake for about 20 seconds, the table offers <b>Play the house instead</b>. If you accept, the other seat is played by the casino. It is always labelled <span className="house-badge">House player</span>. It is never shown as a person, and it never sits down unless you ask.</p>
      <h2>What it may know</h2>
      <p>The house knows only what a human in its seat would know. It never sees your hidden cards, dice or box. The rules are the same as against a person: the same stakes, the same 2% rake and the same commit-reveal seals.</p>
      <h3>Carrot in a Box</h3>
      <ul>
        <li><b>House as guesser:</b> it flips a coin for keep or swap at the start of the round, before you peek or speak. That choice is sealed with SHA-256 (“zecasino:commit:v1”‖len‖salt‖choice), and you see the seal straight away. At the reveal the seal opens, and your browser checks that it matches both the seal and what the house actually did. Your bluff cannot change its choice.</li>
        <li><b>House as holder:</b> like every holder, it knows its own box. It picks one of the four lines at random. The box itself is sealed before anyone peeks, as in every round.</li>
      </ul>
      <h3>Liar&apos;s Dice</h3>
      <p>The house uses a fixed, public rule that looks only at its own five dice and the current bid. The expected count of a face is its own matches plus one third of the unknown dice. If the bid is more than one die above that, it calls liar. Otherwise it makes the cheapest legal raise on the face it holds most of. All dice are sealed before the first bid. After the call, your browser replays every house move from its opened dice and confirms that none of them depended on yours.</p>
      <h3>Heads-up Hold&apos;em</h3>
      <p>Every card is encrypted to three keys. Against the house, the house holds two of them: the dealer key and its seat key. That is still not enough. A card opens only with all three shares, and you never send the share for your own hole cards. You also shuffle the deck yourself, with a proof checked in the browser. So the house can neither see your cards nor stack the deck. It checks when it can. It calls with a pair or an ace, or when the price is at most half the pot. Otherwise it folds.</p>
      <h2>Money</h2>
      <p>The house&apos;s half of the pot comes from the house bankroll, not from any player&apos;s balance. Your bet and any payout are written to the ledger exactly as in a normal PvP game, so house profit and loss moves by exactly the house&apos;s result. What the casino owes players (its liabilities, shown on <Link href="/solvency">/solvency</Link>) stays the sum of player balances.</p>
      <h2>Timers, reconnects, rematch</h2>
      <p>Every turn shows a clock to both seats. When it runs out, a safe default is played: the guesser keeps their box, a Liar&apos;s Dice turn calls (or opens with one die), and in Hold&apos;em you check, or fold if there is a bet. If a player drops, their opponent sees <i>Opponent reconnecting</i>, and the seat is held for 30 seconds before the clock may act. When a round ends, Rematch deals again with the same opponent once both of you agree. Against the house it deals at once.</p>
    </div>
  );
}
