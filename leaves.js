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
// shoots spring from the root and where they head, how they bend, where along them their sprouts come out, on which
// side, how many of the heads are flowers, whether the design is mirrored and how exactly its twin mirrors it), detail
// the depth, plump, lobes and curl the leaf (slender to fat; a horn, a cluster of fingers or a fan; gentle to hooked),
// variation how much the leaves differ: every shoot and every stroke of a head is an instance of its own, moved
// through the shape numbers, so no two are alike. Aspect sets the proportions: wider, a frieze, a scroll that swings
// out to both sides of the motif, mirrored about it, with plants standing and hanging in its bays, feature motifs
// among small sprigs, lush stretches and open ground; taller, a tower of tiers. Each repeat wanders from the motif with
// its distance from the centre, so the plants change gradually along the length; x, y, z and variation set how far.
// Every number is continuous, every point draws a design, and a small step in any number changes it only a little:
// whatever appears, a generation, a shoot, a finger, a petal, a stripe or a repeat, grows from nothing. No
// dependencies; used by the Leaves tab of index.html and by cli/leaves.mjs.
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
let HEADS = null;                                  // the strokes of every head, likewise

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
// mirrored design (half) only the strokes on the right are drawn; the mirror completes them. Each stroke is its own
// instance: its angle, length, width, arch and hook move a little, and each inner ring its size and turn, by the
// amount va times Q at its place in the head (tv, the shoot's own number), so no two strokes are alike; the first
// stroke (the shoot's spine, which its sprouts follow) and a crown's middle stroke keep their line.
function head(sc, x, y, h, l, H, c, k, half, pen, n, quick, sway, ess, neck, tv = 0, va = 0) {
  // a straight shoot (c near 0) has no concave side, so its fan is centred
  const M = H.m, nM = Math.ceil(M - 1e-9), W = H.whorls, nW = Math.ceil(W - 1e-9), a = Math.max(H.a, 1 - Math.abs(clamp(4 * c, -1, 1)));
  // depths, front to back: the centre, the inner rings (the innermost first), the outer ring
  const zc = sc.next(k), Z = [];
  for (let r = nW; r >= 0; r--) { Z[r] = []; for (let i = 0; i < nM; i++) Z[r][i] = [sc.next(k), sc.next(k)]; }
  const sg = clamp(4 * c, -1, 1), del = H.fan / Math.max(1, M - 1 + H.fan / TAU);
  const e = (i, r, j) => va * Q(tv + 1.93 * i + 4.31 * r + 2.71 * j), rec = HEADS && !quick ? [] : null;
  let first = null;
  for (let r = 0; r <= (quick ? 0 : nW); r++) {                 // measuring needs only the outer ring
    const wr = r ? clamp(W - r + 1) * (1 - 0.3 * r) * (1 + 0.2 * e(0, r, 7)) : 1; if (wr <= 0) continue;
    const tr = r ? 0.4 * del * e(0, r, 8) : 0;
    for (let i = 0; i < nM; i++) {
      const wi = i ? clamp(M - i) : 1; if (wi <= 0) continue;
      // centred places: 0, +1, -1, +2, -2, ... (an inner ring, turned half a step: +1/2, -1/2, +3/2, -3/2, ...)
      const alt = r % 2 ? (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 0.5) : i ? (i % 2 ? 1 : -1) * Math.ceil(i / 2) : 0;
      if (half && alt > 1e-9) continue;
      const axis = (half && Math.abs(alt) < 1e-9) || (!i && !r);   // the crown's middle stroke and the shoot's own first stroke keep their line
      const th = del * lerp(sg * (i + r / 2), alt, a) + (axis ? 0 : tr + 0.4 * del * e(i, r, 1)), rank = lerp(i, Math.ceil(i / 2), a);
      const ci = lerp(c, clamp(th / 0.3, -1, 1) * H.dir, a);
      const li = l * H.len * wr * Math.pow(H.rho, rank) * wi * (1 + 0.28 * e(i, r, 2));
      const P = { n: i || r ? Math.max(12, Math.round(0.4 * n)) : n, quick, turn: H.turn * (1 + 0.25 * e(i, r, 3)), hook: H.hook * (1 + 0.5 * e(i, r, 4)), tail: H.tail, wid: H.wid * (1 + 0.3 * e(i, r, 5)), vs: H.vs, base: H.base, round: H.round, p: H.p, asym: H.asym, stripes: H.stripes, neck, ess: i || r ? 0 : ess, sway: i || r ? null : sway };
      const s = stroke(sc, x, y, h + th, li, P, ci, Z[r][i][1], Z[r][i][0], pen);
      if (!i && !r) first = s;
      if (rec && s) rec.push({ ring: r, i, len: li / Math.max(1e-9, l * H.len), turn: P.turn, hook: P.hook, wid: P.wid, th });
    }
  }
  if (rec) HEADS.push({ gen: k, shoot: tv, strokes: rec });
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
  ['side', -1, 1],           // a bias towards the convex side (> 0) or the concave side (< 0): mostly none (below)
  ['pair', 0, 1, 0.5],       // a partner on the other side, at the same node
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
  ['swing', 0, 1, 0, 0],     // how far a frieze's scroll swings
  ['symmetry', 0, 1, 0, 0],  // how exactly a twin mirrors (below): exactly in most of the space
  ['asymPhase', 0, TAU, 0, 0],    // the way a twin drifts from the mirror image
  ['vary', 0, 1, 0.08, 0],   // how far every instance (shoot, stroke, ring, repeat) moves from the others
  ['varAngle', 0, TAU, 0, 0],     // the plane of shape numbers it moves in
  ['varTwist', 0, TAU, 0, 0],
  ['hier', 0.15, 1, 0, 0],   // feature motifs and small sprigs along a frieze
  ['lush', 0.3, 1, 0, 0],    // lush clusters and sparse stretches of open ground along a frieze
  ['lean', 0, 0.9],          // a frieze's plants lean with its scroll
];
const IW = SETTINGS.findIndex(s => s[0] === 'wander'), IS = SETTINGS.findIndex(s => s[0] === 'symmetry');
// Wander: repeat j of a frieze (j = 0 the motif, 1, 2, ... outwards to the right, -1, -2, ... to the left) or tier j of a
// tower reads wave k with its phase shifted by a * drift_k * walk(|j|, k), and its leaf numbers moved likewise. walk is
// a smooth, never-repeating walk along the repeats (three incommensurate sines, as Q), 0 at the motif, its own for each
// setting and for each part of the space; a, the amount, is the setting wander times (0.7 + 0.7 variation). So
// neighbouring repeats are alike and the plants change gradually outwards from the centre, the same way on both
// sides, and a repeat depends only on its own place, never on how many repeats there are. The mirror, the gap and the
// runner's swing do not wander: every repeat is as symmetric as the motif, and they keep its spacing.
const PACE = 0.4;                                  // how quickly the walk turns, per repeat
const walk = (j, k, seed) => { const p = 2.39 * k + 0.35 * seed; return Q(PACE * j + p) - Q(p); };
const fold = v => v < 0 ? -v : v > 1 ? 2 - v : v;  // back into 0..1, as a mirror folds

