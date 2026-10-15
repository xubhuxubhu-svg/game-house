// 克朗棋 核心：物理與規則（網頁與伺服器共用，只用加減乘除與開根號，確保每台裝置結果一樣）
var CR = (function () {
  var HALF = 50, PC = 45.6, PR = 4.3, CRAD = 2.1, SRAD = 2.75, BASE = 36.5, BX = 28.5;
  var MAXV = 340, FRIC = 70, LIN = 0.55, DT = 1 / 240, WALL = 0.72, E = 0.9, SM = 1.7, CM = 1;
  var POCKETS = [[-PC, -PC], [PC, -PC], [-PC, PC], [PC, PC]];
  var R3 = Math.sqrt(3);
  function newGame() {
    var p = [{ t: 'q', x: 0, y: 0, in: 0 }], d = 2 * CRAD + 0.06;
    // 內圈 6 顆
    var inner = [[1, 0], [0.5, R3 / 2], [-0.5, R3 / 2], [-1, 0], [-0.5, -R3 / 2], [0.5, -R3 / 2]];
    inner.forEach(function (v, i) { p.push({ t: i % 2 ? 'b' : 'w', x: v[0] * d, y: v[1] * d, in: 0 }); });
    // 外圈 12 顆：6 顆在 2d 的六角頂點，6 顆在邊的中點
    var outer = [];
    inner.forEach(function (v, i) {
      var nv = inner[(i + 1) % 6];
      outer.push([v[0] * 2 * d, v[1] * 2 * d, 'w']);
      outer.push([(v[0] + nv[0]) * d, (v[1] + nv[1]) * d, 'b']);
    });
    outer.forEach(function (o) { p.push({ t: o[2], x: o[0], y: o[1], in: 0 }); });
    return { p: p, turn: 0, queen: -1, pend: -1, winner: -1, shots: 0, msg: '' };
  }
  function clone(st) { return JSON.parse(JSON.stringify(st)); }
  function baseY(seat) { return seat === 0 ? BASE : -BASE; }
  function strikerOk(st, seat, x) {
    if (!(x >= -BX && x <= BX)) return false;
    var y = baseY(seat);
    for (var i = 0; i < st.p.length; i++) {
      var q = st.p[i]; if (q.in) continue;
      var dx = q.x - x, dy = q.y - y; if (dx * dx + dy * dy < (CRAD + SRAD) * (CRAD + SRAD)) return false;
    }
    return true;
  }
  function Sim(st, shot, seat) {
    this.b = []; this.pocketed = []; this.striker = false; this.steps = 0; this.done = false; this.hits = [];
    for (var i = 0; i < st.p.length; i++) { var q = st.p[i]; if (!q.in) this.b.push({ id: i, x: q.x, y: q.y, vx: 0, vy: 0, r: CRAD, m: CM, on: true }); }
    var vx = Number(shot.vx) || 0, vy = Number(shot.vy) || 0, sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > MAXV) { vx = vx / sp * MAXV; vy = vy / sp * MAXV; }
    this.b.push({ id: -1, x: Number(shot.x), y: baseY(seat), vx: vx, vy: vy, r: SRAD, m: SM, on: true });
  }
  Sim.prototype.step = function () {
    if (this.done) return;
    var b = this.b, n = b.length, i, j, moving = false;
    this.hits.length = 0;
    for (i = 0; i < n; i++) {
      var o = b[i]; if (!o.on) continue;
      var s = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      if (s > 0) {
        var ns = s - FRIC * DT - s * LIN * DT;
        if (ns < 0.6) { o.vx = 0; o.vy = 0; } else { o.vx = o.vx * ns / s; o.vy = o.vy * ns / s; moving = true; }
      }
      o.x += o.vx * DT; o.y += o.vy * DT;
      if (o.x - o.r < -HALF) { o.x = -HALF + o.r; o.vx = -o.vx * WALL; this.hits.push(['wall', Math.abs(o.vx)]); }
      if (o.x + o.r > HALF) { o.x = HALF - o.r; o.vx = -o.vx * WALL; this.hits.push(['wall', Math.abs(o.vx)]); }
      if (o.y - o.r < -HALF) { o.y = -HALF + o.r; o.vy = -o.vy * WALL; this.hits.push(['wall', Math.abs(o.vy)]); }
      if (o.y + o.r > HALF) { o.y = HALF - o.r; o.vy = -o.vy * WALL; this.hits.push(['wall', Math.abs(o.vy)]); }
      for (var k = 0; k < 4; k++) {
        var dx = o.x - POCKETS[k][0], dy = o.y - POCKETS[k][1];
        if (dx * dx + dy * dy < PR * PR) {
          o.on = false; o.vx = 0; o.vy = 0; o.px = POCKETS[k][0]; o.py = POCKETS[k][1];
          if (o.id < 0) this.striker = true; else this.pocketed.push(o.id);
          this.hits.push(['pocket', o.id]); break;
        }
      }
    }
    for (i = 0; i < n; i++) {
      var A = b[i]; if (!A.on) continue;
      for (j = i + 1; j < n; j++) {
        var B = b[j]; if (!B.on) continue;
        if (A.vx === 0 && A.vy === 0 && B.vx === 0 && B.vy === 0) continue;
        var ddx = B.x - A.x, ddy = B.y - A.y, rr = A.r + B.r, d2 = ddx * ddx + ddy * ddy;
        if (d2 >= rr * rr || d2 === 0) continue;
        var d = Math.sqrt(d2), nx = ddx / d, ny = ddy / d, over = rr - d, im = 1 / A.m + 1 / B.m;
        A.x -= nx * over * (1 / A.m) / im; A.y -= ny * over * (1 / A.m) / im;
        B.x += nx * over * (1 / B.m) / im; B.y += ny * over * (1 / B.m) / im;
        var vn = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
        if (vn > 0) {
          var J = (1 + E) * vn / im;
          A.vx -= J / A.m * nx; A.vy -= J / A.m * ny; B.vx += J / B.m * nx; B.vy += J / B.m * ny;
          this.hits.push(['hit', vn]); moving = true;
        }
      }
    }
    this.steps++;
    if (!moving || this.steps > 240 * 14) {
      this.done = true;
      for (i = 0; i < n; i++) { b[i].vx = 0; b[i].vy = 0; }
    }
  };
  Sim.prototype.run = function () { while (!this.done) this.step(); return this; };

  // 回中央：找最靠近中心又不重疊的位置
  var SPOTS = (function () {
    var out = [], st = 2 * CRAD + 0.1;
    for (var gx = -6; gx <= 6; gx++) for (var gy = -6; gy <= 6; gy++) {
      var x = gx * st * 0.5, y = gy * st * 0.5; out.push([x, y, x * x + y * y, gx * 100 + gy]);
    }
    out.sort(function (a, b) { return a[2] - b[2] || a[3] - b[3]; });
    return out;
  })();
  function placeCenter(st, idx) {
    var q = st.p[idx];
    for (var s = 0; s < SPOTS.length; s++) {
      var x = SPOTS[s][0], y = SPOTS[s][1], ok = true;
      for (var i = 0; i < st.p.length; i++) {
        var o = st.p[i]; if (i === idx || o.in) continue;
        var dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy < (2 * CRAD + 0.05) * (2 * CRAD + 0.05)) { ok = false; break; }
      }
      if (ok) { q.x = x; q.y = y; q.in = 0; return; }
    }
    q.x = 0; q.y = 0; q.in = 0;
  }
  function colorOf(seat) { return seat === 0 ? 'w' : 'b'; }
  function countIn(st, t) { var n = 0; for (var i = 0; i < st.p.length; i++) if (st.p[i].t === t && st.p[i].in) n++; return n; }
  function queenIdx(st) { return 0; }
  // 套用一桿的結果
  function applyShot(st, seat, sim) {
    var ns = clone(st), own = colorOf(seat), opp = colorOf(1 - seat), msgs = [], again = false;
    ns.shots++;
    for (var i = 0; i < sim.b.length; i++) { var o = sim.b[i]; if (o.id >= 0 && o.on) { ns.p[o.id].x = o.x; ns.p[o.id].y = o.y; } }
    var ownIn = [], oppIn = [], queenIn = false;
    sim.pocketed.forEach(function (id) {
      ns.p[id].in = ns.shots;
      if (ns.p[id].t === own) ownIn.push(id); else if (ns.p[id].t === opp) oppIn.push(id); else queenIn = true;
    });
    if (sim.striker) {
      msgs.push('母球進洞，犯規！');
      ownIn.forEach(function (id) { placeCenter(ns, id); });
      var pen = -1;
      for (var k = 0; k < ns.p.length; k++) if (ns.p[k].t === own && ns.p[k].in) { if (pen < 0 || ns.p[k].in > ns.p[pen].in) pen = k; }
      if (pen >= 0) { placeCenter(ns, pen); msgs.push('罰一顆棋子回到中央'); }
      if (queenIn) placeCenter(ns, 0);
      if (ns.pend === seat) { if (!queenIn) placeCenter(ns, 0); ns.pend = -1; }
    } else {
      if (ns.pend === seat) {
        if (ownIn.length) { ns.queen = seat; msgs.push('成功保住皇后！'); }
        else { placeCenter(ns, 0); msgs.push('皇后沒保住，回到中央'); }
        ns.pend = -1;
      }
      if (queenIn) {
        if (ownIn.length) { ns.queen = seat; msgs.push('打進皇后並保住了！'); }
        else { ns.pend = seat; msgs.push('打進皇后！下一桿要再打進自己的棋子才算數'); }
      }
      if (ownIn.length && !queenIn) msgs.push('進了 ' + ownIn.length + ' 顆，再打一桿！');
      if (oppIn.length) msgs.push('幫對手打進了 ' + oppIn.length + ' 顆');
      again = ownIn.length > 0 || queenIn;
    }
    ['w', 'b'].forEach(function (c) {
      if (countIn(ns, c) === 9 && ns.queen < 0) {
        var last = -1; for (var k = 0; k < ns.p.length; k++) if (ns.p[k].t === c && ns.p[k].in) { if (last < 0 || ns.p[k].in > ns.p[last].in) last = k; }
        placeCenter(ns, last); msgs.push('要先拿下皇后，最後一顆退回中央');
        if (c === own) again = false;
      }
    });
    if (countIn(ns, 'w') === 9) ns.winner = 0; else if (countIn(ns, 'b') === 9) ns.winner = 1;
    if (ns.winner < 0 && !again) ns.turn = 1 - seat;
    ns.msg = msgs.join('　');
    return ns;
  }
  function score(st, seat) { return countIn(st, colorOf(seat)); }
  function validShot(st, seat, shot) {
    if (!shot || st.winner >= 0 || st.turn !== seat) return false;
    var x = Number(shot.x), vx = Number(shot.vx), vy = Number(shot.vy);
    if (!isFinite(x) || !isFinite(vx) || !isFinite(vy)) return false;
    if (vx * vx + vy * vy < 25) return false;
    return strikerOk(st, seat, x);
  }
  // 電腦出手：嘗試多種打法，模擬後挑最好的
  function aiShot(st, seat, level, rnd) {
    rnd = rnd || Math.random;
    var own = colorOf(seat), by = baseY(seat), cands = [];
    var targets = [];
    st.p.forEach(function (q, i) { if (!q.in && (q.t === own || (q.t === 'q' && st.queen < 0))) targets.push(i); });
    var xs = []; for (var k = 0; k <= 12; k++) xs.push(-BX + 2 * BX * k / 12);
    function clearPath(ax, ay, bx2, by2, rad, skip) {
      for (var i = 0; i < st.p.length; i++) {
        if (i === skip || st.p[i].in) continue;
        var q = st.p[i], dx = bx2 - ax, dy = by2 - ay, l = dx * dx + dy * dy, t = l ? ((q.x - ax) * dx + (q.y - ay) * dy) / l : 0;
        if (t < 0 || t > 1) continue;
        var ex = ax + dx * t - q.x, ey = ay + dy * t - q.y; if (ex * ex + ey * ey < rad * rad) return false;
      }
      return true;
    }
    targets.forEach(function (ti) {
      var q = st.p[ti];
      POCKETS.forEach(function (pk) {
        var dx = pk[0] - q.x, dy = pk[1] - q.y, L = Math.sqrt(dx * dx + dy * dy), ux = dx / L, uy = dy / L;
        var gx = q.x - ux * (CRAD + SRAD), gy = q.y - uy * (CRAD + SRAD);
        if (!clearPath(q.x, q.y, pk[0], pk[1], 2 * CRAD, ti)) return;
        xs.forEach(function (x) {
          if (!strikerOk(st, seat, x)) return;
          var wx = gx - x, wy = gy - by, wl = Math.sqrt(wx * wx + wy * wy), cut = (wx * ux + wy * uy) / wl;
          if (cut < 0.35) return;
          if (!clearPath(x, by, gx, gy, CRAD + SRAD, ti)) return;
          var dist = wl + L / Math.max(0.35, cut);
          var sp = Math.min(MAXV, 40 + Math.sqrt(2 * (FRIC + 20) * dist) * 1.7);
          cands.push({ x: x, vx: wx / wl * sp, vy: wy / wl * sp, pre: cut * 3 - wl / 60 - L / 80 });
        });
      });
    });
    cands.sort(function (a, b) { return b.pre - a.pre; });
    cands = cands.slice(0, 36);
    if (!cands.length) {
      for (var t = 0; t < 12; t++) {
        var x = -BX + rnd() * 2 * BX; if (!strikerOk(st, seat, x)) continue;
        var tx = (rnd() - 0.5) * 30, ty = (rnd() - 0.5) * 30, wx2 = tx - x, wy2 = ty - by, wl2 = Math.sqrt(wx2 * wx2 + wy2 * wy2);
        cands.push({ x: x, vx: wx2 / wl2 * 260, vy: wy2 / wl2 * 260, pre: 0 });
      }
    }
    var noise = level === 'easy' ? 0.07 : level === 'normal' ? 0.03 : 0.008;
    var scored = cands.map(function (c) {
      var sim = new Sim(st, c, seat).run(), ns = applyShot(st, seat, sim);
      var v = (score(ns, seat) - score(st, seat)) * 10 - (score(ns, 1 - seat) - score(st, 1 - seat)) * 8;
      if (sim.striker) v -= 25; if (ns.queen === seat && st.queen !== seat) v += 12; if (ns.pend === seat) v += 4;
      if (ns.winner === seat) v += 100; if (ns.turn === seat) v += 3;
      return { c: c, v: v + rnd() * 0.5 };
    });
    scored.sort(function (a, b) { return b.v - a.v; });
    var pickFrom = level === 'easy' ? Math.min(6, scored.length) : level === 'normal' ? Math.min(2, scored.length) : 1;
    var pick = scored[Math.floor(rnd() * pickFrom)] || { c: { x: 0, vx: 0, vy: by > 0 ? -250 : 250 } };
    var c = pick.c, a = (rnd() * 2 - 1) * noise, ca = Math.cos(a), sa = Math.sin(a), pw = 1 + (rnd() * 2 - 1) * noise * 1.5;
    return { x: c.x, vx: (c.vx * ca - c.vy * sa) * pw, vy: (c.vx * sa + c.vy * ca) * pw };
  }
  return { HALF: HALF, PC: PC, PR: PR, CRAD: CRAD, SRAD: SRAD, BASE: BASE, BX: BX, MAXV: MAXV, POCKETS: POCKETS,
    newGame: newGame, clone: clone, baseY: baseY, strikerOk: strikerOk, Sim: Sim, applyShot: applyShot, score: score,
    countIn: countIn, colorOf: colorOf, validShot: validShot, aiShot: aiShot };
})();
if (typeof module !== 'undefined') module.exports = CR;
