const q = require("./lib");
(async () => {
  const br = await q.launch(); const s = await q.session(br, "A"); const p = s.p; p.setDefaultTimeout(8000);
  p.on("console", m => console.log("console", m.text().slice(0, 200)));
  await p.goto(q.BASE + "/table/blackjack", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) { try {
    await p.getByRole("button", { name: "Betting circle" }).click(); await p.getByRole("button", { name: "Deal" }).click(); await p.waitForTimeout(2800);
    await p.screenshot({ path: `/tmp/bj-${i}.png` });
    console.log(i, (await p.locator(".bj-actions, .actions, .pk-actions").first().innerText().catch(() => "?")).replace(/\n/g, " | "), "msg:", await p.locator(".bj-msg, .result-toast").first().innerText().catch(() => "-"));
    if (await p.getByRole("button", { name: "Stand" }).count()) { await p.getByRole("button", { name: "Stand" }).click(); await p.waitForTimeout(3500); }
  } catch (e) { console.log("STUCK", i, e.message.split("\n")[0]); await p.screenshot({ path: `/tmp/bj-stuck.png` }); break; } }
  await br.close();
})();