// The leaf, from plump, lobes and curl (and the setting stripes): the numbers of a head's strokes, before it opens.
function leafForm(plump, lobes, curl, stripes) {
  lobes = clamp(lobes); plump = clamp(plump); curl = clamp(curl);
  return {
    m: 1 + 5 * Math.pow(lobes, 1.2),               // strokes in a head: one (a horn) to six (a fan)
    fan: 1.9 * smooth(0, 0.8, lobes),              // the angle they fan through
    rho: lerp(0.92, 0.8, lobes),                   // each further stroke shorter by rho
    len: lerp(1, 0.66, smooth(0.25, 1, lobes)),    // the first stroke's length, as a share of the shoot past its stalk
    wid: lerp(0.075, 0.155, plump) * lerp(1, 1.3, lobes), // half-width over length
    round: 0.92 * smooth(0.45, 1, lobes),          // a pointed tip, or the round end of a fan's lobe
    turn: lerp(2, 3.1, curl) * lerp(1, 0.65, lobes),      // the arch, radians
    hook: lerp(0.05, 1, curl),                     // turns of the hook at the tip
    tail: lerp(0, 0.16, curl),                     // the hairline past the band
    vs: lerp(0.3, 0.45, plump),                    // where the band is widest
    base: lerp(0.6, 0.85, plump),                  // how broad it comes out
    p: lerp(1.4, 1, plump),                        // the taper to the tip
    asym: lerp(0.1, 0.35, plump),                  // the convex side's extra swell
    stripes: lerp(3, 6, stripes) * lerp(0.8, 1.1, plump),
  };
}

// Instance variation, as in the Machine: two directions D1, D2 through the shape numbers below (set by varAngle and
// varTwist) span a plane, and each instance, a shoot, the strokes of its head, a repeat, sits at its own quasi-periodic
// point (s1, s2) = amt (Q(t), Q(0.77 t + 5.3)) of it, t its own number: value = base + range (s1 D1 + s2 D2). Every
// shoot thus has its own lean, size, curl, sprouts and leaf, and nothing is copied; the same numbers always give the
// same shoots. The amount (vamt) rises with variation and with vary, a setting of x, y and z, and is small only where
// both are near zero; it is less for each generation.
const VK = [                                       // [shape number, range, lo, hi]
  ['angle', 0.3, 0.2, 1.6], ['scale', 0.1, 0.4, 1], ['away', 0.2, 0.3, 1], ['rise', 0.25, 0, 0.9], ['sprouts', 0.6, 0, 4],
  ['from', 0.15, 0, 0.7], ['to', 0.3, 0.2, 1.2], ['alt', 0.5, 0, 1], ['side', 0.2, -1, 1], ['nest', 0.4, 0, 1],
  ['cluster', 0.5, 0, 2], ['cup', 0.4, 0, 1], ['which', 0.35, 0, 1], ['stripes', 0.4, 0, 1], ['hair', 0.25, 0, 1],
  ['stalk', 0.08, 0.1, 0.55], ['plump', 0.25, 0, 1], ['lobes', 0.2, 0, 1], ['curl', 0.25, 0, 1],
];
const dirv = (a, b, k) => Math.sin(a + b * Math.cos(k * GOLD) + 2.1 * k);
const vamt = (V, vary) => (0.2 + 0.5 * clamp(V) + 0.55 * vary) * smooth(0, 0.35, clamp(V) + vary);
// a setting moved by d, kept within lo..hi (or within its own value, if that lies outside), so it never jumps
const within = (v, d, lo, hi) => clamp(v + d, Math.min(lo, v), Math.max(hi, v));
function varied(K, t, amt) {
  if (!(amt > 0)) return K;
  const u = 0.9 * t + 0.7 * K.seed + 3.1, s1 = amt * Q(u), s2 = amt * Q(0.77 * u + 5.3), o = Object.create(K);
  VK.forEach(([k, r, lo, hi], i) => { o[k] = within(K[k], r * (s1 * K.D1[i] + s2 * K.D2[i]), lo, hi); });
  o.F = leafForm(o.plump, o.lobes, o.curl, o.stripes);
  return o;
}

// Symmetry, as in the Machine: a mirrored twin (the mirror image in a motif, the left half of a frieze) is exact at
// symmetry 1 and below that drifts continuously away from the mirror image: each of these numbers moves by
// (1 - symmetry) amplitude sin(asymPhase + i g), and its small variations (the seed) move too.
const ASYM = [['turn', 0.35], ['spread', 0.15], ['bend', 0.3], ['arch', 0.35], ['sprouts', 0.7], ['angle', 0.25], ['scale', 0.08],
  ['from', 0.2], ['to', 0.25], ['side', 0.4], ['rise', 0.25], ['away', 0.2], ['stalk', 0.1], ['sway', 0.25], ['bloom', 0.4],
  ['alt', 0.4], ['cup', 0.3], ['plump', 0.15], ['lobes', 0.15], ['curl', 0.2]];
const ALIM = { sprouts: [0, 9], scale: [0.3, 1], from: [0, 0.7], side: [-1, 1], bloom: [0, 9], alt: [0, 1], cup: [0, 1], plump: [0, 1], lobes: [0, 1], curl: [0, 1], stalk: [0.05, 0.6], away: [0.2, 1], sway: [0, 9], rise: [0, 9] };
function drift(K, d, seed = true) {
  if (!(d > 0)) return K;
  const T = { ...K };
  ASYM.forEach(([k, a], i) => { const [lo, hi] = ALIM[k] || [-9, 9]; T[k] = within(K[k], d * a * Math.sin(K.asymPhase + i * GOLD), lo, hi); });
  if (seed) T.seed = K.seed + 1.7 * d;
  T.F = leafForm(T.plump, T.lobes, T.curl, T.stripes);
  return T;
}
const twinOf = K => drift(K, 1 - K.symmetry);

