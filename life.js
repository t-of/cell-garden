// CELL GARDEN の中身（盤・1 世代・くり返しの見分け・かたち・保存と URL の読み書き）。
// DOM には触らない。ブラウザでは main.js から、テストでは node test.mjs から読む。
// ルールはコンウェイのライフゲーム（B3/S23）。上下・左右の端はつながっている。

export const SIZES = [32, 64, 128];   // 盤の大きさ（小・中・大）
export const MAX_HISTORY = 20000;     // くり返しの見分けに覚える世代の数

// ---- かたち ----
// マスの並びは数学の事実。O が生きているマス。
const SHAPE_ROWS = {
  glider: ['.O.', '..O', 'OOO'],
  lwss: ['.O..O', 'O....', 'O...O', 'OOOO.'],
  blinker: ['OOO'],
  pulsar: [
    '..OOO...OOO..',
    '.............',
    'O....O.O....O',
    'O....O.O....O',
    'O....O.O....O',
    '..OOO...OOO..',
    '.............',
    '..OOO...OOO..',
    'O....O.O....O',
    'O....O.O....O',
    'O....O.O....O',
    '.............',
    '..OOO...OOO..',
  ],
  row10: ['OOOOOOOOOO'],
  'r-pentomino': ['.OO', 'OO.', '.O.'],
  diehard: ['......O.', 'OO......', '.O...OOO'],
  acorn: ['.O.....', '...O...', 'OO..OOO'],
  'gosper-gun': [
    '........................O...........',
    '......................O.O...........',
    '............OO......OO............OO',
    '...........O...O....OO............OO',
    'OO........O.....O...OO..............',
    'OO........O...O.OO....O.O...........',
    '..........O.....O.......O...........',
    '...........O...O....................',
    '............OO......................',
  ],
};

export const SHAPES = [
  { id: 'glider', name: 'グライダー', note: '4 世代で斜めに 1 マス進む' },
  { id: 'lwss', name: '宇宙船', note: '4 世代で横に 2 マス進む' },
  { id: 'blinker', name: 'ブリンカー', note: '2 世代ごとに縦と横を行き来する' },
  { id: 'pulsar', name: 'パルサー', note: '3 世代ごとにくり返す' },
  { id: 'row10', name: '15 周期', note: '10 マスの横一列が、15 世代ごとにくり返す形に育つ' },
  { id: 'r-pentomino', name: 'R ペントミノ', note: '5 マスなのに長く暴れる' },
  { id: 'diehard', name: '消える種', note: '130 世代で全部消える' },
  { id: 'acorn', name: 'どんぐり', note: '7 マスから長く育つ' },
  { id: 'gosper-gun', name: 'グライダー銃', note: '30 世代ごとにグライダーを撃つ' },
].map((s) => {
  const rows = SHAPE_ROWS[s.id];
  const cells = [];
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'O') cells.push([x, y]); });
  return { ...s, w: rows[0].length, h: rows.length, cells };
});

export const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;

// 90° × rot だけ右に回した形（{ w, h, cells }）
export function rotate(shape, rot) {
  let { w, h, cells } = shape;
  for (let k = 0; k < (rot & 3); k++) {
    cells = cells.map(([x, y]) => [h - 1 - y, x]);
    [w, h] = [h, w];
  }
  return { w, h, cells };
}

// ---- 盤 ----

export function newWorld(n) {
  return {
    n,
    grid: new Uint8Array(n * n),
    next: new Uint8Array(n * n),
    gen: 0,
    alive: 0,
    origin: null,          // 世代 0 から進めたときの盤（「はじめから」で戻る先）
    history: new Map(),    // 指紋 → 世代
    cycle: null,           // 見分けたくり返し { start, p }。見分けたあとは覚えるのをやめる
  };
}

// 盤を描き直したとき: 世代を 0 に戻し、見分けをやり直す
export function edited(w) {
  w.gen = 0;
  w.origin = null;
  w.history.clear();
  w.cycle = null;
  w.alive = count(w.grid);
}

const count = (g) => { let a = 0; for (let i = 0; i < g.length; i++) a += g[i]; return a; };

export function setCell(w, x, y, v) {
  const i = y * w.n + x;
  if (w.grid[i] === v) return false;
  w.grid[i] = v;
  return true;
}

export function clear(w) {
  w.grid.fill(0);
  edited(w);
}

export function randomize(w, rand = Math.random, p = 0.3) {
  for (let i = 0; i < w.grid.length; i++) w.grid[i] = rand() < p ? 1 : 0;
  edited(w);
}

