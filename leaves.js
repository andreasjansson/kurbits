// Kurbits Leaves: a second Kurbits engine of line-drawn leaves and flowers after Dalecarlian kurbits painting
// (dalmålning, c. 1780-1870). A kurbits leaf is not a botanical leaf but a brush stroke: a thick band that comes out
// broad from behind a flower or another leaf, swells, arches over like a horn or a breaking wave and tapers into a
// point that hooks back, striped along its length. Fanned out from one point, such strokes become a cluster of hooked
// fingers or, shorter and rounder, a fan with a scalloped edge; closed into a full ring they become a rosette, and
// cupped together a tulip. Everything is a pen line; nothing is filled.
//
// Like the Kurbits Machine (index.html) a design is a point in a continuous space, and is built by one recursive rule:
// a shoot (a stalk, then a head of strokes) grows smaller shoots from behind itself, along its length and from behind
// its head, which grow smaller ones, down to the depth that detail sets. x, y and z choose the composition (how many
// shoots spring from the root and where they head, how they bend, where along them their sprouts come out, how many
// of the heads are flowers, and whether the design is mirrored), detail the depth, plump, lobes and curl the leaf
// (slender to fat; a horn, a cluster of fingers or a fan; gentle to hooked), variation how much the leaves differ,
// aspect the proportions: wider, a frieze of repeats along a runner, taller, a tower of tiers. Each repeat wanders
// from the motif with its place along the frieze, so the plants change gradually along its length; x, y, z and
// variation set how far. Every number is continuous, every point draws a design, and a small step in any number
// changes it only a little: whatever appears, a generation, a shoot, a finger, a petal, a stripe or a repeat, grows
// from nothing. No dependencies; used by the Leaves tab of index.html and by cli/leaves.mjs.
//
// Output: pen lines, in drawing order, engine units (about one unit per main shoot), y up:
//   {t: 'l', pts: [x0, y0, x1, y1, ...], w}   a line of width w with round ends and joins (closed if it ends
//                                              where it starts)
// A line that swells or tapers, like a brush stroke, is drawn as several such lines end to end. Hidden lines are
// already removed: a line that passes behind a leaf or a stalk stops a small gap short of its outline, as in an
// engraving.
const TAU = Math.PI * 2, GOLD = 2.399963229728653;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// three incommensurate sines: smooth, never repeating, in [-1, 1]
const Q = t => (Math.sin(t) + Math.sin(1.6180339887 * t + 1.3) + Math.sin(2.6180339887 * t + 2.1)) / 3;
const PEN0 = 0.0072, VEIN0 = 0.0046;               // the outline pen and the stripe pen, in main-shoot lengths
let PEN = PEN0, VEIN = VEIN0;                      // the pens for this design (a large design draws a little bolder)
let MIN = 0;                                       // the narrowest line kept for small prints, from build()
let GAP = 0;                                       // the narrowest gap between lines for small prints
let TRACE = null;                                  // where sprouts come out, if build() was asked to record it

// ------------------------------------------------------------------ lines and what hides them
// A scene collects pen lines and silhouettes, each at a depth z (larger is nearer). At the end every line is cut where
// a nearer silhouette covers it. next(k) hands out depths: a deeper generation lies behind every shallower one, and
// within a generation each new part lies behind the parts made before it. A line of width w may swell and taper: then
// its points carry a running parameter U and its width is w f(u) (see ink()).
class Scene {
  constructor() { this.shapes = []; this.lines = []; this.n = 0; }
  next(gen) { return -gen * 1e6 - this.n++; }
  line(pts, w, z, U = null, f = null, cuts = null) { if (pts.length >= 4 && w > 0) this.lines.push({ pts, w, z, U, f, cuts }); }
  // a silhouette (a closed polygon, not repeated at its end); lines behind it stop `halo` short of its edge
  shape(poly, halo, z) { if (poly.length >= 6) this.shapes.push({ poly, halo, z }); }
}

// A polyline P whose points carry U, cut wherever U passes one of the values `cuts`: [[points, their U], ...]. The cuts
// are fixed values of U, so the pieces move smoothly as the line does.
function split(P, U, cuts) {
  const n = U.length, out = [];
  const bucket = u => { let b = 0; while (b < cuts.length && cuts[b] <= u) b++; return b; };
  let cur = [P[0], P[1]], cu = [U[0]];
  for (let i = 1; i < n; i++) {
    const ua = U[i - 1], ub = U[i], ba = bucket(ua), bb = bucket(ub);
    for (let b = ba, d = bb > ba ? 1 : -1; b !== bb; b += d) {
      const cv = cuts[d > 0 ? b : b - 1], f = (cv - ua) / (ub - ua), x = lerp(P[2 * i - 2], P[2 * i], f), y = lerp(P[2 * i - 1], P[2 * i + 1], f);
      cur.push(x, y); cu.push(cv); out.push([cur, cu]); cur = [x, y]; cu = [cv];
    }
    cur.push(P[2 * i], P[2 * i + 1]); cu.push(ub);
  }
  out.push([cur, cu]);
  return out;
}

// A closed polygon moved outwards by h along its vertex normals.
function offset(P, h) {
  const n = P.length / 2; let A = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) A += P[2 * j] * P[2 * i + 1] - P[2 * i] * P[2 * j + 1];
  const s = A > 0 ? 1 : -1, out = new Array(2 * n);   // anticlockwise (A > 0): outwards is to the right of travel
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    let tx = P[2 * b] - P[2 * a], ty = P[2 * b + 1] - P[2 * a + 1]; const l = Math.hypot(tx, ty);
    if (l > 0) { tx /= l; ty /= l; }
    out[2 * i] = P[2 * i] + s * ty * h; out[2 * i + 1] = P[2 * i + 1] - s * tx * h;
  }
  return out;
}

