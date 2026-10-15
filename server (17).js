// 繽紛遊戲屋 伺服器：帳號、排行榜、每日挑戰、倒水瓶與螺絲搶快對戰、克朗棋一對一
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const WS = require('./watersort-core.js');
const SC = require('./screws-core.js');
const CR = require('./carrom-core.js');

const app = express();
app.use(express.json({ limit: '400kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const RACE_LIMIT = Number(process.env.RACE_SECONDS) || 300;
const CR_TURN_MS = Number(process.env.CR_TURN_SECONDS || 30) * 1000;
const MAX_PLAYERS = 6;
const CORE = { ws: WS, sc: SC };

// ---------- 資料庫 ----------
let pool = null;
const mem = { players: new Map(), daily: new Map() };
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
const STAT_COLS = ['sc_level', 'sc_wins', 'sc_races', 'cr_wins', 'cr_games', 'cr_ai'];
async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS watersort_players (
    name TEXT PRIMARY KEY, pin TEXT NOT NULL, level INT DEFAULT 1,
    wins INT DEFAULT 0, races INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now())`);
  for (const c of STAT_COLS) await pool.query(`ALTER TABLE watersort_players ADD COLUMN IF NOT EXISTS ${c} INT DEFAULT ${c === 'sc_level' ? 1 : 0}`);
  await pool.query(`ALTER TABLE watersort_players ADD COLUMN IF NOT EXISTS sc_updated TIMESTAMPTZ DEFAULT now()`);
  await pool.query(`ALTER TABLE watersort_players ADD COLUMN IF NOT EXISTS saves JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`CREATE TABLE IF NOT EXISTS watersort_daily (day TEXT, name TEXT, ms INT, moves INT, PRIMARY KEY(day, name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS screws_daily (day TEXT, name TEXT, ms INT, moves INT, PRIMARY KEY(day, name))`);
}
const hashPin = (name, pin) => crypto.createHash('sha256').update('watersort:' + name + ':' + pin).digest('hex');
const cleanName = n => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 12);
const validPin = p => /^\d{4,8}$/.test(String(p || ''));
const blank = (name, pin) => ({ name, pin, level: 1, wins: 0, races: 0, sc_level: 1, sc_wins: 0, sc_races: 0, cr_wins: 0, cr_games: 0, cr_ai: 0, saves: {} });