function settings(x, y, z, d, plump, lobes, curl, V, j = 0, set = null) {
  const S = {}, J = Math.abs(j);
  // the symmetry: 1 in most of the space, down to 0.55 (as in the Machine); the left half of a frieze (j < 0) is the
  // twin of the right half, so its walk and its numbers drift by 1 - symmetry. set: settings put in place of these.
  const sym = set && set.symmetry !== undefined ? set.symmetry : 1 - 0.45 * clamp((0.3 - osc(x, y, z, IS)) * 3.3), dt = j < 0 ? 1 - sym : 0;
  const seed = 0.29 * x + 0.53 * y + 0.41 * z + 1.7 * dt;
  const [, wlo, whi] = SETTINGS[IW], a = (wlo + (whi - wlo) * osc(x, y, z, IW)) * (0.7 + 0.7 * clamp(V));
  SETTINGS.forEach(([k, lo, hi, t = 0, dr = 1], i) => { S[k] = lo + (hi - lo) * Math.max(0, (osc(x, y, z, i, J && dr ? a * dr * walk(J, i, seed) : 0) - t) / (1 - t)); });
  if (J) { plump = fold(plump + 0.15 * a * walk(J, 41, seed)); lobes = fold(lobes + 0.15 * a * walk(J, 42, seed)); curl = fold(curl + 0.15 * a * walk(J, 43, seed)); }
  S.mirror = clamp((1 - osc(x, y, z, 7) - 0.25) * 4);   // the mirror's wave turned over, steep but continuous: mostly mirrored
  S.symmetry = sym;
  // the side bias: none in most of the space, rising smoothly towards either end of its wave
  S.side = Math.sign(S.side) * 0.75 * smooth(0.97, 1, Math.abs(S.side));
  // the budget: about how many shoots the design would have, R (1 + m + m^2 + m^3) with m sprouts per shoot (and
  // their partners, whorls and clusters), each generation weighted by how far it has grown; beyond about 45 the
  // sprouts are trimmed (smoothly, so that the count levels off) so that a design never crowds
  const depth = 3 * clamp(d), per = 1 + 0.7 * S.pair + 0.5 * S.whorl, cl = 0.7 * S.cluster * smooth(0, 0.12, S.stalk);
  const count = ns => { let t = 0; for (let k = 0; k <= 3; k++) t += Math.pow(ns * per + cl, k) * clamp(depth - k + 1); return S.shoots * t; };
  const E = count(S.sprouts), want = E / Math.pow(1 + Math.pow(E / 45, 4), 0.25);
  let lo = 0, hi = S.sprouts;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (count(m) < want) lo = m; else hi = m; }
  S.sprouts = (lo + hi) / 2;
  const K = {
    ...S, detail: d, plump, lobes, curl, variation: V,
    depth,                                         // generations below the main shoots; a fraction grows the last in
    amount: a, repeat: j,                          // how far the repeats wander, and which repeat this is
    seed0: seed,                                   // the design's (or the twin half's) seed
    seed: seed + 1.37 * J,                         // each repeat's leaves vary in their own way, the same on both sides
    vamt: vamt(V, S.vary),                         // the instance variation
    D1: VK.map((_, i) => dirv(S.varAngle, S.varTwist, i)), D2: VK.map((_, i) => dirv(S.varAngle + 1.9, S.varTwist + 2.7, i)),
    F: leafForm(plump, lobes, curl, S.stripes),    // the leaf
  };
  if (set) { Object.assign(K, set); K.F = leafForm(K.plump, K.lobes, K.curl, K.stripes); if (set.vamt === undefined) K.vamt = vamt(V, K.vary); }
  return dt > 0 ? drift(K, dt, false) : K;
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
// (hair-thin curls) growing from nothing, which then fill out into leaves. Each shoot is an instance of its own: its
// settings are the design's K0 moved by the instance variation at its own number t (varied(), above), and its sprouts
// vary from K0 in their own ways.
function grow(sc, K0, x, y, h, L, c, k, t, cut, half = false, b = 0, e0 = 1, fs = 1) {
  if (L < cut) return;
  L *= smooth(cut, 2 * cut, L);                     // small shoots shrink away instead of vanishing
  const va = K0.vamt * Math.pow(0.85, k), K = varied(K0, t, va);
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
  const f0 = head(sc, hx, hy, hh, lh, H, c, k, half, pen, n, K.quick, root ? (u => (1 - sig) * sway(sig + (1 - sig) * u)) : null, ess, Math.max(smooth(0, 0.15, sig), 1 - smooth(0.4, 1.2, e0 / Math.max(1e-9, lh * H.len * H.wid * H.base))), 0.61 * t + K.seed, va);
  // the stalk, behind the head: a band that swells a little in its middle and narrows into the head, as broad as
  // the pens (so a large design's stalks stay bands), and thinner while it is short, so it grows in from nothing
  const sgr = smooth(0, 1, Ls / (0.4 * L)), zs = sc.next(k), sw = (root ? 0.0095 : 0.0065) * Math.sqrt(Math.min(1, L)) * Math.pow(PEN / PEN0, 0.8) * sgr, swf = u => sw * (0.85 + 0.35 * Math.sin(Math.PI * u)) * lerp(1, 0.75, u);
  if (st) { const B = band(st, swf); sc.shape(B, pen.pw / 2 + pen.gap, zs); sc.line(B.concat(B.slice(0, 2)), pen.pw, zs); }
  if (!f0) return;
  // the shoot's spine: the stalk (u up to us), then the head's first stroke; and its half-width on each side (along a
  // stalk still growing in, the first stroke's base width gives way to the stalk's)
  const l0 = lh * H.len, us = st ? Ls / (Ls + l0) : 0;
  const spine = u => u < us ? at(st, u / us) : at(f0.sp, (u - us) / (1 - us));
  const halfAt = (s, u) => {
    if (u < us) return Math.max(swf(u / us), (1 - sgr) * (s > 0 ? f0.wl[0] : f0.wr[0]));
    const v = clamp((u - us) / (1 - us)) * f0.sp.n, i = Math.min(f0.sp.n - 1, Math.floor(v)), W = s > 0 ? f0.wl : f0.wr;
    return lerp(W[i], W[i + 1], v - i);
  };
  // The sides (s = +1 the left): sprouts alternate along the shoot, the first on the side fs, which its parent hands
  // down (its own side, or the other, in turn along the parent and from one generation to the next, so that as many
  // shoots begin on their convex side as on their concave side), or come in pairs at nodes (pair). The bias side moves
  // them towards the convex side, away from the shoot's curl (side > 0), or the concave side (side < 0); in most of the
  // space there is none, and each shoot's own variation of it makes some shoots run on one side for a stretch.
  // conv(s) is 1 on the convex side, blended where the shoot is nearly straight. A crown (half) has only its
  // right-hand sprouts, which the mirror completes.
  const sg = clamp(4 * c, -1, 1), first = fs, bias = K.side, ab = Math.abs(bias), conv = s => (1 - s * sg) / 2;
  const sideW = (j, s) => {
    if (half) return 1;
    const own = (j % 2 ? -first : first) === s, here = Math.max(own ? 1 : 0, K.pair), there = Math.max(own ? 0 : 1, K.pair);
    const fav = bias > 0 ? conv(s) : 1 - conv(s);
    return here * (1 - ab * (1 - fav)) + there * ab * fav;
  };
  const SIDES = half ? [-1] : [1, -1];
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
  // (each shoot's own: from and to, moved by its own Q), slid along by its own phase and staggered by alt; on its side
  // (sideW, above); with a whorl, a second, rising sprout at the same node. It comes out from under the edge there,
  // leaning out at the angle alpha, curls the way it leans, and is the shoot's length times the scale, smaller
  // towards the tip. The last, fractional sprout grows in.
  const ns = K.sprouts * (1 + 0.25 * V * q(6)), vary = 0.2 + 0.15 * V;
  const ua = clamp(K.from + vary * q(21), 0, 0.7), ue = Math.min(0.99, ua + (0.99 - ua) * clamp(K.to + vary * q(22), 0.2, 1)), ph0 = 0.5 * clamp(1.6 * q(23), -1, 1);
  for (let j = 0; j < Math.ceil(ns); j++) {
    const wj = clamp(ns - j) * gw; if (wj <= 0) continue;
    const ev = j % 2 === 0, fj = clamp((j + 0.5 + ph0 + (ev ? -0.25 : 0.25) * K.alt) / Math.max(1, ns)), uj = lerp(ua, ue, fj);
    const [px, py, ph] = spine(uj), al = K.angle * (1 + 0.3 * V * q(7 + j)) * lerp(1.1, 0.75, fj);
    for (const s of SIDES) {
      const bw = sideW(j, s); if (bw <= 0) continue;
      const e = halfAt(s, uj), L1 = L * K.scale * (1 - 0.3 * fj) * (1 + 0.25 * V * q(11 + j)) * wj * bw;
      // recorded once for each side it comes out on, however it is drawn (with a whorl, and as two curls on the convex side)
      if (TRACE && L1 >= cut) TRACE.push({ gen: k, shoot: t, u: uj, side: s, convex: half ? 0.5 : conv(s), x: px, y: py, h: ph, weight: wj * bw });
      for (const [wh0, af, lf, dt0] of [[1, 1, 1, 0], [K.whorl, 0.45, 0.72, 5.3]]) for (const [cj, wc0, dt] of curls(s).map(([a, b], i) => [a, b, dt0 + 3.7 * i])) {
        const wh = wh0 * wc0; if (wh <= 0) continue;
        let hj = ph + s * al * af;
        hj += K.rise * Math.sin(Math.PI / 2 - hj) * 0.8;
        const Lj = L1 * lf * wh;
        grow(sc, K0, px - s * e * Math.sin(ph), py + s * e * Math.cos(ph), hj, Lj, cj, k + 1, 1.3 * t + 2.9 * (j + 1) + (s > 0 ? 0.7 : 0) + dt, cut, false, clamp(K.bloom * K.buds * pick(j, s) * (root ? 1 : 0.7)), e, (j + k) % 2 ? -s : s);
      }
    }
  }
  // a cluster: sprouts fanning out from behind the head, from leaning out to hanging, alternating sides (beginning
  // opposite the shoot's first sprout), so a flower or a leaf at the end of a stalk is ringed with leaves that arch
  // outwards and down (a fountain). They come
  // out from behind the flower, or from behind the base of the head's first stroke; behind a flower they are longer,
  // so big horns sweep out from behind it as in the 1799 plants.
  const bf = smooth(0.2, 0.9, b), ncl = (K.cluster + 2 * smooth(0.3, 0.9, b)) * smooth(0, 0.12, sig) * (root ? 1 : 0.5);
  const uc = us + 0.12 * (1 - us) * (1 - bf), [cx, cy, ch] = spine(uc);
  for (let j = 0; j < Math.ceil(ncl); j++) {
    const wj = clamp(ncl - j) * gw; if (wj <= 0) continue;
    const fj = clamp((j + 0.5) / Math.max(1, ncl)), al = lerp(0.8, 2.1, fj) * (1 + 0.2 * V * q(41 + j));
    for (const s of SIDES) {
      const bs = sideW(j + 1, s); if (bs <= 0) continue;
      const L1 = L * K.scale * lerp(0.95, 0.65, fj) * lerp(1, 1.35, bf) * (1 + 0.2 * V * q(45 + j)) * wj * bs, e = lerp(halfAt(s, uc), 0, bf);   // behind a flower, big horns
      if (TRACE && L1 >= cut) TRACE.push({ gen: k, shoot: t, u: uc, side: s, convex: half ? 0.5 : conv(s), x: cx, y: cy, h: ch, weight: wj * bs, cluster: true });
      for (const [cj, wc0, i] of curls(s).map(([a, b], i) => [a, b, i])) {
      if (wc0 <= 0) continue;
      const Lj = L1 * wc0;
      grow(sc, K0, cx - s * e * Math.sin(ch), cy + s * e * Math.cos(ch), ch + s * al, Lj, cj, k + 1, 1.7 * t + 3.1 * (j + 1) + (s > 0 ? 0.7 : 0) + 9.1 + 3.7 * i, cut, false, clamp(K.bloom * K.buds * 0.35 * pick(j + 3, s)), Math.max(halfAt(s, uc), 0.8 * l0 * bf), (j + k) % 2 ? s : -s);
      }
    }
  }
}

