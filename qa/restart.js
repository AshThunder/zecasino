// Restart safety: an open blackjack hand resumes after a server restart, an open crash bet is refunded, crash round ids keep counting.
const q = require("./lib"); const { execSync } = require("child_process");
(async () => {
  const br = await q.launch(); const s = await q.session(br, "R");
  // open blackjack hand
  let hand = null;
  for (let t = 0; t < 8 && !hand; t++) { const [d] = await q.probeSeq(s, [{ t: "bj_deal", stake: 100000 }]); if (d.t === "bj" || d.hand) { if (!d.hand.done) hand = d.hand; } else { console.log(d); break; } }
  // crash bet in the betting window
  let bet = null, r0 = null;
  for (let t = 0; t < 120 && !bet; t++) { const [m] = await q.probeSeq(s, [{ t: "crash_bet", stake: 300000 }]); if (m.t === "crash_bet") { bet = m; r0 = m.round; } else await new Promise(r => setTimeout(r, 500)); }
  const before = q.ledger(s.token);
  execSync("bash /tmp/restart-gs.sh", { stdio: "ignore" }); await new Promise(r => setTimeout(r, 1500));
  const after = q.ledger(s.token);
  const [g] = await q.probeSeq(s, [{ t: "bj_get" }]);
  const same = !!hand && g.hand && JSON.stringify(g.hand.player) === JSON.stringify(hand.player) && g.hand.dealer[0] === hand.dealer[0] && g.hand.nonce === hand.nonce && !g.hand.done;
  q.record("Restart", "open blackjack hand resumes after server restart", same, hand ? `nonce ${hand.nonce}` : "no open hand dealt");
  if (same) { const [m] = await q.probeSeq(s, [{ t: "bj_stand" }]); q.record("Restart", "resumed hand settles", m.hand && m.hand.done, m.hand && m.hand.message); }
  q.record("Restart", "open crash bet refunded on restart", !!bet && after.balance - before.balance === 300000, bet ? `round ${r0}, Δ ${after.balance - before.balance}` : "no bet placed");
  let r1 = null; for (let t = 0; t < 120 && r1 === null; t++) { const [m] = await q.probeSeq(s, [{ t: "crash_bet", stake: 100000 }]); if (m.t === "crash_bet") r1 = m.round; else await new Promise(r => setTimeout(r, 500)); }
  q.record("Restart", "crash round id continues (never repeats)", r1 !== null && r0 !== null && r1 > r0, `${r0} → ${r1}`);
  const fin = q.ledger(s.token); q.record("Restart", "ledger balance == Σ entries", fin.balance === fin.sum);
  require("fs").writeFileSync("/tmp/qa-restart.json", JSON.stringify(q.results));
  await br.close();
})();