async function getPlayer(name) {
  if (pool) { const r = await pool.query('SELECT * FROM watersort_players WHERE name=$1', [name]); return r.rows[0] || null; }
  return mem.players.get(name) || null;
}
async function auth(name, pin) {
  name = cleanName(name);
  if (!name || !validPin(pin)) return { error: '請輸入暱稱和 4～8 位數字密碼' };
  let p = await getPlayer(name), isNew = false;
  if (!p) {
    p = blank(name, hashPin(name, String(pin)));
    if (pool) await pool.query('INSERT INTO watersort_players(name,pin) VALUES($1,$2)', [name, p.pin]);
    else mem.players.set(name, p);
    isNew = true;
  } else if (p.pin !== hashPin(name, String(pin))) return { error: '這個暱稱已被使用，或密碼錯誤' };
  return { player: p, isNew };
}
// 統計欄位更新（白名單）
const COLMAP = { ws: { level: 'level', wins: 'wins', races: 'races' }, sc: { level: 'sc_level', wins: 'sc_wins', races: 'sc_races' } };
async function setLevel(game, name, level) {
  const col = COLMAP[game].level;
  if (pool) await pool.query(`UPDATE watersort_players SET ${col}=GREATEST(${col},$2), ${game === 'ws' ? 'updated_at' : 'sc_updated'}=now() WHERE name=$1`, [name, level]);
  else { const p = mem.players.get(name); if (p) p[col] = Math.max(p[col], level); }
}
async function addStats(name, inc) {
  const keys = Object.keys(inc).filter(k => ['wins', 'races', 'sc_wins', 'sc_races', 'cr_wins', 'cr_games', 'cr_ai'].includes(k));
  if (!keys.length) return;
  if (pool) await pool.query(`UPDATE watersort_players SET ${keys.map((k, i) => `${k}=${k}+$${i + 2}`).join(',')} WHERE name=$1`, [name, ...keys.map(k => inc[k])]);
  else { const p = mem.players.get(name); if (p) keys.forEach(k => { p[k] += inc[k]; }); }
}
async function saveDaily(game, day, name, ms, moves) {
  const t = game === 'ws' ? 'watersort_daily' : 'screws_daily';
  if (pool) {
    await pool.query(`INSERT INTO ${t}(day,name,ms,moves) VALUES($1,$2,$3,$4)
      ON CONFLICT(day,name) DO UPDATE SET ms=LEAST(${t}.ms,EXCLUDED.ms),
      moves=CASE WHEN EXCLUDED.ms < ${t}.ms THEN EXCLUDED.moves ELSE ${t}.moves END`, [day, name, ms, moves]);
  } else {
    const k = game + '|' + day + '|' + name, o = mem.daily.get(k);
    if (!o || ms < o.ms) mem.daily.set(k, { game, day, name, ms, moves });
  }
}
async function leaderboard(game, day) {
  if (pool) {
    const q = (sql, args) => pool.query(sql, args || []).then(r => r.rows);
    if (game === 'cr') return {
      wins: await q('SELECT name, cr_wins v, cr_games v2 FROM watersort_players WHERE cr_games>0 ORDER BY cr_wins DESC, cr_games ASC LIMIT 50'),
      ai: await q('SELECT name, cr_ai v FROM watersort_players WHERE cr_ai>0 ORDER BY cr_ai DESC LIMIT 50')
    };
    const c = COLMAP[game], t = game === 'ws' ? 'watersort_daily' : 'screws_daily', up = game === 'ws' ? 'updated_at' : 'sc_updated';
    return {
      level: await q(`SELECT name, ${c.level} v FROM watersort_players WHERE ${c.level}>1 ORDER BY ${c.level} DESC, ${up} ASC LIMIT 50`),
      daily: await q(`SELECT name, ms v FROM ${t} WHERE day=$1 ORDER BY ms ASC LIMIT 50`, [day]),
      wins: await q(`SELECT name, ${c.wins} v, ${c.races} v2 FROM watersort_players WHERE ${c.races}>0 ORDER BY ${c.wins} DESC, ${c.races} ASC LIMIT 50`)
    };
  }
  const ps = [...mem.players.values()];
  const top = (arr, f, s) => arr.filter(f).sort(s).slice(0, 50);
  if (game === 'cr') return {
    wins: top(ps, p => p.cr_games > 0, (a, b) => b.cr_wins - a.cr_wins || a.cr_games - b.cr_games).map(p => ({ name: p.name, v: p.cr_wins, v2: p.cr_games })),
    ai: top(ps, p => p.cr_ai > 0, (a, b) => b.cr_ai - a.cr_ai).map(p => ({ name: p.name, v: p.cr_ai }))
  };
  const c = COLMAP[game];
  return {
    level: top(ps, p => p[c.level] > 1, (a, b) => b[c.level] - a[c.level]).map(p => ({ name: p.name, v: p[c.level] })),
    daily: top([...mem.daily.values()], d => d.game === game && d.day === day, (a, b) => a.ms - b.ms).map(d => ({ name: d.name, v: d.ms })),
    wins: top(ps, p => p[c.races] > 0, (a, b) => b[c.wins] - a[c.wins] || a[c.races] - b[c.races]).map(p => ({ name: p.name, v: p[c.wins], v2: p[c.races] }))
  };
}
function taipeiDay() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
const statsOf = p => ({ ws_level: p.level, sc_level: p.sc_level, ws_wins: p.wins, sc_wins: p.sc_wins, cr_wins: p.cr_wins, cr_ai: p.cr_ai });

// ---------- 網頁 ----------
const FILES = ['index.html', 'watersort.html', 'screws.html', 'carrom.html', 'common.js', 'watersort-core.js', 'screws-core.js', 'carrom-core.js'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
FILES.forEach(f => app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f))));
app.get('/api/ping', (req, res) => res.json({ ok: true, game: 'mg', day: taipeiDay() }));

