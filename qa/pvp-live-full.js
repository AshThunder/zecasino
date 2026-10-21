// Full live PvP check on the deployed site in play-chips mode (zecasino-demo), two real browsers.
// Per game (carrot, liars, holdem): pick stake + join -> full round -> rematch -> round; house fallback -> round; invite code join -> round.
// Usage: node qa/pvp-live-full.js [carrot|liars|holdem|all]   (ZC_BASE overrides the site)
const q = require("./lib"); const B = process.env.ZC_BASE || "https://zecasino.fly.dev";
const only = process.argv[2] || "all"; const SH = "../screenshots/after/pvp-live/";
const res = []; const rec = (g, c, ok, n = "") => { res.push({ g, c, ok }); console.log(`${ok ? "PASS" : "FAIL"} [${g}] ${c} ${n}`); };
const vis = async (p, name) => { const l = p.getByRole("button", { name }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
const click = (p, name) => p.getByRole("button", { name }).first().click({ timeout: 3000 }).catch(() => {});
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; }
const STAKE = { carrot: "0.020", liars: "0.020", holdem: "0.20" };
const inGame = { carrot: async p => (await p.locator(".waiting-scene").count()) === 0 && /box/i.test(await p.locator(".felt").innerText().catch(() => "")),
  liars: async p => (await p.locator(".waiting-scene").count()) === 0 && (await p.locator(".lp-dice.mine").count()) > 0,
  holdem: async p => (await p.locator(".waiting-scene").count()) === 0 && (await vis(p, "Fold") || await vis(p, "Leave table") || (await p.locator(".poker-felt .house-badge, .turn-clock").count()) > 0) };
// One step of play for whichever player can act; returns true once the round is over on every page.
async function step(game, pages) {
  for (const p of pages) {
    if (game === "carrot") { if (await vis(p, "Peek inside")) { await click(p, "Peek inside"); await p.waitForTimeout(1800); }
      if (await vis(p, /got the carrot/)) await click(p, /got the carrot/); else if (await vis(p, "Swap boxes")) await click(p, "Swap boxes"); else if (await vis(p, "Keep my box")) await click(p, "Keep my box"); }
    if (game === "liars") { if (await vis(p, "Liar!")) await click(p, "Liar!"); else if (await vis(p, "Bid")) await click(p, "Bid"); }
    if (game === "holdem") { if (await vis(p, "Check")) await click(p, "Check"); else if (await vis(p, /^Call/)) await click(p, /^Call/); }
  }
  const done = async p => game === "holdem" ? (await p.locator(".result-toast").count()) > 0 : await vis(p, /^Rematch$|Accept rematch/);
  for (const p of pages) if (!(await done(p))) return false; return true;
}
const round = (game, pages, ms = 60000) => until(() => step(game, pages), ms);
async function leaveHoldem(pages) { for (const p of pages) { await until(() => vis(p, "Leave table"), 15000); await click(p, "Leave table"); } for (const p of pages) await until(() => vis(p, /^Sit down/), 15000); }
async function lobbyOf(p, game) { await p.goto(B + `/table/${game}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1200); }
async function reset(p) { for (const n of ["Leave queue", "Leave table"]) if (await vis(p, n)) { await click(p, n); await p.waitForTimeout(800); } }
(async () => { const br = await q.launch();
  const mk = async (w, h, mob, nm) => { const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    await c.addInitScript(() => { localStorage.setItem("zc.mode", "demo"); localStorage.setItem("zc.howto.seen", "all"); }); const p = await c.newPage(); p.setDefaultTimeout(20000);
    p.on("pageerror", e => console.log(`[${nm}] PAGEERR ${e.message}`));
    await p.goto(B + "/", { waitUntil: "networkidle" }); await p.waitForFunction(() => sessionStorage.getItem("zc.demo.session")); return p; };
  const A = await mk(1440, 900, false, "A"), C = await mk(390, 844, true, "C");
  for (const game of ["carrot", "liars", "holdem"]) { if (only !== "all" && only !== game) continue;
    // 1) pick a stake + join, two browsers
    for (const p of [A, C]) { await lobbyOf(p, game); await p.locator(".stake-pick button", { hasText: STAKE[game] }).click(); }
    rec(game, "no Quick match UI / waiting counts on table", !/Quick match|waiting/i.test(await A.locator(".match-bar").innerText()));
    await click(A, /^Sit down/); await A.waitForTimeout(700); await click(C, /^Sit down/);
    const paired = await until(async () => (await inGame[game](A)) && (await inGame[game](C)), 25000);
    rec(game, "pick stake + Sit down pairs two browsers", !!paired);
    await A.screenshot({ path: SH + `${game}-pvp-desktop.png` }); await C.screenshot({ path: SH + `${game}-pvp-mobile.png` });
    if (paired) {
      rec(game, "full round completes on both", !!await round(game, [A, C]));
      await A.screenshot({ path: SH + `${game}-round-done-desktop.png` });
      if (game === "holdem") await leaveHoldem([A, C]);
      await until(() => vis(A, /^Rematch$/), 10000); await click(A, /^Rematch$/);
      const off = await until(() => vis(C, "Accept rematch"), 12000); rec(game, "rematch offer reaches opponent", !!off);
      await C.screenshot({ path: SH + `${game}-rematch-offer-mobile.png` });
      if (off) { await click(C, "Accept rematch");
        const again = await until(async () => (await inGame[game](A)) && (await inGame[game](C)) && !(await vis(A, /^Rematch$/)), 15000);
        rec(game, "rematch deals a new round", !!again);
        rec(game, "rematch round completes", !!(again && await round(game, [A, C])));
        await A.screenshot({ path: SH + `${game}-rematch-done-desktop.png` }); }
      if (game === "holdem") await leaveHoldem([A, C]);
    }
    // 2) house fallback
    await lobbyOf(A, game); await A.locator(".stake-pick button", { hasText: STAKE[game] }).click(); await click(A, /^Sit down/);
    const t0 = Date.now(); const offer = await until(() => vis(A, "Play the house instead"), 35000);
    rec(game, "house offer after ~20 s alone", !!offer, offer ? `${Math.round((Date.now() - t0) / 1000)}s` : "");
    if (offer) { await A.screenshot({ path: SH + `${game}-house-offer-desktop.png` }); await click(A, "Play the house instead");
      rec(game, "House player badge + explainer", !!await until(async () => (await A.locator(".house-badge").count()) > 0 && (await A.locator(".house-note").count()) > 0, 15000));
      rec(game, "round vs house completes", !!await round(game, [A], 70000));
      await A.screenshot({ path: SH + `${game}-house-done-desktop.png` });
      if (game === "holdem") await leaveHoldem([A]); } else await reset(A);
    // 3) private invite by code
    for (const p of [A, C]) await lobbyOf(p, game);
    await A.locator(".stake-pick button", { hasText: STAKE[game] }).click(); await click(A, "Private table");
    const code = await until(async () => { const c = A.locator(".ws-invite b[data-code]"); return (await c.count()) ? c.getAttribute("data-code") : null; }, 10000);
    rec(game, "private table shows a code", !!code, code || "");
    if (code) { await click(C, "Have a code?"); await C.getByLabel("Invite code").fill(code); await click(C, "Join table");
      const j = await until(async () => (await inGame[game](A)) && (await inGame[game](C)), 20000);
      rec(game, "friend joins by invite code", !!j); await C.screenshot({ path: SH + `${game}-invite-joined-mobile.png` });
      if (j) rec(game, "invite round completes", !!await round(game, [A, C]));
      if (game === "holdem") await leaveHoldem([A, C]); } else await reset(A);
  }
  const f = res.filter(r => !r.ok).length; console.log(`TOTAL pass=${res.length - f} fail=${f}`);
  require("fs").writeFileSync(`/tmp/pvp-live-full-${only}.json`, JSON.stringify(res)); await br.close(); })();
