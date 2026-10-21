// Crash stage must not grow after load: sample its box at 0 s, 2 s, 10 s and during a running round; bet button must be in view.
const q = require("./lib");
(async () => { const br = await q.launch(); let fails = 0;
  for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]]) {
    const ctx = await br.newContext({ viewport: { width: w, height: h } }); await q.toQa(ctx); await ctx.addInitScript(() => localStorage.setItem("zc.howto.seen", "all"));
    const p = await ctx.newPage(); await p.goto(q.BASE + "/table/crash", { waitUntil: "domcontentloaded" });
    const box = () => p.evaluate(() => { const g = document.querySelector(".crash-graph")?.getBoundingClientRect(); const b = [...document.querySelectorAll(".crash-page .btn.gold.lg")].pop()?.getBoundingClientRect();
      return { w: Math.round(g?.width ?? 0), h: Math.round(g?.height ?? 0), betBottom: Math.round(b?.bottom ?? 0), sw: document.documentElement.scrollWidth }; });
    await p.waitForSelector(".crash-graph"); const s = [["0s", await box()]]; await p.waitForTimeout(2000); s.push(["2s", await box()]); await p.waitForTimeout(8000); s.push(["10s", await box()]);
    await p.waitForFunction(() => /\d\.\d\d×/.test(document.querySelector(".crash-graph")?.textContent ?? "") && !/next round/i.test(document.querySelector(".crash-graph")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
    s.push(["running", await box()]);
    const stable = s.every(([, b]) => b.w === s[0][1].w && b.h === s[0][1].h);
    const fits = w < 700 || s.every(([, b]) => b.betBottom <= h);
    const ok = stable && fits && s.every(([, b]) => b.sw <= w); if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} [Crash layout ${w}x${h}] stable=${stable} betInView=${fits} ${s.map(([t, b]) => `${t}:${b.w}x${b.h} bet@${b.betBottom} sw${b.sw}`).join(" ")}`);
    if (w !== 390) await p.screenshot({ path: `/workspace/zcasino/screenshots/after/crash-fit-${w}x${h}.png` }); else await p.screenshot({ path: `/workspace/zcasino/screenshots/after/crash-fit-mobile.png`, fullPage: true });
    await ctx.close(); }
  await br.close(); process.exit(fails ? 1 : 0); })();
