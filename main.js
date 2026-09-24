// 画面と操作。中身（盤・1 世代・くり返しの見分け・かたち・保存と URL の読み書き）は life.js にある。
import {
  SIZES, SHAPES, shapeById, rotate, newWorld, edited, setCell, clear, randomize, fits, place, step, reset, cycleText,
  readSettings, shapeFromSearch, shareUrl,
} from './life.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'cell-garden.' で始める。
const STORE = 'cell-garden.';

function loadRaw(key) {
  try { return localStorage.getItem(STORE + key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

const DESC = 'マスがまわりの数だけで生まれたり消えたりをくり返す「ライフゲーム」。指で描くか、グライダーなどの有名な形を置いて、動き出す模様を眺める。';
WebAppKit.init({ title: 'CELL GARDEN', text: DESC });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('ja-JP');

// マスは 2 色だけ。ImageData に書くための 32 bit 値（リトルエンディアンなので ABGR の順）
const LIVE = '#a6e36e', DEAD = '#14261c';
const to32 = (h) => (0xff << 24 | parseInt(h.slice(5, 7), 16) << 16 | parseInt(h.slice(3, 5), 16) << 8 | parseInt(h.slice(1, 3), 16)) >>> 0;
const LIVE32 = to32(LIVE), DEAD32 = to32(DEAD);

const RATE = [2, 8, 30, 240];   // 1 秒あたりの世代
const MAX_PER_FRAME = 8;        // 1 フレームで進める世代の上限（遅い端末で画面を固めない）
const HINT = 'くり返しに入ったら止まる';

const settings = readSettings(loadRaw('settings'));
const store = () => save('settings', settings);
const urlShape = shapeFromSearch(location.search);   // ?p= があれば、その形を中の盤の真ん中に置いて始める
if (urlShape) settings.size = 1;

// ---- 音 ----
// 音声ファイルは使わず Web Audio で作る。オン・オフは settings.sound に覚える

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(on) {
  try { if (navigator.audioSession) navigator.audioSession.type = on ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
setAudioSession(settings.sound);

let actxAudio = null, master = null, lastSound = 0, lastDot = 0;
// ブラウザは触る前の音を止めるので、AudioContext は最初に触ったときに作る
function unlockAudio() {
  if (!settings.sound) return;
  setAudioSession(true);
  if (!actxAudio) {
    try { actxAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    master = actxAudio.createGain();
    master.gain.value = 0.5;
    master.connect(actxAudio.destination);
  }
  if (actxAudio.state === 'suspended') actxAudio.resume();
}
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);

// 短い音を 1 つ。notes = [[周波数, 開始の遅れ(秒)], …]
function tone(notes, { dur = 0.12, type = 'sine', gain = 0.08 } = {}) {
  if (!settings.sound || !actxAudio) return;
  const now = actxAudio.currentTime;
  if (now - lastSound < 0.04) return;   // 連打・キーの押しっぱなしで重ねない
  lastSound = now;
  for (const [f, at = 0] of notes) {
    const t = now + at;
    const o = actxAudio.createOscillator(), g = actxAudio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}
const sfx = {
  // なぞって描く: 60ms に 1 回まで。消すときは少し低く
  dot: (v) => {
    if (!actxAudio || actxAudio.currentTime - lastDot < 0.06) return;
    lastDot = actxAudio.currentTime;
    tone([[v ? 988 : 587.33]], { dur: 0.05, gain: 0.035 });
  },
  // 置く: 大きい形ほど少し低く
  place: (cells) => tone([[880 - Math.min(cells, 48) * 8], [1318.5 - Math.min(cells, 48) * 12, 0.03]], { dur: 0.12, type: 'triangle', gain: 0.06 }),
  play: () => tone([[523.25], [783.99, 0.07]], { dur: 0.14, type: 'triangle' }),
  pause: () => tone([[659.25], [440, 0.07]], { dur: 0.14, type: 'triangle' }),
  step: () => tone([[1318.5]], { dur: 0.04, gain: 0.05 }),
  reset: () => tone([[392], [587.33, 0.05]], { dur: 0.1, type: 'triangle', gain: 0.06 }),
  random: () => tone([[523.25], [783.99, 0.03], [659.25, 0.06], [1046.5, 0.09]], { dur: 0.08, type: 'triangle', gain: 0.05 }),
  clear: () => tone([[784], [587.33, 0.05], [392, 0.1]], { dur: 0.12, type: 'triangle', gain: 0.06 }),
  cycle: () => tone([[523.25], [659.25], [783.99], [1046.5, 0.04]], { dur: 0.7, gain: 0.04 }),
  dead: () => tone([[293.66], [196, 0.14]], { dur: 0.28, type: 'triangle', gain: 0.07 }),
  ui: (n) => tone([[440 * 2 ** (n * 4 / 12)]], { dur: 0.06, gain: 0.06 }),
};

function renderSound() {
  $('soundBtn').setAttribute('aria-pressed', String(settings.sound));
  $('soundBtn').setAttribute('aria-label', settings.sound ? '音: オン' : '音: オフ');
  $('soundIcon').innerHTML = settings.sound
    ? '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.3 6a8.5 8.5 0 0 1 0 12"/>'
    : '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9.5 5 5m0-5-5 5"/>';
}
$('soundBtn').addEventListener('click', () => {
  settings.sound = !settings.sound;
  store();
  setAudioSession(settings.sound);
  renderSound();
  if (settings.sound) { unlockAudio(); sfx.ui(1); }
});
renderSound();

// ---- 盤の描画 ----
// 盤は 1 マス = 1 点の Canvas を CSS で拡大する。格子の線と置く前の影は、画面の解像度の Canvas に重ねる
const cells = $('cells');
const cctx = cells.getContext('2d');
const over = $('over');
const octx = over.getContext('2d');
let world, img, px;
let ghost = null;   // 置く前の影 { x, y }

function draw() {
  const g = world.grid;
  for (let i = 0; i < g.length; i++) px[i] = g[i] ? LIVE32 : DEAD32;
  cctx.putImageData(img, 0, 0);
  $('gen').textContent = fmt(world.gen);
  $('alive').textContent = fmt(world.alive);
  const note = cycleText(world);
  $('note').textContent = note || HINT;
  $('note').classList.toggle('is-hit', !!note);
}

function drawOver() {
  const W = over.width, n = world.n, cs = W / n;
  octx.clearRect(0, 0, W, W);
  const cellRect = (x, y) => {
    x = (x % n + n) % n; y = (y % n + n) % n;   // 端をまたぐときはつながった先に
    const a = Math.round(x * cs), b = Math.round(y * cs);
    octx.fillRect(a, b, Math.round((x + 1) * cs) - a, Math.round((y + 1) * cs) - b);
  };
  if (n === SIZES[0]) {   // 小の盤だけ薄い格子の線（描きやすく）
    octx.fillStyle = 'rgba(220, 255, 220, 0.07)';
    for (let k = 1; k < n; k++) {
      const p = Math.round(k * cs);
      octx.fillRect(p, 0, 1, W);
      octx.fillRect(0, p, W, 1);
    }
  }
  if (ghost && placing()) {
    const s = shapeNow();
    const x0 = ghost.x - (s.w >> 1), y0 = ghost.y - (s.h >> 1);
    octx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) cellRect(x0 + x, y0 + y);
    octx.fillStyle = 'rgba(236, 255, 214, 0.55)';
    for (const [x, y] of s.cells) cellRect(x0 + x, y0 + y);
  }
}

new ResizeObserver(() => {
  const w = Math.round(cells.getBoundingClientRect().width * (devicePixelRatio || 1));
  if (w > 0 && w !== over.width) { over.width = over.height = w; drawOver(); }
}).observe(cells);

function newBoard() {
  world = newWorld(SIZES[settings.size]);
  cells.width = cells.height = world.n;
  img = cctx.createImageData(world.n, world.n);
  px = new Uint32Array(img.data.buffer);
  renderShapes();
  draw();
  drawOver();
}

// ---- 動かす ----
let playing = false;
let acc = 0, last = 0, loop = 0;
let msgTimer = 0;

function showMsg(text) {
  $('msg').textContent = text;
  $('msg').hidden = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').hidden = true; }, 2000);
}

// くり返しを見分けたら止めて、盤の上に短く出す（上の帯には残る）
function hit() {
  setPlaying(false);
  draw();
  showMsg(cycleText(world));
  (world.alive === 0 ? sfx.dead : sfx.cycle)();
}

// id: 止めてすぐ動かしたときに、前のループが残って 2 重に進まないように
function frame(id, t) {
  if (!playing || id !== loop) return;
  acc += RATE[settings.speed] * Math.min((t - last) / 1000, 0.1);   // 裏に回って戻ったときにまとめて進めない
  last = t;
  const n = Math.min(Math.floor(acc), MAX_PER_FRAME);
  acc = Math.min(acc - n, 1);
  for (let i = 0; i < n; i++) if (step(world)) { hit(); return; }
  if (n) draw();
  requestAnimationFrame((t2) => frame(id, t2));
}

function setPlaying(on) {
  if (on === playing) return;
  playing = on;
  $('play').textContent = on ? '⏸' : '▶';
  $('play').setAttribute('aria-label', on ? '止める' : '再生');
  if (on) {
    const id = ++loop;
    requestAnimationFrame((t) => { last = t; frame(id, t); });
  }
}

// 空の盤は動かしても何も起きないので、描き方を知らせる
function hasCells() {
  if (world.alive) return true;
  WebAppKit.toast('盤をなぞって描くか、かたちを置く');
  return false;
}

function toggle() {
  if (!playing && !hasCells()) return;
  $('msg').hidden = true;
  setPlaying(!playing);
  (playing ? sfx.play : sfx.pause)();
}
$('play').addEventListener('click', toggle);
$('step').addEventListener('click', () => {
  setPlaying(false);
  if (!hasCells()) return;
  if (step(world)) hit();
  else { draw(); sfx.step(); }
});
$('reset').addEventListener('click', () => { reset(world); acc = 0; draw(); sfx.reset(); });

function renderSpeed() {
  for (const b of $('speed').children) b.setAttribute('aria-pressed', String(+b.dataset.speed === settings.speed));
}
$('speed').addEventListener('click', (e) => {
  const b = e.target.closest('[data-speed]');
  if (!b) return;
  settings.speed = +b.dataset.speed;
  acc = 0;
  store();
  renderSpeed();
  sfx.ui(settings.speed);
});

// ---- 道具 ----
let tool = null;     // 選んでいる形の id（null なら「描く」）
let rot = 0;         // 回した向き。形を選び直すまで覚える
let lastShape = urlShape;   // 共有の URL に付ける

const placing = () => tool !== null;
const shapeNow = () => rotate(shapeById(tool), rot);

$('random').addEventListener('click', () => { randomize(world); draw(); sfx.random(); });
$('clear').addEventListener('click', () => { setPlaying(false); clear(world); draw(); sfx.clear(); });

function renderSizes() {
  for (const b of $('sizes').children) b.setAttribute('aria-pressed', String(+b.dataset.size === settings.size));
}
$('sizes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-size]');
  if (!b || +b.dataset.size === settings.size) return;
  settings.size = +b.dataset.size;
  store();
  setPlaying(false);
  renderSizes();
  newBoard();   // 大きさを変えると盤は空になる
  sfx.ui(settings.size);
});

function selectTool(id) {
  tool = id;
  rot = 0;
  if (id) lastShape = id;
  ghost = null;
  renderShapes();
  drawOver();
}
$('draw').addEventListener('click', () => { selectTool(null); sfx.ui(0); });
$('rotate').addEventListener('click', () => { rot = (rot + 1) & 3; drawOver(); sfx.ui(2); });

// かたちのボタン: 小さな絵と名前
$('shapes').replaceChildren(...SHAPES.map((s) => {
  const b = document.createElement('button');
  b.className = 'shape';
  b.dataset.id = s.id;
  b.setAttribute('aria-label', `${s.name}: ${s.note}`);
  const c = document.createElement('canvas');
  c.width = c.height = 80;
  const x = c.getContext('2d');
  const cs = Math.min(80 / Math.max(s.w, s.h), 16);
  const d = cs > 4 ? cs - 1 : cs;   // 大きいマスは 1 点すき間をあける
  const ox = (80 - s.w * cs) / 2, oy = (80 - s.h * cs) / 2;
  x.fillStyle = LIVE;
  for (const [cx, cy] of s.cells) x.fillRect(ox + cx * cs, oy + cy * cs, d, d);
  b.append(c, s.name);
  b.addEventListener('click', () => { selectTool(tool === s.id ? null : s.id); sfx.ui(tool ? 3 : 0); });
  return b;
}));

function renderShapes() {
  if (tool && !fits(world, shapeById(tool))) { tool = null; ghost = null; }
  for (const b of $('shapes').children) {
    b.setAttribute('aria-pressed', String(b.dataset.id === tool));
    b.disabled = !fits(world, shapeById(b.dataset.id));
  }
  $('draw').setAttribute('aria-pressed', String(!tool));
  $('rotate').hidden = !tool;
  $('shapeNote').textContent = tool ? shapeById(tool).note : '選んで盤をタップすると置ける';
}

// ---- 盤をなぞる・タップする ----
// 描く: 最初に触れたマスが空きなら描く、生きていれば消す。指を離すまで同じ。
// 置く: 押している間は影を見せ、離したところに置く
const board = $('board');
let drag = null;   // { v, x, y }（描く）か { place: true }

function cellAt(e) {
  const r = cells.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / r.width * world.n), Math.floor((e.clientY - r.top) / r.height * world.n)];
}
const inside = (x, y) => x >= 0 && y >= 0 && x < world.n && y < world.n;

// 前の点と今の点の間のマスも塗る（速くなぞっても線が切れないように）
function paintLine(x0, y0, x1, y1, v) {
  const k = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  let changed = false;
  for (let t = 0; t <= k; t++) {
    const x = Math.round(x0 + (x1 - x0) * t / k), y = Math.round(y0 + (y1 - y0) * t / k);
    if (inside(x, y) && setCell(world, x, y, v)) changed = true;
  }
  if (!changed) return;
  edited(world);
  draw();
  sfx.dot(v);
}

board.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  board.setPointerCapture(e.pointerId);
  const [x, y] = cellAt(e);
  if (!inside(x, y)) return;
  if (placing()) {
    drag = { place: true };
    ghost = { x, y };
    drawOver();
    return;
  }
  drag = { v: world.grid[y * world.n + x] ? 0 : 1, x, y };
  paintLine(x, y, x, y, drag.v);
});
board.addEventListener('pointermove', (e) => {
  const [x, y] = cellAt(e);
  if (drag && !drag.place) {
    paintLine(drag.x, drag.y, x, y, drag.v);
    drag.x = x; drag.y = y;
  } else if (placing() && (drag || e.pointerType === 'mouse')) {   // マウスは押す前から影を見せる
    ghost = inside(x, y) ? { x, y } : null;
    drawOver();
  }
});
board.addEventListener('pointerup', (e) => {
  if (drag?.place && ghost) {
    const s = shapeNow();
    place(world, s, ghost.x, ghost.y);
    draw();
    sfx.place(s.cells.length);
  }
  drag = null;
  if (e.pointerType !== 'mouse') ghost = null;
  drawOver();
});
board.addEventListener('pointercancel', () => { drag = null; ghost = null; drawOver(); });
board.addEventListener('pointerleave', (e) => {
  if (!drag && e.pointerType === 'mouse' && ghost) { ghost = null; drawOver(); }
});

