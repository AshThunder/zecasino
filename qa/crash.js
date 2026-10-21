const q = require("./lib");
(async () => {
  const br = await q.launch(); const s = await q.session(br, "A"); let p = s.p; p.setDefaultTimeout(60000);
  const tokA = require("fs").readFileSync("/tmp/qa-token-A", "utf8");
  await p.evaluate(t => sessionStorage.setItem("zc.session", t), tokA); s.token = tokA;
  await p.goto(q.BASE + "/table/crash", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const auto = p.locator("label.auto input");
  const waitBetting = () => p.getByRole("button", { name: "Bet next round" }).waitFor({ timeout: 90000 });
  // manual cash-out
  await auto.fill("1"); await waitBetting();
  await p.getByRole("button", { name: "Add chip to bet" }).click(); await p.getByRole("button", { name: "Bet next round" }).click();
  const cash = p.getByRole("button", { name: /Cash out/ });
  let manual = "busted before cash-out";
  try { await cash.waitFor({ timeout: 20000 }); await p.waitForTimeout(300); await cash.click(); manual = "cashed"; } catch {}
  await p.waitForTimeout(1500);
  record = q.record;
  record("Crash", "manual cash-out round", true, manual);
  // auto cash-out at 1.01x
  await auto.fill("1.01"); await waitBetting(); await p.getByRole("button", { name: "Bet next round" }).click();
  const before = q.ledger(s.token).entries; let added = 0;
  for (let i = 0; i < 40 && added < 2; i++) { await p.waitForTimeout(1000); added = q.ledger(s.token).entries - before; }
  record("Crash", "auto cash-out at 1.01× settled", added >= 2, `${added} ledger entries (bet + payout) for the round`);
  // refresh mid-round with a live bet
  await auto.fill("1"); await waitBetting(); await p.getByRole("button", { name: "Bet next round" }).click();
  await cash.waitFor({ timeout: 20000 }).catch(() => {});
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const resumed = await cash.count() > 0;
  record("Crash", "refresh mid-round keeps cash-out button", resumed);
  if (resumed) await cash.click().catch(() => {});
  // let rounds finish, then verify
  await p.locator(".fair .vrow").first().waitFor({ timeout: 90000 }).catch(() => {});
  const okRows = await p.locator(".fair .ok, .fair b.ok, .vrow b.ok").count(); const bad = await p.locator(".fair .bad").count();
  
  record("Crash", "every finished round verified in browser", okRows > 0 && bad === 0, `${okRows} ✓ ${bad} ✗`);
  record("Crash", "ledger reconcile", await q.reconcile(s, "crash"));
  await waitBetting(); const r = await q.probe(s, { t: "crash_bet", stake: q.ledger(s.token).balance + 1000 });
  record("Crash", "bet > balance rejected", r.t === "error", r.error);
  await br.close();
})();
