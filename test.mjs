// 中身のテスト。node test.mjs で走る（フレームワークなし）。
import assert from 'node:assert/strict';
import {
  SIZES, MAX_HISTORY, SHAPES, shapeById, rotate, newWorld, edited, setCell, clear, randomize, fits, place, step, reset, cycleText,
  readSettings, shapeFromSearch, shareUrl, DEFAULT_SETTINGS,
} from './life.js';

const test = (name, fn) => { fn(); console.log('✓', name); };
const run = (w, n) => { for (let i = 0; i < n; i++) step(w); };
// くり返しを見分けるまで進める（limit 世代まで）
const untilCycle = (w, limit) => { while (w.gen < limit) if (step(w)) return w.cycle; return null; };
const cellsOf = (w) => {
  const out = [];
  for (let i = 0; i < w.grid.length; i++) if (w.grid[i]) out.push([i % w.n, Math.floor(i / w.n)]);
  return out;
};
const key = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');
const shifted = (cells, dx, dy, n) => cells.map(([x, y]) => [(x + dx + n) % n, (y + dy + n) % n]);
const S = (id) => shapeById(id);

test('かたちは 9 つ。大きさとマスの数', () => {
  assert.deepEqual(SHAPES.map((s) => s.id), ['glider', 'lwss', 'blinker', 'pulsar', 'row10', 'r-pentomino', 'diehard', 'acorn', 'gosper-gun']);
  const dims = Object.fromEntries(SHAPES.map((s) => [s.id, [s.w, s.h, s.cells.length]]));
  assert.deepEqual(dims, {
    glider: [3, 3, 5], lwss: [5, 4, 9], blinker: [3, 1, 3], pulsar: [13, 13, 48], row10: [10, 1, 10],
    'r-pentomino': [3, 3, 5], diehard: [8, 3, 7], acorn: [7, 3, 7], 'gosper-gun': [36, 9, 36],
  });
  assert.ok(!SHAPES.some((s) => /ダイハード/.test(s.name)));
  assert.equal(S('diehard').name, '消える種');
});

test('1 世代: ルールは B3/S23（ブロックは動かず、ブリンカーは縦横を行き来）', () => {
  const w = newWorld(32);
  for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) setCell(w, x, y, 1);
  edited(w);
  const block = key(cellsOf(w));
  step(w);
  assert.equal(key(cellsOf(w)), block);
  const b = newWorld(32);
  place(b, S('blinker'), 10, 10);
  assert.equal(key(cellsOf(b)), key([[9, 10], [10, 10], [11, 10]]));
  step(b);
  assert.equal(key(cellsOf(b)), key([[10, 9], [10, 10], [10, 11]]));
  assert.equal(b.alive, 3);
});

test('端はつながる（左上の角のブロックは 4 隅に分かれても動かない）', () => {
  const w = newWorld(32);
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) setCell(w, x, y, 1);
  edited(w);
  run(w, 3);
  assert.equal(key(cellsOf(w)), key([[0, 0], [31, 0], [0, 31], [31, 31]]));
});

test('グライダーは 4 世代後に斜めに 1 マスずれて同じ形（端をまたいでも）', () => {
  for (const n of SIZES) {
    const w = newWorld(n);
    place(w, S('glider'), 1, 1);   // 左上の角にまたがる位置からでも
    let before = cellsOf(w);
    for (let k = 0; k < 3 * n; k++) {
      run(w, 4);
      const now = cellsOf(w);
      assert.equal(key(now), key(shifted(before, 1, 1, n)), `n=${n} k=${k}`);
      before = now;
    }
  }
});

test('宇宙船は 4 世代で横に 2 マス進む', () => {
  const w = newWorld(64);
  place(w, S('lwss'), 32, 32);
  let before = cellsOf(w);
  for (let k = 0; k < 20; k++) {
    run(w, 4);
    const now = cellsOf(w);
    assert.equal(key(now), key(shifted(before, -2, 0, 64)), `k=${k}`);
    before = now;
  }
});

