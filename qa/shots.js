// Screenshots of every page, desktop + mobile: node shots.js <outdir>
const { chromium } = require("playwright-core");
const out = process.argv[2]; const BASE = "http://localhost:3100";
const PAGES = ["/", "/table/carrot", "/table/holdem", "/table/liars", "/table/roulette", "/table/blackjack", "/table/dice", "/table/crash", "/solvency"];
(async () => {
  const br = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  for (const [tag, vp, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
    const ctx = await br.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} });
    const p = await ctx.newPage();
    for (const path of PAGES) {
      await p.goto(BASE + path, { waitUntil: "load" }); await p.waitForTimeout(2500);
      const name = (path === "/" ? "lobby" : path.split("/").pop()) + `-${tag}.png`;
      await p.screenshot({ path: `${out}/${name}`, fullPage: true });
    }
    await ctx.close();
  }
  await br.close(); console.log("done", out);
})();
