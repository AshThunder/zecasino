const q = require("./lib"); const record = q.record;
const which = process.argv[2] || "all";
const vis = async (p, name) => { const l = p.getByRole("button", { name }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; }
async function sitBoth(A, B, path, btn = /^Sit down/) {
  for (const s of [A, B]) { await s.p.goto(q.BASE + path, { waitUntil: "networkidle" }); await s.p.waitForTimeout(1200); }
  await A.p.getByRole("button", { name: btn }).click(); await A.p.waitForTimeout(500);
  await B.p.getByRole("button", { name: btn }).click();
}
(async () => {
  const br = await q.launch();
  const A = await q.session(br, "A"), B = await q.session(br, "B");
  for (const s of [A, B]) s.p.setDefaultTimeout(30000);
  // ---------------- Carrot in a Box
  if (which === "all" || which === "carrot") {
    for (const mode of ["normal", "disconnect", "refresh"]) {
      await sitBoth(A, B, "/table/carrot");
      const holder = await until(async () => (await vis(A.p, "Peek inside")) ? A : (await vis(B.p, "Peek inside")) ? B : null, 15000);
      if (!holder) { record("Carrot", `${mode}: round started`, false); continue; }
      const guesser = holder === A ? B : A;
      if (mode === "refresh") { await holder.p.reload({ waitUntil: "networkidle" }); await holder.p.waitForTimeout(2000); }
      const canPeek = await until(() => vis(holder.p, "Peek inside"), 8000);
      if (mode === "refresh") record("Carrot", "holder refresh mid-round resumes the round", !!canPeek);
      if (canPeek) {
        await holder.p.getByRole("button", { name: "Peek inside" }).click(); await holder.p.waitForTimeout(1500);
        const line = holder.p.locator(".carrot-lines button, .lines button, button.line").first();
        if (await line.count()) await line.click(); else await holder.p.getByRole("button", { name: /got the carrot|empty|Mine/i }).first().click();
      }
      if (mode === "disconnect") { await guesser.p.evaluate(() => window.__zc.drop()); await guesser.p.waitForTimeout(3000); }
      const swap = await until(() => vis(guesser.p, "Swap boxes"), 20000);
      if (swap) await guesser.p.getByRole("button", { name: "Swap boxes" }).click();
      const done = await until(async () => (await vis(A.p, "New opponent")) && (await vis(B.p, "New opponent")), 25000);
      if (mode === "disconnect") record("Carrot", "guesser disconnect mid-round, reconnects and finishes", !!done);
      if (mode === "normal") record("Carrot", "round plays to reveal (two sessions)", !!done, done ? "" : `swap=${!!swap}`);
      if (!done) { await A.p.screenshot({ path: "/tmp/carrotA.png" }); await B.p.screenshot({ path: "/tmp/carrotB.png" }); }
      if (done) {
        const fair = (await A.p.locator("aside.fair").innerText()) + (await B.p.locator("aside.fair").innerText());
        record("Carrot", `${mode}: seal verified by both browsers`, /verified|✓/i.test(fair) && !/mismatch|✗/i.test(fair));
      }
      record("Carrot", `${mode}: ledger reconcile A`, await q.reconcile(A, "carrot A"));
      record("Carrot", `${mode}: ledger reconcile B`, await q.reconcile(B, "carrot B"));
      if (!done) break;
    }
    const r = await q.probe(A, { t: "carrot_join", stake: q.ledger(A.token).balance + 1000 }); record("Carrot", "bet > balance rejected", r.t === "error", r.error);
  }
  // ---------------- Liar's Dice
  if (which === "all" || which === "liars") {
    for (const mode of ["normal", "disconnect", "refresh"]) {
      await sitBoth(A, B, "/table/liars");
      for (const s of [A, B]) { if (await until(() => vis(s.p, /Shake/), 6000)) await s.p.getByRole("button", { name: /Shake/ }).click(); }
      const first = await until(async () => (await vis(A.p, "Bid")) ? A : (await vis(B.p, "Bid")) ? B : null, 20000);
      if (!first) { record("Liar's Dice", `${mode}: bidding started`, false); continue; }
      const second = first === A ? B : A;
      await first.p.getByRole("button", { name: "More" }).click(); await first.p.getByRole("button", { name: "Bid", exact: true }).click();
      if (mode === "disconnect") { await second.p.evaluate(() => window.__zc.drop()); await second.p.waitForTimeout(3000); }
      if (mode === "refresh") { await second.p.reload({ waitUntil: "networkidle" }); await second.p.waitForTimeout(3000); }
      const can = await until(() => vis(second.p, "Liar!"), 15000);
      if (can) await second.p.getByRole("button", { name: "Liar!" }).click();
      const done = await until(async () => (await A.p.getByText(/called liar/).count()) && (await B.p.getByText(/called liar/).count()), 20000);
      record("Liar's Dice", { normal: "round plays to reveal (two sessions)", disconnect: "caller disconnects mid-round, reconnects and calls", refresh: "caller refreshes mid-round, resumes and calls" }[mode], !!done);
      if (done) { const f = (await A.p.locator("aside.fair").innerText()) + (await B.p.locator("aside.fair").innerText()); record("Liar's Dice", `${mode}: all cups verified in both browsers`, (f.match(/verified/g) || []).length >= 4 && !/mismatch/.test(f)); }
      record("Liar's Dice", `${mode}: ledger reconcile A`, await q.reconcile(A, "liars A"));
      record("Liar's Dice", `${mode}: ledger reconcile B`, await q.reconcile(B, "liars B"));
    }
    const r = await q.probe(A, { t: "liars_join", stake: q.ledger(A.token).balance + 1000 }); record("Liar's Dice", "bet > balance rejected", r.t === "error", r.error);
  }
  // ---------------- Hold'em
  if (which === "all" || which === "holdem" || which === "hmrefresh") for (const s of [A, B]) await q.probe(s, { t: "dev_credit", amount: 60_000_000 });
  if (which === "all" || which === "holdem") {
   if (which !== "hmrefresh") {
    await sitBoth(A, B, "/table/holdem");
    let hands = 0, actions = 0, dropped = false, refreshed = false;
    const t0 = Date.now();
    while (hands < 2 && Date.now() - t0 < 120000) {
      for (const s of [A, B]) {
        if (await vis(s.p, /^(Check|Call)/)) {
          if (actions === 1 && !dropped) { await s.p.evaluate(() => window.__zc.drop()); await s.p.waitForTimeout(3000); dropped = true; }
          await s.p.getByRole("button", { name: /^(Check|Call)/ }).click().catch(() => {}); actions++; await s.p.waitForTimeout(400);
        }
      }
      if (await A.p.locator(".result-toast.inline").count() && await B.p.locator(".result-toast.inline").count()) {
        hands++;
        const logs = (await A.p.locator(".hand-log").innerText()) + (await B.p.locator(".hand-log").innerText());
        record("Hold'em", `hand ${hands}: all shuffle/share checks passed in both browsers`, !/FAIL|MISMATCH|failed/.test(logs) && /verified/.test(logs));
        if (hands < 2) await until(async () => !(await A.p.locator(".result-toast.inline").count()), 15000);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    record("Hold'em", "two hands played heads-up (two sessions), incl. a dropped connection mid-hand", hands >= 2, `${actions} actions`);
    await until(() => vis(A.p, "Leave table"), 10000);
    await A.p.getByRole("button", { name: "Leave table" }).click().catch(() => {});
    await until(async () => (await vis(A.p, /^Sit down/)) && (await vis(B.p, /^Sit down/)), 15000);
    record("Hold'em", "ledger reconcile A after leaving", await q.reconcile(A, "holdem A"));
    record("Hold'em", "ledger reconcile B after leaving", await q.reconcile(B, "holdem B"));
    const r = await q.probe(A, { t: "holdem_join", stake: q.ledger(A.token).balance + 1000 }); record("Hold'em", "buy-in > balance rejected", r.t === "error", r.error);
   }
  }
  if (which === "all" || which === "holdem" || which === "hmrefresh") {
    // refresh mid-hand
    await sitBoth(A, B, "/table/holdem");
    await until(() => vis(A.p, /^(Check|Call)/).then(a => a || vis(B.p, /^(Check|Call)/)), 30000);
    await A.p.reload({ waitUntil: "networkidle" }); await A.p.waitForTimeout(3000);
    let refreshed = await until(async () => (await A.p.locator(".pk-seat.bottom .pcard").count()) > 0 && !(await vis(A.p, /^Sit down/)), 8000);
    record("Hold'em", "refresh mid-hand resumes the table", !!refreshed);
    let fin = null; const t1 = Date.now();
    while (!fin && Date.now() - t1 < 90000) {
      for (const s of [A, B]) if (await vis(s.p, /^(Check|Call)/)) { await s.p.getByRole("button", { name: /^(Check|Call)/ }).click().catch(() => {}); await s.p.waitForTimeout(400); }
      if (await A.p.locator(".result-toast.inline").count() && await B.p.locator(".result-toast.inline").count()) fin = true;
      await new Promise(r => setTimeout(r, 300));
    }
    record("Hold'em", "refreshed player finishes the hand (own hole cards reopened)", !!fin && (await A.p.locator(".pk-seat.bottom .pcard").count()) >= 2);
    await until(() => vis(A.p, "Leave table"), 10000); await A.p.getByRole("button", { name: "Leave table" }).click().catch(() => {});
    await until(async () => (await vis(A.p, /^Sit down/)) && (await vis(B.p, /^Sit down/)), 15000);
    record("Hold'em", "ledger reconcile A after refresh hand", await q.reconcile(A, "holdem A2"));
    record("Hold'em", "ledger reconcile B after refresh hand", await q.reconcile(B, "holdem B2"));
  }
  require("fs").writeFileSync(`/tmp/qa-pvp-${which}.json`, JSON.stringify(q.results));
  await br.close();
})();
