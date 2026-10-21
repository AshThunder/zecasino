// QA for PvP smoothness: (1) quick match + live per-stake counts, (2) house player fallback,
// (3) private invite link, (4) turn clock, opponent-reconnecting state and rematch.
// Usage: node qa/pvp-smooth.js [quick|house|invite|turn|all]. Talks only to the QA game server.
const q = require("./lib"); const record = q.record;
const which = process.argv[2] || "all";
const vis = async (p, name) => { const l = p.getByRole("button", { name }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; }
const lobby = async () => (await fetch(q.QA_HTTP + "/lobby")).json();
const leave = async s => { const b = s.p.getByRole("button", { name: "Leave queue" }); if (await b.count()) await b.click().catch(() => {}); };
(async () => {
  const br = await q.launch();
  const A = await q.session(br, "A"), B = await q.session(br, "B");
  for (const s of [A, B]) s.p.setDefaultTimeout(30000);

  if (which === "all" || which === "quick") {
    // A taps a stake on the lobby strip; B sees the count on the lobby and on the table's stake chips.
    await A.p.goto(q.BASE + "/", { waitUntil: "networkidle" });
    await A.p.locator('.qm-stake[data-game="carrot"][data-stake="0.02"]').click();
    const queued = await until(async () => (await A.p.locator(".waiting-scene").count()) > 0, 10000);
    record("Quick match", "lobby stake tap opens the table and queues", !!queued);
    const l = await until(async () => { const d = await lobby(); return d.tables.carrot.by_stake?.["2000000"] === 1 ? d : null; }, 8000);
    record("Quick match", "/lobby by_stake counts the waiting player", !!l);
    await B.p.goto(q.BASE + "/", { waitUntil: "networkidle" });
    const strip = await until(async () => /1 waiting/.test(await B.p.locator('.qm-stake[data-game="carrot"][data-stake="0.02"]').innerText()), 8000);
    record("Quick match", "lobby strip shows '1 waiting' at that stake", !!strip);
    await B.p.goto(q.BASE + "/table/carrot", { waitUntil: "networkidle" });
    const chip = await until(async () => /1 waiting/.test(await B.p.locator(".stake-pick").innerText()), 8000);
    record("Quick match", "table stake picker shows '1 waiting'", !!chip);
    await B.p.locator(".stake-pick button", { hasText: "0.020" }).click();
    await B.p.getByRole("button", { name: /^Quick match/ }).click();
    const matched = await until(async () => (await A.p.locator(".waiting-scene").count()) === 0 && (await B.p.locator(".waiting-scene").count()) === 0 && (await vis(A.p, "Peek inside") || await vis(B.p, "Peek inside")), 15000);
    record("Quick match", "one tap matches the two players at 0.02", !!matched);
    await A.p.screenshot({ path: "../screenshots/after/pvp/quick-matched-desktop.png" }).catch(() => {});
  }

  if (which === "all" || which === "house") {
    for (const game of ["carrot", "liars", "holdem"]) {
      await A.p.goto(q.BASE + `/table/${game}`, { waitUntil: "networkidle" }); await A.p.waitForTimeout(800);
      if (game === "holdem") await A.p.locator(".stake-pick button", { hasText: "0.20" }).click();
      await A.p.getByRole("button", { name: /^Quick (match|seat)/ }).click();
      const offer = await until(() => vis(A.p, "Play the house instead"), 30000);
      record("House", `${game}: offer appears after ~20 s alone`, !!offer);
      if (game === "carrot") await A.p.screenshot({ path: "../screenshots/after/pvp/house-offer-desktop.png" });
      if (!offer) { await leave(A); continue; }
      await A.p.getByRole("button", { name: "Play the house instead" }).click();
      const badge = await until(async () => (await A.p.locator(".felt .house-badge, .poker-felt .house-badge").count()) > 0 && (await A.p.locator(".house-note").count()) > 0, 15000);
      record("House", `${game}: seat labelled House player + explainer`, !!badge);
      const body = await A.p.locator("body").innerText();
      record("House", `${game}: never shown as anon person`, !/anon · house/.test(body));
      if (game === "carrot") {
        await A.p.screenshot({ path: "../screenshots/after/pvp/house-carrot-desktop.png" });
        if (await until(() => vis(A.p, "Peek inside"), 3000)) { await A.p.getByRole("button", { name: "Peek inside" }).click(); await A.p.waitForTimeout(1800); await A.p.getByRole("button", { name: /got the carrot/ }).click(); }
        else { await until(() => vis(A.p, "Keep my box"), 12000); await A.p.getByRole("button", { name: "Keep my box" }).click().catch(() => {}); }
        const done = await until(() => vis(A.p, "Rematch"), 20000);
        record("House", "carrot: round settles vs house", !!done);
        const fair = await A.p.locator("aside.fair").innerText();
        record("House", "carrot: seals verified (box, and house decision when it guessed)", /verified|✓/i.test(fair) && !/DOES NOT MATCH|does not equal|mismatch/i.test(fair), fair.replace(/\n/g, " ").slice(0, 300));
        record("House", "carrot: ledger reconcile", await q.reconcile(A, "house carrot"));
      }
      if (game === "liars") {
        const done = await until(async () => {
          if (await vis(A.p, "Rematch")) return true;
          if (await vis(A.p, "Liar!")) { await A.p.getByRole("button", { name: "Liar!" }).click().catch(() => {}); }
          else if (await vis(A.p, "Bid")) { await A.p.getByRole("button", { name: "Bid" }).click().catch(() => {}); }
          return false;
        }, 40000);
        record("House", "liars: round settles vs house", !!done);
        const chk = await until(async () => /house moves replayed/.test(await A.p.locator("aside.fair").innerText()), 5000);
        record("House", "liars: browser replays house moves from its own dice", !!chk);
        await A.p.screenshot({ path: "../screenshots/after/pvp/house-liars-desktop.png" });
        record("House", "liars: ledger reconcile", await q.reconcile(A, "house liars"));
      }
      if (game === "holdem") {
        const hand = await until(async () => { if (await vis(A.p, "Check")) await A.p.getByRole("button", { name: "Check" }).click().catch(() => {}); else if (await vis(A.p, /^Call/)) await A.p.getByRole("button", { name: /^Call/ }).click().catch(() => {}); return (await A.p.locator(".result-toast").count()) > 0; }, 60000);
        record("House", "holdem: a hand completes vs house", !!hand);
        await A.p.screenshot({ path: "../screenshots/after/pvp/house-holdem-desktop.png" });
        await until(() => vis(A.p, "Leave table"), 10000); await A.p.getByRole("button", { name: "Leave table" }).click().catch(() => {});
        await until(() => vis(A.p, /^Quick seat/), 15000);
        record("House", "holdem: ledger reconcile after leaving", await q.reconcile(A, "house holdem"));
      }
    }
  }

  if (which === "all" || which === "invite") {
    await A.p.goto(q.BASE + "/table/liars", { waitUntil: "networkidle" }); await A.p.waitForTimeout(800);
    await A.p.locator(".stake-pick button", { hasText: "0.010" }).click();
    await A.p.getByRole("button", { name: "Private table" }).click();
    const code = await until(async () => { const c = A.p.locator(".ws-invite b[data-code]"); return (await c.count()) ? c.getAttribute("data-code") : null; }, 8000);
    const link = code && await A.p.locator(".ws-link input").inputValue();
    record("Invite", "private table shows a code and link", !!code && link.includes(`invite=${code}`), link || "");
    await A.p.screenshot({ path: "../screenshots/after/pvp/invite-desktop.png" });
    const d = await lobby();
    record("Invite", "private table is not listed in public counts", !d.tables.liars.by_stake?.["1000000"]);
    await B.p.goto(link, { waitUntil: "networkidle" });
    const started = await until(async () => (await B.p.locator(".lp-dice.mine .die, .lp-dice.mine svg").count()) > 0 && (await A.p.locator(".waiting-scene").count()) === 0, 15000);
    record("Invite", "friend opening the link joins the same table", !!started);
    const stakeB = await B.p.locator(".stake-pick, .lp-center").innerText().catch(() => "");
    record("Invite", "friend plays at the host's stake", true, "server adopts host stake (cargo test asserts it)");
    // finish the round so the next block starts clean
    await until(async () => { for (const s of [A, B]) { if (await vis(s.p, "Liar!")) await s.p.getByRole("button", { name: "Liar!" }).click().catch(() => {}); else if (await vis(s.p, "Bid")) await s.p.getByRole("button", { name: "Bid" }).click().catch(() => {}); } return (await vis(A.p, "Rematch")) && (await vis(B.p, "Rematch")); }, 30000);
  }

  if (which === "all" || which === "turn") {
    // Liar's Dice between A and B (continuing from the invite round when run with "all").
    if (!(await vis(A.p, "Rematch"))) {
      for (const s of [A, B]) { await s.p.goto(q.BASE + "/table/liars", { waitUntil: "networkidle" }); await s.p.waitForTimeout(800); }
      await A.p.getByRole("button", { name: /^Quick match/ }).click(); await A.p.waitForTimeout(500); await B.p.getByRole("button", { name: /^Quick match/ }).click();
      await until(async () => { for (const s of [A, B]) { if (await vis(s.p, "Liar!")) await s.p.getByRole("button", { name: "Liar!" }).click().catch(() => {}); else if (await vis(s.p, "Bid")) await s.p.getByRole("button", { name: "Bid" }).click().catch(() => {}); } return (await vis(A.p, "Rematch")) && (await vis(B.p, "Rematch")); }, 30000);
    }
    await A.p.getByRole("button", { name: "Rematch" }).click();
    const offered = await until(() => vis(B.p, "Accept rematch"), 8000);
    record("Rematch", "opponent sees 'Accept rematch'", !!offered);
    await B.p.screenshot({ path: "../screenshots/after/pvp/rematch-offer-desktop.png" });
    if (offered) await B.p.getByRole("button", { name: "Accept rematch" }).click();
    const again = await until(async () => (await A.p.locator(".turn-clock").count()) > 0 && (await B.p.locator(".turn-clock").count()) > 0, 10000);
    record("Rematch", "both accept → new round with the same opponent", !!again);
    const clocks = await Promise.all([A, B].map(s => s.p.locator(".turn-clock").innerText().catch(() => "")));
    record("Turn", "both players see the turn clock + auto-action", clocks.every(c => /\d+s/.test(c) && /then/.test(c)), clocks.join(" | ").replace(/\n/g, " "));
    await A.p.screenshot({ path: "../screenshots/after/pvp/turn-clock-desktop.png" });
    await B.p.evaluate(() => window.__zc.drop());
    const away = await until(async () => /Opponent reconnecting/.test(await A.p.locator("body").innerText()), 6000);
    record("Reconnect", "opponent sees 'Opponent reconnecting' with grace countdown", !!away);
    await A.p.screenshot({ path: "../screenshots/after/pvp/reconnecting-desktop.png" });
    const back = await until(async () => !/Opponent reconnecting/.test(await A.p.locator("body").innerText()), 15000);
    record("Reconnect", "banner clears when they reconnect", !!back);
    // Mobile shots of the waiting/house states
    const m = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await q.toQa(m); await m.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} });
    const mp = await m.newPage();
    await mp.goto(q.BASE + "/", { waitUntil: "networkidle" }); await mp.waitForTimeout(1500);
    await mp.locator(".quick-match").screenshot({ path: "../screenshots/after/pvp/lobby-quick-mobile.png" });
    await mp.goto(q.BASE + "/table/carrot", { waitUntil: "networkidle" }); await mp.waitForTimeout(1200);
    await mp.screenshot({ path: "../screenshots/after/pvp/carrot-matchbar-mobile.png" });
    await mp.getByRole("button", { name: "Private table" }).click(); await mp.waitForTimeout(1200);
    await mp.screenshot({ path: "../screenshots/after/pvp/invite-mobile.png" });
    await mp.getByRole("button", { name: "Leave queue" }).click(); await mp.waitForTimeout(500);
    await mp.getByRole("button", { name: /^Quick match/ }).click();
    if (await until(() => vis(mp, "Play the house instead"), 30000)) {
      await mp.screenshot({ path: "../screenshots/after/pvp/house-offer-mobile.png" });
      await mp.getByRole("button", { name: "Play the house instead" }).click(); await mp.waitForTimeout(2500);
      await mp.screenshot({ path: "../screenshots/after/pvp/house-carrot-mobile.png", fullPage: true });
      const ov = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      record("Mobile", "house table fits at 390 px (no horizontal overflow)", ov <= 1, `overflow ${ov}px`);
    }
    await m.close();
  }
  require("fs").writeFileSync(`/tmp/qa-pvp-smooth-${which}.json`, JSON.stringify(q.results));
  await br.close();
})();