// The motif: the main shoots from the root (the origin). The first heads K.turn from straight up towards the right
// and each further one K.spread further round, the last, fractional one growing in; the fan is kept softly short of
// straight down (a smooth minimum), so that a mirrored design never crosses its axis. A shoot curls outwards, away
// from the axis, by K.bend times the cosine of its heading (so a shoot heading down curls the other way round, and
// one heading sideways not at all), and by K.arch times its sine: up into an arch or down into a swag. Its head opens
// by bloom times tips. A mirror image (x -> -x), K.mirror times the size, grows from the same root: the mirror image
// of the same shoots where the symmetry is 1, and where it is lower, of their twin, whose numbers drift away
// (twinOf, above); an upright crown on the axis stays exactly symmetric.
const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
const heading = (K, i) => smin(K.turn + K.spread * i, Math.PI - 0.12, 0.25);
function mains(sc, K, cut) {
  const N = K.shoots;
  for (let i = 0; i < Math.ceil(N); i++) {
    const w = clamp(N - i); if (w <= 0) continue;
    const a = heading(K, i), c = clamp(-K.bend * Math.cos(a) + K.arch * Math.sin(a), -1, 1);
    grow(sc, K, 0, 0, Math.PI / 2 - a, w * (1 - 0.12 * i), c, 0, 3.7 * i + 1, cut, false, clamp(K.bloom * K.tips * (i ? 0.7 : 1)), 1, i % 2 ? -1 : 1);
  }
}
function motif(K, cut) {
  const sc = new Scene();
  mains(sc, K, cut);
  // on the axis of a mirrored design, an upright crown: a straight, symmetric shoot (c = 0) with its right-hand
  // strokes and sprouts, which the mirror completes; its head opens by bloom
  const S0 = sc.shapes.length, L0 = sc.lines.length, m = K.mirror, cw = K.crown * m * m;
  if (cw > 0) grow(sc, K, 0, 0, Math.PI / 2, 0.85 * cw, 0, 0, 0.5, cut, true, clamp(1.3 * K.bloom));
  if (m > 0) {
    let shapes = sc.shapes.slice(), lines = sc.lines.slice();
    if (K.symmetry < 1) {
      const T = new Scene(), tr = TRACE, hd = HEADS; TRACE = HEADS = null;
      mains(T, twinOf(K), cut); TRACE = tr; HEADS = hd;
      shapes = T.shapes.concat(shapes.slice(S0)); lines = T.lines.concat(lines.slice(L0));
    }
    for (const s of shapes) sc.shapes.push({ poly: s.poly.map((v, j) => (j % 2 ? v : -v) * m), halo: s.halo * m, z: s.z - 0.5 });
    for (const l of lines) sc.lines.push({ ...l, pts: l.pts.map((v, j) => (j % 2 ? v : -v) * m), w: l.w * m, z: l.z - 0.5 });
  }
  return sc;
}
// How upright a motif stands: the cosine of the mean heading of its main shoots (and its crown), 1 straight up, -1
// hanging
function upright(K) {
  let s = 0, w = 0;
  for (let i = 0; i < Math.ceil(K.shoots); i++) { const wi = clamp(K.shoots - i) * (1 - 0.12 * i); s += wi * Math.cos(heading(K, i)); w += wi; }
  const cw = 0.85 * K.crown * K.mirror * K.mirror;
  return (s + cw) / Math.max(1e-9, w + cw);
}

