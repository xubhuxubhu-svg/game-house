// 螺絲拆拆樂 核心規則（網頁與伺服器共用）
var SC = (function () {
  var COLS = 7, ROWS = 8, TOL = 0.2, COVER = 0.5;
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rd(v) { return Math.round(v * 1e6) / 1e6; }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = ax + dx * t - px, y = ay + dy * t - py; return Math.sqrt(x * x + y * y);
  }
  function aligned(p, x, y) {
    for (var i = 0; i < p.h.length; i++) { var dx = p.h[i][0] - x, dy = p.h[i][1] - y; if (dx * dx + dy * dy < TOL * TOL) return true; }
    return false;
  }
  function covers(p, x, y) {
    if (aligned(p, x, y)) return false;
    var h = p.h, n = h.length;
    return segDist(x, y, h[0][0], h[0][1], h[n - 1][0], h[n - 1][1]) < COVER;
  }
  function clone(st) {
    return { planks: st.planks.map(function (p) { return { h: p.h.map(function (q) { return q.slice(); }), l: p.l, c: p.c, g: p.g }; }),
      holes: st.holes.map(function (q) { return q.slice(); }), occ: st.occ.slice(), hammer: st.hammer, drill: st.drill };
  }
  function pinsOf(st, k) {
    var p = st.planks[k], out = [];
    for (var i = 0; i < st.holes.length; i++) if (st.occ[i] && aligned(p, st.holes[i][0], st.holes[i][1])) out.push(i);
    return out;
  }
  // 只剩一顆螺絲：以那顆為軸，重心轉到正下方
  function hang(p, P) {
    var n = p.h.length, cx = (p.h[0][0] + p.h[n - 1][0]) / 2, cy = (p.h[0][1] + p.h[n - 1][1]) / 2;
    var vx = cx - P[0], vy = cy - P[1], L = Math.sqrt(vx * vx + vy * vy);
    if (L < 1e-4) return false;
    var ux = vx / L, uy = vy / L;
    if (Math.abs(ux) < 1e-6 && uy > 0) return false;
    var c = uy, s = ux;
    for (var i = 0; i < n; i++) {
      var dx = p.h[i][0] - P[0], dy = p.h[i][1] - P[1];
      p.h[i][0] = rd(P[0] + c * dx - s * dy); p.h[i][1] = rd(P[1] + s * dx + c * dy);
    }
    return true;
  }
  function resolve(st, ev) {
    for (var loop = 0; loop < 8; loop++) {
      var changed = false;
      for (var k = 0; k < st.planks.length; k++) {
        var p = st.planks[k]; if (p.g) continue;
        var pins = pinsOf(st, k);
        if (!pins.length) { p.g = true; changed = true; if (ev) ev.push(['fall', k]); }
        else if (pins.length === 1) {
          var P = st.holes[pins[0]], before = p.h[0].slice();
          if (hang(p, P)) { changed = true; if (ev) ev.push(['swing', k, P[0], P[1]]); }
        }
      }
      if (!changed) break;
    }
  }
  function screwTop(st, i) {
    var x = st.holes[i][0], y = st.holes[i][1], top = -1;
    for (var k = 0; k < st.planks.length; k++) { var p = st.planks[k]; if (!p.g && aligned(p, x, y) && p.l > top) top = p.l; }
    return top;
  }
  function blocked(st, i) {
    var x = st.holes[i][0], y = st.holes[i][1], top = screwTop(st, i);
    for (var k = 0; k < st.planks.length; k++) { var p = st.planks[k]; if (!p.g && p.l > top && covers(p, x, y)) return true; }
    return false;
  }
  function holeCovered(st, x, y) {
    for (var k = 0; k < st.planks.length; k++) { var p = st.planks[k]; if (!p.g && covers(p, x, y)) return true; }
    return false;
  }
  function holeFree(st, i) { return !st.occ[i] && !holeCovered(st, st.holes[i][0], st.holes[i][1]); }
  function canPick(st, i) { return !!st.occ[i] && !blocked(st, i); }
  function canDrill(st, x, y) {
    if (x !== Math.round(x) || y !== Math.round(y) || x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
    for (var i = 0; i < st.holes.length; i++) if (st.holes[i][0] === x && st.holes[i][1] === y) return false;
    return !holeCovered(st, x, y);
  }
  function topPlankAt(st, x, y) {
    var best = -1, bl = -1;
    for (var k = 0; k < st.planks.length; k++) {
      var p = st.planks[k]; if (p.g) continue;
      var h = p.h, n = h.length;
      if (segDist(x, y, h[0][0], h[0][1], h[n - 1][0], h[n - 1][1]) < 0.4 && p.l > bl) { bl = p.l; best = k; }
    }
    return best;
  }
  function apply(st, mv, ev) {
    if (!Array.isArray(mv)) return false;
    if (mv[0] === 'h') {
      var k = mv[1] | 0; if (st.hammer || !st.planks[k] || st.planks[k].g) return false;
      st.hammer = true; st.planks[k].g = true; if (ev) ev.push(['smash', k]); resolve(st, ev); return true;
    }
    if (mv[0] === 'd') {
      var x = Number(mv[1]), y = Number(mv[2]);
      if (st.drill || !canDrill(st, x, y)) return false;
      st.drill = true; st.holes.push([x, y]); st.occ.push(false); return true;
    }
    var a = mv[0] | 0, b = mv[1] | 0;
    if (a === b || a < 0 || b < 0 || a >= st.holes.length || b >= st.holes.length) return false;
    if (!canPick(st, a) || !holeFree(st, b)) return false;
    st.occ[a] = false; st.occ[b] = true; resolve(st, ev); return true;
  }
  function remaining(st) { var n = 0; for (var k = 0; k < st.planks.length; k++) if (!st.planks[k].g) n++; return n; }
  function solved(st) { return remaining(st) === 0; }
  function key(st) {
    var s = st.occ.map(function (o) { return o ? 1 : 0; }).join('');
    for (var k = 0; k < st.planks.length; k++) {
      var p = st.planks[k]; s += '|' + (p.g ? 'g' : (Math.round(p.h[0][0] * 100) + ',' + Math.round(p.h[0][1] * 100) + ',' + Math.round(p.h[p.h.length - 1][0] * 100)));
    }
    return s;
  }
  function totalPins(st) {
    var n = 0; for (var k = 0; k < st.planks.length; k++) if (!st.planks[k].g) n += 10 + pinsOf(st, k).length; return n;
  }
  // 最佳優先搜尋：優先走讓木板掉落、螺絲變少的步
  function solve(start, limit) {
    var seen = new Set(), heap = [], nodes = 0, s0 = clone(start);
    function push(it) { heap.push(it); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (heap[p].f <= it.f) break; heap[i] = heap[p]; i = p; } heap[i] = it; }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l].f < (m === i ? last.f : heap[m].f)) m = l; if (r < heap.length && heap[r].f < (m === i ? last.f : heap[m].f)) m = r; if (m === i) break; heap[i] = heap[m]; i = m; } heap[i] = last; } return top; }
    push({ st: s0, f: totalPins(s0), path: [] }); seen.add(key(s0));
    while (heap.length) {
      var cur = pop(), st = cur.st;
      if (solved(st)) return cur.path;
      if (++nodes > limit) return null;
      for (var a = 0; a < st.holes.length; a++) {
        if (!canPick(st, a)) continue;
        for (var b = 0; b < st.holes.length; b++) {
          if (b === a || !holeFree(st, b)) continue;
          var ns = clone(st); apply(ns, [a, b]);
          var kk = key(ns); if (seen.has(kk)) continue; seen.add(kk);
          push({ st: ns, f: totalPins(ns) + cur.path.length * 0.3, path: cur.path.concat([[a, b]]) });
        }
      }
    }
    return null;
  }
  var WOODS = 7;
  function build(r, m, extra) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]], planks = [], pts = {};
    var tries = 0;
    while (planks.length < m && tries++ < 400) {
      var d = dirs[Math.floor(r() * 4)], diag = d[0] && d[1];
      var L = 1 + Math.floor(r() * (diag ? 2 : 3));
      var x0 = Math.floor(r() * COLS), y0 = Math.floor(r() * ROWS), x1 = x0 + d[0] * L, y1 = y0 + d[1] * L;
      if (x1 < 0 || x1 >= COLS || y1 < 0 || y1 >= ROWS) continue;
      var dup = planks.some(function (p) { var a = p.h[0], b = p.h[p.h.length - 1]; return (a[0] === x0 && a[1] === y0 && b[0] === x1 && b[1] === y1); });
      if (dup) continue;
      var h = [[x0, y0], [x1, y1]];
      if (L === 2 && !diag && r() < 0.4) h.splice(1, 0, [x0 + d[0], y0 + d[1]]);
      planks.push({ h: h, l: planks.length, c: Math.floor(r() * WOODS), g: false });
    }
    var holes = [], occ = [], idx = {};
    function addHole(x, y, o) { var k = x + ',' + y; if (idx[k] != null) { if (o) occ[idx[k]] = true; return; } idx[k] = holes.length; holes.push([x, y]); occ.push(!!o); }
    planks.forEach(function (p) { p.h.forEach(function (q) { addHole(q[0], q[1], true); }); });
    // 有些木板孔下方不放螺絲（但每塊木板至少要有 2 顆）
    var st = { planks: planks, holes: holes, occ: occ, hammer: false, drill: false };
    for (var i = 0; i < holes.length; i++) {
      if (r() < 0.12) { st.occ[i] = false; var ok = true; for (var k = 0; k < planks.length; k++) if (pinsOf(st, k).length < 2) ok = false; if (!ok) st.occ[i] = true; }
    }
    var freeTries = 0, added = 0;
    while (added < extra && freeTries++ < 200) {
      var fx = Math.floor(r() * COLS), fy = Math.floor(r() * ROWS);
      if (idx[fx + ',' + fy] != null) continue;
      addHole(fx, fy, false); added++;
    }
    return st;
  }
  function freeCount(st) { var n = 0; for (var i = 0; i < st.holes.length; i++) if (holeFree(st, i)) n++; return n; }
  function params(n) {
    n = Math.max(1, n | 0);
    return { m: Math.min(16, 2 + Math.floor(n * 0.7)), extra: n < 3 ? 3 : n < 12 ? 2 : 1 };
  }
  var RACE = { easy: { m: 6, extra: 2 }, normal: { m: 10, extra: 2 }, hard: { m: 14, extra: 1 } };
  var DAILY = { m: 13, extra: 1 };
  var cache = {};
  function gen(seed, p) {
    var ck = seed + ':' + p.m + ':' + p.extra;
    if (cache[ck]) return clone(cache[ck]);
    var r = rng(seed), res = null, fallback = null;
    for (var at = 0; at < 60 && !res; at++) {
      var st = build(r, p.m, p.extra + (at >= 12 ? 1 : 0) + (at >= 30 ? 1 : 0));
      if (st.planks.length < Math.min(p.m, 2) || freeCount(st) < 1) continue;
      var sol = solve(st, 1500);
      if (sol) { if (sol.length >= Math.min(p.m, 3) || at > 40) res = st; else if (!fallback) fallback = st; }
    }
    if (!res) res = fallback;
    if (!res) { res = { planks: [{ h: [[2, 3], [4, 3]], l: 0, c: 0, g: false }], holes: [[2, 3], [4, 3], [3, 5]], occ: [true, true, false], hammer: false, drill: false }; }
    var keys = Object.keys(cache); if (keys.length > 100) delete cache[keys[0]];
    cache[ck] = res;
    return clone(res);
  }
  function campaign(n) { return gen(hashStr('sc' + n), params(n)); }
  function daily(day) { return gen(hashStr('scdaily' + day), DAILY); }
  function race(seed, diff) { return gen(seed >>> 0, RACE[diff] || RACE.normal); }
  function timeLimit(st) { return 45 + st.planks.length * 12; }
  function verify(start, moves) {
    if (!Array.isArray(moves) || moves.length > 2000) return false;
    var st = clone(start);
    for (var i = 0; i < moves.length; i++) if (!apply(st, moves[i])) return false;
    return solved(st);
  }
  function _build(r,m,e){return build(r,m,e);}
  return { _build: _build, freeCount: freeCount, COLS: COLS, ROWS: ROWS, TOL: TOL, rng: rng, hashStr: hashStr, clone: clone, aligned: aligned, covers: covers, pinsOf: pinsOf,
    screwTop: screwTop, blocked: blocked, holeFree: holeFree, holeCovered: holeCovered, canPick: canPick, canDrill: canDrill, topPlankAt: topPlankAt,
    apply: apply, resolve: resolve, remaining: remaining, solved: solved, solve: solve, campaign: campaign, daily: daily, race: race,
    params: params, RACE: RACE, timeLimit: timeLimit, verify: verify };
})();
if (typeof module !== 'undefined') module.exports = SC;
