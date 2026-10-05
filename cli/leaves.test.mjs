// Tests for the Kurbits Leaves engine (../leaves.js): run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build, bbox } from '../leaves.js';

const P = { x: 2, y: 3, z: 3, detail: 0.5, aspect: 6 };

test('the same numbers always give the same ornament', () => {
  assert.deepEqual(build(P), build({ ...P }));
});

test('a small change of a number changes the ornament only a little', () => {
  const a = bbox(build(P)), b = bbox(build({ ...P, x: P.x + 0.01 }));
  for (const k of ['x0', 'x1', 'y0', 'y1']) assert.ok(Math.abs(a[k] - b[k]) < 0.02, k);
});

test('the three centre motifs appear across z', () => {
  const sizes = [2, 10, 18].map(z => build({ ...P, z }).length);
  assert.equal(new Set(sizes).size, 3);
});

test('the border is mirror-symmetric', () => {
  const b = bbox(build(P));
  assert.ok(Math.abs(b.x0 + b.x1) < 1e-9);
});

test('print mode: halos leave at least the requested gap, and fine detail is reduced', () => {
  const screen = build({ ...P, style: 'fill' }), print = build({ ...P, style: 'fill' }, { min: 0.03, gap: 0.03 });
  for (const it of print) if (it.t === 'p' && it.h > 0) assert.ok(it.h >= 0.06 - 1e-12);
  const cuts = items => items.filter(it => it.t === 'x').length;
  assert.ok(cuts(print) < cuts(screen));
});

test('line art: shapes are outlines over erased silhouettes, veins are lines', () => {
  const line = build(P), fill = build({ ...P, style: 'fill' });
  const lines = items => items.filter(it => it.t === 'p' && it.h === 0).length;
  assert.ok(lines(line) > 2 * lines(fill));
  assert.ok(line.some(it => it.t === 'x'));
});

test('line art in print: every halo also clears the outline pen', () => {
  for (const it of build(P, { min: 0.03, gap: 0.03 })) if (it.t === 'p' && it.h > 0) assert.ok(it.h >= 0.06 - 1e-12);
});

test('forms: mirrored joins two halves without a centrepiece, running is one garland', () => {
  const mirrored = build({ ...P, form: 'mirrored' }), running = build({ ...P, form: 'running' }), centred = build(P);
  const b = bbox(mirrored); assert.ok(Math.abs(b.x0 + b.x1) < 1e-9);
  const crosses = it => { let l = false, r = false; for (let i = 0; i < it.pts.length; i += 2) { if (it.pts[i] < -0.05) l = true; if (it.pts[i] > 0.05) r = true; } return l && r; };
  assert.ok(crosses(mirrored[0]));          // one stem runs through the middle
  const r = bbox(running); assert.ok(r.x1 - r.x0 > 0.8 * P.aspect);
});

test("the page's Leaves presets are valid points that build distinct borders", () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const presets = JSON.parse(html.match(/BORDERS=(\{[^}]*\})/)[1]), seen = new Set();
  assert.ok(Object.keys(presets).length >= 6);
  for (const [name, [x, y, z, detail, aspect, variation, size, style, form]] of Object.entries(presets)) {
    assert.ok(['line', 'fill'].includes(style) && ['centred', 'mirrored', 'running'].includes(form), name);
    const items = build({ x, y, z, detail, aspect, variation, size, style, form }), b = bbox(items);
    assert.ok(items.length > 20 && Number.isFinite(b.x0 + b.x1 + b.y0 + b.y1), name);
    seen.add(items.length + ':' + b.x1.toFixed(6));
  }
  assert.equal(seen.size, Object.keys(presets).length);
});