function sceneBox(sc) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const l of sc.lines) for (let i = 0; i < l.pts.length; i += 2) {
    const a = l.pts[i], b = l.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}
// The parts of scene M, turned by rot, scaled by s (its pens by the square root of s), moved to (X, Y), mirrored
// (x -> -x) if flip, and put dz further back, into the scene sc; returns the largest x of its lines
function put(sc, M, X, Y, s, rot, flip, dz) {
  if (!X && !Y && s === 1 && !rot && !flip && !dz) { sc.shapes.push(...M.shapes); sc.lines.push(...M.lines); return sceneBox(M).x1; }
  const c = Math.cos(rot) * s, n = Math.sin(rot) * s, sw = Math.sqrt(s), fx = flip ? -1 : 1;
  let x1 = -1e9;
  const tf = P => { const o = new Array(P.length); for (let i = 0; i < P.length; i += 2) { const x = P[i], y = P[i + 1]; o[i] = fx * (X + c * x - n * y); o[i + 1] = Y + n * x + c * y; if (o[i] > x1) x1 = o[i]; } return o; };
  for (const t of M.shapes) sc.shapes.push({ poly: tf(t.poly), halo: t.halo * sw, z: t.z + dz });
  x1 = -1e9;
  for (const l of M.lines) sc.lines.push({ ...l, pts: tf(l.pts), w: l.w * sw, z: l.z + dz });
  return x1;
}

// The settings a point gives (all continuous), for pages and tools that describe a design; repeat j gives the
// settings of the j-th repeat of a frieze (negative: to the left, the twin of the right) or the j-th tier of a tower.
export function settingsAt({ x = 5, y = 5, z = 5, detail = 0.5, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}, repeat = 0) {
  return settings(x, y, z, detail, plump, lobes, curl, variation, repeat);
}

// The rhythm of a frieze, read at each repeat's distance i from the centre (so both halves share it): feature motifs
// (larger, opened into flowers ringed with horns, or into large fans) among medium plants and small sprigs, by
// Q(1.13 i); and slow swells of lush clusters (closer, larger, more sprouts) and sparse stretches of open ground (wide
// spacing), by Q(0.29 i); and the spacing itself breathes from one repeat to the next, by Q(1.71 i). hier and lush,
// settings of x, y and z, set how strongly; seed0 is the half's own seed.
function rhythm(K, seed0) {
  return i => {
    const h = Q(1.13 * i + 2.3 * seed0 + 0.7), l = clamp(1.6 * Q(0.29 * i + 1.7 * seed0 + 3.1), -1, 1);
    const feat = K.hier * smooth(0.2, 0.55, h), sprig = K.hier * smooth(-0.05, -0.45, h), lush = K.lush * l;
    return { feat, sprig, lush, kind: smooth(-0.4, 0.4, Q(2.71 * i + seed0 + 1.2)), size: 0.85 * Math.exp(0.35 * feat - 0.8 * sprig + 0.4 * lush), dens: Math.exp(-0.5 * lush + 0.3 * K.hier * Q(1.71 * i + 1.3 * seed0 + 2.2)), open: K.lush * smooth(-0.3, -0.8, l) };
  };
}
// a repeat's settings with its place in the rhythm: a feature opens into a flower ringed with horns (kind 1) or into a
// large fan (kind 0); a sprig has fewer generations and more hairlines; a lush stretch more sprouts
function withRhythm(Kj, r) {
  const o = { ...Kj }, f = r.feat;
  o.bloom = Kj.bloom + 1.1 * f * r.kind; o.tips = lerp(Kj.tips, 1, f); o.cluster = Kj.cluster + 1.6 * f * r.kind;
  o.lobes = clamp(Kj.lobes + 0.5 * f * (1 - r.kind)); o.plump = clamp(Kj.plump + 0.2 * f * (1 - r.kind));
  o.depth = Kj.depth * (1 - 0.4 * r.sprig); o.hair = lerp(Kj.hair, 1, r.sprig); o.sprouts = Kj.sprouts * (1 + 0.45 * r.lush);
  o.F = leafForm(o.plump, o.lobes, o.curl, o.stripes);
  return o;
}
const smax = (a, b, e) => (a + b + Math.sqrt((a - b) * (a - b) + e * e)) / 2;   // a smooth maximum