// Point-in-polygon tests, made quick by sorting the polygon's edges into horizontal slabs.
function prep(sh) {
  const P = sh.sil, n = P.length / 2; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = clamp(Math.round(n / 6), 1, 64), hs = (y1 - y0) / m || 1, slabs = Array.from({ length: m }, () => []);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ya = P[2 * i + 1], yb = P[2 * j + 1];
    const a = clamp(Math.floor((Math.min(ya, yb) - y0) / hs), 0, m - 1), b = clamp(Math.floor((Math.max(ya, yb) - y0) / hs), 0, m - 1);
    for (let q = a; q <= b; q++) slabs[q].push(i);
  }
  Object.assign(sh, { x0, x1, y0, y1, slabs, hs, m });
}
function inside(sh, x, y) {
  if (x < sh.x0 || x > sh.x1 || y < sh.y0 || y > sh.y1) return false;
  const P = sh.sil, n = P.length / 2, E = sh.slabs[clamp(Math.floor((y - sh.y0) / sh.hs), 0, sh.m - 1)];
  let c = false;
  for (let e = 0; e < E.length; e++) {
    const i = E[e], j = i + 1 < n ? i + 1 : 0, xi = P[2 * i], yi = P[2 * i + 1], xj = P[2 * j], yj = P[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Hidden-line removal: every line is split where it passes under a nearer silhouette; the cut is found by bisection,
// so it moves smoothly as the shapes move. A piece shorter than five times its width is drawn thinner, in proportion,
// so that it shrinks away instead of vanishing as a dot (below 0.04 of its width it is too small to see and is left out;
// for small prints, MIN > 0, a piece shorter than its width is left out). A swelling line is then cut into pieces of
// one width each, joined end to end by their round ends. Silhouettes are sorted into a grid, so each point of a line
// meets only the silhouettes in the cell under it.
function hide(sc) {
  const S = sc.shapes.filter(s => s.halo >= 0);
  for (const s of S) { s.sil = s.halo > 0 ? offset(s.poly, s.halo) : s.poly; prep(s); }
  let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
  for (const s of S) { gx0 = Math.min(gx0, s.x0); gy0 = Math.min(gy0, s.y0); gx1 = Math.max(gx1, s.x1); gy1 = Math.max(gy1, s.y1); }
  // about 64 x 64 cells, nearly square however long the design
  const ra = Math.sqrt(Math.max(1e-6, gx1 - gx0) / Math.max(1e-6, gy1 - gy0)), GX = clamp(Math.round(64 * ra), 8, 1024), GY = clamp(Math.round(64 / ra), 8, 1024);
  const cw = Math.max(1e-6, (gx1 - gx0) / GX), ch = Math.max(1e-6, (gy1 - gy0) / GY), grid = Array.from({ length: GX * GY }, () => []);
  const cell = (v, o, c, G) => clamp(Math.floor((v - o) / c), 0, G - 1);
  for (const s of S) for (let i = cell(s.x0, gx0, cw, GX); i <= cell(s.x1, gx0, cw, GX); i++) for (let j = cell(s.y0, gy0, ch, GY); j <= cell(s.y1, gy0, ch, GY); j++) grid[i * GY + j].push(s);
  const out = [], len = r => { let l = 0; for (let i = 2; i < r.length; i += 2) l += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]); return l; };
  const keep = (r, ru, L) => {
    const l = len(r);
    if (!L.U) { if (MIN ? l > L.w : l > 0.04 * L.w) out.push({ t: 'l', pts: r, w: Math.max(MIN, MIN ? L.w : L.w * Math.min(1, l / (5 * L.w))) }); return; }
    let wm = 0; for (const u of ru) wm = Math.max(wm, L.w * L.f(u));
    if (!(wm > 0) || (MIN ? l <= wm : l <= 0.04 * wm)) return;
    const t = MIN ? 1 : Math.min(1, l / (5 * wm));
    // pieces of no width are left out (for small prints, those under half the narrowest line: a crossfade becomes a
    // switch); neighbouring pieces within 8% of one width are drawn as one line
    let g = null;
    for (const [pts, us] of split(r, ru, L.cuts)) {
      const w = L.w * L.f((us[0] + us[us.length - 1]) / 2) * t;
      if (!(pts.length >= 4 && w > 0.5 * MIN && w > 0)) { g = null; continue; }
      if (g && Math.max(g.hi, w) <= 1.08 * Math.min(g.lo, w)) { for (let i = 2; i < pts.length; i++) g.it.pts.push(pts[i]); g.lo = Math.min(g.lo, w); g.hi = Math.max(g.hi, w); }
      else { g = { it: { t: 'l', pts: pts.slice(), w: 0 }, lo: w, hi: w }; out.push(g.it); }
      g.it.w = Math.max(MIN, (g.lo + g.hi) / 2);
    }
  };
  for (const L of sc.lines) {
    const p = L.pts, n = p.length / 2, z = L.z, U = L.U;
    // hidden: inside a nearer silhouette among those in the grid cell under the point
    const hid = (x, y) => {
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) return false;
      const C = grid[cell(x, gx0, cw, GX) * GY + cell(y, gy0, ch, GY)];
      for (let c = 0; c < C.length; c++) if (C[c].z > z && inside(C[c], x, y)) return true;
      return false;
    };
    const f = new Array(n); let any = false;
    for (let i = 0; i < n; i++) { f[i] = hid(p[2 * i], p[2 * i + 1]); if (f[i]) any = true; }
    if (!any) { keep(p, U, L); continue; }
    const cross = (i, j) => {                      // i is visible, j hidden: the last visible point between them
      let a = 0, b = 1;
      for (let r = 0; r < 8; r++) { const m = (a + b) / 2; if (hid(lerp(p[2 * i], p[2 * j], m), lerp(p[2 * i + 1], p[2 * j + 1], m))) b = m; else a = m; }
      return [lerp(p[2 * i], p[2 * j], a), lerp(p[2 * i + 1], p[2 * j + 1], a), U ? lerp(U[i], U[j], a) : 0];
    };
    const runs = []; let cur = null, cu = null;
    for (let i = 0; i < n; i++) {
      if (!f[i]) {
        if (!cur) { cur = []; cu = []; if (i > 0) { const [x, y, u] = cross(i, i - 1); cur.push(x, y); cu.push(u); } }
        cur.push(p[2 * i], p[2 * i + 1]); if (U) cu.push(U[i]);
      } else if (cur) { const [x, y, u] = cross(i - 1, i); cur.push(x, y); cu.push(u); runs.push([cur, cu]); cur = null; }
    }
    if (cur) runs.push([cur, cu]);
    // a closed line whose start (= end) is visible: its last and first pieces are one
    if (!U && runs.length > 1 && !f[0] && p[0] === p[2 * n - 2] && p[1] === p[2 * n - 1]) { const a = runs.pop(); runs[0][0] = a[0].concat(runs[0][0].slice(2)); }
    for (const [r, ru] of runs) keep(r, ru, L);
  }
  return out;
}

// ------------------------------------------------------------------ curves
// A curve from (x0, y0) at heading h0, length L, by integrating its curvature k(u) (radians per unit u, u = 0..1),
// sampled at n + 1 points. Each sample step is integrated in four sub-steps, so the shape hardly depends on n.
function curve(x0, y0, h0, L, k, n) {
  const X = [x0], Y = [y0], H = [h0]; let x = x0, y = y0, h = h0; const du = 1 / (4 * n);
  for (let i = 0; i < 4 * n; i++) {
    const k0 = k(i * du), k1 = k((i + 1) * du), hm = h + 0.25 * (k0 + k1) * du;
    x += Math.cos(hm) * L * du; y += Math.sin(hm) * L * du; h += 0.5 * (k0 + k1) * du;
    if (i % 4 === 3) { X.push(x); Y.push(y); H.push(h); }
  }
  return { X, Y, H, n, L };
}
// a point and heading on a sampled curve at u (0..1), interpolated
function at(c, u) {
  const v = clamp(u) * c.n, i = Math.min(c.n - 1, Math.floor(v)), f = v - i;
  return [lerp(c.X[i], c.X[i + 1], f), lerp(c.Y[i], c.Y[i + 1], f), lerp(c.H[i], c.H[i + 1], f)];
}
// The outline of a band of half-width w(u) around a sampled curve, one closed polygon with round ends. Where the curve
// turns tighter than the band is wide, the inner side is narrowed, so it never loops.
function band(c, w) {
  const L = [], R = [], hw = [];
  for (let i = 0; i <= c.n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(c.n, i + 1), ds = Math.hypot(c.X[b] - c.X[a], c.Y[b] - c.Y[a]) || 1e-9;
    const k = (c.H[b] - c.H[a]) / ds, ww = w(i / c.n), lim = q => ww / Math.pow(1 + Math.pow(Math.max(0, q * ww) / 0.8, 4), 0.25);
    const nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]), wl = lim(k), wr = lim(-k);
    L.push(c.X[i] + nx * wl, c.Y[i] + ny * wl); R.push(c.X[i] - nx * wr, c.Y[i] - ny * wr); hw.push((wl + wr) / 2);
  }
  const cap = (i, dir) => {                        // a half circle round sample i, from the left side to the right
    const q = [], x = c.X[i], y = c.Y[i], h = c.H[i] + (dir < 0 ? Math.PI : 0), r = hw[i];
    for (let m = 1; m < 6; m++) { const a = h + Math.PI / 2 - Math.PI * m / 6; q.push(x + r * Math.cos(a), y + r * Math.sin(a)); }
    return q;
  };
  const P = L.slice();
  P.push(...cap(c.n, 1));
  for (let i = R.length - 2; i >= 0; i -= 2) P.push(R[i], R[i + 1]);
  P.push(...cap(0, -1));
  return P;
}

// Ink along a polyline P whose points carry a running parameter U, with the width wf(u) and at the depth zf(u): a line
// that swells and tapers like a brush stroke. It is cut at the values `cuts` (which must include every place where zf
// changes) into pieces of one width each, after the hidden lines are removed (hide()); each run of pieces at one depth
// goes into the scene as one line.
function ink(sc, P, U, wf, zf, cuts) {
  if (U.length < 2) return;
  let cur = null, cz = 0;
  for (const [pts, us] of split(P, U, cuts)) {
    const z = zf((us[0] + us[us.length - 1]) / 2);
    if (cur && z !== cz) { sc.line(cur[0], 1, cz, cur[1], wf, cuts); cur = null; }
    if (!cur) { cur = [pts.slice(), us.slice()]; cz = z; }
    else { cur[0].push(...pts.slice(2)); cur[1].push(...us.slice(1)); }
  }
  if (cur) sc.line(cur[0], 1, cz, cur[1], wf, cuts);
}
const EIGHTHS = [1, 2, 3, 4, 5, 6, 7].map(j => j / 8), SIXTEENTHS = Array.from({ length: 15 }, (_, j) => (j + 1) / 16);

