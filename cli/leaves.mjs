#!/usr/bin/env node
// Kurbits Leaves on the command line: the line-drawn, dalmålning-style engine in ../leaves.js.
//
//   leaves svg   --at X,Y,Z[,DETAIL[,ASPECT[,PLUMP[,LOBES[,CURL[,VARIATION]]]]]] [options] [-o FILE]
//   leaves json  --at ... [-o FILE]          raw geometry, engine units, y up: {params, bbox, items: [{kind: 'line',
//                                            width, points: [[x, y], ...]}]}; hidden lines are already removed
//   leaves sheet --points "X,Y,Z,D,A,...;..." [--cols N] [options] -o FILE
//   leaves sheet --leaf --points "PLUMP,LOBES,CURL;..." [--cols N] -o FILE    single leaves, for close-ups of the leaf
//
// x, y and z (0 to 20) choose the composition, detail (0 to 1) the depth: how many generations of shoots grow from
// the main ones. Aspect (0.25 to 48, default 1) is relative to the design's own proportions: wider adds repeats along
// a runner (a frieze; at 48 typically 30 to 80 times as wide as it is tall), taller stacks smaller tiers. Each repeat
// wanders from the motif with its place, so the plants change gradually along the length; x, y and z set how far.
// Plump, lobes and curl (0 to 1, default 0.5) shape the leaf: slender to plump, a smooth to a billowed edge, calm to
// tightly curled; variation (0 to 1, default 0.4) is how much each leaf, and each repeat, differs from the next.
// Every number is continuous: any point draws a design.
// Options: --bg COLOUR (default #101012), --col COLOUR (default #d6d9de), --px WIDTH for .png (default 1600),
// --min M: the narrowest line, --gap G: the narrowest gap between lines, both in engine units (about 1 unit per main
// shoot), for small physical prints such as an engraving.
// An -o FILE ending in .png is rendered with resvg; anything else is written as SVG.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, buildLeaf, bbox } from '../leaves.js';

const require = createRequire(import.meta.url);
const f4 = v => (+v).toFixed(4);
export const KEYS = ['x', 'y', 'z', 'detail', 'aspect', 'plump', 'lobes', 'curl', 'variation'];
const LEAF = ['plump', 'lobes', 'curl'];

export function toJSON(items, params) {
  const pairs = p => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
  return { params, bbox: bbox(items), items: items.map(it => ({ kind: 'line', width: it.w, points: pairs(it.pts) })) };
}

// every item is a pen line: an SVG path stroked in the ink colour (a closed line ends where it starts)
function paths(items, P, X, Y, s) {
  let out = '';
  for (const it of items) {
    const p = it.pts; let d = 'M' + f4(X(p[0])) + ' ' + f4(Y(p[1]));
    for (let i = 2; i < p.length; i += 2) d += 'L' + f4(X(p[i])) + ' ' + f4(Y(p[i + 1]));
    out += `<path d="${d}" fill="none" stroke="${P.col}" stroke-width="${f4(it.w * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return out;
}

export function toSVG(items, P, pad = 0.04, widthPx = 1200) {
  // the margin: pad times the larger side, but no more than three times the smaller (so a long divider is not lost
  // in its margins)
  const b = bbox(items), w = b.x1 - b.x0, h = b.y1 - b.y0, m = pad * Math.min(Math.max(w, h), 3 * Math.min(w, h));
  const s = widthPx / (w + 2 * m), H = (h + 2 * m) * s;
  const X = x => (x - b.x0 + m) * s, Y = y => (b.y1 - y + m) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f4(widthPx)}" height="${f4(H)}" viewBox="0 0 ${f4(widthPx)} ${f4(H)}">` +
    `<rect width="100%" height="100%" fill="${P.bg}"/>${paths(items, P, X, Y, s)}</svg>`;
}

// a grid of designs (or single leaves), each fitted into a cell of the same height, labelled with its numbers
function sheetSVG(points, P, cols, cell = 600, opt = {}, leaf = false) {
  const rows = Math.ceil(points.length / cols), lab = 26, keys = leaf ? LEAF : KEYS;
  let body = '', maxH = 0; const cells = points.map(p => { const items = leaf ? buildLeaf(p) : build(p, opt); const b = bbox(items); return { p, items, b }; });
  for (const c of cells) maxH = Math.max(maxH, Math.min(1.6, (c.b.y1 - c.b.y0) / (c.b.x1 - c.b.x0)));
  const ch = cell * maxH * 1.04 + lab + 12;
  cells.forEach((c, i) => {
    const gx = (i % cols) * cell, gy = Math.floor(i / cols) * ch, w = c.b.x1 - c.b.x0, h = c.b.y1 - c.b.y0;
    const s = Math.min(cell * 0.94 / w, (ch - lab - 12) / h), ox = gx + (cell - w * s) / 2, oy = gy + lab + (ch - lab - 6 - h * s) / 2;
    const X = x => ox + (x - c.b.x0) * s, Y = y => oy + (c.b.y1 - y) * s;
    body += `<text x="${gx + 8}" y="${gy + 20}" fill="#9aa0a8" font-family="Helvetica" font-size="17">${i + 1}  ${keys.map(k => +(+c.p[k]).toFixed(3)).join(', ')}</text>`;
    body += paths(c.items, P, X, Y, s);
  });
  const W = cols * cell, H = rows * ch;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${f4(H)}" viewBox="0 0 ${W} ${f4(H)}"><rect width="100%" height="100%" fill="${P.bg}"/>${body}</svg>`;
}

function write(file, svg, px) {
  if (file && file.endsWith('.png')) {
    const { Resvg } = require('@resvg/resvg-js');
    fs.writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().asPng());
  } else if (file) fs.writeFileSync(file, svg); else process.stdout.write(svg);
}

export function parsePoint(s) {
  const [x, y, z, detail = 0.5, aspect = 1, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4] = s.split(',').map(Number);
  return { x, y, z, detail, aspect, plump, lobes, curl, variation };
}
const parseLeaf = s => { const [plump = 0.5, lobes = 0.5, curl = 0.5] = s.split(',').map(Number); return { plump, lobes, curl }; };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  const [cmd, ...rest] = process.argv.slice(2), o = {};
  for (let i = 0; i < rest.length; i++) { const k = rest[i].replace(/^-+/, ''); if (k === 'leaf') { o.leaf = true; continue; } o[k] = rest[i + 1]; i++; }
  const P = { bg: o.bg || '#101012', col: o.col || '#d6d9de' }, px = +(o.px || 1600), out = o.o;
  const opt = { min: +(o.min || 0), gap: +(o.gap || 0) };
  if (cmd === 'svg') write(out, toSVG(build(parsePoint(o.at || '5,5,5'), opt), P), px);
  else if (cmd === 'json') {
    const p = parsePoint(o.at || '5,5,5'), j = JSON.stringify(toJSON(build(p, opt), p));
    if (out) fs.writeFileSync(out, j); else process.stdout.write(j);
  } else if (cmd === 'sheet') write(out, sheetSVG((o.points || '').split(';').filter(Boolean).map(o.leaf ? parseLeaf : parsePoint), P, +(o.cols || 2), 600, opt, o.leaf), px);
  else { console.error('usage: leaves svg|json|sheet ... (see the header of cli/leaves.mjs)'); process.exit(1); }
}