// One stroke of a frieze's scroll: the points P (x, y pairs) with half-widths W, then a volute that winds on from its
// end, curling the same way as the scroll there (sg, its curvature k0 at the join), tightening like a logarithmic
// spiral through about 1.3 turns over the length ext while it thins to a point. A band with a halo, at depth z.
function scrollStroke(sc, P, W, sg, ext, k0, z) {
  const m = P.length / 2 - 1; if (m < 1) return;
  const x1 = P[2 * m], y1 = P[2 * m + 1], h1 = Math.atan2(y1 - P[2 * m - 1], x1 - P[2 * m - 2]), pts = P.slice(), ws = W.slice();
  if (ext > 1e-6) {
    const r0 = 0.1, C = TAU * 1.3 / Math.log((1 + r0) / r0);
    const V = curve(x1, y1, h1, ext, u => sg * C * smooth(0, 0.45, u) / (1 - u + r0) + k0 * ext * (1 - smooth(0, 0.35, u)), 40);
    for (let i = 1; i <= V.n; i++) { pts.push(V.X[i], V.Y[i]); ws.push(W[m] * lerp(1, 0.12, smooth(0, 1, i / V.n))); }
  }
  const c = { X: [], Y: [], H: [], n: pts.length / 2 - 1 };
  for (let i = 0; i <= c.n; i++) {
    c.X.push(pts[2 * i]); c.Y.push(pts[2 * i + 1]);
    const a = Math.max(0, i - 1), b = Math.min(c.n, i + 1);
    c.H.push(Math.atan2(pts[2 * b + 1] - pts[2 * a + 1], pts[2 * b] - pts[2 * a]));
  }
  for (let i = 1; i <= c.n; i++) c.H[i] -= TAU * Math.round((c.H[i] - c.H[i - 1]) / TAU);   // no jumps of 2 pi
  const B = band(c, u => ws[Math.round(u * c.n)]);
  sc.shape(B, PEN / 2 + Math.max(GAP, 0.9 * PEN), z); sc.line(B.concat(B.slice(0, 2)), Math.max(MIN, PEN), z);
}

