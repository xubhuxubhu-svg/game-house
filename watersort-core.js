// 繽紛倒水瓶 核心規則（網頁與伺服器共用）
var WS = (function () {
  var CAP = 4;
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // 闖關難度：F=有顏色的瓶數，k=顏色種類，e=空瓶數
  function params(n) {
    n = Math.max(1, n | 0);
    var F = Math.min(30, 2 + n);
    var k = Math.min(10, F, 3 + Math.floor((n - 1) / 2));
    var e = 2;
    return { F: F, k: k, e: e };
  }
  var RACE = {
    easy: { F: 7, k: 6, e: 2 },
    normal: { F: 12, k: 9, e: 2 },
    hard: { F: 20, k: 10, e: 2 }
  };
  var DAILY = { F: 20, k: 10, e: 2 };

  function isDone(b) {
    if (b.length === 0) return true;
    if (b.length !== CAP) return false;
    for (var i = 1; i < b.length; i++) if (b[i] !== b[0]) return false;
    return true;
  }
  function isFullOne(b) { return b.length === CAP && isDone(b); }
  function solved(bs) { for (var i = 0; i < bs.length; i++) if (!isDone(bs[i])) return false; return true; }
  function topRun(b) {
    if (!b.length) return 0;
    var c = b[b.length - 1], n = 0;
    for (var i = b.length - 1; i >= 0 && b[i] === c; i--) n++;
    return n;
  }
  function canPour(bs, i, j) {
    if (i === j) return false;
    var s = bs[i], d = bs[j];
    if (!s || !d || !s.length || d.length >= CAP) return false;
    if (isFullOne(s)) return false;
    return d.length === 0 || d[d.length - 1] === s[s.length - 1];
  }
  function pourAmount(bs, i, j) { return Math.min(topRun(bs[i]), CAP - bs[j].length); }
  function pour(bs, i, j) {
    var n = pourAmount(bs, i, j), s = bs[i], d = bs[j];
    for (var k = 0; k < n; k++) d.push(s.pop());
    return n;
  }
  function clone(bs) { return bs.map(function (b) { return b.slice(); }); }

  function solve(start, limit) {
    var seen = new Set(), nodes = 0;
    function key(bs) { return bs.map(function (b) { return b.join(','); }).sort().join('|'); }
    function moves(bs) {
      var out = [], firstEmpty = -1;
      for (var j = 0; j < bs.length; j++) if (!bs[j].length) { firstEmpty = j; break; }
      for (var i = 0; i < bs.length; i++) {
        var s = bs[i]; if (!s.length || isFullOne(s)) continue;
        var run = topRun(s), uniform = run === s.length;
        for (var j2 = 0; j2 < bs.length; j2++) {
          if (j2 === i) continue;
          var d = bs[j2];
          if (d.length >= CAP) continue;
          if (!d.length) {
            if (uniform || j2 !== firstEmpty) continue;
            out.push([i, j2, 0 + (run >= 2 ? 1 : 0)]);
          } else if (d[d.length - 1] === s[s.length - 1]) {
            var amt = Math.min(run, CAP - d.length);
            out.push([i, j2, 3 + (amt === run ? 2 : 0) + (uniform ? 1 : 0)]);
          }
        }
      }
      out.sort(function (a, b) { return b[2] - a[2]; });
      return out;
    }
    function dfs(bs) {
      if (solved(bs)) return true;
      if (++nodes > limit) return false;
      var k = key(bs); if (seen.has(k)) return false; seen.add(k);
      var ms = moves(bs);
      for (var m = 0; m < ms.length; m++) {
        var nb = clone(bs); pour(nb, ms[m][0], ms[m][1]);
        if (dfs(nb)) return true;
        if (nodes > limit) return false;
      }
      return false;
    }
    return dfs(clone(start));
  }

  var cache = {};
  function gen(seed, p) {
    var ck = seed + ':' + p.F + ':' + p.k + ':' + p.e;
    if (cache[ck]) return clone(cache[ck]);
    var result = null;
    for (var attempt = 0; attempt < 30 && !result; attempt++) {
      var r = rng((seed + attempt * 7919) >>> 0);
      var units = [];
      for (var b = 0; b < p.F; b++) for (var u = 0; u < CAP; u++) units.push(b % p.k);
      for (var x = units.length - 1; x > 0; x--) { var y = Math.floor(r() * (x + 1)); var t = units[x]; units[x] = units[y]; units[y] = t; }
      var bs = [], bad = false;
      for (var b2 = 0; b2 < p.F; b2++) { var bt = units.slice(b2 * CAP, b2 * CAP + CAP); if (isFullOne(bt)) bad = true; bs.push(bt); }
      if (bad) continue;
      for (var e = 0; e < p.e; e++) bs.push([]);
      if (solve(bs, 30000)) result = bs;
      else if (attempt === 29) { bs.push([]); result = bs; }
    }
    if (!result) { result = []; for (var z = 0; z < p.F; z++) result.push([z % p.k, z % p.k, z % p.k, z % p.k]); }
    var keys = Object.keys(cache); if (keys.length > 300) delete cache[keys[0]];
    cache[ck] = result;
    return clone(result);
  }
  function campaign(n) { return gen(hashStr('lv' + n), params(n)); }
  function daily(dateStr) { return gen(hashStr('daily' + dateStr), DAILY); }
  function race(seed, diff) { return gen(seed >>> 0, RACE[diff] || RACE.normal); }

  // 驗證整段操作是否合法並完成（伺服器防作弊用）。'a' 代表加一個空瓶（每關一次）
  function verify(start, moves) {
    var bs = clone(start), added = false;
    if (!Array.isArray(moves) || moves.length > 3000) return false;
    for (var m = 0; m < moves.length; m++) {
      var mv = moves[m];
      if (mv === 'a') { if (added) return false; added = true; bs.push([]); continue; }
      if (mv === 'u') return false;
      if (!Array.isArray(mv) || !canPour(bs, mv[0] | 0, mv[1] | 0)) return false;
      pour(bs, mv[0] | 0, mv[1] | 0);
    }
    return solved(bs);
  }
  function progress(bs) {
    var n = 0; for (var i = 0; i < bs.length; i++) if (isFullOne(bs[i])) n++; return n;
  }
  return { CAP: CAP, rng: rng, hashStr: hashStr, params: params, RACE: RACE, DAILY: DAILY, isDone: isDone, isFullOne: isFullOne,
    solved: solved, topRun: topRun, canPour: canPour, pourAmount: pourAmount, pour: pour, clone: clone, solve: solve,
    campaign: campaign, daily: daily, race: race, verify: verify, progress: progress };
})();

if (typeof module !== 'undefined') module.exports = WS;
