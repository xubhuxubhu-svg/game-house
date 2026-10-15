// 繽紛遊戲屋 共用功能：音效、視窗、帳號、排行榜、連線對戰大廳
var MG = (function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  var fmtT = function (ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  var fmtT2 = function (ms) { return (ms / 1000).toFixed(1) + ' 秒'; };
  var medal = function (i) { return ['🥇', '🥈', '🥉'][i] || (i + 1) + '.'; };

  // ---------- 音效 ----------
  var actx = null, muted = store.get('mg_mute') === true;
  function unlock() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function tone(f, d, type, v, slide) {
    if (muted || !actx) return;
    var t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f * slide), t + d);
    g.gain.setValueAtTime(v || 0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v, freq, q) {
    if (muted || !actx) return;
    var len = Math.max(1, Math.floor(actx.sampleRate * d)), buf = actx.createBuffer(1, len, actx.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = q || 1; g.gain.value = v || 0.3;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
  }
  function seq(notes, gap, d, type, v) { notes.forEach(function (f, i) { setTimeout(function () { tone(f, d, type, v); }, i * gap); }); }
  var sfx = {
    click: function () { tone(660, 0.06, 'triangle', 0.05); },
    err: function () { tone(170, 0.15, 'square', 0.04); },
    win: function () { seq([523, 659, 784, 1046, 1318], 110, 0.22, 'triangle', 0.08); },
    lose: function () { seq([392, 330, 262], 180, 0.3, 'triangle', 0.07); },
    tick: function () { tone(880, 0.12, 'square', 0.05); },
    go: function () { tone(1320, 0.35, 'square', 0.06); },
    undo: function () { tone(500, 0.09, 'sine', 0.05, 0.6); }
  };
  var soundBtns = [];
  function bindSound(el, withText) {
    soundBtns.push([el, withText]); paintSound();
    el.addEventListener('click', function () { unlock(); muted = !muted; store.set('mg_mute', muted); paintSound(); if (!muted) sfx.click(); });
  }
  function paintSound() { soundBtns.forEach(function (b) { b[0].textContent = (muted ? '🔇' : '🔊') + (b[1] ? ' 音效' : ''); }); }

  // ---------- 提示與視窗 ----------
  var toastT = 0, modalKind = '';
  function ensureUi() {
    if ($('mgToast')) return;
    var t = document.createElement('div'); t.id = 'mgToast'; document.body.appendChild(t);
    var bg = document.createElement('div'); bg.id = 'mgModalBg'; bg.className = 'mgHidden'; bg.innerHTML = '<div id="mgModal"></div>'; document.body.appendChild(bg);
    bg.addEventListener('pointerdown', function (e) { if (e.target === bg && ['help', 'rank', 'lobby', 'info'].indexOf(modalKind) >= 0) closeModal(); });
  }
  function toast(msg, ms) { ensureUi(); var t = $('mgToast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, ms || 2200); }
  function showModal(html, kind) { ensureUi(); modalKind = kind || ''; $('mgModal').innerHTML = html; $('mgModalBg').classList.remove('mgHidden'); $('mgModal').scrollTop = 0; }
  function closeModal() { if ($('mgModalBg')) $('mgModalBg').classList.add('mgHidden'); modalKind = ''; }

  // ---------- 帳號與連線 ----------
  var state = { online: false, day: '', acct: null, guestName: store.get('mg_guest') || ('訪客' + Math.floor(100 + Math.random() * 900)), sock: null };
  store.set('mg_guest', state.guestName);
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
  }
  function ping() {
    if (location.protocol === 'file:') return Promise.resolve(false);
    var ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 5000);
    return fetch('/api/ping', { signal: ctl.signal, cache: 'no-store' }).then(function (r) { clearTimeout(tm); return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.game === 'mg') { state.day = j.day; return true; } return false; }).catch(function () { return false; });
  }
  function today() { return state.day || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function displayName() { return state.acct ? state.acct.name : state.guestName; }
  function authSocket() { if (state.sock && state.sock.connected) state.sock.emit('auth', state.acct ? { name: state.acct.name, pin: state.acct.pin } : { guestName: state.guestName }, function () {}); }
  var sockHandlers = [];
  function onSock(fn) { sockHandlers.push(fn); if (state.sock) fn(state.sock); }
  function loadSocket() {
    var s = document.createElement('script'); s.src = '/socket.io/socket.io.js';
    s.onload = function () {
      state.sock = window.io(); state.sock.on('connect', authSocket);
      sockHandlers.forEach(function (fn) { fn(state.sock); });
    };
    document.head.appendChild(s);
  }
  function init(opts) {
    opts = opts || {};
    return ping().then(function (ok) {
      state.online = ok;
      if (!ok) return state;
      if (opts.socket) loadSocket();
      var cred = store.get('mg_cred');
      if (!cred || !cred.name || !cred.pin) return state;
      return api('/api/login', cred).then(function (r) {
        if (r.ok) { state.acct = { name: r.name, pin: cred.pin, stats: r.stats, saves: r.saves || {} }; authSocket(); }
        return state;
      }).catch(function () { return state; });
    });
  }
  function login(name, pin) {
    return api('/api/login', { name: name, pin: pin }).then(function (r) {
      if (r.ok) { state.acct = { name: r.name, pin: pin, stats: r.stats, saves: r.saves || {} }; store.set('mg_cred', { name: r.name, pin: pin }); authSocket(); }
      return r;
    });
  }
  function logout() { store.del('mg_cred'); state.acct = null; authSocket(); }
  function post(path, body) {
    if (!state.online || !state.acct) return Promise.resolve(null);
    body = Object.assign({ name: state.acct.name, pin: state.acct.pin }, body || {});
    return api(path, body).catch(function () { return null; });
  }

  // ---------- 記憶存檔（本機＋雲端） ----------
  var saveTimers = {}, pending = {};
  function saveKey(game) { return 'mg_save_' + (state.acct ? state.acct.name : 'guest') + '_' + game; }
  function saveGame(game, data) {
    var rec = data ? Object.assign({}, data, { t: Date.now() }) : { t: Date.now(), none: true };
    store.set(saveKey(game), rec);
    if (state.acct) state.acct.saves = Object.assign(state.acct.saves || {}, (function () { var o = {}; o[game] = rec; return o; })());
    if (!state.online || !state.acct) return;
    pending[game] = rec; clearTimeout(saveTimers[game]);
    saveTimers[game] = setTimeout(function () { flushSave(game); }, data ? 2000 : 0);
  }
  function flushSave(game, beacon) {
    if (!pending[game] || !state.online || !state.acct) return;
    var body = JSON.stringify({ name: state.acct.name, pin: state.acct.pin, game: game, data: pending[game] });
    pending[game] = null; clearTimeout(saveTimers[game]);
    if (beacon && navigator.sendBeacon) { try { navigator.sendBeacon('/api/save', new Blob([body], { type: 'application/json' })); return; } catch (e) {} }
    fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }
  function loadGame(game) {
    var l = store.get(saveKey(game)), s = state.acct && state.acct.saves ? state.acct.saves[game] : null;
    var best = l; if (s && (!l || (s.t || 0) > (l.t || 0))) best = s;
    return best && !best.none ? best : null;
  }
  function flushAll() { Object.keys(pending).forEach(function (g) { flushSave(g, true); }); }
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });

  // ---------- 排行榜 ----------
  var GAMES = {
    ws: { name: '繽紛倒水瓶', tabs: [['level', '闖關榜'], ['daily', '今日挑戰'], ['wins', '對戰榜']] },
    sc: { name: '螺絲拆拆樂', tabs: [['level', '闖關榜'], ['daily', '今日挑戰'], ['wins', '對戰榜']] },
    cr: { name: '克朗棋', tabs: [['wins', '連線勝場'], ['ai', '擊敗電腦']] }
  };
  function openRank(game, tab, onClose) {
    if (!state.online) return toast('排行榜需要連線版（部署到伺服器後才能使用）');
    var g = GAMES[game];
    showModal('<h2>🏆 ' + g.name + '</h2><p style="text-align:center">讀取中…</p>', 'rank');
    api('/api/leaderboard?game=' + game).then(function (d) {
      if (modalKind !== 'rank') return;
      if (!d || !d.ok) throw 0;
      var me = state.acct ? state.acct.name : '';
      var fmt = {
        level: function (r) { return '第 ' + (r.v - 1) + ' 關'; },
        daily: function (r) { return fmtT2(r.v); },
        wins: function (r) { return r.v + ' 勝' + (r.v2 != null ? ' / ' + r.v2 + ' 場' : ''); },
        ai: function (r) { return r.v + ' 次'; }
      };
      var notes = { level: '依「已完成的最高關卡」排名', daily: '今天（' + d.day + '）每日挑戰最快紀錄', wins: '連線對戰勝場數', ai: '贏過「困難」電腦的次數' };
      function draw(k) {
        var rows = d[k] || [];
        showModal('<h2>🏆 ' + g.name + '</h2><div class="mgSeg">' + g.tabs.map(function (t) { return '<button data-k="' + t[0] + '" class="' + (t[0] === k ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
          (rows.length ? '<ul class="mgRank">' + rows.map(function (r, i) { return '<li class="' + (r.name === me ? 'me' : '') + '"><span>' + medal(i) + ' ' + esc(r.name) + '</span><span>' + fmt[k](r) + '</span></li>'; }).join('') + '</ul>'
            : '<p style="text-align:center">還沒有人上榜，快來搶第一！</p>') +
          '<p class="mgNote">' + notes[k] + '</p><button class="mgBtn grey" id="rkClose">關閉</button>', 'rank');
        document.querySelectorAll('#mgModal .mgSeg button').forEach(function (b) { b.onclick = function () { draw(b.dataset.k); }; });
        $('rkClose').onclick = function () { closeModal(); if (onClose) onClose(); };
      }
      draw(tab || g.tabs[0][0]);
    }).catch(function () {
      showModal('<h2>🏆 排行榜</h2><p style="text-align:center">讀取失敗，請稍後再試</p><button class="mgBtn grey" id="rkClose">關閉</button>', 'rank');
      $('rkClose').onclick = closeModal;
    });
  }

  // ---------- 搶快對戰大廳（倒水瓶、螺絲） ----------
  var DIFF = { easy: '簡單', normal: '普通', hard: '困難' };
  var race = { game: '', h: null, room: null, autoAt: 0, diff: store.get('mg_diff') || 'normal', bound: false };
  function segHtml(cur) { return '<div class="mgSeg" id="diffSeg">' + ['easy', 'normal', 'hard'].map(function (d) { return '<button data-d="' + d + '" class="' + (d === cur ? 'on' : '') + '">' + DIFF[d] + '</button>'; }).join('') + '</div>'; }
  function bindSeg(cb) { document.querySelectorAll('#diffSeg button').forEach(function (b) { b.onclick = function () { cb(b.dataset.d); }; }); }
  function raceSetup(game, handlers) {
    race.game = game; race.h = handlers;
    onSock(function (sock) {
      if (race.bound) return; race.bound = true;
      sock.on('race:room', function (r) { race.room = r; if (modalKind === 'room') renderRoom(); });
      sock.on('race:auto', function (o) { race.autoAt = o.inMs ? Date.now() + o.inMs : 0; if (modalKind === 'room') renderRoom(); });
      sock.on('race:begin', function (o) { race.autoAt = 0; closeModal(); race.h.begin(o); });
      sock.on('race:standings', function (l) { race.h.standings(l); });
      sock.on('race:end', function (o) { race.h.end(o); });
      sock.on('disconnect', function () { race.room = null; race.h.disconnected && race.h.disconnected(); if (modalKind === 'room') renderLobby(); });
    });
    setInterval(function () {
      if (modalKind === 'room' && race.room && race.room.isPublic && race.autoAt && $('autoTxt') && race.room.players.length >= 2)
        $('autoTxt').textContent = Math.max(0, Math.ceil((race.autoAt - Date.now()) / 1000)) + ' 秒後自動開始';
    }, 300);
  }
  function openRace() {
    if (!state.online) return toast('對戰需要連線版（部署到伺服器後才能使用）');
    if (!state.sock || !state.sock.connected) return toast('正在連線伺服器，請稍候再試');
    race.room ? renderRoom() : renderLobby();
  }
  function renderLobby() {
    showModal('<h2>⚔️ 連線對戰</h2><p class="mgNote">' + race.h.intro + '最多 6 人。</p>' +
      (state.acct ? '' : '<p class="mgNote" style="color:#c2410c">訪客身分的成績不會記入排行榜</p>') +
      '<h3>難度</h3>' + segHtml(race.diff) +
      '<button class="mgBtn" id="rQuick">⚡ 快速配對</button><p class="mgNote">和線上玩家配對，滿 2 人後 15 秒自動開始</p>' +
      '<button class="mgBtn blue" id="rCreate">🏠 建立私人房間</button><p class="mgNote">把房號告訴朋友，由你按下開始</p>' +
      '<div class="mgRow"><input class="mgInp" id="rCode" inputmode="numeric" maxlength="4" placeholder="輸入 4 位房號"><button class="mgBtn green" id="rJoin" style="margin-top:8px">加入</button></div>' +
      '<div class="mgErr" id="rErr"></div><button class="mgBtn grey" id="rClose">關閉</button>', 'lobby');
    bindSeg(function (d) { race.diff = d; store.set('mg_diff', d); renderLobby(); });
    var sock = state.sock;
    $('rQuick').onclick = function () { sock.emit('race:quick', { game: race.game, diff: race.diff }); showModal('<h2>配對中…</h2>', 'room'); };
    $('rCreate').onclick = function () { sock.emit('race:create', { game: race.game, diff: race.diff }); showModal('<h2>建立房間中…</h2>', 'room'); };
    $('rJoin').onclick = function () {
      var code = $('rCode').value.trim(); if (!/^\d{4}$/.test(code)) { $('rErr').textContent = '請輸入 4 位數字房號'; return; }
      sock.emit('race:join', { code: code, game: race.game }, function (r) { if (!r.ok) $('rErr').textContent = r.error; else { modalKind = 'room'; if (race.room) renderRoom(); } });
    };
    $('rClose').onclick = closeModal;
  }
  function renderRoom() {
    var room = race.room; if (!room) return renderLobby();
    var sock = state.sock, me = sock.id, isHost = room.host === me, n = room.players.length;
    var auto = room.isPublic && race.autoAt ? Math.max(0, Math.ceil((race.autoAt - Date.now()) / 1000)) : 0;
    showModal('<h2>' + (room.isPublic ? '⚡ 配對房間' : '🏠 私人房間') + '</h2>' +
      (room.isPublic ? '' : '<p class="mgNote" style="margin:0">房號（告訴朋友）</p><div class="mgCode">' + room.code + '</div>') +
      '<h3>難度：' + DIFF[room.diff] + '</h3>' + (isHost && !room.isPublic ? segHtml(room.diff) : '') +
      '<h3>玩家（' + n + '/6）</h3><ul class="mgPlist">' + room.players.map(function (p) {
        return '<li><span>' + (p.id === room.host ? '👑 ' : '') + esc(p.name) + (p.guest ? '（訪客）' : '') + '</span><span>' + (p.id === me ? '← 你' : '') + '</span></li>';
      }).join('') + '</ul><p class="mgNote" id="autoTxt">' + (n < 2 ? '等待其他玩家加入…' : room.isPublic ? (auto ? auto + ' 秒後自動開始' : '即將開始') : isHost ? '人數足夠，可以開始了！' : '等待房主開始') + '</p>' +
      (isHost && n >= 2 ? '<button class="mgBtn green" id="rStart">開始對戰！</button>' : '') + '<button class="mgBtn grey" id="rLeave">離開房間</button>', 'room');
    bindSeg(function (d) { sock.emit('race:diff', { diff: d }); });
    if ($('rStart')) $('rStart').onclick = function () { sock.emit('race:start'); };
    $('rLeave').onclick = function () { leaveRace(); renderLobby(); };
  }
  function leaveRace() { if (state.sock && race.room) state.sock.emit('race:leave'); race.room = null; race.autoAt = 0; }
  function raceResult(o, unit, onAgain, onHome) {
    var myId = state.sock.id, ranking = o.ranking, me = -1;
    ranking.forEach(function (r, i) { if (r.id === myId) me = i; });
    var champ = me === 0 && ranking[0].done;
    if (champ) sfx.win();
    showModal('<h2>' + (champ ? '🎉 你是冠軍！' : '對戰結束') + '</h2><ul class="mgRank">' + ranking.map(function (r, i) {
      return '<li class="' + (r.id === myId ? 'me' : '') + '"><span>' + medal(i) + ' ' + esc(r.name) + (r.guest ? '（訪客）' : '') + '</span><span>' +
        (r.done ? fmtT2(r.ms) : '完成 ' + r.prog + '/' + r.total + ' ' + unit) + '</span></li>';
    }).join('') + '</ul><button class="mgBtn green" id="reAgain">再來一局（留在房間）</button><button class="mgBtn grey" id="reHome">離開</button>', 'result');
    $('reAgain').onclick = function () { onAgain(); renderRoom(); };
    $('reHome').onclick = function () { closeModal(); leaveRace(); onHome(); };
  }
  function standingsHtml(list, unitTotal) {
    var myId = state.sock ? state.sock.id : '';
    return list.map(function (p, i) {
      var pct = p.total ? Math.round(p.prog / p.total * 100) : 0;
      return '<div class="r ' + (p.id === myId ? 'me' : '') + '"><span>' + medal(i) + '</span><span class="n">' + esc(p.name) + '</span>' +
        (p.done ? '<span>' + fmtT2(p.ms) + '</span>' : '<span class="bar"><i style="width:' + pct + '%"></i></span>') + '</div>';
    }).join('');
  }

  // ---------- 共用樣式 ----------
  var css = '' +
    '.mgHidden{display:none!important}' +
    '#mgModalBg{position:fixed;inset:0;background:rgba(30,25,20,.55);display:grid;place-items:center;z-index:50;padding:12px}' +
    '#mgModal{background:#fbf8ef;color:#34404e;border:4px solid #34404e;border-radius:22px;width:100%;max-width:420px;max-height:88vh;overflow-y:auto;padding:18px;box-shadow:0 8px 0 rgba(0,0,0,.3);font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif}' +
    '#mgModal h2{margin:0 0 10px;text-align:center;font-size:24px}#mgModal h3{margin:14px 0 6px;font-size:17px}#mgModal p,#mgModal li{font-size:15px;line-height:1.6}#mgModal ul{padding-left:20px;margin:6px 0}' +
    '.mgBtn{display:block;width:100%;border:3px solid #34404e;border-radius:14px;padding:11px;font:inherit;font-weight:900;font-size:17px;background:#f7c41f;color:#34404e;margin-top:10px;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.25)}' +
    '.mgBtn:active{transform:translateY(3px);box-shadow:0 1px 0 rgba(0,0,0,.25)}.mgBtn.blue{background:#9fd0f5}.mgBtn.green{background:#b6e08a}.mgBtn.grey{background:#e4e0d4}.mgBtn.pink{background:#f5b3e0}.mgBtn:disabled{opacity:.5}' +
    '.mgInp{width:100%;padding:11px;border:3px solid #34404e;border-radius:12px;font:inherit;font-size:17px;margin-top:8px;background:#fff;color:#34404e;box-sizing:border-box}' +
    '.mgRow{display:flex;gap:8px}.mgRow>*{flex:1}.mgNote{font-size:13px!important;opacity:.75;text-align:center}.mgErr{color:#c62828;font-weight:800;text-align:center;min-height:1.4em;margin-top:6px}' +
    '.mgSeg{display:flex;gap:6px;margin:6px 0}.mgSeg button{flex:1;border:3px solid #34404e;border-radius:12px;padding:8px 4px;font:inherit;font-weight:800;background:#fff;cursor:pointer;color:#34404e}.mgSeg button.on{background:#f7c41f}' +
    '.mgRank{list-style:none;padding:0!important;margin:0}.mgRank li{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:10px;font-weight:700}.mgRank li:nth-child(odd){background:rgba(0,0,0,.05)}.mgRank li.me{background:#ffe08a}' +
    '.mgPlist{list-style:none;padding:0!important}.mgPlist li{background:#fff;border:2px solid #34404e;border-radius:12px;padding:8px 12px;margin-bottom:6px;font-weight:800;display:flex;justify-content:space-between}' +
    '.mgCode{font-size:40px;font-weight:900;text-align:center;letter-spacing:6px;color:#c2410c}' +
    '.mgStats{display:flex;justify-content:center;gap:12px;margin:8px 0}.mgStats div{background:#fff;border:2px solid #34404e;border-radius:14px;padding:6px 14px;text-align:center;font-weight:900;font-size:20px}.mgStats small{display:block;font-size:12px;opacity:.7}' +
    '.mgCredit{margin-top:14px;font-weight:800;opacity:.7;font-size:14px;text-align:center}' +
    '#mgToast{position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#34404e;color:#fff;padding:9px 18px;border-radius:12px;font-weight:800;font-size:15px;z-index:60;opacity:0;transition:opacity .25s;pointer-events:none;max-width:90vw;text-align:center;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif}' +
    '#mgToast.show{opacity:1}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  return {
    $: $, esc: esc, store: store, fmtT: fmtT, fmtT2: fmtT2, medal: medal,
    unlock: unlock, tone: tone, noise: noise, seq: seq, sfx: sfx, bindSound: bindSound, isMuted: function () { return muted; },
    toast: toast, showModal: showModal, closeModal: closeModal, modalKind: function () { return modalKind; },
    saveGame: saveGame, loadGame: loadGame, flushSave: flushSave,
    state: state, api: api, init: init, login: login, logout: logout, post: post, today: today, displayName: displayName, onSock: onSock,
    openRank: openRank, DIFF: DIFF, raceSetup: raceSetup, openRace: openRace, leaveRace: leaveRace, raceResult: raceResult, standingsHtml: standingsHtml,
    raceRoom: function () { return race.room; }
  };
})();