app.post('/api/login', async (req, res) => {
  try {
    const r = await auth(req.body.name, req.body.pin);
    if (r.error) return res.json({ ok: false, error: r.error });
    res.json({ ok: true, isNew: r.isNew, name: r.player.name, stats: statsOf(r.player), saves: r.player.saves || {} });
  } catch (e) { console.error(e); res.json({ ok: false, error: '伺服器忙碌，請稍後再試' }); }
});
app.post('/api/clear', async (req, res) => {
  try {
    const game = req.body.game; if (!CORE[game]) return res.json({ ok: false });
    const r = await auth(req.body.name, req.body.pin);
    if (r.error) return res.json({ ok: false, error: r.error });
    const lv = Math.floor(Number(req.body.level));
    if (!(lv >= 1 && lv <= 100000)) return res.json({ ok: false });
    const cur = r.player[COLMAP[game].level];
    if (lv > cur) return res.json({ ok: false, error: '關卡尚未解鎖' });
    if (!CORE[game].verify(CORE[game].campaign(lv), req.body.moves)) return res.json({ ok: false, error: '過關紀錄無效' });
    await setLevel(game, r.player.name, lv + 1);
    res.json({ ok: true, level: Math.max(cur, lv + 1) });
  } catch (e) { console.error(e); res.json({ ok: false }); }
});
app.post('/api/daily', async (req, res) => {
  try {
    const game = req.body.game; if (!CORE[game]) return res.json({ ok: false });
    const r = await auth(req.body.name, req.body.pin);
    if (r.error) return res.json({ ok: false, error: r.error });
    const day = String(req.body.day || '');
    if (day !== taipeiDay()) return res.json({ ok: false, error: '每日挑戰已換日' });
    const ms = Math.floor(Number(req.body.ms));
    if (!(ms >= 3000 && ms < 86400000)) return res.json({ ok: false });
    if (!CORE[game].verify(CORE[game].daily(day), req.body.moves)) return res.json({ ok: false, error: '紀錄無效' });
    await saveDaily(game, day, r.player.name, ms, req.body.moves.length);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.json({ ok: false }); }
});
// 記憶存檔：每款遊戲各存一份進行中的進度
app.post('/api/save', async (req, res) => {
  try {
    const game = req.body.game; if (!['ws', 'sc', 'cr'].includes(game)) return res.json({ ok: false });
    const data = req.body.data;
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 60000) return res.json({ ok: false });
    const r = await auth(req.body.name, req.body.pin);
    if (r.error) return res.json({ ok: false });
    const old = (r.player.saves || {})[game];
    if (old && (old.t || 0) > (data.t || 0)) return res.json({ ok: true, stale: true });
    if (pool) await pool.query(`UPDATE watersort_players SET saves = jsonb_set(COALESCE(saves,'{}'::jsonb), $2, $3::jsonb) WHERE name=$1`, [r.player.name, '{' + game + '}', JSON.stringify(data)]);
    else { r.player.saves = r.player.saves || {}; r.player.saves[game] = data; }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.json({ ok: false }); }
});
app.post('/api/cr/ai', async (req, res) => {
  try {
    const r = await auth(req.body.name, req.body.pin);
    if (r.error) return res.json({ ok: false });
    await addStats(r.player.name, { cr_ai: 1 }); res.json({ ok: true });
  } catch (e) { console.error(e); res.json({ ok: false }); }
});
app.get('/api/leaderboard', async (req, res) => {
  try {
    const game = ['ws', 'sc', 'cr'].includes(req.query.game) ? req.query.game : 'ws';
    res.json({ ok: true, day: taipeiDay(), ...(await leaderboard(game, taipeiDay())) });
  } catch (e) { console.error(e); res.json({ ok: false }); }
});

