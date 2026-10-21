// Session history: rounds stored only in the browser, re-verified on /history, clearable.
const q = require("./lib");
(async () => {
  const br = await q.launch(); const s = await q.session(br, "hist"); const p = s.p; let fails = 0;
  const rec = (a, b, ok, d = "") => { q.record(a, b, ok, d); if (!ok) fails++; };
  const reqs = []; p.on("request", r => { if (!r.url().startsWith(q.BASE)) reqs.push(r.method() + " " + r.url()); });
  await p.goto(q.BASE + "/table/dice", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  const roll = p.locator(".btn.gold.lg").last();
  for (let i = 0; i < 2; i++) { await p.getByRole("button", { name: "Add chip to bet" }).click(); await roll.click(); await p.waitForTimeout(2200); }
  await p.goto(q.BASE + "/history", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  rec("History", "2 dice rounds stored locally, pending until seed reveal", await p.locator(".h-item").count() === 2 && await p.locator(".vbadge.wait").count() === 2);
  await p.goto(q.BASE + "/table/dice", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /Reveal seed/ }).click(); await p.waitForTimeout(1500);
  await p.goto(q.BASE + "/history", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  rec("History", "after reveal both re-verify green", await p.locator(".h-item b.vbadge.ok").count() === 2);
  // tamper with one stored outcome: must turn red
  await p.evaluate(() => { const k = "zc.history"; const l = JSON.parse(localStorage.getItem(k)); l[0].proofs[0].outcome = 1; localStorage.setItem(k, JSON.stringify(l)); });
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  rec("History", "tampered round shows Mismatch", await p.locator(".h-item b.vbadge.bad").count() === 1);
  await p.screenshot({ path: "/tmp/history.png", fullPage: true });
  await p.getByRole("button", { name: "Clear history" }).click(); await p.getByRole("button", { name: "Delete", exact: true }).click(); await p.waitForTimeout(500);
  rec("History", "clear empties storage", await p.locator(".empty-state").count() === 1 && await p.evaluate(() => localStorage.getItem("zc.history")) === null);
  rec("History", "history never sent off the web origin", reqs.every(u => !/^POST/.test(u) && !/history/.test(u)), reqs.join(","));
  await br.close(); process.exit(fails ? 1 : 0);
})();
