// Footer links: GitHub + X on every page, new tab, noopener; screenshots desktop/mobile/360. ZC_BASE for live.
const q = require("./lib"); const out = process.env.SHOT_DIR || "../screenshots/after/r2-after";
(async () => { const br = await q.launch(); let bad = 0;
  for (const [n, w, h, mob] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true], ["360", 360, 780, true]]) {
    const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 }); const p = await c.newPage();
    for (const path of ["/", "/table/carrot", "/solvency", "/house"]) { await p.goto(q.BASE + path, { waitUntil: "load" }); await p.waitForTimeout(800);
      const r = await p.evaluate(() => { const L = [...document.querySelectorAll(".ftr-links a")]; const W = document.documentElement.clientWidth;
        return { n: L.length, ok: L.every(a => a.target === "_blank" && /noopener/.test(a.rel)), hrefs: L.map(a => a.href), over: [...document.querySelectorAll(".ftr *")].some(e => e.getBoundingClientRect().right > W + 1), sw: document.documentElement.scrollWidth - W }; });
      const ok = r.n === 2 && r.ok && r.hrefs.includes("https://github.com/AshThunder/zecasino") && r.hrefs.includes("https://x.com/chrisgold__") && !r.over && r.sw <= 0; if (!ok) bad++;
      console.log(`${ok ? "PASS" : "FAIL"} [Footer ${n}] ${path} ${ok ? "" : JSON.stringify(r)}`); }
    await p.locator(".ftr").scrollIntoViewIfNeeded(); await p.locator(".ftr").screenshot({ path: `${out}/footer-${n}.png` }); await c.close(); }
  await br.close(); process.exit(bad ? 1 : 0); })();
