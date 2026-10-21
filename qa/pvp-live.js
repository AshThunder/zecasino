// Live check on the deployed site with play chips (demo server): two browsers + house fallback.
const q = require("./lib"); const B = process.env.ZC_BASE || "https://zecasino.fly.dev";
const vis = async (p, name) => { const l = p.getByRole("button", { name }); return (await l.count()) > 0 && await l.first().isVisible() && await l.first().isEnabled(); };
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; }
const rec = (c, ok, n = "") => console.log(`${ok ? "PASS" : "FAIL"} [Live] ${c} ${n}`);
(async () => { const br = await q.launch();
  const mk = async (w, h, mob) => { const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    await c.addInitScript(() => { localStorage.setItem("zc.mode", "demo"); localStorage.setItem("zc.howto.seen", "all"); }); const p = await c.newPage(); p.setDefaultTimeout(30000);
    await p.goto(B + "/", { waitUntil: "networkidle" }); await p.waitForFunction(() => sessionStorage.getItem("zc.demo.session")); return p; };
  const A = await mk(1440, 900, false), C = await mk(390, 844, true);
  // Quick match between two browsers
  await A.locator('.qm-stake[data-game="carrot"][data-stake="0.05"]').click();
  rec("lobby counts waiting at 0.05", !!await until(async () => { await C.goto(B + "/", { waitUntil: "networkidle" }); return /1 waiting/.test(await C.locator('.qm-stake[data-game="carrot"][data-stake="0.05"]').innerText()); }, 20000));
  await C.locator('.qm-stake[data-game="carrot"][data-stake="0.05"]').click();
  const m = await until(async () => (await vis(A, "Peek inside")) ? [A, C] : (await vis(C, "Peek inside")) ? [C, A] : null, 20000);
  rec("quick match pairs the two browsers", !!m);
  if (m) { const [h, g] = m;
    const clocks = await Promise.all([A, C].map(p => p.locator(".turn-clock").innerText().catch(() => "")));
    rec("both see a turn clock", clocks.every(c => /\ds/.test(c)), clocks.join(" | ").replace(/\n/g, " "));
    await A.screenshot({ path: "../screenshots/after/pvp/live-carrot-desktop.png" }); await C.screenshot({ path: "../screenshots/after/pvp/live-carrot-mobile.png" });
    await h.getByRole("button", { name: "Peek inside" }).click(); await h.waitForTimeout(2000); await h.getByRole("button", { name: /got the carrot/ }).click();
    await until(() => vis(g, "Swap boxes"), 15000); await g.getByRole("button", { name: "Swap boxes" }).click();
    rec("round reveals on both", !!await until(async () => (await vis(A, "Rematch")) && (await vis(C, "Rematch")), 20000));
    await A.getByRole("button", { name: "Rematch" }).click();
    rec("rematch offer reaches the other browser", !!await until(() => vis(C, "Accept rematch"), 10000));
    await C.getByRole("button", { name: "Accept rematch" }).click();
    rec("rematch deals a new round", !!await until(async () => (await vis(A, "Peek inside")) || (await vis(C, "Peek inside")), 15000));
    await C.evaluate(() => window.__zc.drop());
    rec("reconnecting banner on drop", !!await until(async () => /Opponent reconnecting/.test(await A.locator("body").innerText()), 8000));
    await A.screenshot({ path: "../screenshots/after/pvp/live-reconnecting-desktop.png" });
    rec("banner clears on reconnect", !!await until(async () => !/Opponent reconnecting/.test(await A.locator("body").innerText()), 15000));
  }
  // Invite link
  await A.goto(B + "/table/liars", { waitUntil: "networkidle" }); await A.waitForTimeout(1000);
  await A.getByRole("button", { name: "Private table" }).click();
  const link = await until(async () => { const i = A.locator(".ws-link input"); return (await i.count()) ? i.inputValue() : null; }, 10000);
  rec("invite link shown", !!link, link || "");
  await C.goto(link, { waitUntil: "networkidle" });
  rec("friend joins via link", !!await until(async () => (await A.locator(".waiting-scene").count()) === 0 && (await C.locator(".lp-dice.mine").count()) > 0, 20000));
  await C.screenshot({ path: "../screenshots/after/pvp/live-invite-joined-mobile.png" });
  // House fallback
  await A.goto(B + "/table/carrot", { waitUntil: "networkidle" }); await A.waitForTimeout(1000);
  await A.locator(".stake-pick button", { hasText: "0.010" }).click(); await A.getByRole("button", { name: /^Quick match/ }).click();
  rec("house offer after ~20 s", !!await until(() => vis(A, "Play the house instead"), 32000));
  await A.getByRole("button", { name: "Play the house instead" }).click();
  rec("House player badge + explainer", !!await until(async () => (await A.locator(".felt .house-badge").count()) > 0 && (await A.locator(".house-note").count()) > 0, 15000));
  await A.waitForTimeout(800); await A.screenshot({ path: "../screenshots/after/pvp/live-house-desktop.png" });
  await br.close(); })();