// ---------- 倒水瓶 / 螺絲：搶快對戰 ----------
const rooms = new Map(), codes = new Set();
function newCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (codes.has(c)); codes.add(c); return c; }
function roomInfo(room) {
  return { code: room.code, game: room.game, isPublic: room.isPublic, host: room.host, state: room.state, diff: room.diff,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, guest: p.guest })) };
}
const broadcastRoom = room => io.to('r' + room.code).emit('race:room', roomInfo(room));
function standings(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, guest: p.guest, done: p.done, ms: p.ms, prog: p.prog, total: room.total }))
    .sort((a, b) => (b.done - a.done) || (a.done ? a.ms - b.ms : b.prog - a.prog));
}
function armAuto(room) {
  if (room.isPublic && room.state === 'wait' && room.players.size >= 2 && !room.autoTimer) {
    io.to('r' + room.code).emit('race:auto', { inMs: 15000 });
    room.autoTimer = setTimeout(() => startRace(room), 15000);
  }
}
function leaveRoom(socket) {
  const code = socket.data.room; if (!code) return;
  const room = rooms.get(code); socket.data.room = null; socket.leave('r' + code);
  if (!room) return;
  room.players.delete(socket.id);
  if (!room.players.size) { clearTimeout(room.timer); clearTimeout(room.autoTimer); rooms.delete(code); codes.delete(code); return; }
  if (room.host === socket.id) room.host = room.players.keys().next().value;
  if (room.players.size < 2 && room.autoTimer) { clearTimeout(room.autoTimer); room.autoTimer = null; io.to('r' + room.code).emit('race:auto', { inMs: null }); }
  if (room.state === 'play') checkEnd(room);
  broadcastRoom(room);
}
function joinRoom(socket, room) {
  leaveRoom(socket); leaveCr(socket);
  room.players.set(socket.id, { id: socket.id, name: socket.data.name, guest: socket.data.guest, done: false, ms: 0, prog: 0 });
  socket.data.room = room.code; socket.join('r' + room.code);
  broadcastRoom(room); armAuto(room);
  if (room.players.size >= MAX_PLAYERS && room.state === 'wait') startRace(room);
}
function startRace(room) {
  if (room.state !== 'wait' || room.players.size < 2) return;
  clearTimeout(room.autoTimer); room.autoTimer = null;
  room.state = 'play';
  room.seed = crypto.randomInt(1, 2 ** 31);
  const core = CORE[room.game];
  room.level = core.race(room.seed, room.diff);
  room.total = room.game === 'ws' ? room.level.filter(b => b.length).length : room.level.planks.length;
  room.startAt = Date.now() + 3000;
  for (const p of room.players.values()) { p.done = false; p.ms = 0; p.prog = 0; }
  io.to('r' + room.code).emit('race:begin', { seed: room.seed, diff: room.diff, startIn: 3000, limit: RACE_LIMIT * 1000, level: room.game === 'sc' ? room.level : undefined });
  broadcastRoom(room);
  room.timer = setTimeout(() => endRace(room), 3000 + RACE_LIMIT * 1000 + 1000);
}
function checkEnd(room) {
  const ps = [...room.players.values()];
  if (ps.length && ps.every(p => p.done)) { clearTimeout(room.timer); setTimeout(() => endRace(room), 800); }
}
async function endRace(room) {
  if (room.state !== 'play') return;
  room.state = 'end';
  const ranking = standings(room);
  io.to('r' + room.code).emit('race:end', { ranking });
  const c = COLMAP[room.game];
  for (let i = 0; i < ranking.length; i++) {
    const r = ranking[i];
    if (!r.guest) { try { await addStats(r.name, { [c.races]: 1, [c.wins]: i === 0 && r.done && ranking.length > 1 ? 1 : 0 }); } catch (e) { console.error(e); } }
  }
  room.state = 'wait';
  broadcastRoom(room); armAuto(room);
}

