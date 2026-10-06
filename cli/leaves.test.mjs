// Tests for the Kurbits Leaves engine (../leaves.js): run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { build, bbox, settingsAt, buildLeaf, buildRepeat } from '../leaves.js';
const P = { x: 7, y: 9, z: 12, detail: 0.6, aspect: 1, plump: 0.5, lobes: 0.5, curl: 0.5, variation: 0.4 };
const KEYS = ['x', 'y', 'z', 'detail', 'aspect', 'plump', 'lobes', 'curl', 'variation'];
const RANGE = { x: [0, 20], y: [0, 20], z: [0, 20], detail: [0, 1], aspect: [0.25, 48], plump: [0, 1], lobes: [0, 1], curl: [0, 1], variation: [0, 1] };
// a small pseudo-random generator, so that the random points are the same on every run
const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(20261005);
const randomPoint = (aspectMax = 3) => Object.fromEntries(KEYS.map(k => { const [a, b] = k === 'aspect' ? [0.5, aspectMax] : RANGE[k]; return [k, a + (b - a) * rng()]; }));

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
// further than `far` from the other drawing; with r, only the ink within |x| <= r (each drawing's ink there is matched
// to all of the other's)
function distance(A, B, far, r = Infinity) {
  const a = samples(A), b = samples(B), na = nearest(a, 0.05), nb = nearest(b, 0.05);
  let s = 0, t = 0, sw = 0, tw = 0, fa = 0;
  a.X.forEach((x, i) => { if (Math.abs(x) > r) return; const d = nb(x, a.Y[i]); s += d * a.W[i]; sw += a.W[i]; if (d > far) fa += a.W[i]; });
  b.X.forEach((x, i) => { if (Math.abs(x) > r) return; const d = na(x, b.Y[i]); t += d * b.W[i]; tw += b.W[i]; if (d > far) fa += b.W[i]; });
  return { mean: (s / sw + t / tw) / 2, far: fa / (sw + tw) };
}

test('the same numbers always give the same design', () => {
  assert.deepEqual(build(P), build({ ...P }));
});

test('every point builds, and draws only pen lines: random points and every corner of the space', () => {
  const points = Array.from({ length: 60 }, () => randomPoint(48));
  for (let m = 0; m < 512; m++) points.push(Object.fromEntries(KEYS.map((k, i) => [k, RANGE[k][(m >> i) & 1]])));
  for (const p of points) {
    const items = build(p), b = bbox(items);
    assert.ok(items.length >= 4, JSON.stringify(p));
    assert.ok(Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1) && b.x1 - b.x0 > 0.2 && b.y1 - b.y0 > 0.2, JSON.stringify(p));
    for (const it of items) {
      assert.equal(it.t, 'l');
      assert.ok(it.w > 0 && it.pts.length >= 4 && it.pts.every(Number.isFinite), JSON.stringify(p));
    }
  }
});

// Continuity: along every number, from random points, each small step (1/400 of its range, a slider's step; aspect,
// a ratio, steps by 1/400 of its range in proportion, as its slider does) moves the drawing only a little, and no step
// moves it much more than the steps around it.
test('continuity: a small step in any number makes a small change, and no step jumps', () => {
  const STEPS = 10;
  for (let q = 0; q < 5; q++) {
    const p0 = randomPoint();
    for (const k of KEYS) {
      const lg = k === 'aspect', f = lg ? Math.log : v => v, F = lg ? Math.exp : v => v;
      const [lo, hi] = RANGE[k].map(f), dk = (hi - lo) / 400, start = Math.min(f(p0[k]), hi - (STEPS + 1) * dk);
      let prev = build({ ...p0, [k]: F(start) }); const d = [], far = [];
      const H = Math.max(bbox(prev).y1 - bbox(prev).y0, bbox(prev).x1 - bbox(prev).x0);   // the design's size
      for (let i = 1; i <= STEPS; i++) {
        const cur = build({ ...p0, [k]: F(start + i * dk) }), r = distance(prev, cur, 0.03 * H);
        d.push(r.mean / H); far.push(r.far); prev = cur;
      }
      const med = [...d].sort((a, b) => a - b)[STEPS >> 1], max = Math.max(...d), at = JSON.stringify({ ...p0, [k]: F(start) });
      if (process.env.VERBOSE) console.log(k.padEnd(9), med.toExponential(2), max.toExponential(2), Math.max(...far).toExponential(2));
      assert.ok(max < 0.008, `${k}: a step moved the ink ${max.toFixed(5)} of the design's size on average, from ${at}`);
      assert.ok(max <= 6 * med + 5e-4, `${k}: a jump (${max.toFixed(5)} against a median step of ${med.toFixed(5)}) from ${at}`);
      assert.ok(Math.max(...far) < 0.02, `${k}: ${(100 * Math.max(...far)).toFixed(2)}% of the ink moved further than 3% of its size, from ${at}`);
    }
  }
});

