const { chromium } = require("playwright-core");
(async () => {
  const br = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await br.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(() => { localStorage.setItem("zc.mode", "demo"); localStorage.setItem("zc.howto.seen", "all"); });
  const p = await ctx.newPage();
  for (const path of (process.argv[2]||"/").split(",")) {
    await p.goto("https://zecasino.fly.dev" + path, { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
    const n = path.replace(/\W/g, "_") || "root";
    await p.screenshot({ path: `/tmp/ex${n}.png` });
    const btns = await p.$$eval("button,a,input,select", es => es.map(e => `${e.tagName}:${(e.innerText||e.placeholder||e.name||e.getAttribute('aria-label')||'').trim().slice(0,40)}`));
    console.log(path, JSON.stringify(btns));
  }
  await br.close();
})();
