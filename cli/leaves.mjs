#!/usr/bin/env node
// Kurbits Leaves on the command line: the leafier, dalmålning-style engine in ../leaves.js.
//
//   leaves svg   --at X,Y,Z[,DETAIL[,ASPECT[,VARIATION[,SIZE]]]] [options] [-o FILE]
//   leaves json  --at ... [-o FILE]          raw geometry, engine units, y up: {params, bbox, items: [{kind: fill|cut,
//                                            halo, points: [[x, y], ...]}]}; a cut erases what was painted before it
//   leaves sheet --points "X,Y,Z,D,A;..." [--cols N] [options] -o FILE
//
// x, y and z run from 0 to 20, detail from 0 to 1, aspect from 2 up (a border's width over its height), variation from
// 0 (every leaf alike) to 1 (each leaf, flower and bend differs from its neighbours; default 0.7), size from 0 (a fine,
// busy garland) to 1 (fewer, larger leaves that read from afar; default 0.3).
// Options: --bg COLOUR (default #101012), --col COLOUR (default #d6d9de), --px WIDTH for .png (default 1600),
// --min M: the smallest cut or dot kept, --gap G: the smallest gap between overlapping shapes, both in engine
// units (roughly 1 unit per ornament height), for small physical prints such as an engraving.
// --style line|fill: line art (outlines and engraved lines, the default) or filled shapes with cut lines.
// --form centred|mirrored|running: a centrepiece between two mirrored garlands (default), two mirrored garlands
// joined in the middle without one, or one garland running from end to end.
// An -o FILE ending in .png is rendered with resvg; anything else is written as SVG.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, bbox } from '../leaves.js';

const require = createRequire(import.meta.url);
const f4 = v => (+v).toFixed(4);

export function toJSON(items, params) {
  const pairs = p => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
  return { params, bbox: bbox(items), items: items.map(it => ({ kind: it.t === 'x' ? 'cut' : 'fill', halo: it.h || 0, points: pairs(it.pts) })) };
}

function paths(items, P, X, Y, s) {
  let out = '';
  for (const it of items) {
    const p = it.pts; let d = 'M' + f4(X(p[0])) + ' ' + f4(Y(p[1]));
    for (let i = 2; i < p.length; i += 2) d += 'L' + f4(X(p[i])) + ' ' + f4(Y(p[i + 1]));
    if (it.t === 'x') { out += `<path d="${d}Z" fill="${P.bg}"/>`; continue; }
    if (it.h > 0) out += `<path d="${d}Z" fill="none" stroke="${P.bg}" stroke-width="${f4(it.h * s)}" stroke-linejoin="round"/>`;
    out += `<path d="${d}Z" fill="${P.col}"/>`;
  }
  return out;
}

export function toSVG(items, P, pad = 0.04, widthPx = 1200) {
  const b = bbox(items), w = b.x1 - b.x0, h = b.y1 - b.y0, m = pad * Math.max(w, h);
  const s = widthPx / (w + 2 * m), H = (h + 2 * m) * s;
  const X = x => (x - b.x0 + m) * s, Y = y => (b.y1 - y + m) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f4(widthPx)}" height="${f4(H)}" viewBox="0 0 ${f4(widthPx)} ${f4(H)}">` +
    `<rect width="100%" height="100%" fill="${P.bg}"/>${paths(items, P, X, Y, s)}</svg>`;
}

function sheetSVG(points, P, cols, cell = 600, opt = {}) {
  const rows = Math.ceil(points.length / cols), lab = 26;
  let body = '', maxH = 0; const cells = points.map(p => { const items = build(p, opt); const b = bbox(items); return { p, items, b }; });
  for (const c of cells) maxH = Math.max(maxH, (c.b.y1 - c.b.y0) / (c.b.x1 - c.b.x0));
  const ch = cell * maxH * 1.08 + lab;
  cells.forEach((c, i) => {
    const gx = (i % cols) * cell, gy = Math.floor(i / cols) * ch, w = c.b.x1 - c.b.x0, s = cell * 0.94 / w;
    const X = x => gx + cell * 0.03 + (x - c.b.x0) * s, Y = y => gy + lab + (c.b.y1 - y) * s;
    body += `<text x="${gx + 8}" y="${gy + 20}" fill="#9aa0a8" font-family="Helvetica" font-size="17">${i + 1}  ${[c.p.x, c.p.y, c.p.z, c.p.detail, c.p.aspect, c.p.variation, c.p.size].join(', ')}</text>`;
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

function parsePoint(s) {
  const [x, y, z, detail = 0.5, aspect = 6, variation = 0.7, size = 0.3] = s.split(',').map(Number);
  return { x, y, z, detail, aspect, variation, size };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  const [cmd, ...rest] = process.argv.slice(2), o = {};
  for (let i = 0; i < rest.length; i++) { const k = rest[i].replace(/^-+/, ''); o[k] = rest[i + 1]; i++; }
  const P = { bg: o.bg || '#101012', col: o.col || '#d6d9de' }, px = +(o.px || 1600), out = o.o;
  const opt = { min: +(o.min || 0), gap: +(o.gap || 0) }, style = o.style || 'line', form = o.form || 'centred';
  if (cmd === 'svg') write(out, toSVG(build({ ...parsePoint(o.at || '5,5,5'), style, form }, opt), P), px);
  else if (cmd === 'json') {
    const p = { ...parsePoint(o.at || '5,5,5'), style, form }, j = JSON.stringify(toJSON(build(p, opt), p));
    if (out) fs.writeFileSync(out, j); else process.stdout.write(j);
  } else if (cmd === 'sheet') write(out, sheetSVG((o.points || '').split(';').filter(Boolean).map(s => ({ ...parsePoint(s), style, form })), P, +(o.cols || 2), 600, opt), px);
  else { console.error('usage: leaves svg|json|sheet ... (see the header of cli/leaves.mjs)'); process.exit(1); }
}