test('ブリンカーは周期 2、パルサーは周期 3（世代 0 から見分けて止まる）', () => {
  const b = newWorld(32);
  place(b, S('blinker'), 16, 16);
  assert.deepEqual(untilCycle(b, 10), { start: 0, p: 2 });
  assert.equal(b.gen, 2);
  const p = newWorld(32);
  place(p, S('pulsar'), 16, 16);
  assert.deepEqual(untilCycle(p, 10), { start: 0, p: 3 });
  assert.equal(p.alive, 48);
});

test('10 マスの横一列は、しばらくして 15 世代ごとのくり返しになる', () => {
  const w = newWorld(64);
  place(w, S('row10'), 32, 32);
  const c = untilCycle(w, 200);
  assert.equal(c.p, 15);
  assert.ok(c.start > 0 && c.start < 30, `start=${c.start}`);
});

test('消える種は 128 × 128 の盤で 130 世代目に 0 になる', () => {
  const w = newWorld(128);
  place(w, S('diehard'), 64, 64);
  run(w, 129);
  assert.ok(w.alive > 0);
  assert.equal(w.cycle, null);
  assert.equal(step(w), true);
  assert.equal(w.gen, 130);
  assert.equal(w.alive, 0);
  assert.deepEqual(w.cycle, { start: 130, p: 1 });
  assert.equal(cycleText(w), '130 世代で全部消えた');
});

test('グライダー銃は 30 世代ごとにグライダーが 1 つ（5 マス）増える', () => {
  const w = newWorld(128);
  place(w, S('gosper-gun'), 30, 20);
  const start = w.alive;
  for (let k = 1; k <= 6; k++) {
    run(w, 30);
    assert.equal(w.alive, start + 5 * k, `${30 * k} 世代`);
  }
  assert.equal(w.cycle, null);
});

test('R ペントミノとどんぐりは長く暴れる（200 世代では落ち着かない）', () => {
  for (const id of ['r-pentomino', 'acorn']) {
    const w = newWorld(128);
    place(w, S(id), 64, 64);
    assert.equal(untilCycle(w, 200), null, id);
    assert.ok(w.alive > S(id).cells.length, id);
  }
});

test('くり返しの見分けは何世代ごとでも効く（グライダーの一周 = 4 × 盤の幅）', () => {
  for (const n of SIZES) {
    const w = newWorld(n);
    place(w, S('glider'), n >> 1, n >> 1);
    assert.deepEqual(untilCycle(w, 5 * n), { start: 0, p: 4 * n }, `n=${n}`);
  }
  // 2 つのくり返しが重なると周期は最小公倍数（ブリンカー 2 とパルサー 3 → 6）
  const w = newWorld(64);
  place(w, S('blinker'), 5, 5);
  place(w, S('pulsar'), 40, 40);
  assert.deepEqual(untilCycle(w, 20), { start: 0, p: 6 });
  assert.equal(cycleText(w), '0 世代から 6 世代ごとのくり返し');
});

test('動かなくなった・全部消えた（世代 0 がもうくり返しの形でも見分ける）', () => {
  const w = newWorld(32);
  for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6]]) setCell(w, x, y, 1);
  edited(w);
  assert.equal(step(w), true);
  assert.deepEqual(w.cycle, { start: 0, p: 1 });
  assert.equal(cycleText(w), '0 世代から動かなくなった');
  const e = newWorld(32);
  setCell(e, 3, 3, 1);
  edited(e);
  assert.equal(step(e), true);
  assert.deepEqual(e.cycle, { start: 1, p: 1 });
  assert.equal(cycleText(e), '1 世代で全部消えた');
});

test('見分けたあとは止めずに続く。盤を描き直すと見分けをやり直す', () => {
  const w = newWorld(32);
  place(w, S('blinker'), 16, 16);
  untilCycle(w, 10);
  for (let i = 0; i < 10; i++) assert.equal(step(w), false);
  assert.equal(w.gen, 12);
  setCell(w, 0, 0, 1);
  edited(w);
  assert.equal(w.gen, 0);
  assert.equal(w.cycle, null);
  assert.ok(untilCycle(w, 10));
});

test('覚える世代は最大 20,000。超えたら古いものから捨てる', () => {
  const w = newWorld(128);
  randomize(w, (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })());
  for (let g = 0; g < MAX_HISTORY + 5; g++) w.history.set(`x${g}`, g);
  assert.ok(w.history.size > MAX_HISTORY);
  step(w);   // 1 つ覚えるたびに、あふれた分を 1 つずつ捨てる
  assert.equal(w.history.size, MAX_HISTORY + 5);
  assert.ok(!w.history.has('x0'));
});