// ------------------------------------------------------------------ the brush stroke
// One stroke: the kurbits leaf's single gesture. From (x0, y0) at heading h0, length l, chirality c (it arches
// anticlockwise for c > 0; at 0 it is straight and symmetric). Its spine is described by its curvature: an arch that
// tightens towards the tip (the S reverses it near the base), then a hook that winds like a logarithmic spiral; past
// the band's end (the share `tail`) the tip winds on as a hairline. The band's half-width on each side is the stroke's
// length times wid times an envelope: broad at the base (base), swelling to its widest at vs, then tapering to a sharp
// point (round = 0) or closing in a round end (round = 1, a petal or a lobe of a fan); the convex side, away from the
// arch, swells further (asym). Its outline swells and thins as a brush stroke does: thickest along the convex side's
// belly, fine at the tip. Inside, stripes run along it, crowding towards the convex side, and run together at the tip.
// Its depth is zb, its tip (from 0.62 of the band on) zt, in front, so a tip that hooks back over the band hides what
// lies beneath. Returns the spine and the half-width on each side, where sprouts attach.
function stroke(sc, x0, y0, h0, l, P, c, zb, zt, pen) {
  if (!(l > 1e-4)) return null;
  // the arch's direction: nearly full as soon as c leaves 0, so that few strokes are straight
  const n = P.n, ub = 1 - P.tail, cc = Math.sign(c) * Math.pow(Math.min(1, 1.6 * Math.abs(c)), 0.6), { pw, vw, gap } = pen;
  const r0 = 0.05 + 0.004 / l, uc = 0.55 * ub, C = TAU * P.hook / Math.log((1 - uc + r0) / r0);
  const kap = u => cc * (P.turn * (0.5 + u) * (1 - 3 * P.ess * (1 - u) * (1 - u)) + C * smooth(uc, uc + 0.3, u) / (1 - u + r0)) + (P.sway ? P.sway(u) : 0);
  const sp = curve(x0, y0, h0, l, kap, n);
  const K = sp.H.map((h, i) => { const a = Math.max(0, i - 1), b = Math.min(n, i + 1); return (sp.H[b] - sp.H[a]) / ((b - a) / n * l); });
  const vs = P.vs;
  const neck = v => lerp(1, 0.22 + 0.78 * smooth(0, 0.2, v), P.neck);   // on a stalk, the band flares out of it
  const env = v => neck(v) * (v >= 1 ? 0 : v <= vs ? lerp(P.base, 1, Math.sin(Math.PI / 2 * Math.max(0, v) / vs)) : (t => lerp(Math.pow(1 - t, P.p), Math.sqrt(Math.max(0, 1 - t * t)), P.round))((v - vs) / (1 - vs)));
  const o = s => (1 - s * clamp(4 * c, -1, 1)) / 2;   // 1 on the convex side
  const half = (s, u, k) => {
    const w0 = l * P.wid * (1 + P.asym * (2 * o(s) - 1)) * env(u / ub);
    return w0 / Math.pow(1 + Math.pow(Math.max(0, s * k * w0) / 0.8, 4), 0.25);
  };
  const kAt = u => { const t = clamp(u) * n, j = Math.min(n - 1, Math.floor(t)); return lerp(K[j], K[j + 1], t - j); };
  // the band, sampled at fixed shares v of its length (closer together towards the tip)
  const nb = n, G = [];
  for (let i = 0; i <= nb; i++) {
    const v = 0.5 * i / nb + 0.5 * Math.sin(Math.PI / 2 * i / nb), u = v * ub, [x, y, h] = at(sp, u), k = kAt(u);
    G.push({ v, x, y, h, l: i < nb ? half(1, u, k) : 0, r: i < nb ? half(-1, u, k) : 0 });
  }
  const pL = g => [g.x - g.l * Math.sin(g.h), g.y + g.l * Math.cos(g.h)], pR = g => [g.x + g.r * Math.sin(g.h), g.y - g.r * Math.cos(g.h)];
  // the outline: up the left side (U = v), down the right (U = 2 - v), round the base (U from 2 to 3), where the
  // band comes out from behind whatever it springs from
  const poly = [], U = [];
  for (let i = 0; i <= nb; i++) { poly.push(...pL(G[i])); U.push(G[i].v); }
  for (let i = nb - 1; i >= 0; i--) { poly.push(...pR(G[i])); U.push(2 - G[i].v); }
  const g0 = G[0], d = 0.25 * (g0.l + g0.r), tx = Math.cos(g0.h), ty = Math.sin(g0.h), nx = -ty, ny = tx;
  for (let m = 1; m < 6; m++) {
    const f = m / 6, a = Math.PI * f, w = lerp(-g0.r, g0.l, (1 - Math.cos(a)) / 2);
    poly.push(g0.x - tx * d * Math.sin(a) + nx * w, g0.y - ty * d * Math.sin(a) + ny * w); U.push(2 + f);
  }
  const widths = () => {
    const wl = [], wr = [];
    for (let i = 0; i <= n; i++) { const u = i / n; wl.push(u < ub ? half(1, u, K[i]) : 0); wr.push(u < ub ? half(-1, u, K[i]) : 0); }
    return { sp, wl, wr };
  };
  if (P.quick) { sc.line(poly, pw, zb); return widths(); }   // only measuring: the outline is enough
  let wmax = 0;
  for (const g of G) wmax = Math.max(wmax, g.l, g.r);
  const soft = Math.min(1, wmax / (3 * PEN)), halo = (pw / 2 + gap) * soft;
  sc.shape(poly, halo, zb);
  // the tip, from 0.7 of the band on, is a nearer shape of its own
  const tip = [];
  for (let i = 0; i <= nb; i++) if (G[i].v >= 0.7) tip.push(...pL(G[i]));
  for (let i = nb - 1; i >= 0; i--) if (G[i].v >= 0.7) tip.push(...pR(G[i]));
  sc.shape(tip, Math.min(halo, 0.05 * l), zt);
  // a band too narrow to read as one is drawn as a single hairline along its spine instead, the two crossfading
  const oL = o(1), oR = o(-1), al = smooth(1.2 * pw, 3 * pw, wmax);
  const swell = v => Math.pow(Math.sin(Math.PI * clamp(v / 0.92)), 0.8);
  const edge = (v, oo) => al * pw * lerp(0.8 + 0.2 * swell(v), 0.7 + 0.8 * swell(v), oo) * (1 - 0.45 * smooth(0.72, 1, v));
  const cuts = [...SIXTEENTHS, 0.62, 1, 1.38, 2, ...SIXTEENTHS.map(v => 1 + v)].sort((a, b) => a - b);
  ink(sc, poly.concat(poly.slice(0, 2)), U.concat(3), u => u <= 1 ? edge(u, oL) : u <= 2 ? edge(2 - u, oR) : 0.7 * pw, u => u < 2 && Math.min(u, 2 - u) > 0.62 ? zt : zb, cuts);
  if (al < 1) {
    const T = [], TU = [];
    for (const g of G) { T.push(g.x, g.y); TU.push(g.v); }
    ink(sc, T, TU, v => (1 - al) * pw * lerp(0.9, 0.5, v), v => v > 0.62 ? zt : zb, [...EIGHTHS, 0.62].sort((a, b) => a - b));
  }
  // the hairline past the band
  if (ub < 1) {
    const [x1, y1] = at(sp, ub), T = [x1, y1], TU = [ub];
    for (let i = Math.floor(ub * n) + 1; i <= n; i++) { T.push(sp.X[i], sp.Y[i]); TU.push(i / n); }
    ink(sc, T, TU, u => pw * lerp(0.5, 0.16, (u - ub) / (1 - ub)), () => zt, [1, 2, 3, 4, 5].map(j => ub + (1 - ub) * j / 6));
  }
  // stripes: stripe j lies at the share f_j of the width from the left edge, j / (stripes + 1) pushed towards the
  // convex side, and is drawn where it is a line and a gap clear of its neighbours, so the stripes run together at the
  // tip; a fractional count grows the last stripe back from the tip. Each swells in the middle and thins at its ends.
  if (P.stripes > 0) {
    const ns = P.stripes, need = vw + gap, bL = 0.55 * (2 * oL - 1), iT = (() => { let i = 0; while (G[i + 1].v <= 0.62) i++; return i + (0.62 - G[i].v) / (G[i + 1].v - G[i].v); })();
    const fr = j => { const f = Math.min(1, j / (ns + 1)); return f - bL * f * (1 - f); };
    const scuts = [...EIGHTHS.map(v => v * nb), iT].sort((a, b) => a - b);
    for (let j = 1; j <= Math.ceil(ns - 1e-9); j++) {
      const wt = clamp(ns - j + 1); if (wt <= 0) continue;
      const f = fr(j), df = Math.min(f - fr(j - 1), fr(j + 1) - f), room = i => (G[i].l + G[i].r) * df - need;
      // the longest run of samples with room, its ends found between samples
      let a = -1, b = -1, best = 0, ra = -1;
      for (let i = 0; i <= nb; i++) {
        if (room(i) >= 0) { if (ra < 0) ra = i; if (i - ra > best) { best = i - ra; a = ra; b = i; } } else ra = -1;
      }
      if (a < 0 || b <= a) continue;
      const ta = a > 0 ? a - room(a) / (room(a) - room(a - 1)) : a, tb = b < nb ? b + room(b) / (room(b) - room(b + 1)) : b;
      const t0 = lerp(tb, ta, wt);
      if (tb - t0 < 1e-3) continue;
      const S = [], SU = [];
      const pt = t => {
        const i = Math.min(nb - 1, Math.floor(t)), fi = t - i, A = G[i], B = G[i + 1];
        const x = lerp(A.x, B.x, fi), y = lerp(A.y, B.y, fi), h = lerp(A.h, B.h, fi), wl = lerp(A.l, B.l, fi), wr = lerp(A.r, B.r, fi), dd = wl - f * (wl + wr);
        S.push(x - dd * Math.sin(h), y + dd * Math.cos(h)); SU.push(t);
      };
      pt(t0); for (let i = Math.floor(t0) + 1; i < tb; i++) pt(i); pt(tb);
      ink(sc, S, SU, t => vw * (0.45 + 0.55 * Math.sin(Math.PI * clamp((t - t0) / (tb - t0)))), t => t > iT ? zt : zb, scuts);
    }
  }
  return widths();
}