// ---------- 克朗棋：一對一 ----------
const crRooms = new Map();
function crInfo(r) { return { code: r.code, isPublic: r.isPublic, players: r.players.map(p => ({ id: p.id, name: p.name, guest: p.guest })) }; }
function crBroadcast(r) { io.to('c' + r.code).emit('cr:room', crInfo(r)); }
function crStart(r) {
  r.state = 'play'; r.st = CR.newGame(); r.again = new Set();
  if (r.games) r.players.reverse(); // 再來一局：交換先後手
  r.games = (r.games || 0) + 1;
  const names = r.players.map(p => p.name);
  r.players.forEach((p, seat) => { const s = io.sockets.sockets.get(p.id); if (s) s.emit('cr:start', { state: r.st, seat, names, turnMs: CR_TURN_MS }); });
  crArmTurn(r, CR_TURN_MS);
}
function crArmTurn(r, ms) {
  clearTimeout(r.turnTimer);
  r.turnTimer = setTimeout(() => {
    if (r.state !== 'play') return;
    const st = CR.clone(r.st); st.turn = 1 - st.turn; st.pend = -1;
    if (r.st.pend >= 0) { st.p[0].in = 0; st.p[0].x = 0; st.p[0].y = 0; }
    r.st = st;
    io.to('c' + r.code).emit('cr:turn', { ms: CR_TURN_MS, state: st, msg: '超過時間，換對手出手' });
    crArmTurn(r, CR_TURN_MS);
  }, ms);
}
async function crFinish(r, winnerSeat, normal, reason) {
  if (r.state !== 'play') return;
  r.state = 'end'; clearTimeout(r.turnTimer);
  io.to('c' + r.code).emit('cr:end', { winner: winnerSeat, normal, reason });
  for (let s = 0; s < r.players.length; s++) {
    const p = r.players[s];
    if (!p.guest) { try { await addStats(p.name, { cr_games: 1, cr_wins: s === winnerSeat ? 1 : 0 }); } catch (e) { console.error(e); } }
  }
}
function leaveCr(socket) {
  const code = socket.data.cr; if (!code) return;
  socket.data.cr = null; socket.leave('c' + code);
  const r = crRooms.get(code); if (!r) return;
  const seat = r.players.findIndex(p => p.id === socket.id);
  if (seat < 0) return;
  if (r.state === 'play') crFinish(r, 1 - seat, false, '對手離開了，你獲勝！');
  r.players.splice(seat, 1); r.state = 'wait';
  if (!r.players.length) { clearTimeout(r.turnTimer); crRooms.delete(code); codes.delete(code); return; }
  crBroadcast(r);
}
function crJoin(socket, r) {
  leaveRoom(socket); leaveCr(socket);
  r.players.push({ id: socket.id, name: socket.data.name, guest: socket.data.guest });
  socket.data.cr = r.code; socket.join('c' + r.code);
  crBroadcast(r);
  if (r.players.length === 2) setTimeout(() => { if (r.players.length === 2 && r.state === 'wait') crStart(r); }, 1500);
}

