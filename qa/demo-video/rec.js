// Demo-video recorder: node rec.js <scene> <outdir>. Needs an X display (run via record.sh).
// Headed Chrome fills a 1920x1080 Xvfb screen (CSS viewport 1440x810 at 1.333x), ffmpeg x11grab captures it.
// Uses demo play-chips mode for gameplay; real-mode cashier is shown read-only (no deposit, no broadcast).
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const BASE = process.env.ZC_BASE || "https://zecasino.fly.dev";
const [scene, out = "/workspace/zcasino-video/raw"] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CURSOR = () => {
  const css = `#__cur{position:fixed;left:0;top:0;width:32px;height:32px;margin:0;padding:0;border:0;background:none;pointer-events:none;inset:auto;overflow:visible;transition:transform .08s linear;z-index:2147483647}
  #__cur.down svg{transform:scale(.85)} .rc-code{filter:blur(8px)!important;user-select:none}`;
  addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s);
    const c = document.createElement("div"); c.id = "__cur"; c.setAttribute("popover", "manual");
    c.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(c); setInterval(() => { if (!c.isConnected) { document.documentElement.appendChild(c); top(); } }, 200); const top = () => { try { c.hidePopover(); c.showPopover(); } catch {} }; top();
    addEventListener("mousemove", e => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener("mousedown", () => c.classList.add("down"), true); addEventListener("mouseup", () => c.classList.remove("down"), true);
    new MutationObserver(() => setTimeout(top, 30)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  });
};

let mx = 800, my = 450;
async function glide(p, x, y, ms = 700) {
  const n = Math.max(12, Math.round(ms / 16)); const x0 = mx, y0 = my;
  for (let i = 1; i <= n; i++) { const t = i / n, e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; await p.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e); await sleep(ms / n); }
  mx = x; my = y;
}
async function to(p, loc, ms) { await loc.waitFor({ state: "visible" }); let b = await loc.boundingBox(); const H = await p.evaluate(() => innerHeight);
  if (b.y < 60 || b.y + b.height > H - 10) { await loc.evaluate(e => e.scrollIntoView({ block: "center", behavior: "smooth" })); await sleep(700); b = await loc.boundingBox(); } await glide(p, b.x + b.width / 2, b.y + b.height / 2, ms); return b; }
async function click(p, loc, ms = 700) { await to(p, loc, ms); await sleep(150); await p.mouse.down(); await sleep(70); await p.mouse.up(); await sleep(250); }
async function type(p, loc, text) { await click(p, loc); await p.keyboard.type(text, { delay: 45 }); }
async function scroll(p, dy, ms = 1200) { const n = 30; for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy / n); await sleep(ms / n); } }

