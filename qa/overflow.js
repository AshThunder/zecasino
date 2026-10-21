// No horizontal overflow at 360 / 390 / 768 on every page; lists the widest offenders.
const q = require("./lib");
const PAGES = ["/", "/history", "/solvency", "/table/carrot", "/table/holdem", "/table/liars", "/table/roulette", "/table/blackjack", "/table/dice", "/table/crash"];
(async () => { const br = await q.launch(); let bad = 0;
  for (const w of [360, 390, 768, 1024, 1280, 1440]) { const ctx = await br.newContext({ viewport: { width: w, height: 800 }, isMobile: w < 700, hasTouch: true }); await q.toQa(ctx);
    await ctx.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} });
    const p = await ctx.newPage();
    for (const path of PAGES) { await p.goto(q.BASE + path, { waitUntil: "load" }); await p.waitForTimeout(1800);
      const r = await p.evaluate(() => { const W = document.documentElement.clientWidth; const out = [];
        for (const el of document.querySelectorAll("body *")) { const b = el.getBoundingClientRect(); if (b.width && b.right > W + 1) {
          let a = el.parentElement, clipped = false; while (a) { const cs = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(cs.overflowX) && a.getBoundingClientRect().right <= W + 1) { clipped = true; break; } a = a.parentElement; }
          if (!clipped) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} r=${Math.round(b.right)}`); } }
        return { sw: document.documentElement.scrollWidth, W, out: out.slice(0, 4) }; });
      const ok = r.sw <= r.W && r.out.length === 0; if (!ok) bad++;
      console.log(`${ok ? "PASS" : "FAIL"} [Overflow ${w}] ${path} ${ok ? "" : JSON.stringify(r)}`); }
    await ctx.close(); }
  await br.close(); process.exit(bad ? 1 : 0); })();
