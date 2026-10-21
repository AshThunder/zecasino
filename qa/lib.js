// QA harness helpers: sessions, header/ledger reconciliation, raw-ws edge probes.
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const DB = process.env.ZC_DB || "/tmp/zc-dev.sqlite";
const BASE = "http://localhost:3100";
const results = [];
function ledger(token) {
  const id = crypto.createHash("sha256").update(token).digest("hex");
  const out = execFileSync("python3", ["-c", `import sqlite3,sys;c=sqlite3.connect('file:${DB}?mode=ro',uri=True)
b=c.execute('select balance from sessions where id=?',(sys.argv[1],)).fetchone()[0]
s=c.execute('select coalesce(sum(delta),0),count(*) from entries where session=?',(sys.argv[1],)).fetchone()
print(b,s[0],s[1])`, id]).toString().trim().split(" ").map(Number);
  return { balance: out[0], sum: out[1], entries: out[2] };
}
async function launch() { return chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] }); }
async function session(br, name) {
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log(`[${name}] PAGEERR`, e.message));
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForFunction(() => sessionStorage.getItem("zc.session"));
  await p.waitForTimeout(800);
  const token = await p.evaluate(() => sessionStorage.getItem("zc.session"));
  return { ctx, p, token, name };
}
async function header(p) { const t = await p.locator(".balance b").textContent(); return Number(t.replace(/[^\d.]/g, "")); }
/** header == ledger balance == Σ entries, exactly (header shown to 4 dp). */
async function reconcile(s, label) {
  await s.p.waitForTimeout(700);
  const h = await header(s.p); const l = ledger(s.token);
  const ok = l.balance === l.sum && Math.abs(h - l.balance / 1e8) < 0.00005;
  console.log(`${ok ? "OK  " : "FAIL"} reconcile ${label}: header ${h} ledger ${l.balance / 1e8} Σentries ${l.sum / 1e8} (${l.entries} entries)`);
  return ok;
}
/** Send one message on a separate raw socket for this session; returns the reply with matching id. */
async function probe(s, msg) {
  return s.p.evaluate(async ([tok, msg]) => new Promise(res => {
    const ws = new WebSocket("ws://127.0.0.1:3200/ws");
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", token: tok, id: 1 }));
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) ws.send(JSON.stringify({ ...msg, id: 2 })); else if (m.id === 2) { ws.close(); res(m); } };
    setTimeout(() => res({ t: "timeout" }), 8000);
  }), [s.token, msg]);
}
async function verifyHouse(p) {
  await p.getByRole("button", { name: /Reveal seed/ }).click();
  await p.waitForTimeout(2500);
  const ok = await p.locator(".vrow b.ok").count(), bad = await p.locator(".vrow b.bad").count();
  return { ok, bad };
}
function record(game, check, pass, note = "") { results.push({ game, check, pass, note }); console.log(`${pass ? "PASS" : "FAIL"} [${game}] ${check} ${note}`); }
module.exports = { launch, session, header, ledger, reconcile, probe, verifyHouse, record, results, BASE };