const SCENES = {
  async intro(p) { await p.goto(BASE + "/"); await p.waitForLoadState("networkidle"); await sleep(1200); return async () => {
    await glide(p, 500, 300, 900); await sleep(600); await scroll(p, 520, 2200); await sleep(500);
    const cards = p.locator("a[href^='/table/']"); for (const i of [0, 3, 6]) { await to(p, cards.nth(i), 700); await sleep(500); }
    await scroll(p, -520, 1800); await sleep(800); }; },
  async deposit(p) { await p.goto(BASE + "/"); await p.waitForLoadState("networkidle"); await sleep(1500); return async () => {
    await click(p, p.getByRole("button", { name: "Cashier" }).first(), 900); await sleep(1800);
    await to(p, p.locator(".rc-code"), 700); await sleep(1200);
    await click(p, p.locator(".rc-ack input")); await sleep(400);
    await click(p, p.getByRole("button", { name: "Show my deposit address" })); await sleep(2500);
    await to(p, p.locator(".qr-wrap"), 800); await sleep(2200); await glide(p, 1100, 600, 800); await sleep(1500); }; },
  async withdraw(p) { await p.goto(BASE + "/"); await p.waitForLoadState("networkidle"); await sleep(1500); return async () => {
    await click(p, p.getByRole("button", { name: "Cashier" }).first(), 800); await sleep(900);
    await click(p, p.getByRole("tab", { name: "Withdraw" })); await sleep(700);
    await type(p, p.locator("#wd-addr"), "tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd");
    const amt = p.locator("form.wd input[name=amt]"); if (await amt.count()) { await click(p, amt); await amt.fill(""); await p.keyboard.type("0.01", { delay: 60 }); }
    const opts = p.locator("fieldset.delay label"); const k = await opts.count(); for (let i = 0; i < k; i++) { await click(p, opts.nth(i), 450); await sleep(300); }
    await click(p, p.getByRole("button", { name: "Queue shielded withdrawal" })); await sleep(2500); }; },
  async crash(p) { await p.goto(BASE + "/table/crash"); await p.waitForLoadState("networkidle"); await sleep(1000);
    const bet = p.getByRole("button", { name: "Bet next round" });
    // start recording right as a betting window opens
    await p.getByRole("button", { name: /Wait for next round|Cash out/ }).first().waitFor({ timeout: 120000 }).catch(() => {}); await bet.waitFor({ timeout: 120000 }); return async () => {
    await click(p, p.getByRole("button", { name: "½" }), 600); await click(p, p.getByRole("button", { name: "2×" }), 350); await click(p, p.getByRole("button", { name: "2×" }), 250);
    await click(p, bet, 500);
    const cash = p.getByRole("button", { name: /Cash out/ });
    try { await cash.waitFor({ timeout: 20000 }); await to(p, cash, 400);
      for (let i = 0; i < 200 && await cash.count(); i++) { const m = await p.evaluate(() => Number((document.body.innerText.match(/(\d+\.\d\d)×/) || [])[1] || 0)); if (m >= 1.6) break; await sleep(60); }
      if (await cash.count()) { await click(p, cash, 120); console.log("CASHED"); } } catch {}
    await sleep(3000); }; },
  async blackjack(p) { await p.goto(BASE + "/table/blackjack"); await p.waitForLoadState("networkidle"); await sleep(1500);
    const clr = p.getByRole("button", { name: "Clear" }); if (await clr.count()) await clr.click(); return async () => {
    const rack = p.locator(".rack button"), circle = p.locator(".bet-circle");
    await click(p, rack.nth(3)); await click(p, circle); await click(p, rack.nth(2), 500); await click(p, circle); await sleep(200); await click(p, circle, 200);
    await click(p, p.getByRole("button", { name: "Deal" })); await sleep(2600);
    for (let i = 0; i < 5; i++) {
      const stand = p.getByRole("button", { name: "Stand", exact: true }); if (!(await stand.count())) break;
      const t = Number((await p.locator(".hand.player .hand-total").first().textContent().catch(() => "")).replace(/\D/g, "")) || 20;
      await click(p, t < 13 ? p.getByRole("button", { name: "Hit", exact: true }) : stand); await sleep(1900);
    }
    await sleep(1800); await click(p, p.getByRole("button", { name: /Reveal seed/ }), 900); await sleep(3200);
    const v = p.locator(".vrow").first(); if (await v.count()) await to(p, v, 700); await sleep(1500); }; },
  async solvency(p) { await p.goto(BASE + "/solvency"); await p.waitForLoadState("networkidle"); await sleep(1500); return async () => {
    await glide(p, 600, 350, 800); await sleep(800);
    await click(p, p.getByRole("button", { name: "Verify my inclusion" }), 900); await sleep(2500);
    await scroll(p, 600, 2200); await sleep(500);
    await to(p, p.getByRole("button", { name: "Copy viewing key" }), 900); await sleep(2500); }; },
  // PvP scenes (Quick Match UI). "opp" is a second, headless demo browser acting as a real opponent.
  async holdem(p, opp) { await p.goto(BASE + "/table/holdem"); await p.waitForLoadState("networkidle"); await sleep(1500);
    await opp.goto(BASE + "/table/holdem"); await opp.waitForLoadState("networkidle"); await sleep(1000); return async () => {
    await click(p, p.locator(".stake-pick button", { hasText: "0.20" }), 800); await click(p, p.getByRole("button", { name: /^Quick (match|seat)/ }));
    await sleep(1200); await opp.locator(".stake-pick button", { hasText: "0.20" }).click(); await opp.getByRole("button", { name: /^Quick (match|seat)/ }).click(); mark("matched");
    const vis = async (pg, n) => { const l = pg.getByRole("button", { name: n }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
    for (let i = 0; i < 60; i++) {
      for (const n of ["Check", /^Call/]) if (await vis(opp, n)) { await opp.getByRole("button", { name: n }).first().click().catch(() => {}); break; }
      for (const n of ["Check", /^Call/]) if (await vis(p, n)) { await click(p, p.getByRole("button", { name: n }).first(), 600); await sleep(600); break; }
      if (await p.locator(".result-toast").count()) { mark("showdown"); break; } await sleep(400);
    }
    await sleep(2500); const f = p.locator("aside.fair"); if (await f.count()) { await to(p, f, 900); await sleep(2500); } }; },
  async carrot(p) { await p.goto(BASE + "/table/carrot"); await p.waitForLoadState("networkidle"); await sleep(1500); return async () => {
    await click(p, p.locator(".stake-pick button", { hasText: "0.020" }), 800); await click(p, p.getByRole("button", { name: /^Quick match/ })); mark("queued");
    const h = p.getByRole("button", { name: "Play the house instead" }); await h.waitFor({ timeout: 60000 }); mark("house-offer"); await sleep(1200);
    await click(p, h); mark("vs-house"); await sleep(2500);
    const badge = p.locator(".house-badge").first(); if (await badge.count()) { await to(p, badge, 700); await sleep(1500); }
    for (let i = 0; i < 40; i++) {
      const peek = p.getByRole("button", { name: "Peek inside" }), keep = p.getByRole("button", { name: "Keep my box" });
      if (await peek.count() && await peek.isEnabled()) { await click(p, peek); await sleep(2000); const g = p.getByRole("button", { name: /got the carrot/ }); if (await g.count()) await click(p, g.first()); break; }
      if (await keep.count() && await keep.isEnabled()) { await click(p, keep); break; } await sleep(500);
    }
    await sleep(4000); mark("done"); }; },
  async liars(p, opp) { await p.goto(BASE + "/table/liars"); await p.waitForLoadState("networkidle"); await sleep(1500);
    await opp.goto(BASE + "/table/liars"); await opp.waitForLoadState("networkidle"); await sleep(1000); return async () => {
    await click(p, p.locator(".stake-pick button", { hasText: "0.010" }), 800); await click(p, p.getByRole("button", { name: /^Quick match/ })); await sleep(1500);
    await opp.locator(".stake-pick button", { hasText: "0.010" }).click(); await opp.getByRole("button", { name: /^Quick match/ }).click(); mark("matched");
    const vis = async (pg, n) => { const l = pg.getByRole("button", { name: n }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
    for (let i = 0, bids = 0; i < 80; i++) {
      if (bids > 0 && await vis(opp, "Liar!")) await opp.getByRole("button", { name: "Liar!" }).click().catch(() => {}); else if (await vis(opp, "Bid")) await opp.getByRole("button", { name: "Bid" }).first().click().catch(() => {});
      if (await vis(p, "Bid")) { if (bids++ < 1) { await click(p, p.getByRole("button", { name: "Bid" }).first(), 600); } else if (await vis(p, "Liar!")) { await click(p, p.getByRole("button", { name: "Liar!" }), 700); } }
      if (await vis(p, "Rematch")) { mark("over"); break; } await sleep(400);
    }
    await sleep(3500); }; },
};
const T0 = Date.now(); let REC = 0; function mark(n) { console.log("MARK", n, ((Date.now() - REC) / 1000).toFixed(1)); }

(async () => {
  const real = ["deposit", "withdraw", "solvency"].includes(scene);
  const br = await chromium.launchPersistentContext(require("fs").mkdtempSync("/tmp/zcrec-"), { executablePath: "/usr/bin/google-chrome", headless: false, viewport: null,
    args: ["--no-sandbox", "--kiosk", "--window-position=0,0", "--window-size=1600,900", "--force-device-scale-factor=1.2", "--disable-infobars", "--no-first-run", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"], ignoreDefaultArgs: ["--enable-automation"] });
  const ctx = br;
  await ctx.addInitScript(([demo]) => { localStorage.setItem("zc.howto.seen", "all"); if (demo) localStorage.setItem("zc.mode", "demo"); else localStorage.removeItem("zc.mode"); }, [!real]);
  await ctx.addInitScript(CURSOR);
  const p = ctx.pages()[0] || await ctx.newPage(); p.setDefaultTimeout(30000);
  let opp = null;
  if (["holdem", "liars"].includes(scene)) { const b2 = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); const c2 = await b2.newContext({ viewport: { width: 1440, height: 810 } }); await c2.addInitScript(() => { localStorage.setItem("zc.howto.seen", "all"); localStorage.setItem("zc.mode", "demo"); }); opp = await c2.newPage(); }
  const run = await SCENES[scene](p, opp);
  await p.mouse.move(mx, my);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", "1920x1080", "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", `${out}/${scene}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  await sleep(700); REC = Date.now() - 700;
  try { await run(); } catch (e) { console.log("SCENE ERR", e.message); }
  ff.stdin.write("q"); await new Promise(r => ff.on("close", r));
  await p.screenshot({ path: `${out}/${scene}-last.png` });
  await br.close(); process.exit(0);
})();
