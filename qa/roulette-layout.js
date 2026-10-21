// Roulette layout labels: UI sans, bold, numbers ≈50–60% of cell height, '2 to 1' horizontal. Screenshots per width.
const q = require("./lib"); const out = process.env.SHOT_DIR || __dirname + "/../screenshots/after/r2-after";
(async () => { const br = await q.launch(); let bad = 0;
  for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768], [1440, 900], [390, 844]]) {
    const mob = w < 700; const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 }); await q.toQa(c);
    await c.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} }); const p = await c.newPage();
    await p.goto(q.BASE + "/table/roulette", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => { const T = [...document.querySelectorAll(".layout text")]; const cs = getComputedStyle(T[0]);
      const n = T.find(t => t.textContent === "17"); const cell = n.parentElement.querySelector("rect").getBoundingClientRect(); const ratio = parseFloat(n.getAttribute("font-size")) / 74;
      const col = T.find(t => t.textContent === "2 to 1");
      return { font: cs.fontFamily, weight: cs.fontWeight, ratio: +ratio.toFixed(2), rot: !!col.getAttribute("transform"), px: +(cell.height * 40 / 74).toFixed(1) }; });
    const ok = /Manrope|sans/i.test(r.font) && !/Cormorant/i.test(r.font) && +r.weight >= 700 && r.ratio >= 0.45 && r.ratio <= 0.7 && !r.rot; if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"} [Roulette ${w}] ${JSON.stringify(r)}`);
    await p.locator(".layout").scrollIntoViewIfNeeded(); await p.locator(".layout-wrap").screenshot({ path: `${out}/roulette-${w}.png` }); await c.close(); }
  await br.close(); process.exit(bad ? 1 : 0); })();