// Long friezes, up to the longest: the same steps, from points whose aspect lies between 12 and the maximum (the first
// at the maximum, so that aspect is stepped right up to its end). The ink a step moves is measured against the
// design's size, as above, and a jump against the steps around it in units of the frieze's height, which for a
// long frieze is much the stricter.
test('continuity on long friezes: a small step in any number makes a small change, and no step jumps', () => {
  const STEPS = 8, l12 = Math.log(12), lmax = Math.log(RANGE.aspect[1]);
  for (let q = 0; q < 3; q++) {
    const p0 = { ...randomPoint(), aspect: q === 0 ? RANGE.aspect[1] : Math.exp(l12 + (lmax - l12) * rng()) };
    for (const k of KEYS) {
      const lg = k === 'aspect', f = lg ? Math.log : v => v, F = lg ? Math.exp : v => v;
      const [lo, hi] = RANGE[k].map(f), dk = (hi - lo) / 400, start = Math.min(f(p0[k]), hi - STEPS * dk);
      let prev = build({ ...p0, [k]: F(start) }); const d = [], dh = [], far = [];
      const b = bbox(prev), H = Math.max(b.y1 - b.y0, b.x1 - b.x0), Hh = b.y1 - b.y0;
      for (let i = 1; i <= STEPS; i++) {
        const cur = build({ ...p0, [k]: F(start + i * dk) }), r = distance(prev, cur, 0.03 * H);
        d.push(r.mean / H); dh.push(r.mean / Hh); far.push(r.far); prev = cur;
      }
      const med = [...dh].sort((a, b) => a - b)[STEPS >> 1], max = Math.max(...dh), at = JSON.stringify({ ...p0, [k]: F(start) });
      if (process.env.VERBOSE) console.log(k.padEnd(9), Math.max(...d).toExponential(2), med.toExponential(2), max.toExponential(2), Math.max(...far).toExponential(2));
      assert.ok(Math.max(...d) < 0.008, `${k}: a step moved the ink ${Math.max(...d).toFixed(5)} of the design's size on average, from ${at}`);
      assert.ok(max <= 6 * med + 5e-4, `${k}: a jump (${max.toFixed(5)} against a median step of ${med.toFixed(5)} of the height) from ${at}`);
      assert.ok(Math.max(...far) < 0.02, `${k}: ${(100 * Math.max(...far)).toFixed(2)}% of the ink moved further than 3% of its size, from ${at}`);
    }
  }
});

// Aspect adds repeats at the ends of a frieze and leaves the ones it had where they were, as they were: a repeat's
// settings and place depend on its own position, never on how many repeats there are. Within the inner 70% of the
// shorter frieze, one slider step moves the ink by a tiny part of the height, and a frieze a third longer (several
// new repeats at each end) by little more: only the pens and the smallest shoots change with the design's size.
test('aspect: a longer frieze grows repeats at its ends and keeps the ones it had', () => {
  const step = Math.pow(RANGE.aspect[1] / RANGE.aspect[0], 1 / 400);
  for (let q = 0; q < 5; q++) {
    const p = randomPoint();
    for (const [a0, a1, mean, far] of [[20, 20 * step, 0.003, 0.01], [36, 48, 0.012, 0.1], [9, 12, 0.012, 0.1]]) {
      const A = build({ ...p, aspect: a0 }), B = build({ ...p, aspect: a1 }), b = bbox(A), c = bbox(B), H = b.y1 - b.y0;
      const d = distance(A, B, 0.03 * H, 0.7 * Math.min(-b.x0, b.x1)), at = JSON.stringify({ ...p, aspect: a0 }) + ' to ' + a1.toFixed(3);
      if (process.env.VERBOSE) console.log(a0, (d.mean / H).toExponential(2), (100 * d.far).toFixed(2) + '%');
      assert.ok(c.x1 - c.x0 > b.x1 - b.x0, at);
      assert.ok(d.mean < mean * H, `the inner repeats moved ${(d.mean / H).toFixed(5)} of the height, from ${at}`);
      assert.ok(d.far < far, `${(100 * d.far).toFixed(2)}% of the inner ink moved further than 3% of the height, from ${at}`);
    }
  }
});

