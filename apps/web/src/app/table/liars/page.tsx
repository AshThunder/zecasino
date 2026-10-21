"use client";
import { MatchBar, HouseBadge, HouseNote, TurnClock, PresenceBanner, RematchButton } from "@/components/Pvp";
import { useMatch, useTurnClock, usePresence } from "@/lib/pvp";
import { checkHouseLiars } from "@/lib/housePolicy";
import { useErrToast } from "@/lib/useErrToast";
import { readable } from "@/lib/seed";
import { WaitingScene } from "@/components/WaitingScene";
import { HowTo } from "@/components/HowTo";
import { ChainSees } from "@/components/ChainSees";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Die } from "@/components/Die";
import { DiceCup } from "@/components/DiceCup";
import { Chip, ChipStack } from "@/components/Chip";
import { celebrate, flyChips, chipsFor } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { getClient, toZat, ZAT } from "@/lib/server";
import { pvpCommit, unhex } from "@/lib/fair";
import { record, toHex } from "@/lib/history";

type P = { anon: string; name: string; dice: number[] | null; commitment: string; salt?: string; ok?: boolean; chip: number; me?: boolean };
type Bid = { q: number; f: number; by: string };
const STAKES = [0.01, 0.02, 0.05, 0.08, 0.1, 0.25];
const hexb = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const roll5 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => (b % 6) + 1);
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
const plural = (f: number) => (f === 6 ? "sixes" : `${f}s`);
const short = (h: string) => (h ? readable(h) : "…");
const anonTag = () => hexb(crypto.getRandomValues(new Uint8Array(2)));
/** Same commitment the server makes: fairness::commit over the five dice bytes. */
const seal = async (dice: number[], salt: Uint8Array) => pvpCommit(salt, new Uint8Array(dice));