// ------------------------------------------------------------------ the head: strokes fanned from one point
// A head at (x, y), heading h, its strokes l long, with the numbers H (from form()). Its m strokes (the last,
// fractional one growing in) fan out from the one point, delta apart: one-sided, each further one turned towards the
// concave side of the first and shorter by rho (a = 0: a horn, a cluster of hooked fingers, a fan), or centred,
// alternating left and right of the first (a = 1: a palmette seen from the front, a tulip, a rosette). A centred
// stroke curls by dir away from the middle (outwards; inwards, cupping, for a tulip). Behind the outer ring a
// rosette has inner rings, each smaller and turned half a step, and a centre in front of them. On the axis of a
// mirrored design (half) only the strokes on the right are drawn; the mirror completes them.
function head(sc, x, y, h, l, H, c, k, half, pen, n, quick, sway, ess, neck) {
  // a straight shoot (c near 0) has no concave side, so its fan is centred
  const M = H.m, nM = Math.ceil(M - 1e-9), W = H.whorls, nW = Math.ceil(W - 1e-9), a = Math.max(H.a, 1 - Math.abs(clamp(4 * c, -1, 1)));
  // depths, front to back: the centre, the inner rings (the innermost first), the outer ring
  const zc = sc.next(k), Z = [];
  for (let r = nW; r >= 0; r--) { Z[r] = []; for (let i = 0; i < nM; i++) Z[r][i] = [sc.next(k), sc.next(k)]; }
  const sg = clamp(4 * c, -1, 1), del = H.fan / Math.max(1, M - 1 + H.fan / TAU);
  let first = null;
  for (let r = 0; r <= (quick ? 0 : nW); r++) {                 // measuring needs only the outer ring
    const wr = r ? clamp(W - r + 1) * (1 - 0.3 * r) : 1; if (wr <= 0) continue;
    for (let i = 0; i < nM; i++) {
      const wi = i ? clamp(M - i) : 1; if (wi <= 0) continue;
      // centred places: 0, +1, -1, +2, -2, ... (an inner ring, turned half a step: +1/2, -1/2, +3/2, -3/2, ...)
      const alt = r % 2 ? (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 0.5) : i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) : 0;
      if (half && alt > 1e-9) continue;
      const th = del * lerp(sg * (i + r / 2), alt, a), rank = lerp(i, Math.ceil(i / 2), a);
      const ci = lerp(c, clamp(th / 0.3, -1, 1) * H.dir, a);
      const li = l * H.len * wr * Math.pow(H.rho, rank) * wi;
      const P = { n: i || r ? Math.max(12, Math.round(0.4 * n)) : n, quick, turn: H.turn, hook: H.hook, tail: H.tail, wid: H.wid, vs: H.vs, base: H.base, round: H.round, p: H.p, asym: H.asym, stripes: H.stripes, neck, ess: i || r ? 0 : ess, sway: i || r ? null : sway };
      const s = stroke(sc, x, y, h + th, li, P, ci, Z[r][i][1], Z[r][i][0], pen);
      if (!i && !r) first = s;
    }
  }
  // the centre: a round boss with a ring inside it
  const rc = l * H.len * H.centre;
  if (rc > 1e-5 && !quick) {
    const C = [], D = [];
    for (let j = 0; j <= 40; j++) { const t = TAU * j / 40 + h; C.push(x + rc * Math.cos(t), y + rc * Math.sin(t)); D.push(x + 0.55 * rc * Math.cos(t), y + 0.55 * rc * Math.sin(t)); }
    sc.shape(C.slice(0, -2), (pen.pw / 2 + pen.gap) * Math.min(1, rc / (3 * PEN)), zc);
    sc.line(C, pen.pw, zc); sc.line(D, pen.vw, zc);
  }
  return first;
}

// A fan of hairlines springing from the outer side of a bend, as painters flick them from a scroll: from (x, y) on
// the edge, the shoot heading h, on side s (+1 the left), nh strokes leaning out from 0.45 to 1.35 radians and spread a
// little along the shoot, each a line that tapers from its root and bends back the way the shoot goes.
function hairs(sc, x, y, h, s, len, nh, pen, z, quick) {
  const N = Math.ceil(nh - 1e-9);
  for (let i = 0; i < N; i++) {
    const wi = clamp(nh - i); if (wi <= 0) continue;
    const f = clamp(i / Math.max(1, nh - 1)), b = h + s * lerp(0.45, 1.35, f), d = (f - 0.5) * 0.3 * len;
    const li = len * (0.7 + 0.3 * Math.sin(Math.PI * f)) * wi;
    const cv = curve(x + d * Math.cos(h), y + d * Math.sin(h), b, li, u => -s * (0.8 + 1.2 * u), quick ? 4 : 12);
    const P = [], U = [];
    for (let j = 0; j <= cv.n; j++) { P.push(cv.X[j], cv.Y[j]); U.push(j / cv.n); }
    ink(sc, P, U, u => pen.vw * lerp(1.5, 0.2, u), () => z, [1, 2, 3, 4, 5].map(j => j / 6));
  }
}