// Variation along the length: each repeat of a frieze (and each tier of a tower) is drawn from its own settings, so
// neighbouring repeats are never copies, for nearly every point of the space, and they are related: on average,
// neighbours differ about half as much as repeats five apart. "Alike" is a mean distance below 0.009 of the repeat's
// size between repeats j and j + 1 (j = 1, 2, 3), about where a difference stops being plain to see.
test('variation along the length: neighbouring repeats differ for nearly every point, and gradually', () => {
  const D = (p, i, j) => { const a = buildRepeat(p, i), b = buildRepeat(p, j), bb = bbox(a), H = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0); return distance(a, b, 0.03 * H).mean / H; };
  const N = 40; let alike = 0, near = 0, apart = 0;
  for (let n = 0; n < N; n++) {
    const p = randomPoint(), d = (D(p, 1, 2) + D(p, 2, 3) + D(p, 3, 4)) / 3;
    if (d < 0.009) alike++;
    near += D(p, -1, -2); apart += D(p, -1, -6);
  }
  if (process.env.VERBOSE) console.log('alike', alike, 'of', N, ' neighbours', (near / N).toFixed(4), ' five apart', (apart / N).toFixed(4));
  assert.ok(alike <= 0.1 * N, `${alike} of ${N} random points have nearly identical neighbouring repeats`);
  assert.ok(near < 0.75 * apart, `neighbours differ ${(near / N).toFixed(4)} on average, repeats five apart ${(apart / N).toFixed(4)}`);
  // the motif itself is repeat 0
  assert.deepEqual(buildRepeat(P, 0), build({ ...P, aspect: 1 }));
});

// Where x, y and z give a mirrored design (the setting mirror = 1), the drawing is mirror-symmetric about the root, up
// to which of two crossing leaves lies in front; where they give none (mirror = 0), it is not.
test('mirror: mirrored points are symmetric, unmirrored points are not', () => {
  const sym = items => { const H = bbox(items).y1 - bbox(items).y0; return distance(items, items.map(it => ({ ...it, pts: it.pts.map((v, i) => i % 2 ? v : -v) })), 0.05).mean / H; };
  let on = 0, off = 0;
  for (let i = 0; i < 400 && (on < 4 || off < 4); i++) {
    const p = { ...P, x: 20 * rng(), y: 20 * rng(), z: 20 * rng() }, m = settingsAt(p).mirror;
    if (m === 1 && on < 4) { on++; const it = build(p), b = bbox(it); assert.ok(Math.abs(b.x0 + b.x1) < 0.02 * (b.x1 - b.x0), JSON.stringify(p)); assert.ok(sym(it) < 0.004, JSON.stringify(p) + ' ' + sym(it)); }
    if (m === 0 && off < 4) { off++; assert.ok(sym(build(p)) > 0.01, JSON.stringify(p)); }
  }
  assert.ok(on === 4 && off === 4);
});

// The mirror does not wander: in a mirrored design every repeat is as symmetric as the motif.
test('mirror: the repeats of a mirrored design are symmetric too', () => {
  const sym = items => { const H = bbox(items).y1 - bbox(items).y0; return distance(items, items.map(it => ({ ...it, pts: it.pts.map((v, i) => i % 2 ? v : -v) })), 0.05).mean / H; };
  let on = 0;
  for (let i = 0; i < 400 && on < 3; i++) {
    const p = { ...P, x: 20 * rng(), y: 20 * rng(), z: 20 * rng(), variation: rng() };
    if (settingsAt(p).mirror < 1) continue;
    on++;
    for (const j of [2, -4, 7]) { assert.equal(settingsAt(p, j).mirror, 1); const s = sym(buildRepeat(p, j)); assert.ok(s < 0.004, JSON.stringify(p) + ' repeat ' + j + ' ' + s); }
  }
  assert.equal(on, 3);
});

// Each step of detail grows one more generation of shoots. (The shoots are counted from where sprouts come out,
// opt.trace: lines are now the pieces of swelling and tapering strokes, merged where they are nearly one width, so their
// number no longer counts the shoots; and the budget of layer 1 keeps the total number of shoots level, trimming the
// sprouts per shoot as a generation is added, so neither count need rise. What must rise is the depth.)
test('detail is the depth: every step of detail adds a generation of shoots', () => {
  for (const p of [P, { ...P, x: 3, y: 15, z: 4 }, { ...P, x: 16, y: 2, z: 10 }]) {
    const at = [0, 0.34, 0.67, 1].map(d => { const trace = []; build({ ...p, detail: d }, { trace }); const g = trace.length ? 1 + Math.max(...trace.map(t => t.gen)) : 0; return { gens: g, deepest: trace.filter(t => t.gen === g - 1).length }; });
    for (let i = 1; i < at.length; i++) assert.ok(at[i].gens === i && at[i].deepest > 0, JSON.stringify(p) + ' ' + JSON.stringify(at));
  }
});

