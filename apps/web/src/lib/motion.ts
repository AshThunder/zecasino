"use client";
/**
 * Table motion: cards off the shoe with a flip, chips that fly to the pot or your stack, and the win moment.
 * Reduced motion: `installMotion()` makes every GSAP tween finish instantly through gsap.matchMedia (end states and
 * callbacks still run, so game logic is unchanged) and the helpers below skip their flourishes entirely.
 */
import gsap from "gsap";
import { play } from "./sfx";
import { denomFor, DENOMS } from "./chips";

const RM = "(prefers-reduced-motion: reduce)";
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia(RM).matches;

let installed = false;
export function installMotion() {
  if (installed || typeof window === "undefined") return; installed = true;
  gsap.matchMedia().add(RM, () => { gsap.globalTimeline.timeScale(1000); return () => gsap.globalTimeline.timeScale(1); });
}

const center = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

/** Deal: the card leaves the shoe's mouth face down, slides to its spot, then turns over (if `flip`). */
export function dealFromShoe(card: Element | null | undefined, shoe: Element | null | undefined, { flip = true, delay = 0 } = {}) {
  if (!card) return;
  const inner = card.querySelector(".pcard-inner");
  if (reducedMotion() || !shoe) { gsap.fromTo(card, { opacity: 0 }, { opacity: 1, duration: 0.2 }); return; }
  const a = center(shoe), b = center(card);
  const tl = gsap.timeline({ delay });
  tl.fromTo(card, { x: a.x - 40 - b.x, y: a.y - b.y, rotation: -18, scale: 0.82, opacity: 0 },
    { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.5, ease: "power3.out", clearProps: "transform" });
  if (flip && inner) {
    tl.fromTo(inner, { rotateY: 180 }, { rotateY: 0, duration: 0.42, ease: "power2.inOut", clearProps: "transform" }, 0.3);
  }
  return tl;
}

/** Turn a card over in place (hole card reveal, showdown). */
export function flipUp(card: Element | null | undefined) {
  const inner = card?.querySelector(".pcard-inner"); if (!inner) return;
  gsap.fromTo(inner, { rotateY: 180 }, { rotateY: 0, duration: 0.5, ease: "power2.inOut", clearProps: "transform" });
}

/** Break an amount into chip denominations (largest first, at most `max` chips) for the flying stack. */
export function chipsFor(amount: number, max = 6): number[] {
  const out: number[] = []; let left = Math.round(amount * 1000) / 1000;
  for (const d of [...DENOMS].reverse()) while (left >= d.value - 1e-9 && out.length < max) { out.push(d.value); left = Math.round((left - d.value) * 1000) / 1000; }
  return out.length ? out : [DENOMS[0].value];
}

let uid = 0;
/** Same artwork as components/Chip.tsx (edge inserts, inlay ring, denomination), as a detached SVG. */
function chipEl(value: number) {
  const d = denomFor(value); const id = `fc${uid++}`;
  const ins = Array.from({ length: 8 }, (_, i) => `<rect x="44" y="3" width="12" height="15" rx="1.5" fill="${d.edge}" transform="rotate(${i * 45} 50 50)"/>`).join("");
  const el = document.createElement("div"); el.className = "fly-chip"; el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg width="40" height="40" viewBox="0 0 100 100"><defs><radialGradient id="${id}" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient></defs>
<circle cx="50" cy="50" r="47" fill="${d.base}"/>${ins}<circle cx="50" cy="50" r="33" fill="${d.base}" stroke="${d.edge}" stroke-width="2"/>
<text x="50" y="58" text-anchor="middle" font-family="serif" font-weight="700" font-size="22" fill="${d.ink}">${d.label}</text><circle cx="50" cy="50" r="47" fill="url(#${id})"/><circle cx="50" cy="50" r="46.5" fill="none" stroke="#000" stroke-opacity=".35"/></svg>`;
  document.body.appendChild(el); return el;
}

/** Chips arc from one element to another (bet → spot, pot → winner, felt → balance). */
export function flyChips(values: number[], from: Element | null | undefined, to: Element | null | undefined, { stagger = 0.07, sound = true } = {}) {
  if (!from || !to || reducedMotion()) return Promise.resolve();
  const a = center(from), b = center(to);
  return new Promise<void>(res => {
    values.forEach((v, i) => {
      const el = chipEl(v); const lift = Math.min(160, 60 + Math.abs(b.x - a.x) * 0.25);
      gsap.set(el, { x: a.x - 20, y: a.y - 20, scale: 0.9 });
      const tl = gsap.timeline({ delay: i * stagger, onComplete: () => { el.remove(); if (i === values.length - 1) res(); } });
      tl.to(el, { x: b.x - 20, duration: 0.6, ease: "power1.inOut" }, 0)
        .to(el, { y: Math.min(a.y, b.y) - lift, duration: 0.3, ease: "power2.out" }, 0)
        .to(el, { y: b.y - 20 - i * 2, duration: 0.3, ease: "power2.in" }, 0.3)
        .to(el, { scale: 0.7, opacity: 0, duration: 0.12 }, 0.58);
      if (sound && i % 2 === 0) tl.call(() => play("chip", 0.35), [], 0.55);
    });
  });
}

/** The win moment: the table glows, the payout counts up, and chips fly from the felt into your balance. */
export function celebrate(amount: number, felt: Element | null | undefined, { label = "You win" } = {}) {
  if (!felt || !(amount > 0)) return;
  play("stack", 0.7); setTimeout(() => play("handle", 0.45), 380);
  const host = felt as HTMLElement;
  const burst = document.createElement("div"); burst.className = "win-burst"; burst.setAttribute("role", "status");
  burst.innerHTML = `<small>${label}</small><b>ⓩ <span>0.0000</span></b>`;
  host.appendChild(burst);
  const num = burst.querySelector("span")!;
  const bal = document.querySelector(".hdr .balance");
  if (reducedMotion()) {
    num.textContent = amount.toFixed(4); host.classList.add("win-glow-static");
    setTimeout(() => { burst.remove(); host.classList.remove("win-glow-static"); }, 2200); return;
  }
  const o = { v: 0 };
  const tl = gsap.timeline({ onComplete: () => burst.remove() });
  tl.fromTo(burst, { scale: 0.6, opacity: 0, y: 12 }, { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: "back.out(2)" })
    .to(o, { v: amount, duration: 1.1, ease: "power2.out", onUpdate: () => { num.textContent = o.v.toFixed(4); } }, 0.1)
    .fromTo(host, { boxShadow: "inset 0 0 0 0 #F4B72800, 0 0 0 0 #F4B72800" }, { boxShadow: "inset 0 0 120px 0 #F4B72838, 0 0 48px 4px #F4B72855", duration: 0.45, yoyo: true, repeat: 1, ease: "sine.inOut", clearProps: "boxShadow" }, 0)
    .call(() => { flyChips(chipsFor(amount), burst, bal, { sound: false }); }, [], 0.5)
    .to(burst, { opacity: 0, y: -16, duration: 0.4, ease: "power2.in" }, 2.3);
  if (bal) tl.fromTo(bal, { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out", clearProps: "transform" }, 1.15);
}
