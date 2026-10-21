// Every element inside open modals stays within the modal and the viewport (360 / 390 / 412),
// on Cashier Deposit + Withdraw, Restore, How-to, Session key. Also: visible X (aria-label Close) and Esc closes.
const q = require("./lib");
const shots = process.argv.includes("--shots");
(async () => { const br = await q.launch(); let bad = 0;
  const check = async (p, label, sel) => {
    const r = await p.evaluate(sel => { const W = document.documentElement.clientWidth; const d = document.querySelector(sel); if (!d) return { missing: true };
      const db = d.getBoundingClientRect(); const out = [];
      if (db.right > W + 1 || db.left < -1) out.push(`modal ${Math.round(db.left)}..${Math.round(db.right)} W=${W}`);
      for (const el of d.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (!b.width || getComputedStyle(el).visibility === "hidden") continue;
        if (b.right > Math.min(W, db.right) + 1 || b.left < Math.max(0, db.left) - 1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${Math.round(b.left)}..${Math.round(b.right)}`); }
      if (d.scrollWidth > d.clientWidth + 1) out.push(`modal scrollWidth ${d.scrollWidth} > ${d.clientWidth}`);
      const x = d.querySelector('[aria-label="Close"]'); const xb = x?.getBoundingClientRect();
      const xOk = !!xb && xb.width >= 28 && xb.top - db.top < 60 && db.right - xb.right < 60;
      return { out: out.slice(0, 6), xOk }; }, sel);
    const ok = !r.missing && r.out.length === 0 && r.xOk; if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} [Modal] ${label} ${ok ? "" : JSON.stringify(r)}`);
  };
  const esc = async (p, label, sel) => { await p.keyboard.press("Escape"); await p.waitForTimeout(400); const open = await p.locator(sel).count(); if (open) bad++; console.log(`${open ? "FAIL" : "PASS"} [Modal] ${label} Esc closes`); };
  for (const w of [360, 390, 412]) {
    const ctx = await br.newContext({ viewport: { width: w, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await q.toQa(ctx);
    await ctx.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} });
    const p = await ctx.newPage(); await p.goto(q.BASE + "/table/dice", { waitUntil: "networkidle" }); await p.waitForTimeout(1200);
    await p.getByRole("button", { name: "Cashier", exact: true }).click(); await p.waitForTimeout(700);
    await check(p, `${w} cashier deposit`, "dialog.cashier[open]");
    if (shots) await p.screenshot({ path: `../screenshots/after/r2-after/cashier-mobile-deposit-${w}.png` });
    await p.getByRole("tab", { name: "Withdraw" }).click(); await p.waitForTimeout(500);
    await check(p, `${w} cashier withdraw`, "dialog.cashier[open]");
    if (shots) { await p.screenshot({ path: `../screenshots/after/r2-after/cashier-mobile-withdraw-${w}.png` });
      await p.locator("dialog.cashier[open]").evaluate(d => d.scrollTo(0, d.scrollHeight)); await p.waitForTimeout(300);
      await p.screenshot({ path: `../screenshots/after/r2-after/cashier-mobile-withdraw-bottom-${w}.png` }); }
    // click outside (backdrop) closes
    await p.mouse.click(w - 4, 4); await p.waitForTimeout(400);
    const still = await p.locator("dialog.cashier[open]").count();
    if (still) { console.log(`INFO [Modal] ${w} cashier covers the viewport (full-screen sheet); closing via X`); await p.locator('dialog.cashier[open] [aria-label="Close"]').click(); }
    else console.log(`PASS [Modal] ${w} cashier click outside closes`);
    await p.getByRole("button", { name: "Cashier", exact: true }).click(); await p.waitForTimeout(500); await esc(p, `${w} cashier`, "dialog.cashier[open]");
    await p.getByRole("button", { name: "Cashier", exact: true }).click(); await p.waitForTimeout(500);
    await p.locator("dialog.cashier[open] .restore-entry").click(); await p.waitForTimeout(600);
    await check(p, `${w} restore`, "dialog.restore[open]");
    if (shots) await p.screenshot({ path: `../screenshots/after/r2-after/cashier-mobile-restore-${w}.png` });
    await esc(p, `${w} restore`, "dialog.restore[open]"); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    await p.locator(".howto-btn").first().click(); await p.waitForTimeout(600);
    await check(p, `${w} how-to`, "dialog.howto[open]"); await esc(p, `${w} how-to`, "dialog.howto[open]");
    const menu = p.getByRole("button", { name: /menu/i }).first();
    if (await menu.count() && await menu.isVisible()) { await menu.click(); await p.waitForTimeout(400); await p.locator(".mobile-sheet .ms-key").first().click(); await p.waitForTimeout(500);
      await check(p, `${w} session key`, ".session-key"); await esc(p, `${w} session key`, ".session-key"); }
    await ctx.close(); }
  await br.close(); process.exit(bad ? 1 : 0); })();