test('a single leaf or flower builds from pen lines across the leaf numbers', () => {
  for (const plump of [0, 0.5, 1]) for (const lobes of [0, 0.5, 1]) for (const curl of [0, 0.5, 1]) for (const [bloom, cup] of [[0, 0], [0.5, 0.5], [1, 0], [1, 1]]) {
    const items = buildLeaf({ plump, lobes, curl, bloom, cup });
    assert.ok(items.length >= 3 && items.every(it => it.t === 'l' && it.w > 0 && it.pts.length >= 4 && it.pts.every(Number.isFinite)), JSON.stringify({ plump, lobes, curl, bloom, cup }));
  }
});

// Leaf to flower: a single head stepped along the whole morph, horn to fan (lobes), fan to rosette (bloom), rosette to
// tulip (cup), each by 1/400 of its range at a time, with the limits of the continuity test above, within every stretch
// of ten steps.
test('one continuous morph from a horn to a fan, a rosette and a tulip', () => {
  const path = [];
  for (let i = 0; i <= 400; i++) path.push({ plump: 0.55, curl: 0.6, lobes: i / 400, bloom: 0, cup: 0 });
  for (let i = 1; i <= 400; i++) path.push({ plump: 0.55, curl: 0.6, lobes: 1, bloom: i / 400, cup: 0 });
  for (let i = 1; i <= 400; i++) path.push({ plump: 0.55, curl: 0.6, lobes: 1, bloom: 1, cup: i / 400 });
  const d = [], far = [];
  let prev = buildLeaf(path[0]);
  for (let i = 1; i < path.length; i++) {
    const cur = buildLeaf(path[i]), bb = bbox(prev), H = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0), r = distance(prev, cur, 0.03 * H);
    d.push(r.mean / H); far.push(r.far); prev = cur;
  }
  if (process.env.VERBOSE) console.log('morph', Math.max(...d).toExponential(2), Math.max(...far).toExponential(2));
  for (let i = 0; i + 10 <= d.length; i += 5) {
    const w = d.slice(i, i + 10), med = [...w].sort((a, b) => a - b)[5], max = Math.max(...w), at = JSON.stringify(path[i + w.indexOf(max) + 1]);
    assert.ok(max < 0.008, `a step moved the ink ${max.toFixed(5)} of the head's size, at ${at}`);
    assert.ok(max <= 6 * med + 5e-4, `a jump (${max.toFixed(5)} against a median of ${med.toFixed(5)}) at ${at}`);
  }
  assert.ok(Math.max(...far) < 0.02, `${(100 * Math.max(...far)).toFixed(2)}% of the ink moved further than 3% of the head's size in one step`);
});

// Flowers in whole designs: the bloom setting (how far the heads open into flowers, read off x, y and z) is stepped
// directly, by 1/400 of its range, from points of the space, so flowers grow in from leaves; as it rises, the ink
// changes a little at every step and no step jumps (the limits of the continuity test).
test('flowers grow in smoothly: stepping the bloom moves the ink a little, without jumps', () => {
  const [lo, hi] = [0, 1.6], STEPS = 10, dk = (hi - lo) / 400;
  for (let q = 0; q < 4; q++) {
    const p = { ...randomPoint(), aspect: q === 3 ? 6 : 1 };
    for (const b0 of [0, 0.3, 0.75]) {
      let prev = build(p, { set: { bloom: b0 } }); const bb = bbox(prev), H = Math.max(bb.y1 - bb.y0, bb.x1 - bb.x0), d = [], far = [];
      for (let i = 1; i <= STEPS; i++) {
        const cur = build(p, { set: { bloom: b0 + i * dk } }), r = distance(prev, cur, 0.03 * H);
        d.push(r.mean / H); far.push(r.far); prev = cur;
      }
      const med = [...d].sort((a, b) => a - b)[STEPS >> 1], max = Math.max(...d), at = JSON.stringify(p) + ' bloom ' + b0;
      if (process.env.VERBOSE) console.log('bloom', b0, med.toExponential(2), max.toExponential(2), Math.max(...far).toExponential(2));
      assert.ok(max < 0.008, `a step moved the ink ${max.toFixed(5)} of the design's size, from ${at}`);
      assert.ok(max <= 6 * med + 5e-4, `a jump (${max.toFixed(5)} against a median step of ${med.toFixed(5)}) from ${at}`);
      assert.ok(Math.max(...far) < 0.02, `${(100 * Math.max(...far)).toFixed(2)}% of the ink moved further than 3% of its size, from ${at}`);
    }
  }
  // and a good share of the space has flowers: the bloom setting is above zero for most random points
  let some = 0; for (let i = 0; i < 200; i++) if (settingsAt(randomPoint()).bloom > 0.05) some++;
  assert.ok(some > 0.5 * 200, `only ${some} of 200 random points have flowers`);
});

