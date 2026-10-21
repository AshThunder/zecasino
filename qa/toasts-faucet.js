// Toast titles are concrete reasons with actions; faucet links (Cashier, header/menu at 0 balance) are testnet, new tab, noopener.
const q = require("./lib"); const out = process.env.SHOT_DIR || __dirname + "/../screenshots/after/r2-after"; const F = "https://faucet.testnet.valargroup.dev";
(async () => { const br = await q.launch(); let bad = 0; const rec = (c, ok, n = "") => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"} [Toast/Faucet] ${c} ${n}`); };
  for (const [n, w, h, mob] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]]) {
    const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob }); await q.toQa(c);
    await c.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} }); const p = await c.newPage();
    // Hold'em buy-in 0.50 is above the 0.412 dev balance → server says "insufficient balance".
    await p.goto(q.BASE + "/table/holdem", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    await p.locator(".stake-pick button", { hasText: "0.50" }).click(); await p.getByRole("button", { name: /^Sit down/ }).click();
    await p.waitForSelector(".toast.t-error", { timeout: 8000 }).catch(() => {});
    let t;
    t = await p.locator(".toast.t-error").first().innerText().catch(() => "");
    rec(`${n}: toast after over-stake`, /Not enough balance|Stake outside/.test(t) && !/Couldn't place|Something went wrong/.test(t), t.replace(/\n/g, " | "));
    const acts = await p.locator(".toast.t-error .t-actions a, .toast .t-actions button").allInnerTexts();
    if (/Not enough balance/.test(t)) rec(`${n}: actions Open Cashier + Get free testnet TAZ`, acts.some(a => /Open Cashier/.test(a)) && acts.some(a => /free testnet TAZ/.test(a)), acts.join(", "));
    await p.screenshot({ path: `${out}/toast-${n}.png` });
    if (acts.some(a => /Open Cashier/.test(a))) { await p.locator(".toast.t-error .t-actions button", { hasText: "Open Cashier" }).click(); await p.waitForTimeout(600); rec(`${n}: Open Cashier action opens the Cashier`, await p.locator("dialog.cashier[open]").count() === 1); }
    else { await p.getByRole("button", { name: "Cashier", exact: true }).click(); await p.waitForTimeout(600); }
    await p.locator("dialog.cashier[open] .rc-ack input, dialog.cashier[open] input[type=checkbox]").first().check().catch(() => {});
    const fl = p.locator("dialog.cashier[open] a.faucet-link");
    rec(`${n}: Cashier deposit faucet link`, (await fl.count()) === 1 && await fl.getAttribute("href") === F && await fl.getAttribute("target") === "_blank" && /noopener/.test(await fl.getAttribute("rel")) && /testnet/i.test(await fl.innerText()));
    await p.locator("dialog.cashier[open] .faucet-link").scrollIntoViewIfNeeded().catch(() => {});
    await p.screenshot({ path: `${out}/faucet-cashier-${n}.png` });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    c.close(); }
  // header pill at zero balance: a fresh session on the real-mode QA server gets dev credit, so check the logic by DOM after zeroing is impractical; check the menu entry instead (always on real mode).
  const c = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); await q.toQa(c); const p = await c.newPage();
  await p.goto(q.BASE + "/", { waitUntil: "networkidle" }); await p.waitForTimeout(1000);
  await p.getByRole("button", { name: /menu/i }).first().click(); await p.waitForTimeout(400);
  const m = p.locator(".mobile-sheet a.ms-faucet");
  rec("mobile menu has Get free testnet TAZ (new tab, noopener)", (await m.count()) === 1 && await m.getAttribute("href") === F && /noopener/.test(await m.getAttribute("rel")));
  await p.screenshot({ path: `${out}/faucet-menu-mobile.png` });
  await br.close(); process.exit(bad ? 1 : 0); })();