test('はじめから: 世代 0 から進めたときの盤に戻る', () => {
  const w = newWorld(64);
  place(w, S('r-pentomino'), 32, 32);
  const first = key(cellsOf(w));
  run(w, 50);
  reset(w);
  assert.equal(w.gen, 0);
  assert.equal(key(cellsOf(w)), first);
  // 途中で描き直したら、次に進めたときの盤が新しい「はじめ」になる
  run(w, 5);
  setCell(w, 0, 0, 1);
  edited(w);
  const drawn = key(cellsOf(w));
  run(w, 20);
  reset(w);
  assert.equal(key(cellsOf(w)), drawn);
});

test('置き方: 囲む四角を空にしてから置く。端をまたぐとつながった先へ', () => {
  const w = newWorld(32);
  for (let i = 0; i < w.grid.length; i++) w.grid[i] = 1;
  place(w, S('glider'), 0, 0);
  const box = [];
  for (const y of [31, 0, 1]) for (const x of [31, 0, 1]) box.push(w.grid[y * 32 + x]);
  assert.deepEqual(box, [0, 1, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(w.gen, 0);
  assert.equal(w.alive, 32 * 32 - 4);
});

test('回す: 90° ずつ。4 回で元に戻る', () => {
  const g = S('glider');
  const r1 = rotate(g, 1);
  assert.deepEqual([r1.w, r1.h], [3, 3]);
  assert.equal(key(r1.cells), key([[0, 0], [0, 1], [2, 1], [0, 2], [1, 2]]));   // O.. / O.O / OO.
  assert.equal(key(rotate(g, 4).cells), key(g.cells));
  const row = rotate(S('row10'), 1);
  assert.deepEqual([row.w, row.h], [1, 10]);
  // 回した宇宙船は縦に進む
  const w = newWorld(64);
  place(w, rotate(S('lwss'), 1), 32, 32);
  const before = cellsOf(w);
  run(w, 4);
  assert.equal(key(cellsOf(w)), key(shifted(before, 0, -2, 64)));
});

test('盤より大きい形は置けない（小の盤のグライダー銃だけ）', () => {
  const small = newWorld(32);
  assert.deepEqual(SHAPES.filter((s) => !fits(small, s)).map((s) => s.id), ['gosper-gun']);
  assert.ok(!fits(small, rotate(S('gosper-gun'), 1)));
  assert.ok(SHAPES.every((s) => fits(newWorld(64), s)));
});

test('ランダムは 30% くらい、全部消すと空', () => {
  const w = newWorld(128);
  randomize(w);
  assert.ok(Math.abs(w.alive / (128 * 128) - 0.3) < 0.03, String(w.alive));
  clear(w);
  assert.equal(w.alive, 0);
  assert.equal(w.gen, 0);
});

test('保存の読み書き: 正しい値は残し、おかしい値は初期値に', () => {
  const s = { v: 1, size: 2, speed: 3, sound: false, seenHelp: true };
  assert.deepEqual(readSettings(JSON.stringify(s)), s);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('こわれた{'), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('"x"'), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(JSON.stringify({ size: 3, speed: -1, sound: 'no', seenHelp: 1 })), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(JSON.stringify({ size: 0, speed: 1.5 })), { ...DEFAULT_SETTINGS, size: 0 });
});

test('URL の ?p=: 知っている形だけ読み、共有の URL に書ける', () => {
  assert.equal(shapeFromSearch('?p=glider'), 'glider');
  assert.equal(shapeFromSearch('?x=1&p=gosper-gun'), 'gosper-gun');
  for (const q of ['', '?p=', '?p=Glider', '?p=toString', '?p=%3Cscript%3E', '?p=__proto__']) assert.equal(shapeFromSearch(q), null, q);
  const base = 'https://t-of.github.io/cell-garden/';
  assert.equal(shareUrl(base, null), base);
  const url = shareUrl(base, 'acorn');
  assert.equal(url, `${base}?p=acorn`);
  assert.equal(shapeFromSearch(new URL(url).search), 'acorn');
});