// Where sprouts come out (opt.trace records each one: its generation, the shoot it grows from and its place u along
// that shoot, a share of the shoot's length). Over random points they come out all along the shoots, not in a narrow
// band: every tenth of the length holds at least 2% of them (the old engine left the first tenth and the last two
// empty). Within a design they spread (a mean standard deviation of u above 0.15, where the old engine had 0.145 and
// an even spread would have 0.29), different shoots put them in different places (the per-shoot means differ by a
// standard deviation above 0.08), and so do the generations (their mean places differ by more than 0.06 on average;
// the old engine's differed by 0.03).
test('sprouts come out all along the shoots, differently on different shoots and generations', () => {
  const all = [], within = [], between = [], gens = [];
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, std = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  for (let n = 0; n < 50; n++) {
    const p = { ...randomPoint(), aspect: 1 }; p.detail = 0.4 + 0.6 * p.detail;
    const trace = []; build(p, { trace });
    const us = trace.map(t => t.u); all.push(...us);
    if (us.length >= 3) within.push(std(us));
    const by = new Map(); for (const t of trace) if (!t.cluster) (by.get(t.shoot) || by.set(t.shoot, []).get(t.shoot)).push(t.u);
    if (by.size >= 3) between.push(std([...by.values()].map(mean)));
    const g0 = trace.filter(t => t.gen === 0).map(t => t.u), g1 = trace.filter(t => t.gen === 1).map(t => t.u);
    if (g0.length && g1.length) gens.push(Math.abs(mean(g0) - mean(g1)));
  }
  const bins = Array(10).fill(0); for (const u of all) bins[Math.min(9, Math.floor(10 * u))]++;
  if (process.env.VERBOSE) console.log('tenths %', bins.map(b => (100 * b / all.length).toFixed(1)).join(' '), ' within', mean(within).toFixed(3), ' between', mean(between).toFixed(3), ' generations', mean(gens).toFixed(3));
  assert.ok(all.length > 1000);
  for (let i = 0; i < 10; i++) assert.ok(bins[i] >= 0.02 * all.length, `only ${(100 * bins[i] / all.length).toFixed(1)}% of the sprouts come out between ${i / 10} and ${(i + 1) / 10} of their shoot`);
  assert.ok(mean(within) > 0.15, `sprouts spread along their shoots by only ${mean(within).toFixed(3)} on average`);
  assert.ok(mean(between) > 0.08, `different shoots put their sprouts in nearly the same places (${mean(between).toFixed(3)})`);
  assert.ok(mean(gens) > 0.06, `the generations put their sprouts in nearly the same places (${mean(gens).toFixed(3)})`);
});

test('small prints: no line is narrower than min, and fine lines give way', () => {
  const screen = build(P), print = build(P, { min: 0.02, gap: 0.02 });
  for (const it of print) assert.ok(it.w >= 0.02 - 1e-12);
  const veins = items => items.filter(it => it.w < 0.006).length;
  assert.ok(veins(screen) > 0 && print.length < screen.length);
});

test("the page's Leaves presets are valid points that build distinct designs", () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const presets = JSON.parse(html.match(/DESIGNS=(\{[^}]*\})/)[1]), seen = new Set();
  assert.ok(Object.keys(presets).length >= 8);
  for (const [name, v] of Object.entries(presets)) {
    assert.equal(v.length, KEYS.length, name);
    const p = Object.fromEntries(KEYS.map((k, i) => [k, v[i]]));
    for (const k of KEYS) assert.ok(p[k] >= RANGE[k][0] && p[k] <= RANGE[k][1], name + ' ' + k);
    const items = build(p), b = bbox(items);
    assert.ok(items.length > 10 && Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1), name);
    seen.add(items.length + ':' + b.x1.toFixed(6));
  }
  assert.equal(seen.size, Object.keys(presets).length);
});