// ------------------------------------------------------------------ settings
// The composition is read off slow waves through the space, as in the Machine: setting k is lo + (hi - lo) times a
// wave osc(x, y, z, k) between 0 and 1 (beyond a threshold t, so that some settings rest at lo in parts of the space).
// The repeats of a frieze or a tower read the same waves with their phases shifted (wander, below).
const osc = (x, y, z, k, ph = 0) => 0.5 + 0.5 * Math.sin(0.28 * Math.cos(k * GOLD) * x + 0.28 * Math.sin(1.31 * k * GOLD + 0.4) * y + 0.24 * Math.cos(1.77 * k + 1.1) * z + 1.618 * k + ph);
const SETTINGS = [                                 // [name, lo, hi, threshold, drift: how far it wanders (1 if unset)]
  ['turn', 0.05, 2.55, 0, 0.45],  // where the main shoot heads, from straight up (0) through sideways (pi/2) to hanging
  ['shoots', 1, 3.4],        // how many shoots spring from the root
  ['spread', 0.32, 0.85],    // the angle between neighbouring shoots
  ['bend', 0.15, 1],         // how far the shoots curl outwards, away from the axis
  ['ess', 0, 0.6, 0.45],     // an S: the base bends the other way
  ['sway', 0, 0.75, 0.45],   // a meander along the main shoots
  ['stalk', 0.12, 0.5, 0, 0.6],   // how much of a main shoot is bare stalk
  ['mirror', 0, 1, 0, 0],    // a mirror image grows from the root
  ['sprouts', 1, 3.6],       // shoots along each shoot
  ['angle', 0.35, 1.35],     // how far they lean out
  ['scale', 0.55, 0.85],     // their size
  ['from', 0, 0.65],         // where along the shoot they begin
  ['side', -0.4, 1],         // on the convex side (1), alternating (0), on the concave side
  ['pair', 0, 1, 0.5],       // a mirrored partner on the other side
  ['rise', 0, 0.9, 0.35],    // shoots turn upwards
  ['away', 0.45, 1],         // how strongly sprouts curl the way they lean
  ['leafy', 0.42, 0.8],      // how leafy each generation stays: deeper shoots are slimmer
  ['gap', 0.72, 1.02, 0, 0], // the spacing of repeats
  ['crown', 0, 1, 0.3],      // an upright shoot on the mirror's axis
  ['arch', -0.7, 0.9, 0, 0.8],    // shoots heading sideways bend up (an arch, a wreath) or down (a swag)
  ['wander', 0.7, 1.5, 0, 0],     // how far the repeats of a frieze or a tower wander from the motif
  ['to', 0.25, 1.2],         // how far along the rest of the shoot the sprouts reach (beyond 1, all the way)
  ['alt', 0, 1],             // alternate sprouts staggered along the shoot, not in pairs at nodes
  ['whorl', 0, 1, 0.3],      // a second sprout at each node, rising
  ['cluster', 0, 2, 0.2],    // sprouts fanning out from behind a shoot's head
  ['bloom', 0, 1.6, 0.2],    // how far heads open into flowers (each head opens at most fully)
  ['tips', 0.3, 1],          // the main shoots' heads are flowers
  ['buds', 0, 1, 0.2],       // the sprouts' heads are flowers
  ['cup', 0, 1],             // flowers from open rosettes to cupped tulips
  ['hair', 0, 1, 0.15],      // fans of hairlines on the outer side of bends
  ['stripes', 0, 1],         // few to many stripes in a leaf
  ['which', 0, 1],           // which sprouts flower
  ['nest', 0, 1],            // sprouts curl the way their parent does (nested, a plume) rather than the way they lean
  ['swing', 0, 1, 0.3, 0],   // a frieze's runner swings in big waves, as a painted border's scroll does
];
const IW = SETTINGS.findIndex(s => s[0] === 'wander');
// Wander: repeat j of a frieze (j = 0 the motif, 1, 2, ... to the right, -1, -2, ... to the left) or tier j of a tower
// reads wave k with its phase shifted by a * drift_k * walk(j, k), and its leaf numbers moved likewise. walk is a
// smooth, never-repeating walk along the repeats (three incommensurate sines, as Q), 0 at the motif, its own for each
// setting and for each part of the space; a, the amount, is the setting wander times (0.6 + 0.8 variation). So
// neighbouring repeats are alike and the plants change gradually along the length, and a repeat depends only on its
// own place, never on how many repeats there are. The mirror, the gap and the runner's swing do not wander: every
// repeat is as symmetric as the motif, and they keep its spacing along one runner.
const PACE = 0.4;                                  // how quickly the walk turns, per repeat
const walk = (j, k, seed) => { const p = 2.39 * k + 0.35 * seed; return Q(PACE * j + p) - Q(p); };
const fold = v => v < 0 ? -v : v > 1 ? 2 - v : v;  // back into 0..1, as a mirror folds
function settings(x, y, z, d, plump, lobes, curl, V, j = 0) {
  const S = {}, seed = 0.29 * x + 0.53 * y + 0.41 * z;
  const [, wlo, whi] = SETTINGS[IW], a = (wlo + (whi - wlo) * osc(x, y, z, IW)) * (0.7 + 0.7 * clamp(V));
  SETTINGS.forEach(([k, lo, hi, t = 0, dr = 1], i) => { S[k] = lo + (hi - lo) * Math.max(0, (osc(x, y, z, i, j && dr ? a * dr * walk(j, i, seed) : 0) - t) / (1 - t)); });
  if (j) { plump = fold(plump + 0.15 * a * walk(j, 41, seed)); lobes = fold(lobes + 0.15 * a * walk(j, 42, seed)); curl = fold(curl + 0.15 * a * walk(j, 43, seed)); }
  S.mirror = clamp((1 - osc(x, y, z, 7) - 0.25) * 4);   // the mirror's wave turned over, steep but continuous: mostly mirrored
  // the budget: about how many shoots the design would have, R (1 + m + m^2 + m^3) with m sprouts per shoot (and
  // their partners, whorls and clusters), each generation weighted by how far it has grown; beyond about 45 the
  // sprouts are trimmed (smoothly, so that the count levels off) so that a design never crowds
  const depth = 3 * clamp(d), per = 1 + 0.7 * S.pair + 0.5 * S.whorl, cl = 0.7 * S.cluster * smooth(0, 0.12, S.stalk);
  const count = ns => { let t = 0; for (let k = 0; k <= 3; k++) t += Math.pow(ns * per + cl, k) * clamp(depth - k + 1); return S.shoots * t; };
  const E = count(S.sprouts), want = E / Math.pow(1 + Math.pow(E / 45, 4), 0.25);
  let lo = 0, hi = S.sprouts;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (count(m) < want) lo = m; else hi = m; }
  S.sprouts = (lo + hi) / 2;
  return {
    ...S, detail: d, plump, lobes, curl, variation: V,
    depth,                                         // generations below the main shoots; a fraction grows the last in
    amount: a, repeat: j,                          // how far the repeats wander, and which repeat this is
    seed: seed + 1.37 * j,                         // each repeat's leaves vary in their own way
    F: {                                           // the leaf
      m: 1 + 5 * Math.pow(lobes, 1.2),             // strokes in a head: one (a horn) to six (a fan)
      fan: 1.9 * smooth(0, 0.8, lobes),            // the angle they fan through
      rho: lerp(0.92, 0.8, lobes),                 // each further stroke shorter by rho
      len: lerp(1, 0.66, smooth(0.25, 1, lobes)),  // the first stroke's length, as a share of the shoot past its stalk
      wid: lerp(0.075, 0.155, plump) * lerp(1, 1.3, lobes), // half-width over length
      round: 0.92 * smooth(0.45, 1, lobes),        // a pointed tip, or the round end of a fan's lobe
      turn: lerp(2, 3.1, curl) * lerp(1, 0.65, lobes),      // the arch, radians
      hook: lerp(0.05, 1, curl),                   // turns of the hook at the tip
      tail: lerp(0, 0.16, curl),                   // the hairline past the band
      vs: lerp(0.3, 0.45, plump),                  // where the band is widest
      base: lerp(0.6, 0.85, plump),                // how broad it comes out
      p: lerp(1.4, 1, plump),                      // the taper to the tip
      asym: lerp(0.1, 0.35, plump),                // the convex side's extra swell
      stripes: lerp(3, 6, S.stripes) * lerp(0.8, 1.1, plump),
    },
  };
}

// The head's numbers for a shoot that has opened by b (0 a leaf, 1 a flower) in generation k: the leaf's (from plump,
// lobes and curl; a young generation, leafy near 0, is a few slim, curling fingers) blended into the flower's (from
// cup: an open rosette of eleven round petals in rings round a centre, to a cupped tulip of five), each number by a
// smooth step of its own, so a fan's strokes first shorten and round off, then close into a ring. Small, deep flowers
// are closed buds.
function form(K, b0, leafy, k, q, half) {
  const b = smooth(0.1, 0.9, b0), F = K.F, V = K.variation, cup = clamp(K.cup + 0.25 * k + 0.15 * V * q(31));
  const e = (a, z) => smooth(a, z, b), mix = (lf, fl, a, z) => lerp(lf, fl, e(a, z));
  const ly = smooth(0.25, 0.9, leafy), round = F.round * ly;
  return {
    m: mix(Math.max(half ? 3 : 1, 1 + (F.m * (1 + 0.15 * V * q(5)) - 1) * ly), lerp(9, 3, cup), 0, 0.7),   // a crown has at least a pair beside its middle
    fan: mix(F.fan, lerp(TAU, 1.7, cup), 0.15, 1),
    a: mix(half ? 1 : 0, 1, 0, 0.6),
    dir: mix(0.9, -cup, 0.2, 1),
    rho: mix(F.rho, lerp(1, 1.06, cup), 0, 0.8),
    len: mix(F.len, lerp(0.27, 0.36, cup), 0, 0.55),
    wid: mix(F.wid * Math.pow(leafy, 1.5) * (1 + 0.2 * V * q(1)), lerp(0.46, 0.27, cup), 0.15, 0.9),
    round: mix(round, lerp(1, 0.3, cup), 0, 0.8),
    turn: mix(lerp(2.6, F.turn, leafy) * (1 + 0.25 * V * q(3)), lerp(0, 0.6, cup), 0, 0.7),
    hook: mix(lerp(1.4, F.hook, leafy) * (1 + 0.3 * V * q(4)) * (1 - 0.85 * round), 0, 0, 0.6),
    tail: mix(lerp(0.35, F.tail, leafy) * (1 - round), 0, 0, 0.6),
    vs: mix(F.vs, 0.58, 0, 0.8), base: mix(F.base, 0.3, 0, 0.8), p: mix(F.p, 1.2, 0, 0.8), asym: mix(F.asym, 0.04, 0, 0.8),
    stripes: mix(F.stripes * smooth(0.3, 0.9, leafy), lerp(0, 1.6, cup), 0, 0.8),
    whorls: lerp(2, 0, cup) * e(0.55, 1),
    centre: lerp(0.24, 0, cup) * e(0.45, 1),
  };
}