// The whole design. Aspect is relative to the motif's own proportions, as in the Machine: at 1 the motif stands
// alone; wider, a frieze grows out of it to both sides (below); taller, smaller repeats bud out of its top
// (telescoping, as in a tall panel). Options: min and gap, for small prints; trace, an array that receives where each
// of the motif's sprouts comes out ({gen, shoot, u, side, convex, x, y, h, weight}, u its share of the way along its
// parent, convex its weight on the parent's convex side); heads, an array that receives the strokes of each of the
// motif's heads; layout, an object that receives where a frieze's motifs stand and how its scroll swings; set,
// settings to put in place of the ones x, y and z give (for studies and tests, e.g. {bloom: 1}).
export function build({ x = 5, y = 5, z = 5, detail = 0.5, aspect = 1, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}, opt = {}) {
  MIN = opt.min || 0; GAP = opt.gap || 0; PEN = PEN0; VEIN = VEIN0; TRACE = null; HEADS = null;
  const A = clamp(aspect, 0.2, 48), KS = new Map(), kAt = j => KS.get(j) || KS.set(j, settings(x, y, z, detail, plump, lobes, curl, variation, j, opt.set)).get(j), K = kAt(0);
  // the motif's own size, then how large the whole design will be: a design g times larger keeps its smallest shoots
  // g^0.6 times larger, and its pens g^0.4 times bolder, so that a long frieze or a tall tower is not lost in fuzz
  let cut = 0.03, M = motif(K, cut);
  const b0 = sceneBox(M), W0 = b0.x1 - b0.x0, H0 = b0.y1 - b0.y0, S0 = Math.max(W0, H0);
  const g = Math.max(1, A > 1 ? Math.max(A * W0, H0) / S0 : Math.max(W0, H0 / A) / S0);
  if (g > 1) { PEN = PEN0 * Math.pow(g, 0.4); VEIN = VEIN0 * Math.pow(g, 0.4); cut = 0.03 * Math.pow(g, 0.6); M = motif(K, cut); }
  // a repeat's box, measured on the repeat drawn at a fixed coarse cut and stretched to the motif's own size, so that
  // where the repeats stand does not depend on the aspect
  const CB = 0.1, quick = Kq => sceneBox(motif({ ...Kq, quick: true }, CB)), c0 = quick(K), kx = W0 / (c0.x1 - c0.x0), ky = H0 / (c0.y1 - c0.y0);
  const box = Kq => { const c = quick(Kq); return { x0: kx * c.x0, x1: kx * c.x1, y0: ky * c.y0, y1: ky * c.y1, h: c.y1 - c.y0 }; };
  const sc = new Scene();
  if (A > 1) {
    // A frieze. In the middle stands the motif, mirrored (its mirror image grows in as the frieze does), and from
    // behind it a scroll runs out to each side, carrying repeats in its bays. The left half is the mirror image of the
    // right half, exactly where the symmetry is 1; where it is lower, of the right half's twin (settings(-j)).
    const need = (A - 1) * W0 / 2, K0 = K.mirror < 1 ? { ...K, mirror: lerp(K.mirror, 1, smooth(1, 2.5, A)) } : K, M0 = K0 === K ? M : motif(K0, cut);
    const half = sd => {
      // Repeat i of this half (i = 1, 2, ... outwards), drawn as if facing right: its settings, with its place in the
      // rhythm; its scale (towards the motif's height, times its size in the rhythm); turned over (by pi) if i is odd,
      // so the plants stand and hang in turn; and its root, where the scroll will pass, gap times the sum of the
      // facing reaches, and a quarter more, so that the plants sit in the scroll's bays (or wider, in open ground),
      // beyond the last. Repeats are added until the half is (A - 1) / 2 times
      // the motif's width; the last is weighted by the width still wanted, and one more, not yet begun, gives the
      // scroll its way on. Root i lies at the scroll's phase i pi + theta_i, theta_i = -0.425 pi times how upright the
      // repeat stands, so an upright plant stands in a trough, a hanging one hangs from a crest, and one reaching
      // sideways sits where the scroll crosses its axis.
      const Ks = sd > 0 ? K : kAt(-1), ry = rhythm(K, Ks.seed0), RK = new Map();
      const repK = i => RK.get(i) || RK.set(i, withRhythm(kAt(sd * i), ry(i))).get(i);
      const R = [{ K: K0, s: 1, b: box(K0), rot: 0, Nd: 0, ph: -0.425 * Math.PI * upright(K0), w: 1 }];
      let got = 0;
      for (let i = 1; i < 1000; i++) {
        const Ki = repK(i), b = box(Ki), odd = i % 2 === 1, prev = R[i - 1], r = ry(i);
        const s = clamp(Math.pow((c0.y1 - c0.y0) / Math.max(1e-6, b.h), 0.7), 0.6, 1.6) * r.size;
        const out = prev.s * (prev.rot ? -prev.b.x0 : prev.b.x1), inn = s * (odd ? b.x1 : -b.x0);
        const P = Math.max(0.05 * W0, smax(1.25 * K.gap * r.dens * (out + inn), r.open * W0, 0.1 * W0)), w0 = clamp((need - got) / P);
        R.push({ K: Ki, s, b, rot: odd ? Math.PI : 0, Nd: prev.Nd + P, ph: i * Math.PI - 0.425 * Math.PI * upright(Ki), w: smooth(0, 1, w0) });
        if (w0 <= 0) break;
        got += P;
      }
      // The scroll: x(phase) runs smoothly through the roots (a cubic between neighbouring roots, its slope at each
      // root the secant from the root before), y = A(phase) sin(phase). Its height A at a root is a share of the
      // half-wave's length, or of the plants' height there if that is less (a smooth minimum), the share set by swing,
      // wandering along the length and swinging wider in open ground.
      const N = R.length, L = N - 2, ht = r => r.s * (r.b.y1 - r.b.y0);
      const T = R.map((r, i) => i ? (r.Nd - R[i - 1].Nd) / (r.ph - R[i - 1].ph) : (R[1].Nd - r.Nd) / (R[1].ph - r.ph));
      const am = lerp(0.2, 0.45, K.swing), Aa = R.map((r, i) => am * Math.exp(0.7 * Q(0.41 * i + 1.9 * Ks.seed0 + 2) - 0.3 * ry(i).lush) * -smax(-(i ? r.Nd - R[i - 1].Nd : R[1].Nd), -0.6 * (ht(r) + ht(R[i ? i - 1 : 1])), 0.1 * W0));
      const seg = ph => { let i = 0; while (i < N - 2 && ph > R[i + 1].ph) i++; return i; };
      const X = ph => {
        const i = seg(ph), a = R[i], b = R[i + 1], d = b.ph - a.ph, t = (ph - a.ph) / d;
        if (t > 1) return b.Nd + T[i + 1] * (ph - b.ph);
        const m = (b.Nd - a.Nd) / d, t0 = Math.min(T[i], 3 * m) * d, t1 = Math.min(T[i + 1], 3 * m) * d, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * a.Nd + (t3 - 2 * t2 + t) * t0 + (3 * t2 - 2 * t3) * b.Nd + (t3 - t2) * t1;
      };
      const Am = ph => { const i = seg(ph), t = clamp((ph - R[i].ph) / (R[i + 1].ph - R[i].ph)); return lerp(Aa[i], Aa[i + 1], t * t * (3 - 2 * t)); };
      const y0 = Aa[0] * Math.sin(R[0].ph), Y = ph => Am(ph) * Math.sin(ph) - y0;
      const at = ph => { const e = 1e-3; return [X(ph), Y(ph), Math.atan2(Y(ph + e) - Y(ph - e), X(ph + e) - X(ph - e))]; };
      // How far the scroll has grown: while repeat i grows (w from 0 to 1), the scroll's end runs on from where it
      // ended before to a quarter wave beyond the root, and the repeat buds from the outer edge of the one before (as
      // drawn) and moves out to its root along the scroll (eased, so it starts and stops gently), so the frieze widens
      // at an even rate.
      const Er = i => i <= 1 ? R[0].ph : R[i - 1].ph + Math.PI / 2;
      const end = L ? Er(L) + R[L].w * (R[L].ph + Math.PI / 2 - Er(L)) : R[0].ph;
      const inv = x => { let lo = R[0].ph, hi = R[N - 1].ph + Math.PI; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (X(m) < x) lo = m; else hi = m; } return (lo + hi) / 2; };
      const S = new Scene(), motifs = [], waves = [];
      let edge = sceneBox(M0).x1;
      for (let i = 1; i <= L; i++) {
        const r = R[i], s = r.s * r.w, [rx, rY, tau] = at(r.w < 1 ? inv(edge + r.w * (r.Nd - edge)) : r.ph);
        // it leans with the scroll, and a little of its own way, by its setting lean
        const rot = r.rot + r.K.lean * (tau + 0.35 * Q(0.93 * i + 1.3 * Ks.seed0 + 0.4));
        if (s > 0) edge = put(S, motif(r.K, cut), rx, rY, s, rot, false, -1e8 * i);
        const cy = 0.5 * (r.b.y0 + r.b.y1) * (r.rot ? -1 : 1);
        motifs.push({ j: sd * i, x: rx, y: rY, ry: rY, s, w: r.w, h: s * (r.b.y1 - r.b.y0), cy: rY + s * cy, rot });
      }
      // The scroll's strokes, one for each half-wave (between the nodes n pi, where it crosses its axis): each springs
      // from behind the one before, a little before the node, runs through its crest or trough and past the next node
      // winds into a volute in its own bay, as in a painted border (its length 2.2 times the scroll's height there, and
      // at least 15 times the stroke's half-width, so it always spirals). A stroke swells in the middle of its half-wave
      // and thins at the nodes; it grows in as the scroll's end passes its node.
      const rw = lerp(0.007, 0.014, K.swing) * Math.pow(g, 0.4), DEL = 0.3 * Math.PI, ST = Math.PI / 48, n0 = Math.floor(R[0].ph / Math.PI);
      for (let n = n0; n * Math.PI < end; n++) {
        const a = Math.max(R[0].ph, n * Math.PI - DEL * clamp((end - n * Math.PI) / DEL)), b = Math.min(end, (n + 1) * Math.PI);
        if (!(b - a > 1e-6)) continue;
        const P = [], W = [], add = ph => { const sn = Math.sin(ph); P.push(X(ph), Y(ph)); W.push(rw * (0.55 + 0.45 * sn * sn) * lerp(0.35, 1, smooth(a, a + 0.35 * Math.PI, ph))); };
        add(a); for (let q = Math.floor(a / ST) + 1; q * ST < b - 1e-9; q++) add(q * ST); add(b);
        const m = P.length / 2 - 1, gv = clamp((b - Math.max(a, n * Math.PI)) / (0.5 * Math.PI)), sg = ((n % 2) + 2) % 2 ? 1 : -1;
        let k0 = 0;
        if (m >= 2) { const h0 = Math.atan2(P[2 * m - 1] - P[2 * m - 3], P[2 * m - 2] - P[2 * m - 4]), h1 = Math.atan2(P[2 * m + 1] - P[2 * m - 1], P[2 * m] - P[2 * m - 2]); k0 = (h1 - h0) / Math.max(1e-9, Math.hypot(P[2 * m] - P[2 * m - 4], P[2 * m + 1] - P[2 * m - 3]) / 2); }
        scrollStroke(S, P, W, sg, smax(2.2 * Am(b), 15 * rw, 2 * rw) * gv, k0, -1e12 - 10 * (n - n0));
        waves.push({ n, x0: X(n * Math.PI), x1: X((n + 1) * Math.PI), amp: Am((n + 0.5) * Math.PI) });
      }
      // At each node, as in the 1808 border, what springs from the stroke that goes on: a fan of hairlines flicked from
      // its outer (convex) side, and a short curling sprout into its bay (the concave side), ending in a flower where
      // the repeat's flowers have opened (a leaf where they have not). Both grow in as the scroll passes the node, and
      // lie behind the plants, in front of the scroll.
      const bay = new Scene(), pen = { pw: Math.max(MIN, PEN), vw: Math.max(MIN, 1.3 * VEIN), gap: 0 };
      for (let n = n0 + 1; n * Math.PI < end; n++) {
        const wJ = clamp((end - n * Math.PI) / (0.5 * Math.PI)) * smooth(0, 0.5, detail); if (!(wJ > 0)) continue;
        const Kj = repK(Math.max(1, n + 1)), s = ((n % 2) + 2) % 2 ? 1 : -1, Lh = X((n + 1) * Math.PI) - X(n * Math.PI);
        const edge = (ph, sd) => { const [px, py, ph_] = at(ph), sn = Math.sin(ph), e = rw * (0.55 + 0.45 * sn * sn); return [px - sd * e * Math.sin(ph_), py + sd * e * Math.cos(ph_), ph_]; };
        const hl = 0.3 * Lh * wJ * (0.45 + 0.55 * Kj.hair);
        if (hl > 0) { const [hx, hy, hh] = edge(n * Math.PI + 0.22 * Math.PI * wJ, -s); hairs(bay, hx, hy, hh, -s, hl, 3 + 2 * Kj.hair, pen, bay.next(0), false); }
        const Lb = 0.4 * Lh * wJ * smooth(0, 0.6, detail);
        if (Lb > cut) { const [ex, ey, eh] = edge(n * Math.PI + 0.1 * Math.PI * wJ, s); grow(bay, Kj, ex, ey, eh + s * 0.85, Lb, 0.8 * s, 1, 7.7 + 1.3 * n, cut, false, clamp(1.2 * Kj.bloom), 1); }
      }
      put(S, bay, 0, 0, 1, 0, false, -1e11);
      return { S, motifs, waves };
    };
    const right = half(1), left = K.symmetry < 1 ? half(-1) : right;
    put(sc, M0, 0, 0, 1, 0, false, 0);
    put(sc, right.S, 0, 0, 1, 0, false, 0); put(sc, left.S, 0, 0, 1, 0, true, 0);
    if (opt.layout) {
      const b = box(K0), fl = o => ({ ...o, j: -o.j, x: -o.x, rot: -o.rot });
      opt.layout.motifs = [{ j: 0, x: 0, y: 0, ry: 0, s: 1, w: 1, h: b.y1 - b.y0, cy: 0.5 * (b.y0 + b.y1), rot: 0 }, ...right.motifs, ...left.motifs.map(fl)];
      opt.layout.waves = [...right.waves, ...left.waves.map(w => ({ ...w, x0: -w.x1, x1: -w.x0 }))];
    }
  } else {
    put(sc, M, 0, 0, 1, 0, false, 0);
    if (A < 1) {
      // tiers 0.84 times the last (and scaled towards the motif's height), each overlapping the one below by a
      // quarter; up to eight. A growing tier buds from the top of the one below and rises to its place while it grows.
      const ov = 0.25, need = H0 * (1 / A - 1), s0 = c0.y1 - c0.y0;
      let Y = 0, below = { b: box(K) }, sb = 1, got = 0;
      for (let i = 1; i <= 8 && got < need; i++) {
        const Ki = kAt(i), b = box(Ki), s = Math.pow(0.84, i) * clamp(Math.pow(s0 / Math.max(1e-6, b.h), 0.7), 0.6, 1.6), add = s * (b.y1 - b.y0) * (1 - ov), w0 = clamp((need - got) / add), w = smooth(0, 1, w0);
        got += add;
        const Yi = Y + sb * below.b.y1 - s * w * b.y0 - ov * sb * (below.b.y1 - below.b.y0) * w;
        put(sc, motif(Ki, cut), 0, Yi, s * w, 0, false, -1e8 * i); Y = Yi; below = { b }; sb = s;
        if (w0 < 1) break;
      }
    }
  }
  if (opt.trace || opt.heads) { TRACE = opt.trace || null; HEADS = opt.heads || null; motif(K, cut); TRACE = HEADS = null; }   // the motif once more, recording
  return hide(sc);
}

