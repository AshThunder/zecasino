const q = require("./lib");
const execSplit = tok => { const id = require("crypto").createHash("sha256").update(tok).digest("hex");
  // the latest bj round has two bet entries = split debited
  return require("child_process").execFileSync("python3", ["-c", `import sqlite3,sys;c=sqlite3.connect('file:${process.env.ZC_DB || require("path").join(__dirname, "../run/qa.sqlite")}?mode=ro',uri=True)
r=c.execute("select ref from entries where session=? and kind='bet' and ref like 'bj%' order by seq desc limit 1",(sys.argv[1],)).fetchone()[0]
print(c.execute("select count(*) from entries where session=? and kind='bet' and ref=?",(sys.argv[1],r)).fetchone()[0]-1)`, id]).toString().trim() !== "0"; };
(async () => {
  let p; const br0 = null;
  process.on("unhandledRejection", async e => { console.log("ERR", e.message.split("\n")[0]); try { await globalThis.P.screenshot({ path: "/tmp/qa-fail.png" }); console.log(await globalThis.P.locator("main, body").first().innerText().then(t => t.slice(0, 600))); } catch {} process.exit(1); });
  const br = await q.launch(); const s = await q.session(br, "A"); p = s.p; globalThis.P = p;
  record = q.record;
  record("Session", "fresh session reconciles", await q.reconcile(s, "start"));
  // ---------- Dice
  await p.goto(q.BASE + "/table/dice", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  const roll = p.locator(".btn.gold.lg").last();
  for (let i = 0; i < 3; i++) { await p.getByRole("button", { name: "Add chip to bet" }).click(); await roll.click(); await p.waitForTimeout(2200); }
  let v = await q.verifyHouse(p); record("Dice", "3 rolls verified", v.ok >= 3 && v.bad === 0, `${v.ok} ✓ ${v.bad} ✗`);
  record("Dice", "ledger reconcile", await q.reconcile(s, "dice"));
  let r = await q.probe(s, { t: "dice", stake: q.ledger(s.token).balance + 1000, target: 5000, over: true }); record("Dice", "bet > balance rejected", r.t === "error", r.error);
  // insufficient balance (stake inside the table limit but above what the session holds): fresh session
  { const sB = await q.session(br, "dice-poor"); const l0 = q.ledger(sB.token);
    let stake = l0.balance + 1000;
    if (stake > 50_000_000) { // fresh sessions are dev-credited here: drain to below the max stake first via a withdraw-free path (losing bets would be random), so use a fresh session's balance as-is if possible
      record("Dice", "insufficient balance rejected", false, `fresh balance ${l0.balance} too high to test`); }
    else { const r2 = await q.probe(sB, { t: "dice", stake, target: 5000, over: true }); const l1 = q.ledger(sB.token);
      record("Dice", "insufficient balance rejected (stake within limit)", r2.t === "error" && r2.error === "insufficient balance" && l1.balance === l0.balance && l1.entries === l0.entries, `${r2.error}; balance ${l0.balance}→${l1.balance}, entries ${l0.entries}→${l1.entries}`); }
    await sB.ctx.close(); }
  // ---------- Roulette
  await p.goto(q.BASE + "/table/roulette", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  for (let i = 0; i < 3; i++) { await p.getByRole("button", { name: "Bet EVEN" }).click(); await p.getByRole("button", { name: "Bet 17" }).click(); await p.getByRole("button", { name: "Spin" }).click(); await p.waitForTimeout(7500); }
  v = await q.verifyHouse(p); record("Roulette", "3 spins verified", v.ok >= 3 && v.bad === 0, `${v.ok} ✓ ${v.bad} ✗`);
  record("Roulette", "ledger reconcile", await q.reconcile(s, "roulette"));
  r = await q.probe(s, { t: "roulette", bets: [{ key: "even", amount: q.ledger(s.token).balance + 1000 }] }); record("Roulette", "bet > balance rejected", r.t === "error", r.error);
  // ---------- Blackjack (top up the dev session first: double + split checks need room)
  { const r0 = await q.probe(s, { t: "dev_credit", amount: 100_000_000 }); console.log("top-up", r0.t, r0.balance ?? r0.error); }
  await p.goto(q.BASE + "/table/blackjack", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) {
    if (await p.getByRole("button", { name: "Clear" }).count()) await p.getByRole("button", { name: "Clear" }).click(); await p.getByRole("button", { name: "Betting circle" }).click(); await p.getByRole("button", { name: "Deal" }).click(); await p.waitForTimeout(2500);
    const dbl = p.getByRole("button", { name: "Double" });
    if (i === 1 && await dbl.count()) { await dbl.click(); await p.waitForTimeout(3500); continue; }
    for (let k = 0; k < 6 && await p.getByRole("button", { name: "Stand" }).count(); k++) { await p.getByRole("button", { name: k === 0 && i % 2 ? "Hit" : "Stand" }).click(); await p.waitForTimeout(1800); }
    await p.waitForTimeout(2500);
  }
  v = await q.verifyHouse(p); record("Blackjack", "4 hands (incl. double) verified", v.ok >= 4 && v.bad === 0, `${v.ok} ✓ ${v.bad} ✗`);
  record("Blackjack", "ledger reconcile", await q.reconcile(s, "blackjack"));
  r = await q.probe(s, { t: "bj_deal", stake: q.ledger(s.token).balance + 1000 }); record("Blackjack", "bet > balance rejected", r.t === "error", r.error);
  // double actually lands: exactly one card, stake doubled, ledger debits 2× and pays what the hand says
  { const X = 200000; let ok = false, note = "no doublable hand in 15 deals";
    for (let t = 0; t < 15 && !ok; t++) {
      const b0 = q.ledger(s.token).balance;
      const [d] = await q.probeSeq(s, [{ t: "bj_deal", stake: X }]);
      if (d.t === "error") { note = d.error; break; }
      if (d.hand.done || !d.hand.can_double) { if (!d.hand.done) await q.probeSeq(s, [{ t: "bj_stand" }]); continue; }
      const [m] = await q.probeSeq(s, [{ t: "bj_double" }]); const h = m.hand; const b1 = q.ledger(s.token).balance;
      ok = h.done && h.player.length === 3 && h.stake === 2 * X && h.hands[0].cards.length === 3 && b1 - b0 === h.payout - 2 * X && m.balance === b1;
      note = `cards ${h.player.length}, stake ${h.stake}, Δledger ${b1 - b0} = payout ${h.payout} − ${2 * X}`;
    }
    record("Blackjack", "double lands one card, doubles the stake and the debit", ok, note); }
  // split in the UI: deal until a pair shows up, split, play both hands, then verify via the seed reveal
  { await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500); let split = false, two = false, cost = 0;
    const l0 = q.ledger(s.token).balance;
    for (let t = 0; t < 60 && !split; t++) {
      if (await p.getByRole("button", { name: "Clear" }).count()) await p.getByRole("button", { name: "Clear" }).click(); await p.getByRole("button", { name: "Betting circle" }).click(); await p.getByRole("button", { name: "Deal" }).click(); await p.waitForTimeout(2400);
      if (await p.getByRole("button", { name: "Split" }).count()) { await p.getByRole("button", { name: "Split" }).click(); await p.waitForTimeout(2500); split = true; two = await p.locator(".hand.player .phand").count() === 2; }
      for (let k = 0; k < 4 && await p.getByRole("button", { name: "Stand" }).count(); k++) { await p.getByRole("button", { name: "Stand" }).click(); await p.waitForTimeout(2200); }
      await p.waitForTimeout(1500);
    }
    record("Blackjack", "split shows two hands", split && two, split ? "" : "no pair in 60 deals");
    const ent = execSplit(s.token); record("Blackjack", "split debits a second stake", !split || ent, ent ? "" : "no second bet entry on the split hand");
    v = await q.verifyHouse(p); record("Blackjack", "split round verified (draw log rebuilds both hands)", split && v.ok >= 1 && v.bad === 0, `${v.ok} ✓ ${v.bad} ✗`);
    record("Blackjack", "ledger reconcile after split", await q.reconcile(s, "bj split")); }
  // refresh mid-hand, then disconnect (close tab) mid-hand and come back in a new tab
  for (const mode of ["refresh", "disconnect"]) {
    let open = false;
    for (let t = 0; t < 5 && !open; t++) { if (await p.getByRole("button", { name: "Clear" }).count()) await p.getByRole("button", { name: "Clear" }).click(); await p.getByRole("button", { name: "Betting circle" }).click(); await p.getByRole("button", { name: "Deal" }).click(); await p.waitForTimeout(2800); open = await p.getByRole("button", { name: "Stand" }).count() > 0; if (!open) await p.waitForTimeout(1500); }
    let pg = p;
    if (mode === "refresh") await p.reload({ waitUntil: "networkidle" });
    else { await p.evaluate(() => window.__zc.drop()); await p.waitForTimeout(3000); }
    await pg.waitForTimeout(3500);
    const resumed = await pg.getByRole("button", { name: "Stand" }).count() > 0;
    record("Blackjack", `${mode} mid-hand resumes the hand`, resumed, open ? "" : "could not open a hand");
    if (resumed) { await pg.getByRole("button", { name: "Stand" }).click(); await pg.waitForTimeout(3500); }
    record("Blackjack", `ledger reconcile after ${mode}`, await q.reconcile(s, "bj " + mode));
    p = pg;
  }
  // close the tab entirely, open a new one, restore with the saved session key
  { const url = p.url(); await p.close(); const pg = await s.ctx.newPage(); await pg.goto(q.BASE + "/", { waitUntil: "networkidle" }); await pg.waitForTimeout(1200);
    const fresh = await pg.evaluate(() => sessionStorage.getItem("zc.session"));
    await pg.locator(".shield-pill").click(); await pg.fill("#sk-restore", s.token); await pg.getByRole("button", { name: "Restore" }).click();
    await pg.waitForLoadState("networkidle"); await pg.waitForTimeout(1500);
    const back = await pg.evaluate(() => sessionStorage.getItem("zc.session"));
    record("Session", "closed tab restored from session key", back === s.token && fresh !== s.token);
    s.p = pg; p = pg; globalThis.P = pg; record("Session", "ledger reconcile after restore", await q.reconcile(s, "restore")); }
  if (0) {
  if (await p.getByRole("button", { name: "Clear" }).count()) await p.getByRole("button", { name: "Clear" }).click(); await p.getByRole("button", { name: "Betting circle" }).click(); await p.getByRole("button", { name: "Deal" }).click(); await p.waitForTimeout(2500);
  const midHand = await p.getByRole("button", { name: "Stand" }).count();
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  const resumed = await p.getByRole("button", { name: "Stand" }).count();
  record("Blackjack", "refresh mid-hand resumes the hand", !midHand || resumed > 0, midHand ? (resumed ? "resumed" : "hand lost from UI") : "hand ended immediately (blackjack)");
  if (resumed) { await p.getByRole("button", { name: "Stand" }).click(); await p.waitForTimeout(3500); }
  }
  require("fs").writeFileSync("/tmp/qa-token-A", s.token);
  require("fs").writeFileSync("/tmp/qa-house.json", JSON.stringify(q.results));
  await br.close();
})();
