// Tests for the Kurbits Leaves engine (../leaves.js): run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, bbox } from '../leaves.js';

const P = { x: 7, y: 9, z: 12, detail: 0.6, aspect: 4, variation: 0.5, size: 0.4, mirror: 1 };
const KEYS = ['x', 'y', 'z', 'detail', 'aspect', 'variation', 'size', 'mirror'];
const RANGE = { x: [0, 20], y: [0, 20], z: [0, 20], detail: [0, 1], aspect: [2, 24], variation: [0, 1], size: [0, 1], mirror: [0, 1] };
// a small pseudo-random generator, so that the random points are the same on every run
const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20261005);
const randomPoint = (aspectMax = 8) => Object.fromEntries(KEYS.map(k => { const [a, b] = k === 'aspect' ? [2, aspectMax] : RANGE[k]; return [k, a + (b - a) * rng()]; }));

// ---- a distance between two drawings: every line is sampled every h units, each sample weighted by the ink it
// stands for (width times length), and each sample is matched to the nearest sample of the other drawing
function samples(items, h = 0.01) {
  const X = [], Y = [], W = [];
  for (const it of items) {
    const p = it.pts;
    for (let i = 2; i < p.length; i += 2) {
      const dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1], l = Math.hypot(dx, dy), m = Math.max(1, Math.ceil(l / h));
      for (let k = 0; k < m; k++) { X.push(p[i - 2] + dx * (k + 0.5) / m); Y.push(p[i - 1] + dy * (k + 0.5) / m); W.push(it.w * l / m); }
    }
  }
  return { X, Y, W };
}
function nearest(S, c) {                          // a grid of cell size c over the samples, and a nearest-sample query
  const G = new Map(), key = (i, j) => i * 100003 + j;
  S.X.forEach((x, n) => { const k = key(Math.floor(x / c), Math.floor(S.Y[n] / c)); (G.get(k) || G.set(k, []).get(k)).push(n); });
  return (x, y) => {
    const gi = Math.floor(x / c), gj = Math.floor(y / c); let best = Infinity;
    for (let r = 0; r < 400; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        for (const n of G.get(key(gi + i, gj + j)) || []) best = Math.min(best, (S.X[n] - x) ** 2 + (S.Y[n] - y) ** 2);
      }
      if (best <= (r * c) ** 2) break;
    }
    return Math.sqrt(best);
  };
}
// the ink-weighted mean distance both ways (a symmetric Chamfer distance), and the share of the ink that lies
// further than `far` from the other drawing
function distance(A, B, far) {
  const a = samples(A), b = samples(B), na = nearest(a, 0.05), nb = nearest(b, 0.05);
  let s = 0, t = 0, sw = 0, tw = 0, fa = 0;
  a.X.forEach((x, i) => { const d = nb(x, a.Y[i]); s += d * a.W[i]; sw += a.W[i]; if (d > far) fa += a.W[i]; });
  b.X.forEach((x, i) => { const d = na(x, b.Y[i]); t += d * b.W[i]; tw += b.W[i]; if (d > far) fa += b.W[i]; });
  return { mean: (s / sw + t / tw) / 2, far: fa / (sw + tw) };
}

test('the same numbers always give the same border', () => {
  assert.deepEqual(build(P), build({ ...P }));
});

test('every point builds, and draws only pen lines: random points and every corner of the space', () => {
  const points = Array.from({ length: 60 }, () => randomPoint(24));
  for (let m = 0; m < 256; m++) points.push(Object.fromEntries(KEYS.map((k, i) => [k, RANGE[k][(m >> i) & 1]])));
  for (const p of points) {
    const items = build(p), b = bbox(items);
    assert.ok(items.length >= 4, JSON.stringify(p));
    assert.ok(Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1) && b.x1 - b.x0 > 1, JSON.stringify(p));
    for (const it of items) {
      assert.equal(it.t, 'l');
      assert.ok(it.w > 0 && it.pts.length >= 4 && it.pts.every(Number.isFinite), JSON.stringify(p));
    }
  }
});

// Continuity: along every number, from random points, each small step (1/400 of its range, a slider's step) moves
// the drawing only a little, and no step moves it much more than the steps around it.
test('continuity: a small step in any number makes a small change, and no step jumps', () => {
  const STEPS = 10;
  for (let q = 0; q < 5; q++) {
    const p0 = randomPoint();
    for (const k of KEYS) {
      const [lo, hi] = RANGE[k], dk = (hi - lo) / 400, start = Math.min(p0[k], hi - (STEPS + 1) * dk);
      let prev = build({ ...p0, [k]: start }); const d = [], far = [];
      const H = bbox(prev).y1 - bbox(prev).y0;
      for (let i = 1; i <= STEPS; i++) {
        const cur = build({ ...p0, [k]: start + i * dk }), r = distance(prev, cur, 0.03 * H);
        d.push(r.mean / H); far.push(r.far); prev = cur;
      }
      const med = [...d].sort((a, b) => a - b)[STEPS >> 1], max = Math.max(...d), at = JSON.stringify({ ...p0, [k]: start });
      if (process.env.VERBOSE) console.log(k.padEnd(9), med.toExponential(2), max.toExponential(2), Math.max(...far).toExponential(2));
      assert.ok(max < 0.006, `${k}: a step moved the ink ${max.toFixed(5)} border heights on average, from ${at}`);
      assert.ok(max <= 6 * med + 5e-4, `${k}: a jump (${max.toFixed(5)} against a median step of ${med.toFixed(5)}) from ${at}`);
      assert.ok(Math.max(...far) < 0.02, `${k}: ${(100 * Math.max(...far)).toFixed(2)}% of the ink moved further than 3% of the height, from ${at}`);
    }
  }
});

test('mirror: 1 is mirror-symmetric about the centre, 0 runs one way', () => {
  const sym = items => distance(items, items.map(it => ({ ...it, pts: it.pts.map((v, i) => i % 2 ? v : -v) })), 0.05).mean;
  const b = bbox(build(P));
  assert.ok(Math.abs(b.x0 + b.x1) < 1e-9);
  assert.ok(sym(build(P)) < 1e-9);
  assert.ok(sym(build({ ...P, mirror: 0 })) > 0.01);
});

test('small prints: no line is narrower than min, and fine lines give way', () => {
  const screen = build(P), print = build(P, { min: 0.02, gap: 0.02 });
  for (const it of print) assert.ok(it.w >= 0.02 - 1e-12);
  const veins = items => items.filter(it => it.w < 0.009).length;
  assert.ok(veins(screen) > 0 && print.length < screen.length);
});

test("the page's Leaves presets are valid points that build distinct borders", () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const presets = JSON.parse(html.match(/BORDERS=(\{[^}]*\})/)[1]), seen = new Set();
  assert.ok(Object.keys(presets).length >= 8);
  for (const [name, v] of Object.entries(presets)) {
    assert.equal(v.length, KEYS.length, name);
    const p = Object.fromEntries(KEYS.map((k, i) => [k, v[i]]));
    for (const k of KEYS) assert.ok(p[k] >= RANGE[k][0] && p[k] <= RANGE[k][1], name + ' ' + k);
    const items = build(p), b = bbox(items);
    assert.ok(items.length > 20 && Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1), name);
    seen.add(items.length + ':' + b.x1.toFixed(6));
  }
  assert.equal(seen.size, Object.keys(presets).length);
});
