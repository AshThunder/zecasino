/** Turns a server or client error string into a toast whose title is the concrete reason. */
import type { ToastAction } from "./toast";
import { DEMO } from "./server";

export const FAUCET_URL = "https://faucet.testnet.valargroup.dev";
export const OPEN_CASHIER = "zc:open-cashier";
export const openCashier = () => window.dispatchEvent(new Event(OPEN_CASHIER));

const cashierActions = (): ToastAction[] => DEMO
  ? [{ label: "Refill play chips", event: "zc:demo-refill" }]
  : [{ label: "Open Cashier", event: OPEN_CASHIER }, { label: "Get free testnet TAZ", href: FAUCET_URL }];

type T = { title: string; body?: string; actions?: ToastAction[] };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");
const MAP: [RegExp, (m: string) => T][] = [
  [/insufficient balance/, () => ({ title: "Not enough balance", body: DEMO ? "Refill your play chips to place this stake." : "Top up in the Cashier to place this stake.", actions: cashierActions() })],
  [/stake out of range|buy-in must/, m => ({ title: /buy-in/.test(m) ? "Buy-in must be 0.2–0.5 TAZ" : "Stake outside the table limits", body: "Pick a stake between the table minimum and 0.5 TAZ." })],
  [/target out of range/, () => ({ title: "Target outside 2–98", body: "Move the slider back inside the range." })],
  [/invalid bets/, () => ({ title: "No valid bets on the layout", body: "Place at least one chip, up to 0.5 TAZ in total." })],
  [/auto cash-out/, () => ({ title: "Auto cash-out above 1000×", body: "Set it below the 1000× cap." })],
  [/betting closed|not betting now|too late/, () => ({ title: "Betting is closed for this round", body: "Your stake goes in on the next round." })],
  [/already in this round/, () => ({ title: "You're already in this round", body: "Cash out or wait for the bust." })],
  [/already queued/, () => ({ title: "You're already in the queue", body: "Leave the queue first to change table or stake." })],
  [/invite has expired|already used/, () => ({ title: "That invite has expired", body: "Ask your friend for a new link, or pick a stake and sit down." })],
  [/opponent left|could not cover/, m => ({ title: /cover/.test(m) ? "Opponent couldn't cover the stake" : "Your opponent left", body: "You were not charged. Sit down again to find another player." })],
  [/rematch expired/, () => ({ title: "Rematch offer expired", body: "Sit down again to play a new opponent." })],
  [/not your turn/, () => ({ title: "Not your turn yet", body: "Wait for your opponent's move." })],
  [/bid must be higher/, () => ({ title: "Bid must be higher", body: "Raise the count, or keep the count and pick a higher face." })],
  [/finish the hand first|hand in progress/, () => ({ title: "Finish the hand first", body: "You can leave once this hand is settled." })],
  [/minimum withdrawal/, () => ({ title: "Minimum withdrawal is 0.001 TAZ" })],
  [/shielded address only/, () => ({ title: "Shielded addresses only", body: "Use a unified (u1…) or Sapling (zs1…) address. Transparent t-addresses are refused to protect your privacy." })],
  [/connection lost|offline|reconnecting/, () => ({ title: "Connection lost · reconnecting", body: "Your seat and balance are safe on the server." })],
  [/unknown session/, () => ({ title: "Session not found", body: "Restore it from your recovery code.", actions: [{ label: "Restore session", event: "zc:open-restore" }] })],
];
export function explain(err: string): T {
  for (const [re, f] of MAP) if (re.test(err)) return f(err);
  return { title: cap(err), body: "Nothing was charged. Try again." };
}