io.on('connection', socket => {
  socket.data.name = '訪客' + Math.floor(100 + Math.random() * 900);
  socket.data.guest = true;
  socket.on('auth', async ({ name, pin, guestName } = {}, cb) => {
    try {
      if (name && pin) { const r = await auth(name, pin); if (!r.error) { socket.data.name = r.player.name; socket.data.guest = false; } }
      else if (guestName) { socket.data.name = cleanName(guestName) || socket.data.name; socket.data.guest = true; }
    } catch (e) { console.error(e); }
    cb && cb({ name: socket.data.name, guest: socket.data.guest });
  });
  const diffOk = d => (['easy', 'normal', 'hard'].includes(d) ? d : 'normal');
  const gameOk = g => (g === 'sc' ? 'sc' : 'ws');
  socket.on('race:quick', ({ game, diff } = {}) => {
    game = gameOk(game); diff = diffOk(diff);
    let room = [...rooms.values()].find(r => r.isPublic && r.game === game && r.diff === diff && r.state === 'wait' && r.players.size < MAX_PLAYERS);
    if (!room) { room = { code: newCode(), game, isPublic: true, diff, host: socket.id, state: 'wait', players: new Map() }; rooms.set(room.code, room); }
    joinRoom(socket, room);
  });
  socket.on('race:create', ({ game, diff } = {}) => {
    const room = { code: newCode(), game: gameOk(game), isPublic: false, diff: diffOk(diff), host: socket.id, state: 'wait', players: new Map() };
    rooms.set(room.code, room); joinRoom(socket, room);
  });
  socket.on('race:join', ({ code, game } = {}, cb) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return cb && cb({ ok: false, error: '找不到這個房號' });
    if (game && room.game !== gameOk(game)) return cb && cb({ ok: false, error: '這是別款遊戲的房間' });
    if (room.state !== 'wait') return cb && cb({ ok: false, error: '這個房間正在比賽中' });
    if (room.players.size >= MAX_PLAYERS) return cb && cb({ ok: false, error: '房間已滿' });
    joinRoom(socket, room); cb && cb({ ok: true });
  });
  socket.on('race:diff', ({ diff } = {}) => {
    const room = rooms.get(socket.data.room);
    if (room && room.host === socket.id && !room.isPublic && room.state === 'wait') { room.diff = diffOk(diff); broadcastRoom(room); }
  });
  socket.on('race:start', () => { const room = rooms.get(socket.data.room); if (room && room.host === socket.id) startRace(room); });
  socket.on('race:prog', ({ prog } = {}) => {
    const room = rooms.get(socket.data.room); if (!room || room.state !== 'play') return;
    const p = room.players.get(socket.id); if (!p || p.done) return;
    p.prog = Math.max(0, Math.min(room.total, prog | 0));
  });
  socket.on('race:done', ({ moves } = {}, cb) => {
    const room = rooms.get(socket.data.room); if (!room || room.state !== 'play') return cb && cb({ ok: false });
    const p = room.players.get(socket.id); if (!p || p.done) return cb && cb({ ok: false });
    if (!CORE[room.game].verify(room.level, moves)) return cb && cb({ ok: false, error: '紀錄無效' });
    p.done = true; p.prog = room.total; p.ms = Math.max(0, Date.now() - room.startAt);
    cb && cb({ ok: true, ms: p.ms, place: [...room.players.values()].filter(x => x.done).length });
    checkEnd(room);
  });
  socket.on('race:leave', () => leaveRoom(socket));

  // 克朗棋
  socket.on('cr:quick', () => {
    let r = [...crRooms.values()].find(x => x.isPublic && x.state === 'wait' && x.players.length < 2);
    if (!r) { r = { code: newCode(), isPublic: true, state: 'wait', players: [] }; crRooms.set(r.code, r); }
    crJoin(socket, r);
  });
  socket.on('cr:create', () => { const r = { code: newCode(), isPublic: false, state: 'wait', players: [] }; crRooms.set(r.code, r); crJoin(socket, r); });
  socket.on('cr:join', ({ code } = {}, cb) => {
    const r = crRooms.get(String(code || '').trim());
    if (!r) return cb && cb({ ok: false, error: '找不到這個房號' });
    if (r.players.length >= 2) return cb && cb({ ok: false, error: '房間已滿' });
    crJoin(socket, r); cb && cb({ ok: true });
  });
  socket.on('cr:move', ({ x } = {}) => {
    const r = crRooms.get(socket.data.cr); if (!r || r.state !== 'play') return;
    const seat = r.players.findIndex(p => p.id === socket.id); if (seat !== r.st.turn) return;
    const v = Number(x); if (isFinite(v)) socket.to('c' + r.code).emit('cr:move', { seat, x: Math.max(-CR.BX, Math.min(CR.BX, v)) });
  });
  socket.on('cr:shot', (shot = {}) => {
    const r = crRooms.get(socket.data.cr); if (!r || r.state !== 'play') return;
    const seat = r.players.findIndex(p => p.id === socket.id);
    if (!CR.validShot(r.st, seat, shot)) return socket.emit('cr:error', { msg: '現在不能出手' });
    const s = { x: Number(shot.x), vx: Number(shot.vx), vy: Number(shot.vy) };
    const before = r.st, sim = new CR.Sim(before, s, seat).run(), after = CR.applyShot(before, seat, sim);
    r.st = after;
    io.to('c' + r.code).emit('cr:shot', { seat, shot: s, before, after });
    const animMs = sim.steps / 240 * 1000 + 800;
    if (after.winner >= 0) { setTimeout(() => crFinish(r, after.winner, true), animMs); return; }
    crArmTurn(r, CR_TURN_MS + animMs);
    setTimeout(() => { if (r.state === 'play') io.to('c' + r.code).emit('cr:turn', { ms: CR_TURN_MS }); }, animMs);
  });
  socket.on('cr:again', () => {
    const r = crRooms.get(socket.data.cr); if (!r || r.state === 'play') return;
    r.again = r.again || new Set(); r.again.add(socket.id);
    if (r.players.length === 2 && r.players.every(p => r.again.has(p.id))) crStart(r);
  });
  socket.on('cr:leave', () => leaveCr(socket));
  socket.on('disconnect', () => { leaveRoom(socket); leaveCr(socket); });
});

setInterval(() => {
  for (const room of rooms.values()) if (room.state === 'play') io.to('r' + room.code).emit('race:standings', standings(room));
}, 1000);

const PORT = process.env.PORT || 3000;
initDb().catch(e => console.error('資料庫初始化失敗', e)).finally(() => {
  server.listen(PORT, () => console.log('繽紛遊戲屋 伺服器啟動，連接埠 ' + PORT));
});
