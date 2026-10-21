const q = require("./lib");
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
  // ---------- Roulette
  await p.goto(q.BASE + "/table/roulette", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  for (let i = 0; i < 3; i++) { await p.getByRole("button", { name: "Bet EVEN" }).click(); await p.getByRole("button", { name: "Bet 17" }).click(); await p.getByRole("button", { name: "Spin" }).click(); await p.waitForTimeout(7500); }
  v = await q.verifyHouse(p); record("Roulette", "3 spins verified", v.ok >= 3 && v.bad === 0, `${v.ok} ✓ ${v.bad} ✗`);
  record("Roulette", "ledger reconcile", await q.reconcile(s, "roulette"));
  r = await q.probe(s, { t: "roulette", bets: [{ key: "even", amount: q.ledger(s.token).balance + 1000 }] }); record("Roulette", "bet > balance rejected", r.t === "error", r.error);
  // ---------- Blackjack
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
