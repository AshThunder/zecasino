// Chip rack + its label stay inside the felt's inner area (felt box minus rail padding), and never overlap the bet controls.
const q = require("./lib"); const shots = process.argv.includes("--shots"); const out = process.env.SHOT_DIR || __dirname + "/../screenshots/after/r2-after";
const PAD = 12; // minimum gap from the felt's inner edge (the rail)
(async () => { const br = await q.launch(); let bad = 0;
  for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080], [390, 844], [360, 780]]) {
    const mob = w < 700; const c = await br.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob }); await q.toQa(c);
    await c.addInitScript(() => { try { localStorage.setItem("zc.howto.seen", "all"); } catch {} }); const p = await c.newPage();
    for (const g of ["blackjack", "dice", "roulette"]) { await p.goto(q.BASE + "/table/" + g, { waitUntil: "load" }); await p.waitForTimeout(1500);
      const r = await p.evaluate(PAD => { const felt = document.querySelector(".felt"); const wrap = document.querySelector(".rack-wrap"); if (!felt || !wrap) return { missing: true };
        const f = felt.getBoundingClientRect(); const cs = getComputedStyle(felt); const bw = parseFloat(cs.borderLeftWidth) || 0;
        const inner = { l: f.left + bw + PAD, r: f.right - bw - PAD, t: f.top + bw, b: f.bottom - bw };
        const bad = []; for (const el of [wrap, wrap.querySelector(".rack"), wrap.querySelector(".rack-unit")]) { const b = el.getBoundingClientRect();
          if (b.left < inner.l - .5 || b.right > inner.r + .5 || b.top < inner.t || b.bottom > inner.b + .5) bad.push(`${el.className} ${Math.round(b.left)}..${Math.round(b.right)} / ${Math.round(b.top)}..${Math.round(b.bottom)} vs inner ${Math.round(inner.l)}..${Math.round(inner.r)} / ${Math.round(inner.t)}..${Math.round(inner.b)}`); }
        // Curved rail: every corner of the rack must also sit inside the rounded (elliptical) inner edge.
        const rad = k => { const v = cs[k].split(" ").map(parseFloat); const pct = cs[k].includes("%"); const rx = pct ? v[0] / 100 * f.width : v[0], ry = pct ? (v[1] ?? v[0]) / 100 * f.height : (v[1] ?? v[0]); return [Math.max(0, rx - bw - PAD), Math.max(0, ry - bw - PAD)]; };
        const corners = { tl: rad("borderTopLeftRadius"), tr: rad("borderTopRightRadius"), bl: rad("borderBottomLeftRadius"), br: rad("borderBottomRightRadius") };
        const inside = (x, y) => { for (const [k, [rx, ry]] of Object.entries(corners)) { if (!rx || !ry) continue;
            const cx = k[1] === "l" ? inner.l + rx : inner.r - rx, cy = k[0] === "t" ? inner.t + PAD + ry : inner.b - PAD - ry;
            const inX = k[1] === "l" ? x < cx : x > cx, inY = k[0] === "t" ? y < cy : y > cy;
            if (inX && inY && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1.0001) return false; } return true; };
        for (const el of [wrap.querySelector(".rack"), wrap.querySelector(".rack-unit")]) { const b = el.getBoundingClientRect();
          for (const [x, y] of [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]) if (!inside(x, y)) { bad.push(`${el.className} corner (${Math.round(x)},${Math.round(y)}) crosses the curved rail`); break; } }
        const rb = wrap.getBoundingClientRect();
        for (const el of document.querySelectorAll(".table-controls > *:not(.rack-wrap)")) { const b = el.getBoundingClientRect(); if (!b.width) continue;
          if (b.left < rb.right - 1 && b.right > rb.left + 1 && b.top < rb.bottom - 1 && b.bottom > rb.top + 1) bad.push(`overlaps ${el.className || el.tagName}`); }
        const rack = wrap.querySelector(".rack"); if (rack.scrollWidth > rack.clientWidth + 1) bad.push("rack scrolls (chips hidden)");
        return { bad }; }, PAD);
      const ok = !r.missing && r.bad.length === 0; if (!ok) bad++;
      console.log(`${ok ? "PASS" : "FAIL"} [ChipRack ${w}] ${g} ${ok ? "" : JSON.stringify(r)}`);
      if (shots && (g !== "roulette" || w === 1366)) await p.screenshot({ path: `${out}/chiprack-${g}-${w}.png`, fullPage: true }); }
    await c.close(); }
  await br.close(); process.exit(bad ? 1 : 0); })();