// ------------------------------------------------------------------ the recursive rule
// A shoot of generation k, L long, opened by b (0 a leaf, 1 a flower): a stalk (a share sig of it, on main shoots and
// under flowers), then its head, then its sprouts. Generation k grows in as the depth passes k - 1: first as tendrils
// (hair-thin curls) growing from nothing, which then fill out into leaves.
function grow(sc, K, x, y, h, L, c, k, t, cut, half = false, b = 0, e0 = 1) {
  if (L < cut) return;
  L *= smooth(cut, 2 * cut, L);                     // small shoots shrink away instead of vanishing
  const V = K.variation, q = j => Q(1.618 * t + 2.39 * j + K.seed), root = k === 0;
  const leafy = root ? 1 : Math.pow(K.leafy, k) * smooth(0.15, 1.15, K.depth - k + 1);
  const H = form(K, b, leafy, k, q, half), cc = Math.sign(c) * Math.pow(Math.min(1, 1.6 * Math.abs(c)), 0.6);
  const sig = root ? lerp(K.stalk, 0.15 + K.stalk, smooth(0, 1, b)) : 0.3 * smooth(0, 1, b);
  const sway = root && K.sway > 0 ? (u => K.sway * TAU * 1.3 * Math.cos(TAU * 1.3 * u + 0.6) * smooth(0, 0.15, u)) : () => 0;
  const ess = root ? K.ess : 0.5 * K.ess;
  // the stalk bends by 2.2 radians per shoot length (main shoots; 0.8 under a sprout's flower) times c', reversed
  // near the base by the S
  const kshoot = u => cc * (root ? 2.2 : 0.8) * (1 - 2 * ess * (1 - u)) + sway(u);
  const g = Math.sqrt(Math.min(1, L / 0.25)), pen = { pw: Math.max(MIN, PEN * g), vw: Math.max(MIN, VEIN * g), gap: Math.max(GAP, 0.9 * PEN * g) };
  const n = (k === 0 ? 96 : k === 1 ? 72 : 48) / (K.quick ? 4 : 1);   // samples along the first stroke (fixed for a shoot)
  const Ls = sig * L, st = Ls > 1e-5 ? curve(x, y, h, Ls, u => sig * kshoot(sig * u), (root ? 40 : 24) / (K.quick ? 4 : 1)) : null;
  const [hx, hy, hh] = st ? at(st, 1) : [x, y, h], lh = (1 - sig) * L;
  const f0 = head(sc, hx, hy, hh, lh, H, c, k, half, pen, n, K.quick, root ? (u => (1 - sig) * sway(sig + (1 - sig) * u)) : null, ess, Math.max(smooth(0, 0.15, sig), 1 - smooth(0.4, 1.2, e0 / Math.max(1e-9, lh * H.len * H.wid * H.base))));
  // the stalk, behind the head: a band that swells a little in its middle and narrows into the head
  const zs = sc.next(k), sw = (root ? 0.0095 : 0.0065) * Math.sqrt(Math.min(1, L)), swf = u => sw * (0.85 + 0.35 * Math.sin(Math.PI * u)) * lerp(1, 0.75, u);
  if (st) { const B = band(st, swf); sc.shape(B, pen.pw / 2 + pen.gap, zs); sc.line(B.concat(B.slice(0, 2)), pen.pw, zs); }
  if (!f0) return;
  // the shoot's spine: the stalk (u up to us), then the head's first stroke; and its half-width on each side
  const l0 = lh * H.len, us = st ? Ls / (Ls + l0) : 0;
  const spine = u => u < us ? at(st, u / us) : at(f0.sp, (u - us) / (1 - us));
  const halfAt = (s, u) => {
    if (u < us) return swf(u / us);
    const v = clamp((u - us) / (1 - us)) * f0.sp.n, i = Math.min(f0.sp.n - 1, Math.floor(v)), W = s > 0 ? f0.wl : f0.wr;
    return lerp(W[i], W[i + 1], v - i);
  };
  // the shoot's convex side, away from its curl: sides(wv, wc) weighs a sprout on the convex side by wv and one on the
  // concave side by wc, [[left, its weight], [right, its weight]], blended where the shoot is nearly straight
  const sg = clamp(4 * c, -1, 1), sides = (wv, wc) => half ? [[-1, Math.max(wv, wc)]] : [[1, lerp(wv, wc, (1 + sg) / 2)], [-1, lerp(wv, wc, (1 - sg) / 2)]];
  // a sprout on side s curls the way it leans (s), or, nested, the way its parent curls (sg): on the convex side the
  // two differ, and the sprout is drawn as both, weighted (blending by weight rather than by curl, no sprout is ever
  // straight): [[curl, weight], ...]
  const wn = half ? 0 : K.nest, curls = s => { const d = Math.abs(s - sg) / 2 * wn; return [[s * K.away, 1 - d], [sg * K.away, d]]; };
  // hairlines on the outer side of the bend, near the first stroke's base, on main shoots and their sprouts
  const zh = sc.next(k), hw = k <= 1 ? K.hair * smooth(0, 1, K.depth - k + 0.4) * (root ? 1 : 0.6) : 0;
  if (hw > 0 && !K.quick) {
    const uh = us + (1 - us) * 0.3, [px, py, ph] = spine(uh), kh = (spine(uh + 0.02)[2] - spine(uh - 0.02)[2]) / 0.04;
    for (const s of half ? [-1] : [1, -1]) {
      const wv = hw * smooth(0.2, 1.2, -s * kh); if (wv <= 0) continue;
      const e = halfAt(s, uh);
      hairs(sc, px - s * e * Math.sin(ph), py + s * e * Math.cos(ph), ph, s, 0.17 * L * wv, 3 + 2 * K.hair, pen, zh, K.quick);
    }
  }
  const gw = clamp(K.depth - k);
  if (gw <= 0) return;
  // which sprouts flower: a smooth choice along the sprouts, set by `which`
  const pick = (j, s) => smooth(0.3, 0.8, 0.5 + 0.5 * Math.cos(2.4 * j + TAU * K.which + (s > 0 ? 1.9 : 0)));
  // sprouts along the shoot, the next generation, with weight clip(depth - k): sprout j sits at u_j, from ua to ue
  // (each shoot's own: from and to, moved by its own Q), slid along by its own phase and staggered by alt; on the convex side, the concave side or
  // both (side, pair); with a whorl, a second, rising sprout at the same node. It comes out from under the edge there,
  // leaning out at the angle alpha, curls the way it leans, and is the shoot's length times the scale, smaller
  // towards the tip. The last, fractional sprout grows in.
  const ns = K.sprouts * (1 + 0.25 * V * q(6)), vary = 0.2 + 0.15 * V;
  const ua = clamp(K.from + vary * q(21), 0, 0.7), ue = Math.min(0.99, ua + (0.99 - ua) * clamp(K.to + vary * q(22), 0.2, 1)), ph0 = 0.5 * clamp(1.6 * q(23), -1, 1);
  for (let j = 0; j < Math.ceil(ns); j++) {
    const wj = clamp(ns - j) * gw; if (wj <= 0) continue;
    const ev = j % 2 === 0, fj = clamp((j + 0.5 + ph0 + (ev ? -0.25 : 0.25) * K.alt) / Math.max(1, ns)), uj = lerp(ua, ue, fj);
    const wv = Math.max(ev ? clamp(1 + K.side) : clamp(K.side), K.pair), wc = Math.max(ev ? clamp(-K.side) : clamp(1 - K.side), K.pair);
    const [px, py, ph] = spine(uj), al = K.angle * (1 + 0.3 * V * q(7 + j)) * lerp(1.1, 0.75, fj);
    for (const [s, bw] of sides(wv, wc)) {
      if (bw <= 0) continue;
      const e = halfAt(s, uj);
      for (const [wh0, af, lf, dt0] of [[1, 1, 1, 0], [K.whorl, 0.45, 0.72, 5.3]]) for (const [cj, wc0, dt] of curls(s).map(([a, b], i) => [a, b, dt0 + 3.7 * i])) {
        const wh = wh0 * wc0; if (wh <= 0) continue;
        let hj = ph + s * al * af;
        hj += K.rise * Math.sin(Math.PI / 2 - hj) * 0.8;
        const Lj = L * K.scale * lf * (1 - 0.3 * fj) * (1 + 0.25 * V * q(11 + j)) * wj * bw * wh;
        if (TRACE && Lj >= cut) TRACE.push({ gen: k, shoot: t, u: uj, side: s, x: px, y: py, h: ph, weight: wj * bw * wh });
        grow(sc, K, px - s * e * Math.sin(ph), py + s * e * Math.cos(ph), hj, Lj, cj, k + 1, 1.3 * t + 2.9 * (j + 1) + (s > 0 ? 0.7 : 0) + dt, cut, false, clamp(K.bloom * K.buds * pick(j, s) * (root ? 1 : 0.7)), e);
      }
    }
  }
  // a cluster: sprouts fanning out from behind the head, from leaning out to hanging, the convex side first, so a
  // flower or a leaf at the end of a stalk is ringed with leaves that arch outwards and down (a fountain). They come
  // out from behind the flower, or from behind the base of the head's first stroke; behind a flower they are longer,
  // so big horns sweep out from behind it as in the 1799 plants.
  const bf = smooth(0.2, 0.9, b), ncl = (K.cluster + 2 * smooth(0.3, 0.9, b)) * smooth(0, 0.12, sig) * (root ? 1 : 0.5);
  const uc = us + 0.12 * (1 - us) * (1 - bf), [cx, cy, ch] = spine(uc);
  for (let j = 0; j < Math.ceil(ncl); j++) {
    const wj = clamp(ncl - j) * gw; if (wj <= 0) continue;
    const fj = clamp((j + 0.5) / Math.max(1, ncl)), ev = j % 2 === 0, al = lerp(0.8, 2.1, fj) * (1 + 0.2 * V * q(41 + j));
    for (const [s, bw0] of sides(ev ? 1 : K.pair, ev ? K.pair : 1)) for (const [cj, wc0, i] of curls(s).map(([a, b], i) => [a, b, i])) {
      const bw = bw0 * wc0; if (bw <= 0) continue;
      const Lj = L * K.scale * lerp(0.95, 0.65, fj) * lerp(1, 1.35, bf) * (1 + 0.2 * V * q(45 + j)) * wj * bw, e = lerp(halfAt(s, uc), 0, bf);   // behind a flower, big horns
      if (TRACE && Lj >= cut) TRACE.push({ gen: k, shoot: t, u: uc, side: s, x: cx, y: cy, h: ch, weight: wj * bw, cluster: true });
      grow(sc, K, cx - s * e * Math.sin(ch), cy + s * e * Math.cos(ch), ch + s * al, Lj, cj, k + 1, 1.7 * t + 3.1 * (j + 1) + (s > 0 ? 0.7 : 0) + 9.1 + 3.7 * i, cut, false, clamp(K.bloom * K.buds * 0.35 * pick(j + 3, s)), Math.max(halfAt(s, uc), 0.8 * l0 * bf));
    }
  }
}