export default function Liars() {
  const [stake, setStake] = useState(0.05);
  const scope = useRef<HTMLDivElement>(null);
  const [players, setPlayers] = useState<P[]>([]);
  const [phase, setPhase] = useState<"lobby" | "roll" | "bid" | "reveal">("roll");
  const [bid, setBid] = useState<Bid | null>(null);
  const [turn, setTurn] = useState(0);
  const [q, setQ] = useState(3); const [f, setF] = useState(5);
  const [result, setResult] = useState<{ count: number; winner: string; youWon: boolean; caller: string; bid: Bid } | null>(null);
  const [remote, setRemote] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useErrToast(err);
  const m = useMatch("liars", stake, setStake, setErr);
  const searching = m.searching;
  const [oppHouse, setOppHouse] = useState(false); const houseRef = useRef(false);
  const [clockAt, setClockAt] = useState<{ at: number; ms: number } | null>(null);
  const clock = useTurnClock(clockAt?.at ?? null, clockAt?.ms ?? null);
  const away = usePresence(room);
  const moves = useRef<{ house: boolean; q?: number; f?: number; call?: boolean }[]>([]);
  const [houseCheck, setHouseCheck] = useState<{ ok: boolean; checked: number } | null>(null);
  const salts = useRef<Uint8Array[]>([]);
  const playersRef = useRef<P[]>([]); playersRef.current = players;
  const { contextSafe } = useGSAP({ scope });

  const localTable = (): P[] => [{ anon: "you", name: "You", dice: null, commitment: "", chip: 0.5, me: true }, { anon: "3c9e", name: "anon · 3c9e", dice: null, commitment: "", chip: 0.05 }, { anon: "b71f", name: "anon · b71f", dice: null, commitment: "", chip: 0.1 }];
  useEffect(() => { (async () => { const c = await getClient(); setRemote(!!c); setPlayers(c ? [] : localTable()); setPhase(c ? "lobby" : "roll"); })(); }, []);

  const shake = contextSafe((then: () => void) => {
    play("shake", 0.7);
    gsap.timeline()
      .to(".lp .cup", { x: () => gsap.utils.random(-8, 8), rotation: () => gsap.utils.random(-10, 10), duration: 0.08, repeat: 9, yoyo: true })
      .to(".lp .cup", { x: 0, rotation: 0, duration: 0.15 })
      .add(() => { play("throw", 0.6); then(); });
  });

  // ---------- local table: real commitments, simple bots ----------
  const rollLocal = () => shake(async () => {
    const dice = playersRef.current.map(() => roll5());
    salts.current = dice.map(() => crypto.getRandomValues(new Uint8Array(32)));
    const commits = await Promise.all(dice.map((d, i) => seal(d, salts.current[i])));
    // Opponents' dice exist only to be opened at the call; the table never renders them before that.
    setPlayers(ps => ps.map((p, i) => ({ ...p, dice: dice[i], commitment: commits[i], salt: undefined, ok: undefined })));
    setPhase("bid"); setBid(null); setTurn(0); setQ(2); setF(4);
  });
  const botMove = (cur: Bid, who: number) => {
    const ps = playersRef.current; const mine = ps[who].dice!.filter(d => d === cur.f).length;
    const expected = mine + (ps.length * 5 - 5) / 6;
    if (cur.q > expected + 1.2 && Math.random() < 0.75) return callBy(who, cur);
    const nb = cur.f < 6 && Math.random() < 0.5 ? { q: cur.q, f: cur.f + 1, by: ps[who].name } : { q: cur.q + 1, f: ps[who].dice![0], by: ps[who].name };
    if (nb.q === cur.q && nb.f <= cur.f) nb.q++;
    setBid(nb); setQ(nb.q); setF(nb.f); play("chip", 0.4);
    const next = (who + 1) % ps.length;
    if (next === 0) setTurn(0); else setTimeout(() => botMove(nb, next), 1100);
  };
  const callBy = async (who: number, cur: Bid) => {
    const ps = playersRef.current;
    const opened = await Promise.all(ps.map(async (p, i) => ({ ...p, salt: hexb(salts.current[i]), ok: (await seal(p.dice!, salts.current[i])) === p.commitment })));
    const count = opened.flatMap(p => p.dice!).filter(d => d === cur.f).length;
    const bidder = ps.find(p => p.name === cur.by)!;
    const winner = count >= cur.q ? bidder : ps[who];
    reveal(opened, { count, winner: winner.name, youWon: !!winner.me, caller: ps[who].name, bid: cur });
  };

  // ---------- server room (heads-up) ----------
  useEffect(() => {
    if (!remote) return;
    let offs: (() => void)[] = [];
    getClient().then(c => {
      if (!c) return;
      offs = [
        c.on("liars_start", async m => { if (m.stake) setStake(m.stake / ZAT);
          gsap.to(".lp .cup", { y: 0, rotation: 0, opacity: 1, duration: 0.4 }); setResult(null); setHouseCheck(null);
          moves.current = [];
          houseRef.current = !!m.opponent_house; setOppHouse(!!m.opponent_house); setClockAt(m.turn_ms ? { at: m.at ?? Date.now(), ms: m.turn_ms } : null);
          setRoom(m.room);
          const mineOk = (await pvpCommit(unhex(m.salt), new Uint8Array(m.dice))) === m.commitments[m.seat].commitment;
          setPlayers((m.commitments as { anon: string; commitment: string }[]).map((cm, i) => ({ anon: cm.anon, name: i === m.seat ? "You" : m.opponent_house ? "House player" : `anon · ${cm.anon}`, dice: i === m.seat ? m.dice : null, commitment: cm.commitment, chip: i === m.seat ? 0.5 : 0.05, me: i === m.seat, ok: i === m.seat ? mineOk : undefined })));
          setTurn(m.turn === m.seat ? 0 : 1); setBid(null); setQ(2); setF(4);
          shake(() => setPhase("bid"));
        }),
        c.on("liars_bid", m => {
          const ps = playersRef.current; const meAnon = ps.find(p => p.me)?.anon;
          moves.current.push({ house: houseRef.current && m.by !== meAnon, q: m.q, f: m.f });
          if (m.turn_ms) setClockAt({ at: m.at ?? Date.now(), ms: m.turn_ms });
          setBid({ q: m.q, f: m.f, by: m.by === meAnon ? "You" : houseRef.current ? "House player" : `anon · ${m.by}` }); setQ(m.q); setF(m.f);
          setTurn(m.by === meAnon ? 1 : 0); play("chip", 0.4);
        }),
        c.on("liars_reveal", async m => {
          const ps = playersRef.current;
          const opened = await Promise.all(ps.map(async p => {
            const o = (m.openings as { anon: string; commitment: string; dice: number[]; salt: string }[]).find(x => x.anon === p.anon)!;
            return { ...p, dice: o.dice, salt: o.salt, ok: o.commitment === p.commitment && (await pvpCommit(unhex(o.salt), new Uint8Array(o.dice))) === o.commitment };
          }));
          const name = (a: string) => opened.find(p => p.anon === a)?.name ?? a;
          setClockAt(null);
          if (houseRef.current) {
            const meAnon = ps.find(p => p.me)?.anon; const hd = opened.find(p => !p.me)?.dice;
            if (hd) setHouseCheck(checkHouseLiars(hd, [...moves.current, { house: m.caller !== meAnon, call: true }]));
          }
          record("liars", `${m.count} on the table · ${m.you_won ? "you won" : "you lost"}`, opened.filter(p => p.salt).map(p => ({ kind: "commit" as const, commitment: p.commitment, salt: p.salt!, valueHex: toHex(new Uint8Array(p.dice!)) })));
          reveal(opened, { count: m.count, winner: name(m.winner), youWon: m.you_won, caller: name(m.caller), bid: { q: m.bid.q, f: m.bid.f, by: "" } });
        }),
      ];
      c.rpc({ t: "pvp_resume" }).catch(() => {}); // a refreshed tab picks its round back up
    });
    return () => offs.forEach(o => o());
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = contextSafe((opened: P[], r: NonNullable<typeof result>) => {
    setPlayers(opened); setResult(r); setPhase("reveal"); play("die", 0.7);
    gsap.to(".lp:not(.me) .cup", { y: -90, rotation: -8, opacity: 0.25, duration: 0.7, ease: "power3.out", stagger: 0.12 });
    if (r.youWon) setTimeout(() => celebrate(stake * opened.length * 0.98, document.querySelector(".liars-felt")), 700); else play("collide", 0.6);
  });
  const placeBid = async () => {
    if (turn !== 0 || (bid && (q < bid.q || (q === bid.q && f <= bid.f)))) return;
    play("chip", 0.5);
    if (remote) { const c = await getClient(); try { setErr(null); await c!.rpc({ t: "liars_bid", room, q, f }); } catch (e) { setErr((e as Error).message); } return; }
    const nb = { q, f, by: "You" }; setBid(nb); setTurn(1); setTimeout(() => botMove(nb, 1), 1100);
  };
  const callLiar = async () => {
    if (!bid || turn !== 0) return;
    if (remote) { const c = await getClient(); try { await c!.rpc({ t: "liars_call", room }); } catch (e) { setErr((e as Error).message); } return; }
    callBy(0, bid);
  };
  const reset = contextSafe(() => {
    gsap.to(".lp .cup", { y: 0, rotation: 0, opacity: 1, duration: 0.4 });
    setBid(null); setResult(null); setRoom(null); setOppHouse(false); houseRef.current = false; setHouseCheck(null); setClockAt(null);
    if (remote) { setPlayers([]); setPhase("lobby"); } else { setPlayers(localTable()); setPhase("roll"); }
  });

  const me = players.find(p => p.me), others = players.filter(p => !p.me);
  const verdictText = result ? `${result.caller} called liar on ${WORDS[result.bid.q]} ${plural(result.bid.f)}. There ${result.count === 1 ? "is" : "are"} ${WORDS[result.count]}. ${result.youWon ? `You win ⓩ ${(stake * players.length * 0.98).toFixed(4)}.` : `${result.winner} wins the pot.`}` : null;
  const myTurn = phase === "bid" && turn === 0;
  return (
    <div ref={scope} className="table-page liars-page">
      <div className="table-head"><div><p className="eyebrow">Heads-up · 5 dice each · ones are not wild</p><div className="th-title"><h1>Liar&apos;s Dice</h1><HowTo game="liars" /></div></div></div>
      <div className="felt liars-felt">
        {searching && <WaitingScene table="liars" label="Waiting for an opponent" m={m} stake={stake} />}
        <PresenceBanner away={away} />
        <div className="lp-row">
          {(others.length ? others : [{ anon: "?", name: searching ? "Finding a player…" : "Empty seat", dice: null, commitment: "", chip: 0.05 } as P]).map(p => (
            <div key={p.anon} className="lp">
              <div className="lp-cupwrap">
                {phase === "reveal" && p.dice && <div className="lp-dice">{p.dice.map((d, i) => <Die key={i} value={d} size={34} />)}</div>}
                <div className="cup"><DiceCup width={110} /></div>
              </div>
              <div className="lp-tag"><Chip value={p.chip} size={30} id={`lp-${p.chip}`} /><div><b>{p.name}{oppHouse && !p.me && p.anon !== "?" ? <> <HouseBadge /></> : null}</b><small className="mono">{p.commitment ? <>commit {short(p.commitment)}{p.ok !== undefined && !p.me && <em className={p.ok ? "" : "bad"}>{p.ok ? " ✓ opened" : " ✗ mismatch"}</em>}</> : "no cup yet"}</small></div></div>
            </div>
          ))}
        </div>
        <div className="lp-center">
          {verdictText ? <div className="result-toast verdict" role="status"><span>{verdictText}</span></div> : <>
          <ChipStack values={Array(Math.max(players.length, 2)).fill(stake)} size={46} />
          <div className="bid-card">
            {bid ? <><small>{bid.by} bids</small><b>{WORDS[bid.q]} × </b><Die value={bid.f} size={40} /></> : <small>{phase === "lobby" ? "Sit down to get matched with another player" : phase === "bid" ? (turn === 0 ? "Your opening bid" : "Waiting for the opening bid") : "Shake your cup to start the round"}</small>}
          </div></>}
        </div>
        
        {phase === "lobby" && <div className="lp-lobby"><MatchBar game="liars" stakes={STAKES} stake={stake} setStake={setStake} m={m} /><small>Heads-up · server-dealt dice, sealed before the first bid</small></div>}
        {me && (
          <div className="lp me">
            <div className="tray">
              <span className="tray-label">{me.dice ? "Your dice · only you can see these" : "Your cup is empty until you roll"}</span>
              <div className="lp-dice mine">{(me.dice ?? [1, 1, 1, 1, 1]).map((d, i) => <Die key={i} value={d} size={56} color="ruby" />)}</div>
            </div>
            <div className="lp-controls">
              {phase === "roll" && <button className="btn gold lg" onClick={rollLocal}>Shake &amp; roll</button>}
              {phase === "bid" && room && <TurnClock clock={clock} mine={myTurn} auto={myTurn ? (bid ? "you call liar" : "you bid one of your first die") : (bid ? "they call liar" : "they open with one die")} />}
              {phase === "bid" && !myTurn && <span className="wait">{oppHouse ? "House is deciding…" : "Their move…"}</span>}
              {myTurn && <>
                <div className="stepper"><button onClick={() => setQ(x => Math.max(1, x - 1))} aria-label="Fewer">−</button><b>{q}</b><button onClick={() => setQ(x => Math.min(15, x + 1))} aria-label="More">+</button></div>
                <div className="faces" role="radiogroup" aria-label="Face">{[1, 2, 3, 4, 5, 6].map(v => <button key={v} role="radio" aria-checked={f === v} className={f === v ? "on" : ""} onClick={() => setF(v)}><Die value={v} size={36} /></button>)}</div>
                <button className="btn ghost" onClick={placeBid}>Bid</button>
                <button className="btn gold" onClick={callLiar} disabled={!bid}>Liar!</button>
              </>}
              {phase === "reveal" && (remote ? <><RematchButton room={room} house={oppHouse} /><button className="btn ghost" onClick={reset}>New opponent</button></> : <button className="btn gold" onClick={reset}>Next round</button>)}
            </div>
          </div>
        )}
      </div>
      <div className="side-col">
        {oppHouse && <HouseNote game="liars" />}
        <aside className="fair">
        <h4>Committed dice</h4>
        <p className="fair-explain">Every cup is sealed before the first bid, so nobody can change their dice once they hear yours.</p>
        <p>When the cups go down, every cup is sealed as SHA-256(“zecasino:commit:v1”‖len‖salt‖dice) and the seals are shown to everyone. At the call each seal is opened and your browser recomputes it, so nobody can change their dice after hearing a bid.</p>
        <dl>
          <dt>Dealer</dt><dd className="mono">{remote ? "game server · heads-up room" : "in-browser table (server offline)"}</dd>
          {players.map(p => <div key={p.anon}><dt>{p.name}</dt><dd className={`mono ${p.ok === false ? "bad" : p.ok ? "ok" : ""}`}>{p.commitment ? short(p.commitment) : "–"}{p.ok === true ? (p.me && phase !== "reveal" ? " · your seal checks out" : " · verified") : p.ok === false ? " · MISMATCH" : ""}</dd></div>)}
        </dl>
        {houseCheck && <p className={`house-check ${houseCheck.ok ? "ok" : "bad"}`}>{houseCheck.ok ? `✓ All ${houseCheck.checked} house moves replayed here from the house's own dice and the bids. None used your dice.` : "✗ A house move does not match the published policy."}</p>}
      </aside>
        <ChainSees table="liars" />
      </div>
    </div>
  );
}
