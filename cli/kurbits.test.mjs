// Tests for the Machine's command line (kurbits.mjs), which reads the engine out of ../index.html: run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMachine, toSVG } from './kurbits.mjs';

test('the engine, presets and palettes still load from the page', () => {
  const m = loadMachine();
  assert.equal(Object.keys(m.presets).length, 12);
  assert.deepEqual(Object.keys(m.palettes), ['panel', 'band', 'slate']);
  const [x, y, z, detail, aspect] = m.presets.Lily, items = m.build({ x, y, z, detail, aspect }, 1, 2.5);
  assert.ok(items.length > 0);
  assert.match(toSVG(items, m.bbox(items), m.palettes.panel), /^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+"/);
});