// The motif: the main shoots from the root (the origin). The first heads K.turn from straight up towards the right
// and each further one K.spread further round, the last, fractional one growing in; the fan is kept softly short of
// straight down (a smooth minimum), so that a mirrored design never crosses its axis. A shoot curls outwards, away
// from the axis, by K.bend times the cosine of its heading (so a shoot heading down curls the other way round, and
// one heading sideways not at all), and by K.arch times its sine: up into an arch or down into a swag. Its head opens
// by bloom times tips. A mirror image (x -> -x), K.mirror times the size, grows from the same root.
const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
function motif(K, cut) {
  const sc = new Scene();
  const N = K.shoots;
  for (let i = 0; i < Math.ceil(N); i++) {
    const w = clamp(N - i); if (w <= 0) continue;
    const a = smin(K.turn + K.spread * i, Math.PI - 0.12, 0.25);
    const c = clamp(-K.bend * Math.cos(a) + K.arch * Math.sin(a), -1, 1);
    grow(sc, K, 0, 0, Math.PI / 2 - a, w * (1 - 0.12 * i), c, 0, 3.7 * i + 1, cut, false, clamp(K.bloom * K.tips * (i ? 0.7 : 1)));
  }
  // on the axis of a mirrored design, an upright crown: a straight, symmetric shoot (c = 0) with its right-hand
  // strokes and sprouts, which the mirror completes; its head opens by bloom
  const m = K.mirror, cw = K.crown * m * m;
  if (cw > 0) grow(sc, K, 0, 0, Math.PI / 2, 0.85 * cw, 0, 0, 0.5, cut, true, clamp(1.3 * K.bloom));
  if (m > 0) {
    const S = sc.shapes.length, Ln = sc.lines.length;
    for (let i = 0; i < S; i++) { const s = sc.shapes[i]; sc.shapes.push({ poly: s.poly.map((v, j) => (j % 2 ? v : -v) * m), halo: s.halo * m, z: s.z - 0.5 }); }
    for (let i = 0; i < Ln; i++) { const l = sc.lines[i]; sc.lines.push({ ...l, pts: l.pts.map((v, j) => (j % 2 ? v : -v) * m), w: l.w * m, z: l.z - 0.5 }); }
  }
  return sc;
}

function sceneBox(sc) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const l of sc.lines) for (let i = 0; i < l.pts.length; i += 2) {
    const a = l.pts[i], b = l.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}

// The settings a point gives (all continuous), for pages and tools that describe a design; repeat j gives the
// settings of the j-th repeat of a frieze (negative: to the left) or the j-th tier of a tower.
export function settingsAt({ x = 5, y = 5, z = 5, detail = 0.5, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}, repeat = 0) {
  return settings(x, y, z, detail, plump, lobes, curl, variation, repeat);
}

// A runner: a stem through the roots of a frieze's repeats, y = yA(x) from xa to xb, winding into a curl of length
// ext past each end (the left curl the mirror image of the right one); its heading at an end follows the stem's, so
// the curls turn smoothly as the runner grows. It is a brush stroke of its own: it swells to w in the middle of each
// half-wave (between the nodes N) and thins at the nodes and into the curls.
function runner(sc, xa, xb, yA, Pp, ext, w, N) {
  if (!(xb - xa > 0)) return;
  const m = Math.max(16, Math.ceil(80 * (xb - xa) / Pp)), dx = 1e-4 * Pp, hd = x => Math.atan((yA(x + dx) - yA(x - dx)) / (2 * dx));
  const r0 = 0.12, C = TAU * 1.1 / Math.log((1 + r0) / r0), kc = u => C * smooth(0.25, 0.6, u) / (1 - u + r0);
  const Rr = curve(xb, yA(xb), hd(xb), ext, u => -kc(u), 48), Rl = curve(xa, yA(xa), Math.PI + hd(xa), ext, kc, 48);
  const pts = [], X = [];
  for (let i = Rl.n; i >= 1; i--) { pts.push(Rl.X[i], Rl.Y[i]); X.push(xa); }
  for (let i = 0; i <= m; i++) { const x = lerp(xa, xb, i / m); pts.push(x, yA(x)); X.push(x); }
  for (let i = 1; i <= Rr.n; i++) { pts.push(Rr.X[i], Rr.Y[i]); X.push(xb); }
  const c = { X: [], Y: [], H: [], n: pts.length / 2 - 1 };
  for (let i = 0; i <= c.n; i++) {
    c.X.push(pts[2 * i]); c.Y.push(pts[2 * i + 1]);
    const a = Math.max(0, i - 1), b = Math.min(c.n, i + 1);
    c.H.push(Math.atan2(pts[2 * b + 1] - pts[2 * a + 1], pts[2 * b] - pts[2 * a]));
  }
  for (let i = 1; i <= c.n; i++) c.H[i] -= TAU * Math.round((c.H[i] - c.H[i - 1]) / TAU);   // no jumps of 2 pi
  const swell = x => { let k = 0; while (k < N.length - 2 && x > N[k + 1]) k++; const s = Math.sin(Math.PI * clamp((x - N[k]) / (N[k + 1] - N[k]))); return 0.55 + 0.45 * s * s; };
  const k0 = Rl.n / c.n, k1 = 1 - Rr.n / c.n, z = -1e12;
  const B = band(c, u => { const i = Math.round(u * c.n); return w * swell(X[i]) * (0.35 + 0.65 * smooth(0, k0, u) * (1 - smooth(k1, 1, u))); });
  sc.shape(B, PEN / 2 + Math.max(GAP, 0.9 * PEN), z); sc.line(B.concat(B.slice(0, 2)), Math.max(MIN, PEN), z);
}