// Repeat j of a frieze (or tier j of a tower) on its own, as the motif would stand alone with those settings; the
// repeats to the left (j < 0) are drawn as they face, mirrored.
export function buildRepeat(point = {}, j = 0) {
  const { x = 5, y = 5, z = 5, detail = 0.5, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = point;
  MIN = 0; GAP = 0; PEN = PEN0; VEIN = VEIN0;
  const items = hide(motif(settings(x, y, z, detail, plump, lobes, curl, variation, j), 0.03));
  return j < 0 ? items.map(it => ({ ...it, pts: it.pts.map((v, i) => i % 2 ? v : -v) })) : items;
}

// One head on its own (a main shoot on a short stalk, without sprouts), for close-ups: the leaf numbers, how far it
// has opened into a flower (bloom, 0 to 1) and the flower's shape (cup: 0 a rosette, 1 a tulip).
export function buildLeaf({ plump = 0.5, lobes = 0.5, curl = 0.5, bloom = 0, cup = 0.5 } = {}) {
  MIN = 0; GAP = 0; PEN = PEN0; VEIN = VEIN0;
  const K = settings(0, 0, 0, 0, plump, lobes, curl, 0);
  Object.assign(K, { stalk: 0.15, ess: 0, sway: 0, depth: 0, hair: 0, cup, vamt: 0 });
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
