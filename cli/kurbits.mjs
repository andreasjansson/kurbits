#!/usr/bin/env node
// Kurbits Machine on the command line. The engine, the presets and the palettes are read from ../index.html, so the
// page stays the one source: nothing here re-implements the mathematics.
//
//   kurbits presets [--json]
//   kurbits svg   [--preset NAME | --at X,Y,Z[,DETAIL[,ASPECT]]] [--detail D] [--aspect A] [options] [-o FILE]
//   kurbits json  [same selection] [-o FILE]
//   kurbits sheet [--points "X,Y,Z,D,A;..." | all presets] [--cols N] [colour options] -o FILE
//
// x, y and z run from 0 to 20, detail from 0 to 1, aspect from 0.25 to 6 (wider ornaments gain scrolls). An -o FILE
// ending in .png is rendered with resvg (--px WIDTH, default 1600); anything else is written as SVG text.
//
// Options (svg, sheet):
//   --palette panel|band|slate   the page's palettes (default panel)
//   --bg COLOUR|none              background (none = transparent); --col COLOUR, --acc COLOUR: the two inks
//   --width-mm W | --height-mm H  physical size; the other side follows the ornament's aspect
//   --pad F                       margin as a fraction of the larger side (default 0.03, as the page)
//   --res R                       sampling resolution (default 2.5, as the page's Copy SVG)
//   --grow G                      growth (default 1)
//   --no-halo                     omit the background-coloured outline the page draws around filled shapes
//   --only col|acc                emit only one ink (one layer of a two-ink design)
//
// json: the raw geometry in engine units (y up): {params, bbox, items: [{kind: fill|stroke, ink: col|acc, width,
// halo, points: [[x, y], ...]}]}. A fill is a closed polygon; a stroke is a polyline drawn with round caps.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function loadMachine(htmlPath = path.join(HERE, '..', 'index.html')) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const engineSrc = scripts.find(s => s.includes('const KurbitsSwirl'));
  const pageSrc = scripts.find(s => s.includes('PRESETS='));
  if (!engineSrc || !pageSrc) throw new Error('index.html: engine or page script not found');
  const ctx = vm.createContext({ math: require('mathjs'), console });
  const { KurbitsSwirl, Compact, Field } = vm.runInContext(engineSrc + '\n;({KurbitsSwirl, Compact, Field})', ctx);
  const presets = JSON.parse(pageSrc.match(/PRESETS=(\{[^}]*\})/)[1]);
  const palettes = vm.runInNewContext('(' + pageSrc.match(/const PALS=(\{.*\});/)[1] + ')');
  const G = KurbitsSwirl, Cm = Compact(G), F = Field(Cm, G);
  const build = (p, grow = 1, res) =>
    G.build(Cm.expand(F.at(p.x, p.y, p.z, p.detail, p.aspect).C), grow, res ? { res } : undefined);
  return { presets, palettes, build, bbox: G.bbox };
}

export function toJSON(items, bbox, params) {
  const pairs = p => { const out = []; for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]); return out; };
  return {
    params, bbox,
    items: items.map(it => it.t === 'p'
      ? { kind: 'fill', ink: it.c || 'col', halo: it.h || 0, points: pairs(it.pts) }
      : { kind: 'stroke', ink: it.c || 'col', width: it.w, points: pairs(it.pts) }),
  };
}

const f4 = v => (+v).toFixed(4);

// The ornament's paths. X and Y map engine coordinates (y up) to SVG coordinates; s scales widths.
function paths(items, P, o, X, Y, s = 1) {
  let out = '';
  for (const it of items) {
    const ink = it.c || 'col';
    if (o.only && ink !== o.only) continue;
    const p = it.pts; let d = 'M' + f4(X(p[0])) + ' ' + f4(Y(p[1]));
    for (let i = 2; i < p.length; i += 2) d += 'L' + f4(X(p[i])) + ' ' + f4(Y(p[i + 1]));
    if (it.t === 'p') {
      if (it.h > 0 && o.halo !== false && P.bg !== 'none')
        out += `<path d="${d}Z" fill="none" stroke="${P.bg}" stroke-width="${f4(it.h * s)}" stroke-linejoin="round"/>`;
      out += `<path d="${d}Z" fill="${P[ink] || P.col}"/>`;
    } else out += `<path d="${d}" fill="none" stroke="${P[ink] || P.col}" stroke-width="${f4(it.w * s)}" stroke-linecap="round"/>`;
  }
  return out;
}

// The page's toSVG, with the palette, background, size and layer choices exposed.
export function toSVG(items, bbox, P, o = {}) {
  const b = bbox, pad = o.pad ?? 0.03, pd = pad * Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const W = b.x1 - b.x0 + 2 * pd, H = b.y1 - b.y0 + 2 * pd;
  let size = '';
  if (o.widthMm) size = ` width="${f4(o.widthMm)}mm" height="${f4(o.widthMm * H / W)}mm"`;
  else if (o.heightMm) size = ` width="${f4(o.heightMm * W / H)}mm" height="${f4(o.heightMm)}mm"`;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f4(W)} ${f4(H)}"${size}>`;
  if (P.bg !== 'none') out += `<rect width="100%" height="100%" fill="${P.bg}"/>`;
  out += paths(items, P, o, v => v - b.x0 + pd, v => b.y1 - v + pd);
  return out + '</svg>\n';
}