// The whole design. Aspect is relative to the motif's own proportions, as in the Machine: at 1 the motif stands
// alone; wider, repeats bud out on both sides along a runner (a frieze); taller, smaller repeats bud out of its top
// (telescoping, as in a tall panel). Each repeat is drawn from its own settings, which wander from the motif's with
// its place (settings, above), and is scaled towards the motif's height. A fractional repeat grows in, budding from
// its neighbour's edge. Repeats are drawn behind the ones before them. Options: min and gap, for small prints; trace,
// an array that receives where each of the motif's sprouts comes out ({gen, shoot, u, side, x, y, h, weight}, u its
// share of the way along its parent); set, settings to put in place of the ones x, y and z give (for studies and
// tests, e.g. {bloom: 1}).
export function build({ x = 5, y = 5, z = 5, detail = 0.5, aspect = 1, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}, opt = {}) {
  MIN = opt.min || 0; GAP = opt.gap || 0; PEN = PEN0; VEIN = VEIN0; TRACE = null;
  const A = clamp(aspect, 0.2, 48), kAt = j => Object.assign(settings(x, y, z, detail, plump, lobes, curl, variation, j), opt.set), K = kAt(0);
  // the motif's own size, then how large the whole design will be: a design g times larger keeps its smallest shoots
  // g^0.6 times larger, and its pens g^0.4 times bolder, so that a long frieze or a tall tower is not lost in fuzz
  let cut = 0.03, M = motif(K, cut);
  const b0 = sceneBox(M), W0 = b0.x1 - b0.x0, H0 = b0.y1 - b0.y0, S0 = Math.max(W0, H0);
  const g = Math.max(1, A > 1 ? Math.max(A * W0, H0) / S0 : Math.max(W0, H0 / A) / S0);
  if (g > 1) { PEN = PEN0 * Math.pow(g, 0.4); VEIN = VEIN0 * Math.pow(g, 0.4); cut = 0.03 * Math.pow(g, 0.6); M = motif(K, cut); }
  // repeat j: its motif, drawn as finely as the whole design allows; its box, measured on the same repeat drawn at a
  // fixed coarse cut (0.27) and stretched to the motif's own size, so that where the repeats stand does not depend on
  // the aspect; and its scale s = (the motif's height / its height)^0.7, kept within 0.6 to 1.6
  const R = new Map(), CB = 0.1, box = j => sceneBox(motif({ ...kAt(j), quick: true }, CB));
  let c0, kx, ky;
  const rep = j => {
    if (!c0) { c0 = box(0); kx = W0 / (c0.x1 - c0.x0); ky = H0 / (c0.y1 - c0.y0); }
    if (!R.has(j)) {
      const c = j ? box(j) : c0;
      R.set(j, {
        M: j ? motif(kAt(j), cut) : M, b: { x0: kx * c.x0, x1: kx * c.x1, y0: ky * c.y0, y1: ky * c.y1 },
        s: j ? clamp(Math.pow((c0.y1 - c0.y0) / Math.max(1e-6, c.y1 - c.y0), 0.7), 0.6, 1.6) : 1,
      });
    }
    return R.get(j);
  };
  const reps = [];                                 // [x, y, scale, repeat, depth] of each repeat after the first
  const sc = new Scene();
  if (A > 1) {
    // on each side, repeats K.gap times the sum of their facing half-widths apart, until the frieze is A times as
    // wide as the motif. A growing repeat buds from its neighbour's outer edge and moves out to its place while it
    // grows (eased, so it starts and stops gently), so the frieze widens at an even rate.
    const need = (A - 1) * W0 / 2, P0 = K.gap * W0, nodes = new Map([[0, 0]]), grown = new Map([[0, 1]]), roots = new Map([[0, 0]]), end = {};
    for (const sd of [1, -1]) {
      let X0 = 0, got = 0, prev = rep(0);
      end[sd] = 0;
      for (let i = 1; ; i++) {
        const r = rep(sd * i), out = sd > 0 ? prev.s * prev.b.x1 : -prev.s * prev.b.x0, inn = sd > 0 ? -r.s * r.b.x0 : r.s * r.b.x1;
        const P = Math.max(0.05 * P0, K.gap * (out + inn)), w0 = clamp((need - got) / P); if (w0 <= 0) break;
        const w = smooth(0, 1, w0), X = X0 + sd * (out + w * (P - out));
        nodes.set(sd * i, X0 + sd * P); grown.set(sd * i, w); roots.set(sd * i, X);   // where its root will be (a node of the runner), how far it has grown, where it is
        reps.push([X, 0, r.s * w, r, i]);
        end[sd] = X0 + (X - X0) * smooth(0, 0.3, w);   // the runner reaches out to the bud while it starts
        if (w0 < 1) break;
        X0 += sd * P; got += P; prev = r;
      }
    }
    // the runner: between neighbouring nodes a half sine whose height is amp times its length, up and down in turn,
    // so it passes through every root at the same slope; its amp wanders a little along the length
    const lo = Math.min(...nodes.keys()), N = [];
    for (let j = lo; nodes.has(j); j++) N.push(nodes.get(j));
    const amp = u => lerp(0.07, 0.2, K.swing) * (1 + 0.4 * Math.tanh(0.8 * K.amount * walk(u, 24, K.seed)));
    const yA = x => {
      let k = 0; while (k < N.length - 2 && x > N[k + 1]) k++;   // beyond the end nodes, the end segments carry on
      const L = N[k + 1] - N[k];
      return ((lo + k) % 2 ? -1 : 1) * amp(x / P0) * L * Math.sin(Math.PI * (x - N[k]) / L);
    };
    for (const r of reps) r[1] = yA(r[0]);
    const rw = lerp(0.006, 0.015, K.swing) * Math.pow(g, 0.4);   // a swinging runner is a heavier stroke
    runner(sc, end[-1], end[1], yA, P0, 0.3 * Math.min(P0, W0) * Math.min(1, (A - 1) / K.gap), rw, N);
    // at each half-wave's crest, as in a painted border: a fan of hairlines springs from the outer side, and a short,
    // curling sprout grows into the bay on the inner side, ending in a flower where the repeat's flowers have opened
    // (a leaf where they have not). Both belong to the repeat at the segment's outer end and grow in with it; they lie
    // behind the plants and in front of the runner.
    const bay = new Scene();
    for (let k = 0; k + 1 < N.length; k++) {
      const ja = lo + k, jb = ja + 1, own = jb > 0 ? jb : ja, Kj = own ? kAt(own) : K, ws = Math.min(grown.get(ja), grown.get(jb));
      if (!(ws > 0)) continue;
      // between the two roots where they stand now (a growing repeat moves out to its node), within the runner's reach
      const xm = clamp((roots.get(ja) + roots.get(jb)) / 2, end[-1], end[1]), ym = yA(xm), sg = (lo + k) % 2 ? -1 : 1, L = N[k + 1] - N[k];
      const lean = own % 2 ? 1 : -1, hw = ws * (0.35 + 0.65 * Kj.hair) * smooth(0, 0.5, detail);
      if (hw > 0) hairs(bay, xm, ym + sg * rw, lean > 0 ? 0 : Math.PI, sg * lean, 0.16 * L * hw, 3 + 2 * Kj.hair, { pw: Math.max(MIN, PEN), vw: Math.max(MIN, 1.3 * VEIN), gap: 0 }, bay.next(0), false);
      const Lb = 0.3 * L * ws * smooth(0, 0.6, detail);
      if (Lb > cut) grow(bay, Kj, xm, ym - sg * rw, -sg * Math.PI / 2 + 0.5 * lean * sg, Lb, 0.8 * lean, 1, 7.7 + 1.3 * own, cut, false, clamp(1.2 * Kj.bloom), 1);
    }
    for (const t of bay.shapes) sc.shapes.push({ ...t, z: t.z - 1e11 });
    for (const l of bay.lines) sc.lines.push({ ...l, z: l.z - 1e11 });
  } else if (A < 1) {
    // tiers 0.84 times the last (and scaled towards the motif's height), each overlapping the one below by a quarter;
    // up to eight. A growing tier buds from the top of the one below and rises to its place while it grows.
    const ov = 0.25, need = H0 * (1 / A - 1);
    let Y = 0, below = rep(0), sb = 1, got = 0;
    for (let i = 1; i <= 8 && got < need; i++) {
      const r = rep(i), s = Math.pow(0.84, i) * r.s, add = s * (r.b.y1 - r.b.y0) * (1 - ov), w0 = clamp((need - got) / add), w = smooth(0, 1, w0);
      got += add;
      const Yi = Y + sb * below.b.y1 - s * w * r.b.y0 - ov * sb * (below.b.y1 - below.b.y0) * w;
      reps.push([0, Yi, s * w, r, i]); Y = Yi; below = r; sb = s;
      if (w0 < 1) break;
    }
  }
  const put = (X, Y, s, Mj, dz) => {
    const sw = Math.sqrt(s);
    for (const t of Mj.shapes) sc.shapes.push({ poly: t.poly.map((v, j) => (j % 2 ? Y : X) + s * v), halo: t.halo * sw, z: t.z + dz });
    for (const l of Mj.lines) sc.lines.push({ ...l, pts: l.pts.map((v, j) => (j % 2 ? Y : X) + s * v), w: l.w * sw, z: l.z + dz });
  };
  put(0, 0, 1, M, 0);
  for (const [X, Y, s, r, i] of reps) put(X, Y, s, r.M, -1e8 * i);
  if (opt.trace) { TRACE = opt.trace; motif(K, cut); TRACE = null; }   // the motif once more, recording its sprouts
  return hide(sc);
}

// Repeat j of a frieze (or tier j of a tower) on its own, as the motif would stand alone with those settings.
export function buildRepeat(point = {}, j = 0) {
  const { x = 5, y = 5, z = 5, detail = 0.5, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = point;
  MIN = 0; GAP = 0; PEN = PEN0; VEIN = VEIN0;
  return hide(motif(settings(x, y, z, detail, plump, lobes, curl, variation, j), 0.03));
}

// One head on its own (a main shoot on a short stalk, without sprouts), for close-ups: the leaf numbers, how far it
// has opened into a flower (bloom, 0 to 1) and the flower's shape (cup: 0 a rosette, 1 a tulip).
export function buildLeaf({ plump = 0.5, lobes = 0.5, curl = 0.5, bloom = 0, cup = 0.5 } = {}) {
  MIN = 0; GAP = 0; PEN = PEN0; VEIN = VEIN0;
  const K = settings(0, 0, 0, 0, plump, lobes, curl, 0);
  Object.assign(K, { stalk: 0.15, ess: 0, sway: 0, depth: 0, hair: 0, cup });
  const sc = new Scene();
  grow(sc, K, 0, 0, Math.PI / 2, 1, -0.7, 0, 1, 0.01, false, bloom);
  return hide(sc);
}

export function bbox(items) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const it of items) for (let i = 0; i < it.pts.length; i += 2) {
    const a = it.pts[i], b = it.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}
