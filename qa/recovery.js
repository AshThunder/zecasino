// Session recovery: code shown before the deposit address, restore by code and by sealed backup file in a fresh browser.
const q = require("./lib"); const fs = require("fs");
(async () => { const br = await q.launch(); let fails = 0; const rec = (a, b, ok, d = "") => { q.record(a, b, ok, d); if (!ok) fails++; };
  const s = await q.session(br, "rec"); const p = s.p; const bal = await q.header(p);
  await p.getByRole("button", { name: "Cashier" }).click(); await p.waitForTimeout(800);
  rec("Recovery", "code shown before the deposit address (address locked)", await p.locator(".rc-code").count() === 1 && await p.locator(".dep.addr-locked").count() === 1);
  const code = (await p.locator(".rc-code").innerText()).trim();
  rec("Recovery", "code format ZEC-xxxx…", /^ZEC-[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/.test(code), code.slice(0, 14) + "…");
  await p.locator(".rc-file input").fill("correct horse");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download backup" }).click()]);
  const file = "/tmp/qa-backup.json"; await dl.saveAs(file); const j = JSON.parse(fs.readFileSync(file, "utf8"));
  rec("Recovery", "backup file is sealed (no plaintext code/key)", !!j.sealed && !JSON.stringify(j).includes(code) && !JSON.stringify(j).includes(s.token));
  await p.locator(".rc-ack input").check(); await p.getByRole("button", { name: "Show my deposit address" }).click(); await p.waitForTimeout(300);
  rec("Recovery", "address unlocks after acknowledging", await p.locator(".dep.addr-locked").count() === 0);
  // fresh browser, restore by code (typed lowercase with spaces)
  const ctx2 = await br.newContext(); await q.toQa(ctx2); await ctx2.addInitScript(() => localStorage.setItem("zc.howto.seen", "all")); const p2 = await ctx2.newPage();
  await p2.goto(q.BASE + "/", { waitUntil: "networkidle" }); await p2.waitForTimeout(1000);
  await p2.getByRole("button", { name: /Restore a session/ }).click(); await p2.locator(".restore textarea").fill(code.toLowerCase().replace(/-/g, " "));
  await p2.getByRole("button", { name: "Restore session" }).click(); await p2.waitForTimeout(3000);
  rec("Recovery", "restore by code: same session + balance", await p2.evaluate(() => sessionStorage.getItem("zc.session")) === s.token && Math.abs(await q.header(p2) - bal) < 1e-4, `bal ${bal}`);
  rec("Recovery", "restored toast", await p2.locator(".toast.t-success").count() >= 1);
  // typo is rejected by checksum
  await p2.getByRole("button", { name: /Restore a session/ }).click(); const bad = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
  await p2.locator(".restore textarea").fill(bad); await p2.getByRole("button", { name: "Restore session" }).click(); await p2.waitForTimeout(500);
  rec("Recovery", "typo rejected by checksum", await p2.locator(".rs-err").count() === 1);
  // third browser, restore by sealed file
  const ctx3 = await br.newContext(); await q.toQa(ctx3); await ctx3.addInitScript(() => localStorage.setItem("zc.howto.seen", "all")); const p3 = await ctx3.newPage();
  await p3.goto(q.BASE + "/", { waitUntil: "networkidle" }); await p3.waitForTimeout(1000);
  await p3.getByRole("button", { name: /Restore a session/ }).click(); await p3.locator(".rs-upload input").setInputFiles(file);
  await p3.getByRole("button", { name: "Restore session" }).click(); await p3.waitForTimeout(300);
  await p3.locator(".restore input[type=password]").fill("wrong"); await p3.getByRole("button", { name: "Restore session" }).click(); await p3.waitForTimeout(800);
  rec("Recovery", "wrong passphrase refused", await p3.locator(".rs-err").count() === 1);
  await p3.locator(".restore input[type=password]").fill("correct horse"); await p3.getByRole("button", { name: "Restore session" }).click(); await p3.waitForTimeout(3000);
  rec("Recovery", "restore by sealed backup file", await p3.evaluate(() => sessionStorage.getItem("zc.session")) === s.token);
  // entry points: Cashier (desktop + mobile) and the menu sheet (mobile/tablet) open the same restore dialog
  for (const [tag, vp] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 1024, height: 768 }], ["mobile", { width: 390, height: 844 }]]) {
    const c = await br.newContext({ viewport: vp }); await q.toQa(c); await c.addInitScript(() => localStorage.setItem("zc.howto.seen", "all")); const pg = await c.newPage();
    await pg.goto(q.BASE + "/table/dice", { waitUntil: "networkidle" }); await pg.waitForTimeout(800);
    await pg.getByRole("button", { name: "Cashier" }).click(); await pg.waitForTimeout(500);
    await pg.screenshot({ path: `../screenshots/after/r2-after/restore-entry-cashier-${tag}.png` });
    await pg.locator(".cashier .restore-entry").click(); await pg.waitForTimeout(400);
    rec("Recovery", `Cashier → Restore session opens the dialog (${tag})`, await pg.locator("dialog.restore[open]").count() === 1);
    await pg.screenshot({ path: `../screenshots/after/r2-after/restore-entry-cashier-dialog-${tag}.png` });
    await pg.keyboard.press("Escape"); await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
    if (tag !== "desktop") {
      await pg.reload({ waitUntil: "networkidle" }); await pg.locator(".burger").click(); await pg.waitForTimeout(300);
      await pg.screenshot({ path: `../screenshots/after/r2-after/restore-entry-menu-${tag}.png` });
      await pg.locator(".mobile-sheet .restore-entry").click(); await pg.waitForTimeout(400);
      rec("Recovery", `Menu sheet → Restore session opens the dialog (${tag})`, await pg.locator("dialog.restore[open]").count() === 1);
      await pg.screenshot({ path: `../screenshots/after/r2-after/restore-entry-menu-dialog-${tag}.png` });
    }
    await c.close(); }
  await br.close(); process.exit(fails ? 1 : 0); })();