// 共有: webapp-kit が document で拾う前に、今の様子を入れておく
$('share').addEventListener('click', () => {
  const c = world.cycle;
  const what = c && world.alive && c.p > 1
    ? `${fmt(c.start)} 世代から ${fmt(c.p)} 世代ごとのくり返しに入った`
    : c ? cycleText(world) : `${fmt(world.gen)} 世代まで育てた`;
  WebAppKit.init({
    text: `CELL GARDEN で ${what}（生きている ${fmt(world.alive)}）`,
    url: shareUrl(location.origin + location.pathname, lastShape),
  });
});

// ---- 遊び方 ----
function openHelp() { $('help').hidden = false; $('helpClose').focus(); }
function closeHelp() {
  $('help').hidden = true;
  if (!settings.seenHelp) {
    settings.seenHelp = true;
    store();
    if (!urlShape) { setPlaying(true); sfx.play(); }
  }
}
$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('help').addEventListener('click', (e) => { if (e.target === $('help')) closeHelp(); });

// PC: Space で再生・停止、→ で 1 世代。ボタンにフォーカスがあっても Space は再生・停止にする
// （ボタンは keyup の Space で押されるので、keyup も止める）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('help').hidden) { closeHelp(); return; }
  if (!$('help').hidden) return;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) toggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('step').click(); }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && $('help').hidden) e.preventDefault();
});

// ---- はじめ ----
// ?p= があればその形を真ん中に置いて止まったまま。なければランダムな盤から動かす
renderSpeed();
renderSizes();
newBoard();
if (urlShape) place(world, shapeById(urlShape), world.n >> 1, world.n >> 1);
else randomize(world);
draw();
if (!settings.seenHelp) openHelp();
else if (!urlShape) setPlaying(true);