// A grid of ornaments, each scaled to fit its cell, captioned with its name or numbers.
export function sheetSVG(cells, P, o = {}) {
  const cols = o.cols || 4, cw = 400, ch = 300, cap = 34, rows = Math.ceil(cells.length / cols);
  const W = cols * cw, H = rows * (ch + cap);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  out += `<rect width="100%" height="100%" fill="${P.bg === 'none' ? '#ffffff' : P.bg}"/>`;
  cells.forEach(({ items, bbox: b, caption }, i) => {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + cap), m = 18;
    const s = Math.min((cw - 2 * m) / Math.max(1e-9, b.x1 - b.x0), (ch - 2 * m) / Math.max(1e-9, b.y1 - b.y0));
    const ox = cx + cw / 2 - s * (b.x0 + b.x1) / 2, oy = cy + ch / 2 + s * (b.y0 + b.y1) / 2;
    out += paths(items, P, o, v => ox + s * v, v => oy - s * v, s);
    out += `<text x="${cx + cw / 2}" y="${cy + ch + 20}" font-family="Helvetica, Arial, sans-serif" font-size="17" ` +
      `text-anchor="middle" fill="${P.col}">${caption}</text>`;
  });
  return out + '</svg>\n';
}

async function writeOut(file, svg, px) {
  if (!file) { process.stdout.write(svg); return; }
  if (!file.toLowerCase().endsWith('.png')) { fs.writeFileSync(file, svg); return; }
  let Resvg;
  try { ({ Resvg } = require('@resvg/resvg-js')); }
  catch { throw new Error('PNG output needs @resvg/resvg-js: run npm install in the kurbits folder'); }
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: px || 1600 }, font: { loadSystemFonts: true } }).render().asPng();
  fs.writeFileSync(file, png);
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-o') a.o = argv[++i];
    else if (t === '-h') a.help = true;
    else if (t.startsWith('--')) {
      const k = t.slice(2);
      if (['json', 'no-halo', 'help'].includes(k)) a[k] = true;
      else a[k] = argv[++i];
    } else a._.push(t);
  }
  return a;
}

function point(s) {
  const v = s.split(',').map(Number);
  if (v.length < 3 || v.some(Number.isNaN)) throw new Error(`wanted X,Y,Z[,DETAIL[,ASPECT]], got ${s}`);
  return { x: v[0], y: v[1], z: v[2], detail: v[3] ?? 0.4, aspect: v[4] ?? 1 };
}

function selection(m, a) {
  let p;
  if (a.at) p = point(a.at);
  else {
    const name = a.preset || Object.keys(m.presets)[0];
    const key = Object.keys(m.presets).find(k => k.toLowerCase() === String(name).toLowerCase());
    if (!key) throw new Error(`unknown preset ${name}; try: ${Object.keys(m.presets).join(', ')}`);
    const [x, y, z, detail, aspect] = m.presets[key];
    p = { preset: key, x, y, z, detail, aspect };
  }
  if (a.detail != null) p.detail = +a.detail;
  if (a.aspect != null) p.aspect = +a.aspect;
  return p;
}

function palette(m, a) {
  const P = { ...(m.palettes[a.palette || 'panel'] || m.palettes.panel) };
  for (const k of ['bg', 'col', 'acc']) if (a[k]) P[k] = a[k];
  return P;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd || a.help) {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(3, 26)
      .map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return;
  }
  const m = loadMachine();
  const grow = a.grow != null ? +a.grow : 1, res = a.res != null ? +a.res : 2.5, px = a.px ? +a.px : undefined;
  const opts = { halo: !a['no-halo'], only: a.only };
  if (cmd === 'presets') {
    const s = a.json ? JSON.stringify(m.presets, null, 1) + '\n' : Object.entries(m.presets).map(([k, v]) =>
      `${k.padEnd(10)} x ${v[0]}  y ${v[1]}  z ${v[2]}  detail ${v[3]}  aspect ${v[4]}`).join('\n') + '\n';
    return writeOut(a.o, s);
  }
  if (cmd === 'sheet') {
    const list = a.points ? a.points.split(/[;\n]/).map(s => s.trim()).filter(Boolean).map(s => ({ p: point(s), caption: s }))
      : Object.entries(m.presets).map(([k, [x, y, z, detail, aspect]]) => ({ p: { x, y, z, detail, aspect }, caption: k }));
    const cells = list.map(({ p, caption }) => {
      if (a.detail != null) p.detail = +a.detail;
      if (a.aspect != null) p.aspect = +a.aspect;
      const items = m.build(p, grow, res); return { items, bbox: m.bbox(items), caption };
    });
    return writeOut(a.o, sheetSVG(cells, palette(m, a), { ...opts, cols: a.cols ? +a.cols : 4 }), px);
  }
  const p = selection(m, a);
  const items = m.build(p, grow, res);
  const bb = m.bbox(items);
  if (cmd === 'json') return writeOut(a.o, JSON.stringify(toJSON(items, bb, p)) + '\n');
  if (cmd === 'svg') return writeOut(a.o, toSVG(items, bb, palette(m, a), {
    ...opts, pad: a.pad != null ? +a.pad : undefined, widthMm: a['width-mm'] ? +a['width-mm'] : undefined,
    heightMm: a['height-mm'] ? +a['height-mm'] : undefined,
  }), px);
  throw new Error(`unknown command ${cmd} (presets, svg, json, sheet)`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
  main().catch(e => { process.stderr.write('kurbits: ' + e.message + '\n'); process.exit(1); });
}
