"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { reducedMotion } from "@/lib/motion";
import { DEMO, setMode } from "@/lib/server";

type Guide = { title: string; steps: [string, string][]; fair: string };
const G: Record<string, Guide> = {
  carrot: { title: "Carrot in a Box", fair: "The box is sealed with SHA-256 before anyone peeks; the reveal opens the seal and your browser rechecks it.", steps: [
    ["Sit down", "You're matched with one other anonymous session. One of you holds the box, the other guesses."],
    ["Holder peeks", "Only the holder sees whether the carrot is inside. Then they say something: true or a bluff."],
    ["Guesser decides", "Keep your box or swap. Whoever ends up with the carrot takes the pot (2% rake)."]] },
  holdem: { title: "Heads-up Hold'em", fair: "Mental-poker shuffle: each card opens only with all three decryption shares, so even the house can't see your hole cards.", steps: [
    ["Buy in", "Take ⓩ 0.2–0.5 to the table. Blinds are 0.005 / 0.01; you play one opponent."],
    ["Shuffle together", "The house and both players each re-encrypt and shuffle the deck. Your browser checks every proof."],
    ["Play the hand", "Check, call, raise or fold. At showdown both hands open and the best five cards win."]] },
  liars: { title: "Liar's Dice", fair: "Each cup is committed before the first bid and opened only when someone calls liar.", steps: [
    ["Roll under the cup", "Everyone rolls five dice in secret. Only you see yours."],
    ["Bid or call", "Raise the bid (how many of a face are on the whole table) or call the last bidder a liar."],
    ["Reveal", "All cups open. If the bid holds, the bidder wins the pot; if not, the caller does."]] },
  roulette: { title: "European Roulette", fair: "The server commits to its seed before you bet; the pocket comes from HMAC(server seed, your seed, nonce).", steps: [
    ["Pick a chip", "Choose a value from the rack."],
    ["Place bets", "Tap numbers, colours, dozens or columns. Each tap adds a chip."],
    ["Spin", "Single zero, 2.7% edge. Straight-ups pay 35:1, red/black and odd/even 1:1."]] },
  blackjack: { title: "Blackjack", fair: "The whole six-deck shoe is fixed by the committed seed before the first card; after the reveal your browser replays every draw.", steps: [
    ["Bet and deal", "Tap the circle to add chips, then Deal."],
    ["Play your hand", "Hit, stand, double on two cards, or split a pair into two hands."],
    ["Dealer plays", "Dealer draws to 16 and stands on all 17s. Blackjack pays 3 to 2."]] },
  dice: { title: "Dice", fair: "Roll = HMAC(server seed, your seed, nonce) mapped to 0.00–100.00. Rotate the seed to check every roll.", steps: [
    ["Set the line", "Drag the slider. A lower win chance pays a higher multiplier (1% edge)."],
    ["Over or under", "Pick which side of the line wins."],
    ["Roll", "The number lands; win if it's on your side."]] },
  crash: { title: "Crash", fair: "Each round has its own committed seed, revealed at the bust and checked in your browser. Capped at 1000×.", steps: [
    ["Bet before the round", "Place a bet during the countdown. Set an auto cash-out if you like."],
    ["Watch it climb", "The multiplier rises until it busts at a point fixed by the round's seed."],
    ["Cash out in time", "Cash out before the bust to win stake × multiplier. Everyone at the table is just a session hash."]] },
};

const KEY = (g: string) => `zc.howto.${g}`;
const seen = (g: string) => { try { return localStorage.getItem("zc.howto.seen") === "all" || !!localStorage.getItem(KEY(g)); } catch { return true; } };

/** How-to-play: opens itself on a table's first visit, and from the ? button any time after. */
export function HowTo({ game }: { game: keyof typeof G }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDialogElement>(null); const g = G[game];
  useEffect(() => { if (!seen(game)) setOpen(true); }, [game]);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (!reducedMotion()) gsap.timeline().fromTo(d, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" })
        .fromTo(d.querySelectorAll(".ht-step"), { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.08, duration: 0.3 }, 0.12);
    }
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => { try { localStorage.setItem(KEY(game), "1"); } catch {} setOpen(false); };
  return (<>
    <button className="howto-btn" onClick={() => setOpen(true)} aria-label={`How to play ${g.title}`} title="How to play">?</button>
    <dialog ref={ref} className="howto" onClose={close} aria-labelledby={`ht-${game}`} {...{ closedby: "any" }}>
      <p className="eyebrow">How to play</p>
      <h2 id={`ht-${game}`}>{g.title}</h2>
      <ol>{g.steps.map(([h, t], i) => <li key={h} className="ht-step"><span className="ht-n">{i + 1}</span><div><b>{h}</b><p>{t}</p></div></li>)}</ol>
      <p className="ht-fair"><svg width="12" height="14" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 0 14 3v5c0 4-3 7-7 8-4-1-7-4-7-8V3z" fill="#F4B728" /></svg>{g.fair}</p>
      <div className="ht-actions">
        {!DEMO && <button className="btn ghost" onClick={() => { close(); setMode(true); }}>Try it with play chips</button>}
        <button className="btn gold" onClick={close} autoFocus>Got it</button>
      </div>
    </dialog>
  </>);
}