export const fits = (w, shape) => shape.w <= w.n && shape.h <= w.n;

// (cx, cy) を中心に形を置く。囲む四角をいったん空にしてから置く。端をまたぐときはつながった先に置く
export function place(w, shape, cx, cy) {
  const { n, grid } = w;
  const x0 = cx - (shape.w >> 1), y0 = cy - (shape.h >> 1);
  const at = (x, y) => ((y0 + y) % n + n) % n * n + ((x0 + x) % n + n) % n;
  for (let y = 0; y < shape.h; y++) for (let x = 0; x < shape.w; x++) grid[at(x, y)] = 0;
  for (const [x, y] of shape.cells) grid[at(x, y)] = 1;
  edited(w);
}

// 盤の指紋: 32 ビットのハッシュ 2 種類（FNV-1a と、生きているマスの番号を混ぜるもの）
export function fingerprint(g) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < g.length; i++) {
    a = Math.imul(a ^ g[i], 0x01000193);
    if (g[i]) { b = Math.imul(b ^ i, 0x85ebca6b); b ^= b >>> 13; }
  }
  return `${a >>> 0}.${b >>> 0}`;
}

function remember(w) {
  w.history.set(fingerprint(w.grid), w.gen);
  if (w.history.size > MAX_HISTORY) w.history.delete(w.history.keys().next().value);   // 古いものから捨てる
}

// 1 世代進める。くり返しを新しく見分けたら true を返す（w.cycle に入る）
export function step(w) {
  const { n, grid, next } = w;
  if (w.gen === 0) w.origin = grid.slice();
  if (!w.cycle && w.history.size === 0) remember(w);
  let alive = 0;
  for (let y = 0; y < n; y++) {
    const up = ((y + n - 1) % n) * n, row = y * n, down = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const l = (x + n - 1) % n, r = (x + 1) % n;
      const s = grid[up + l] + grid[up + x] + grid[up + r]
        + grid[row + l] + grid[row + r]
        + grid[down + l] + grid[down + x] + grid[down + r];
      const v = s === 3 || (s === 2 && grid[row + x]) ? 1 : 0;
      next[row + x] = v;
      alive += v;
    }
  }
  w.grid = next;
  w.next = grid;
  w.gen++;
  w.alive = alive;
  if (w.cycle) return false;
  const seen = w.history.get(fingerprint(w.grid));
  if (seen !== undefined) w.cycle = { start: seen, p: w.gen - seen };
  else if (alive === 0) w.cycle = { start: w.gen, p: 1 };   // 空の盤は動かない。1 世代待たずに止める
  else { remember(w); return false; }
  return true;
}

// 「はじめから」: 世代 0 の盤に戻す（まだ進めていなければそのまま）
export function reset(w) {
  if (w.origin) w.grid.set(w.origin);
  edited(w);
}

// 見分けの結果の文（盤の上と上の帯に出す）
export function cycleText(w) {
  const c = w.cycle;
  if (!c) return '';
  const g = c.start.toLocaleString('ja-JP');
  if (w.alive === 0) return `${g} 世代で全部消えた`;
  if (c.p === 1) return `${g} 世代から動かなくなった`;
  return `${g} 世代から ${c.p.toLocaleString('ja-JP')} 世代ごとのくり返し`;
}

// ---- 保存（cell-garden.settings）と URL ----

export const DEFAULT_SETTINGS = { v: 1, size: 1, speed: 1, sound: true, seenHelp: false };

// 保存した文字列を読む。読めない・範囲外の値は初期値にする
export function readSettings(raw) {
  let o;
  try { o = JSON.parse(raw); } catch { o = null; }
  if (!o || typeof o !== 'object') return { ...DEFAULT_SETTINGS };
  const int = (v, max, d) => (Number.isInteger(v) && v >= 0 && v <= max ? v : d);
  return {
    v: 1,
    size: int(o.size, 2, DEFAULT_SETTINGS.size),
    speed: int(o.speed, 3, DEFAULT_SETTINGS.speed),
    sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_SETTINGS.sound,
    seenHelp: o.seenHelp === true,
  };
}

// location.search の ?p= を読む。知らない id は null（無視する）
export function shapeFromSearch(search) {
  const s = shapeById(new URLSearchParams(search).get('p'));
  return s ? s.id : null;
}

export const shareUrl = (base, shapeId) => (shapeId ? `${base}?p=${shapeId}` : base);
