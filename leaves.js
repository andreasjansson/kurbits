// Kurbits Leaves: a second Kurbits engine of line-drawn leaves after Dalecarlian kurbits painting (dalmålning, c.
// 1780-1870): plump, banded leaves that bend in a C or an S and wind their tips into curls, coming out from behind one
// another, generation after generation, from a stem, a bouquet, a spray, a garland or a wreath. Everything is a pen
// line; nothing is filled.
//
// Like the Kurbits Machine (index.html) a design is a point in a continuous space, and is built by one recursive rule:
// a shoot (a stalk, then a leaf, then a curl) grows smaller shoots from behind itself, which grow smaller ones, down to
// the depth that detail sets. x, y and z choose the composition (how many shoots spring from the root and where they
// head, how they bend, branch and rise, and whether the design is mirrored), detail the depth, plump, lobes and curl
// the leaf, variation how much the leaves differ, aspect the proportions. Every number is continuous, every point
// draws a design, and a small step in any number changes it only a little: whatever appears, a generation, a shoot,
// a lobe, a stripe or a repeat, grows from nothing. No dependencies; used by the Leaves tab of index.html and by
// cli/leaves.mjs.
//
// Output: pen lines, in drawing order, engine units (about one unit per main shoot), y up:
//   {t: 'l', pts: [x0, y0, x1, y1, ...], w}   a line of width w with round ends and joins (closed if it ends
//                                              where it starts)
// Hidden lines are already removed: a line that passes behind a leaf or a stalk stops a small gap short of its
// outline, as in an engraving.
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

// ------------------------------------------------------------------ lines and what hides them
// A scene collects pen lines and silhouettes, each at a depth z (larger is nearer). At the end every line is cut where
// a nearer silhouette covers it. next(k) hands out depths: a deeper generation lies behind every shallower one, and
// within a generation each new part lies behind the parts made before it.
class Scene {
  constructor() { this.shapes = []; this.lines = []; this.n = 0; }
  next(gen) { return -gen * 1e6 - this.n++; }
  line(pts, w, z) { if (pts.length >= 4 && w > 0) this.lines.push({ pts, w, z }); }
  // a silhouette (a closed polygon, not repeated at its end); lines behind it stop `halo` short of its edge
  shape(poly, halo, z) { if (poly.length >= 6) this.shapes.push({ poly, halo, z }); }
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
// for small prints, MIN > 0, a piece shorter than its width is left out). Silhouettes are sorted into a grid, so each
// point of a line meets only the silhouettes in the cell under it.
function hide(sc) {
  const S = sc.shapes.filter(s => s.halo >= 0);
  for (const s of S) { s.sil = s.halo > 0 ? offset(s.poly, s.halo) : s.poly; prep(s); }
  let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
  for (const s of S) { gx0 = Math.min(gx0, s.x0); gy0 = Math.min(gy0, s.y0); gx1 = Math.max(gx1, s.x1); gy1 = Math.max(gy1, s.y1); }
  const GN = 64, cw = Math.max(1e-6, (gx1 - gx0) / GN), ch = Math.max(1e-6, (gy1 - gy0) / GN), grid = Array.from({ length: GN * GN }, () => []);
  const cell = (v, o, c) => clamp(Math.floor((v - o) / c), 0, GN - 1);
  for (const s of S) for (let i = cell(s.x0, gx0, cw); i <= cell(s.x1, gx0, cw); i++) for (let j = cell(s.y0, gy0, ch); j <= cell(s.y1, gy0, ch); j++) grid[i * GN + j].push(s);
  const out = [], len = r => { let l = 0; for (let i = 2; i < r.length; i += 2) l += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]); return l; };
  const keep = (r, w) => { const l = len(r); if (MIN ? l > w : l > 0.04 * w) out.push({ t: 'l', pts: r, w: MIN ? w : w * Math.min(1, l / (5 * w)) }); };
  for (const L of sc.lines) {
    const p = L.pts, n = p.length / 2, z = L.z;
    // hidden: inside a nearer silhouette among those in the grid cell under the point
    const hid = (x, y) => {
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) return false;
      const C = grid[cell(x, gx0, cw) * GN + cell(y, gy0, ch)];
      for (let c = 0; c < C.length; c++) if (C[c].z > z && inside(C[c], x, y)) return true;
      return false;
    };
    const f = new Array(n); let any = false;
    for (let i = 0; i < n; i++) { f[i] = hid(p[2 * i], p[2 * i + 1]); if (f[i]) any = true; }
    if (!any) { keep(p, L.w); continue; }
    const cross = (i, j) => {                      // i is visible, j hidden: the last visible point between them
      let ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
      for (let r = 0; r < 8; r++) { const mx = (ax + bx) / 2, my = (ay + by) / 2; if (hid(mx, my)) { bx = mx; by = my; } else { ax = mx; ay = my; } }
      return [ax, ay];
    };
    const runs = []; let cur = null;
    for (let i = 0; i < n; i++) {
      if (!f[i]) { if (!cur) cur = i > 0 ? cross(i, i - 1) : []; cur.push(p[2 * i], p[2 * i + 1]); }
      else if (cur) { cur.push(...cross(i - 1, i)); runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    // a closed line whose start (= end) is visible: its last and first pieces are one
    if (runs.length > 1 && !f[0] && p[0] === p[2 * n - 2] && p[1] === p[2 * n - 1]) { const a = runs.pop(); runs[0] = a.concat(runs[0].slice(2)); }
    for (const r of runs) keep(r, L.w);
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
// the piece of a sampled curve from u0 to u1, resampled at m + 1 points (its ends move smoothly with u0 and u1)
function sub(c, u0, u1, m) {
  const X = [], Y = [], H = [];
  for (let i = 0; i <= m; i++) { const [x, y, h] = at(c, lerp(u0, u1, i / m)); X.push(x); Y.push(y); H.push(h); }
  return { X, Y, H, n: m, L: c.L * (u1 - u0) };
}
// a point and heading on a sampled curve at u (0..1), interpolated
function at(c, u) {
  const v = clamp(u) * c.n, i = Math.min(c.n - 1, Math.floor(v)), f = v - i;
  return [lerp(c.X[i], c.X[i + 1], f), lerp(c.Y[i], c.Y[i + 1], f), lerp(c.H[i], c.H[i + 1], f)];
}
// The outline of a band of half-width w(u) around a sampled curve from u = a to u = b (samples), one closed polygon
// with round ends. Where the curve turns tighter than the band is wide, the inner side is narrowed, so it never loops.
function band(c, w, ia = 0, ib = c.n) {
  const L = [], R = [], hw = [];
  for (let i = ia; i <= ib; i++) {
    const a = Math.max(0, i - 1), b = Math.min(c.n, i + 1), ds = Math.hypot(c.X[b] - c.X[a], c.Y[b] - c.Y[a]) || 1e-9;
    const k = (c.H[b] - c.H[a]) / ds, ww = w(i / c.n), lim = q => ww / Math.pow(1 + Math.pow(Math.max(0, q * ww) / 0.8, 4), 0.25);
    const nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]), wl = lim(k), wr = lim(-k);
    L.push(c.X[i] + nx * wl, c.Y[i] + ny * wl); R.push(c.X[i] - nx * wr, c.Y[i] - ny * wr); hw.push((wl + wr) / 2);
  }
  const cap = (i, j, dir) => {                     // a half circle round sample i, from the left side to the right
    const q = [], x = c.X[i], y = c.Y[i], h = c.H[i] + (dir < 0 ? Math.PI : 0), r = hw[j];
    for (let m = 1; m < 6; m++) { const a = h + Math.PI / 2 - Math.PI * m / 6; q.push(x + r * Math.cos(a), y + r * Math.sin(a)); }
    return q;
  };
  const P = L.slice();
  P.push(...cap(ib, hw.length - 1, 1));
  for (let i = R.length - 2; i >= 0; i -= 2) P.push(R[i], R[i + 1]);
  P.push(...cap(ia, 0, -1));
  return P;
}

// ------------------------------------------------------------------ the leaf
// The billows of a leaf's edge are one profile: a bump from 0 (a notch) to 1 (a billow's top) with period 1 in its
// phase f, leant towards the leaf's tip by a skew a and rounded by an exponent p (below 1: round billows between sharp
// notches).
const bump = (f, a, p) => Math.pow(Math.max(0, 0.5 - 0.5 * Math.cos(TAU * f - a * (1 - Math.cos(TAU * f)))), p);

// One shoot, growing from (x0, y0) at heading h0, length L, with form F (from grow()) and chirality c (-1 to 1: the
// shoot bends and curls anticlockwise for c > 0 and clockwise for c < 0; at 0 it is straight and symmetric). Its spine
// is described by its curvature: a bend that may reverse along it (an S), then a tip curl that tightens like a
// logarithmic spiral. Along the spine come a stalk (a narrow band, on main shoots), the blade (a plump leaf whose
// convex side, away from the curl, swells further and carries the billows) and the curl (a line, the tip winding on
// past the blade). The blade is banded with stripes that follow its outline and run together into its base and tip,
// and each notch between billows has a hook. zb is the depth of the blade; the stalk (zs) lies behind it and the tip
// (zt) in front. Returns the spine and the half-width on each side, where the sprouts attach.
function leaf(sc, x0, y0, h0, L, F, c, zs, zb, zt) {
  if (!(L > 1e-4)) return null;
  const s0 = F.stalk, s1 = 1 - F.vol, Lb = L * (s1 - s0);   // the blade runs from u = s0 to s1
  const n = F.n;                                    // a shoot keeps its number of samples, so it never jumps
  // the spine's curvature: the stalk bends by F.sb, the blade by F.bend (reversed near the base by the S, F.ess), and
  // the tip curls F.turns times round with a radius that shrinks with the length left (r0 keeps it finite)
  const r0 = 0.05 + 0.004 / L, uc = lerp(s0, s1, 0.45), Cc = TAU * F.turns / Math.log((1 - uc + r0) / r0);
  const cc = clamp(1.6 * c, -1, 1);
  const kap = u => cc * (lerp(F.sb, F.bend, smooth(s0 - 0.1, s0 + 0.1, u)) * (1 - 2 * F.ess * (1 - u)) + Cc * smooth(uc, uc + 0.3, u) / (1 - u + r0)) + F.sway(u);
  const sp = curve(x0, y0, h0, L, kap, n);
  const K = sp.H.map((h, i) => (sp.H[Math.min(n, i + 1)] - sp.H[Math.max(0, i - 1)]) / ((Math.min(n, i + 1) - Math.max(0, i - 1)) / n * L));
  const g = Math.sqrt(Math.min(1, L / 0.25)), pw = Math.max(MIN, PEN * g), vw = Math.max(MIN, VEIN * g);
  const gap = Math.max(GAP, 0.9 * PEN * g);
  // the stalk: a band behind the blade, narrowing towards it, up to where the blade begins
  const i0 = Math.ceil(s0 * n), i1 = Math.floor(s1 * n), sw = F.stem * Math.sqrt(Math.min(1, L));
  if (s0 > 0.002 && sw > 0) {
    const P = band(sub(sp, 0, s0, Math.max(4, Math.ceil(s0 * n))), u => sw * (1 - 0.35 * u));
    sc.shape(P, pw / 2 + gap, zs); sc.line(P.concat(P.slice(0, 2)), pw, zs);
  }
  // the blade: on each side (s = +1 the left, -1 the right) the edge lies w from the spine: the envelope E (a narrow
  // neck, a belly at vs, a pointed tip) times the width, the convex side (o = 1) more than the concave one, times the
  // billows, whose phase quickens towards the tip so that the billows there are smaller
  const W0 = Lb * F.b, vs = F.vs, p2 = F.p2, p1 = p2 * vs / (1 - vs);
  const env = v => (v <= 0 || v >= 1) ? 0 : Math.sqrt(smooth(0, 0.14, v)) * Math.pow(v / vs, p1) * Math.pow((1 - v) / (1 - vs), p2);
  const ph = v => F.N * (1 - Math.pow(1 - clamp((v - 0.1) / 0.9), 1.4));
  const sw0 = s0 > 0.002 && sw > 0 ? 0.65 * sw : 0;
  const side = s => {
    const o = (1 - s * clamp(c * 4, -1, 1)) / 2, D = F.D * lerp(0.12, 1, o), k = W0 * (1 + F.a * (2 * o - 1));
    const w = [], we = [], E = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v0 = (u - s0) / (s1 - s0), dl = 0.16 * (1 - o), v = (v0 - dl) / (1 - dl), e = env(v), lim = Math.pow(1 + Math.pow(Math.max(0, s * K[i] * k * e) / 0.8, 4), 0.25);
      const fade = smooth(0.02, 0.18, v) * (1 - smooth(0.7, 0.95, v)), b = bump(ph(v), F.sk, 0.4);
      const neck = sw0 * (1 - smooth(0, 0.15, v0)) * (v0 >= 0 && v0 <= 1 ? 1 : 0);   // a stalked blade starts as wide as its stalk
      const ww = k * e * (1 - D * fade * (1 - b)) * (1 + 0.3 * D * fade) / lim + neck;
      w.push(ww); we.push(k * e / lim + neck);
      const h = sp.H[i]; E.push(sp.X[i] - s * ww * Math.sin(h), sp.Y[i] + s * ww * Math.cos(h));
    }
    return { s, o, D, w, we, E };
  };
  const Lf = side(1), Rt = side(-1);
  // the outline: from the base (u = s0, where the blade has no width) up the left side to the tip (u = s1) and down
  // the right side; both ends lie between samples, so they move smoothly
  const ipE = (E, u) => { const t = u * n, i = Math.min(n - 1, Math.floor(t)), f = t - i; return [lerp(E[2 * i], E[2 * i + 2], f), lerp(E[2 * i + 1], E[2 * i + 3], f)]; };
  // a stalked blade's outline is open at the base, where it carries on from the stalk's two sides
  const [tx, ty] = at(sp, s1), poly = sw0 > 0 ? ipE(Lf.E, s0) : at(sp, s0).slice(0, 2), U = [s0];
  for (let i = i0; i <= i1; i++) if (i / n > s0 && i / n < s1) { poly.push(Lf.E[2 * i], Lf.E[2 * i + 1]); U.push(i / n); }
  poly.push(tx, ty); U.push(s1);
  for (let i = i1; i >= i0; i--) if (i / n > s0 && i / n < s1) { poly.push(Rt.E[2 * i], Rt.E[2 * i + 1]); U.push(i / n); }
  if (sw0 > 0) { poly.push(...ipE(Rt.E, s0)); U.push(s0); }
  // the blade hides what lies behind it (a narrow blade less round itself, a tendril not at all); its tip, from 0.7 of
  // the way along, is a nearer shape of its own, so that a tip rolled back over the blade hides the lines beneath it
  const wmax = Math.max(...Lf.we, ...Rt.we), soft = Math.min(1, wmax / (3 * PEN)), halo = (pw / 2 + gap) * soft;
  sc.shape(poly, halo, zb);
  const ut7 = lerp(s0, s1, 0.7);
  const tip = ipE(Lf.E, ut7);
  for (let i = i0; i <= i1; i++) if (i / n > ut7 && i / n < s1) tip.push(Lf.E[2 * i], Lf.E[2 * i + 1]);
  tip.push(tx, ty);
  for (let i = i1; i >= i0; i--) if (i / n > ut7 && i / n < s1) tip.push(Rt.E[2 * i], Rt.E[2 * i + 1]);
  tip.push(...ipE(Rt.E, ut7));
  sc.shape(tip, Math.min(halo, 0.05 * L), zt);
  // a line along the shoot belongs to the blade (zb) up to 0.62 of the blade and to the tip (zt) beyond
  const ut = lerp(s0, s1, 0.62);
  const put = (P, U, w, closed) => {
    const runs = []; let cur = [P[0], P[1]], tipSide = U[0] > ut;
    for (let i = 1; i < U.length; i++) {
      if ((U[i] > ut) !== tipSide) {
        const f = (ut - U[i - 1]) / (U[i] - U[i - 1]), x = lerp(P[2 * i - 2], P[2 * i], f), y = lerp(P[2 * i - 1], P[2 * i + 1], f);
        cur.push(x, y); runs.push([cur, tipSide]); cur = [x, y]; tipSide = !tipSide;
      }
      cur.push(P[2 * i], P[2 * i + 1]);
    }
    runs.push([cur, tipSide]);
    if (closed && runs.length > 1 && runs[0][1] === runs[runs.length - 1][1]) { const a = runs.pop(); runs[0][0] = a[0].concat(runs[0][0].slice(2)); }
    for (const [r, t] of runs) sc.line(r, w, t ? zt : zb);
  };
  if (sw0 > 0) put(poly, U, pw, false); else put(poly.concat(poly.slice(0, 2)), U.concat(U[0]), pw, true);
  // the curl: the tip winds on as a line past the blade
  if (s1 < 1) { const V = [tx, ty]; for (let i = i1 + 1; i <= n; i++) V.push(sp.X[i], sp.Y[i]); sc.line(V, pw, zt); }
  // stripes: on each side, up to F.stripes lines at fixed shares f of the blade's width in from the edge, following
  // the billows near the edge and smoothing out further in; the convex side has more. A stripe is drawn only where it
  // is a line and a gap clear of the edge and of its neighbour, so the stripes run together into the base and the
  // tip; a fractional count grows the last stripe back from the tip.
  const step = 0.17, need = vw + gap;
  for (const Sd of [Lf, Rt]) {
    const ns = F.stripes * lerp(0.2, 1, Sd.o);
    for (let j = 1; j <= Math.ceil(ns - 1e-9); j++) {
      const wt = clamp(ns - j + 1), f = j * step; if (wt <= 0) continue;
      const room = i => step * (Lf.we[i] + Rt.we[i]) - need;          // the space between neighbouring stripes
      // the longest run of samples with room, ends found between samples so they move smoothly
      let a = -1, b = -1, best = 0, ra = -1;
      for (let i = i0; i <= i1; i++) {
        if (room(i) >= 0) { if (ra < 0) ra = i; if (i - ra > best) { best = i - ra; a = ra; b = i; } } else ra = -1;
      }
      if (a < 0 || b <= a) continue;
      const ta = a > i0 ? a - room(a) / (room(a) - room(a - 1)) : a, tb = b < i1 ? b + room(b) / (room(b) - room(b + 1)) : b;
      const t0 = lerp(tb, ta, wt);                // grows back from the tip end
      if (tb - t0 < 1e-3) continue;
      const P = [], PU = [];
      const pt = t => {
        const i = Math.min(n - 1, Math.floor(t)), fr = t - i, ip = (A) => lerp(A[i], A[i + 1], fr);
        const h = ip(sp.H), wE = ip(Sd.w), wB = ip(Sd.we), wT = ip(Lf.we) + ip(Rt.we);
        const d = lerp(wE, wB, Math.min(1, 0.6 + 2.5 * f)) - f * wT;     // from the spine, on this side
        P.push(ip(sp.X) - Sd.s * d * Math.sin(h), ip(sp.Y) + Sd.s * d * Math.cos(h)); PU.push(t / n);
      };
      pt(t0); for (let i = Math.floor(t0) + 1; i < tb; i++) pt(i); pt(tb);
      put(P, PU, vw, false);
    }
  }
  // hooks: at each notch a short stroke turns in from the edge towards the base, so the billows read as overlapping;
  // its size follows the billows' depth on that side, so the shallow notches of the concave side mostly have none
  if (F.N > 0 && F.D > 0) {
    for (const S of [Lf, Rt]) {
      const depth = S.D;
      for (let j = 1; j < F.N; j++) {
        // the notch where the phase reaches j: v from the phase, then the sample
        const v = 0.1 + 0.9 * (1 - Math.pow(1 - j / F.N, 1 / 1.4)), u = lerp(s0, s1, v), wt = clamp(F.N - j) * smooth(0.02, 0.18, v) * (1 - smooth(0.7, 0.95, v));
        const t = u * n, i = Math.min(n - 1, Math.floor(t)), fr = t - i;
        const wB = lerp(S.we[i], S.we[i + 1], fr), r = 0.55 * depth * wB * wt - pw;   // grows from nothing
        if (r <= 0) continue;
        const [x, y, h] = at(sp, u), wE = lerp(S.w[i], S.w[i + 1], fr);
        const nx = -S.s * Math.sin(h), ny = S.s * Math.cos(h), tx = Math.cos(h), ty = Math.sin(h);
        const ex = x + nx * wE, ey = y + ny * wE, H = [], HU = [];
        for (let m = 0; m <= 10; m++) {
          const a = (m / 10) * 1.9;                // from straight in, turning towards the base
          H.push(ex - nx * r * Math.sin(a) - tx * r * (1 - Math.cos(a)), ey - ny * r * Math.sin(a) - ty * r * (1 - Math.cos(a))); HU.push(u);
        }
        put(H, HU, vw, false);
      }
    }
  }
  // the half-width on each side along the whole shoot (the stalk's, then the blade's), where sprouts attach
  const half = (S, i) => Math.max(S.w[i], i <= i0 ? sw : 0);
  return { sp, wl: Lf.w.map((_, i) => half(Lf, i)), wr: Rt.w.map((_, i) => half(Rt, i)) };
}

// ------------------------------------------------------------------ settings
// The composition is read off slow waves through the space, as in the Machine: setting k is lo + (hi - lo) times a
// wave osc(x, y, z, k) between 0 and 1 (beyond a threshold t, so that some settings rest at lo in parts of the space).
const osc = (x, y, z, k) => 0.5 + 0.5 * Math.sin(0.28 * Math.cos(k * GOLD) * x + 0.28 * Math.sin(1.31 * k * GOLD + 0.4) * y + 0.24 * Math.cos(1.77 * k + 1.1) * z + 1.618 * k);
const SETTINGS = [                                 // [name, lo, hi, threshold]
  ['turn', 0.05, 2.55],      // where the main shoot heads, from straight up (0) through sideways (pi/2) to hanging
  ['shoots', 1, 3.4],        // how many shoots spring from the root
  ['spread', 0.32, 0.85],    // the angle between neighbouring shoots
  ['bend', 0.15, 1],         // how far the shoots curl outwards, away from the axis
  ['ess', 0, 0.9, 0.45],     // an S: the base bends the other way
  ['sway', 0, 0.75, 0.45],   // a meander along the main shoots
  ['stalk', 0.25, 0.72],     // how much of a main shoot is bare stalk
  ['mirror', 0, 1],          // a mirror image grows from the root
  ['sprouts', 1, 3.3],       // shoots along each shoot
  ['angle', 0.75, 1.4],      // how far they lean out
  ['scale', 0.62, 0.85],     // their size
  ['span', 0.04, 0.3],       // where along the shoot they start
  ['side', -0.4, 1],         // on the convex side (1), alternating (0), on the concave side
  ['pair', 0, 1, 0.6],       // a mirrored partner on the other side
  ['rise', 0, 0.9, 0.35],    // shoots turn upwards
  ['away', 0.45, 1],         // how strongly sprouts curl the way they lean
  ['leafy', 0.38, 0.78],     // how leafy each generation stays: deeper shoots are slimmer
  ['gap', 0.72, 1.02],       // the spacing of repeats
  ['crown', 0, 1, 0.3],      // an upright shoot on the mirror's axis
  ['arch', -0.7, 0.9],       // shoots heading sideways bend up (an arch, a wreath) or down (a swag)
];
function settings(x, y, z, d, plump, lobes, curl, V) {
  const S = {};
  SETTINGS.forEach(([k, lo, hi, t = 0], i) => { S[k] = lo + (hi - lo) * Math.max(0, (osc(x, y, z, i) - t) / (1 - t)); });
  S.mirror = clamp((1 - osc(x, y, z, 7) - 0.25) * 4);   // the mirror's wave turned over, steep but continuous: mostly mirrored
  // the budget: about how many shoots the design would have, R (1 + m + m^2 + m^3) with m sprouts per shoot, each
  // generation weighted by how far it has grown; beyond about 100 the sprouts are trimmed (smoothly, so that the count
  // levels off) so that a design never crowds
  const depth = 3 * clamp(d), per = 1 + 0.7 * S.pair;
  const count = ns => { let t = 0; for (let k = 0; k <= 3; k++) t += Math.pow(ns * per, k) * clamp(depth - k + 1); return S.shoots * t; };
  const E = count(S.sprouts), want = E / Math.pow(1 + Math.pow(E / 100, 4), 0.25);
  let lo = 0, hi = S.sprouts;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (count(m) < want) lo = m; else hi = m; }
  S.sprouts = (lo + hi) / 2;
  return {
    ...S, detail: d, plump, lobes, curl, variation: V,
    depth,                                         // generations below the main shoots; a fraction grows the last in
    seed: 0.29 * x + 0.53 * y + 0.41 * z,
    F: {                                           // the leaf
      b: lerp(0.085, 0.27, plump),                 // the blade's half-width over its length
      vs: lerp(0.32, 0.44, plump),                 // where it is widest
      a: lerp(0.1, 0.4, plump),                    // how much more the convex side swells
      p2: lerp(1.6, 1.15, plump),                  // the taper to the tip
      N: 5.5 * lobes,                              // billows on the convex edge
      D: 0.3 * smooth(0, 0.35, lobes),             // their depth
      sk: lerp(0.05, 0.3, curl),                   // and lean towards the tip
      bend: lerp(0.35, 1.25, curl),                // the blade's bend
      turns: lerp(0.15, 1.2, curl),                // the tip curl
      vol: lerp(0.03, 0.2, curl),                  // the curl past the blade, as a share of the shoot
      stripes: lerp(1.3, 3.2, plump),              // stripes on the convex side
    },
  };
}

// ------------------------------------------------------------------ the recursive rule
// A shoot of generation k: its form, then its sprouts. Generation k grows in as the depth passes k - 1: first as a
// tendril (a hair-thin curl) growing from nothing, which then fills out into a leaf.
function grow(sc, K, x, y, h, L, c, k, t, cut, half = false, side = c < 0 ? -1 : 1) {
  if (L < cut) return;
  L *= smooth(cut, 2 * cut, L);                     // small shoots shrink away instead of vanishing
  const V = K.variation, q = j => Q(1.618 * t + 2.39 * j + K.seed);
  const leafy = k === 0 ? 1 : Math.pow(K.leafy, k) * smooth(0.15, 1.15, K.depth - k + 1);
  const F0 = K.F, root = k === 0;
  const F = {
    ...F0,
    b: F0.b * leafy * (root ? 0.8 : 1) * (1 + 0.25 * V * q(1)),
    stalk: root ? K.stalk : 0,
    sb: root ? 2.2 : 0.25 * F0.bend,                 // a main stalk bends by its chirality c (bend and arch) times 2.2
    bend: F0.bend * (1 + 0.35 * V * q(3)),
    ess: root ? K.ess : 0.5 * K.ess,
    turns: lerp(1.6, F0.turns, leafy) * (1 + 0.4 * V * q(4)),
    vol: half ? 0.02 : lerp(0.45, F0.vol, leafy),     // the crown ends in a point, not a curl
    N: F0.N * (1 + 0.3 * V * q(5)),
    stripes: F0.stripes * smooth(0.3, 0.9, leafy),
    stem: root ? 0.0095 : 0,
    n: k === 0 ? 140 : k === 1 ? 100 : 64,          // samples along the shoot (fixed for a shoot)
    sway: root && K.sway > 0 ? (u => K.sway * TAU * 1.3 * Math.cos(TAU * 1.3 * u + 0.6) * smooth(0, 0.15, u)) : () => 0,
  };
  const zt = sc.next(k), zb = sc.next(k), zs = sc.next(k);
  const r = leaf(sc, x, y, h, L, F, c, zs, zb, zt);
  if (!r) return;
  const sp = r.sp;
  // sprouts, the next generation, with weight clip(depth - k): sprout j sits at u_j along the shoot (from K.span over
  // the next 0.6 of it, so the tip curls free), on the side sigma_j (alternating, or to one side), and comes
  // out from under the edge there, leaning out at the angle alpha; it curls the way it leans (or back), and is the
  // shoot's length times the scale, smaller towards the tip. The last, fractional sprout grows in.
  const gw = clamp(K.depth - k);
  if (gw <= 0) return;
  const ns = K.sprouts * (1 + 0.25 * V * q(6)), reach = 0.6;
  const cs = side;                                  // the shoot's convex side is -cs: a sprout's is away from its parent
  for (let j = 0; j < Math.ceil(ns); j++) {
    const wj = clamp(ns - j) * gw; if (wj <= 0) continue;
    const fj = (j + 0.5) / Math.max(1, ns), uj = K.span + reach * fj;
    // a sprout on the convex side and one on the concave side, weighted: alternating at side = 0 (even sprouts on the
    // convex side), all on the convex side at side = 1 and all on the concave side at side = -1; pair adds the other
    const ev = j % 2 === 0, wv = Math.max(ev ? clamp(1 + K.side) : clamp(K.side), K.pair), wc = Math.max(ev ? clamp(-K.side) : clamp(1 - K.side), K.pair);
    const [px, py, ph] = at(sp, uj), i = Math.min(sp.n - 1, Math.floor(uj * sp.n)), fr = uj * sp.n - i;
    const al = K.angle * (1 + 0.3 * V * q(7 + j)) * lerp(1.1, 0.7, fj);
    // s: +1 the left side, -1 the right; a shoot on the mirror's axis (half) grows only its right-hand sprouts
    for (const [s, bw] of half ? [[-1, Math.max(wv, wc)]] : [[-cs, wv], [cs, wc]]) {
      if (bw <= 0) continue;
      const Wd = s > 0 ? r.wl : r.wr, e = lerp(Wd[i], Wd[i + 1], fr);
      let hh = ph + s * al;
      hh += K.rise * Math.sin(Math.PI / 2 - hh) * 0.8;
      const Lj = L * K.scale * (1 - 0.35 * fj) * (1 + 0.25 * V * q(11 + j)) * wj * bw;
      grow(sc, K, px - s * e * Math.sin(ph), py + s * e * Math.cos(ph), hh, Lj, s * K.away, k + 1, 1.3 * t + 2.9 * (j + 1) + (s * cs > 0 ? 0.7 : 0), cut);
    }
  }
}

// The motif: the main shoots from the root (the origin). The first heads K.turn from straight up towards the right
// and each further one K.spread further round, the last, fractional one growing in; the fan is kept softly short of
// straight down (a smooth minimum), so that a mirrored design never crosses its axis. A shoot curls outwards, away
// from the axis, by K.bend times the cosine of its heading (so a shoot heading down curls the other way round, and
// one heading sideways not at all), and by K.arch times its sine: up into an arch or down into a swag. A mirror image
// (x -> -x), K.mirror times the size, grows from the same root.
const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
function motif(K, cut) {
  const sc = new Scene();
  const N = K.shoots;
  for (let i = 0; i < Math.ceil(N); i++) {
    const w = clamp(N - i); if (w <= 0) continue;
    const a = smin(K.turn + K.spread * i, Math.PI - 0.12, 0.25);
    const c = clamp(-K.bend * Math.cos(a) + K.arch * Math.sin(a), -1, 1);
    grow(sc, K, 0, 0, Math.PI / 2 - a, w * (1 - 0.12 * i), c, 0, 3.7 * i + 1, cut, false, -1);
  }
  // on the axis of a mirrored design, an upright crown: a straight, symmetric shoot (c = 0) with its right-hand sprouts,
  // which the mirror completes
  const m = K.mirror, cw = K.crown * m * m;
  if (cw > 0) grow(sc, K, 0, 0, Math.PI / 2, 0.85 * cw, 0, 0, 0.5, cut, true);
  if (m > 0) {
    const S = sc.shapes.length, Ln = sc.lines.length;
    for (let i = 0; i < S; i++) { const s = sc.shapes[i]; sc.shapes.push({ poly: s.poly.map((v, j) => (j % 2 ? v : -v) * m), halo: s.halo * m, z: s.z - 0.5 }); }
    for (let i = 0; i < Ln; i++) { const l = sc.lines[i]; sc.lines.push({ pts: l.pts.map((v, j) => (j % 2 ? v : -v) * m), w: l.w * m, z: l.z - 0.5 }); }
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

// The settings a point gives (all continuous), for pages and tools that describe a design.
export function settingsAt({ x = 5, y = 5, z = 5, detail = 0.5, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}) {
  return settings(x, y, z, detail, plump, lobes, curl, variation);
}

// A runner: a stem along y = a P sin(pi x / P) from -xe to xe, through the roots of a frieze's repeats (a full repeat
// sits on a node, every P), winding into a curl of length ext past each end; its heading there follows the swing, so
// the curls turn smoothly as the runner grows.
function runner(sc, xe, Pp, amp, ext, w) {
  if (!(xe > 0)) return;
  const yA = x => amp * Pp * Math.sin(Math.PI * x / Pp), m = Math.max(8, Math.ceil(40 * xe / Pp));
  const r0 = 0.12, C = TAU * 1.1 / Math.log((1 + r0) / r0), hE = Math.atan(amp * Math.PI * Math.cos(Math.PI * xe / Pp));
  const R = curve(xe, yA(xe), hE, ext, u => -C * smooth(0.25, 0.6, u) / (1 - u + r0), 48);
  const pts = [];
  for (let i = R.n; i >= 1; i--) pts.push(-R.X[i], R.Y[i]);   // the left curl is the right one mirrored
  for (let i = 0; i <= 2 * m; i++) { const x = -xe + xe * i / m; pts.push(x, yA(x)); }
  for (let i = 1; i <= R.n; i++) pts.push(R.X[i], R.Y[i]);
  // as a band whose width tapers into both curls
  const c = { X: [], Y: [], H: [], n: pts.length / 2 - 1 };
  for (let i = 0; i <= c.n; i++) {
    c.X.push(pts[2 * i]); c.Y.push(pts[2 * i + 1]);
    const a = Math.max(0, i - 1), b = Math.min(c.n, i + 1);
    c.H.push(Math.atan2(pts[2 * b + 1] - pts[2 * a + 1], pts[2 * b] - pts[2 * a]));
  }
  for (let i = 1; i <= c.n; i++) c.H[i] -= TAU * Math.round((c.H[i] - c.H[i - 1]) / TAU);   // no jumps of 2 pi
  const k0 = R.n / c.n, k1 = 1 - k0, z = -1e12;
  const B = band(c, u => w * (0.35 + 0.65 * smooth(0, k0, u) * (1 - smooth(k1, 1, u))));
  sc.shape(B, PEN / 2 + Math.max(GAP, 0.9 * PEN), z); sc.line(B.concat(B.slice(0, 2)), Math.max(MIN, PEN), z);
}

// The whole design. Aspect is relative to the motif's own proportions, as in the Machine: at 1 the motif stands
// alone; wider, repeats of it bud out on both sides along a runner, K.gap times its width apart (a frieze); taller,
// smaller repeats bud out of its top, each 0.84 times the last (telescoping, as in a tall panel). A fractional repeat
// grows in, budding from its neighbour's edge. Repeats are drawn behind the ones before them.
export function build({ x = 5, y = 5, z = 5, detail = 0.5, aspect = 1, plump = 0.5, lobes = 0.5, curl = 0.5, variation = 0.4 } = {}, opt = {}) {
  MIN = opt.min || 0; GAP = opt.gap || 0; PEN = PEN0; VEIN = VEIN0;
  const K = settings(x, y, z, detail, plump, lobes, curl, variation), A = clamp(aspect, 0.2, 16);
  // the motif's own size, then how large the whole design will be: a design g times larger keeps its smallest shoots
  // g^0.6 times larger, and its pens g^0.4 times bolder, so that a long frieze or a tall tower is not lost in fuzz
  let M = motif(K, 0.03), b = sceneBox(M);
  const W0 = b.x1 - b.x0, H0 = b.y1 - b.y0, S0 = Math.max(W0, H0);
  const g = Math.max(1, A > 1 ? Math.max(A * W0, H0) / S0 : Math.max(W0, H0 / A) / S0);
  if (g > 1) { PEN = PEN0 * Math.pow(g, 0.4); VEIN = VEIN0 * Math.pow(g, 0.4); M = motif(K, 0.03 * Math.pow(g, 0.6)); b = sceneBox(M); }
  const reps = [];                                 // [x, y, scale] of each repeat after the first
  const sc = new Scene();
  if (A > 1) {
    const P = K.gap * W0, c = (A - 1) / K.gap / 2, amp = 0.07;   // c repeats on each side
    // a growing repeat buds from its neighbour's outer edge (b.x1 right of its root, -b.x0 left of it) and moves out
    // to its place while it grows, so the frieze widens at an even rate
    let d = 0, xe = 0;
    for (let i = 1; i < Math.ceil(c) + 1; i++) {
      const w0 = clamp(c - i + 1); if (w0 <= 0) break;
      const w = smooth(0, 1, w0);                 // eased, so a repeat starts and stops growing gently
      const xr = d + b.x1 + w * (P - b.x1), xl = -(d - b.x0 + w * (P + b.x0)), y = x => amp * P * Math.sin(Math.PI * x / P);
      reps.push([xr, y(xr), w], [xl, y(xl), w]);
      xe = d + (Math.max(xr, -xl) - d) * smooth(0, 0.3, w);   // the runner reaches out to the bud while it starts
      d += P * (w0 >= 1 ? 1 : 0);
    }
    runner(sc, xe, P, amp, 0.3 * Math.min(P, W0) * Math.min(1, 2 * c), 0.0045 * Math.pow(g, 0.4));
  } else if (A < 1) {
    // tiers 0.84 times the last, each overlapping the one below by a quarter; up to eight
    const r = 0.84, ov = 0.25, need = H0 * (1 / A - 1);
    // a growing tier buds from the top of the one below and rises to its place while it grows
    let Y = 0, sPrev = 1, got = 0;
    for (let i = 1; i <= 8 && got < need; i++) {
      const s = Math.pow(r, i), add = H0 * s * (1 - ov), w0 = clamp((need - got) / add), w = smooth(0, 1, w0);
      got += add;
      const Yi = Y + sPrev * b.y1 - s * w * b.y0 - ov * H0 * sPrev * w;
      reps.push([0, Yi, s * w]); Y = Yi; sPrev = s;
      if (w0 < 1) break;
    }
  }
  const put = (X, Y, s, dz) => {
    const sw = Math.sqrt(s);
    for (const t of M.shapes) sc.shapes.push({ poly: t.poly.map((v, j) => (j % 2 ? Y : X) + s * v), halo: t.halo * sw, z: t.z + dz });
    for (const l of M.lines) sc.lines.push({ pts: l.pts.map((v, j) => (j % 2 ? Y : X) + s * v), w: l.w * sw, z: l.z + dz });
  };
  put(0, 0, 1, 0);
  reps.forEach(([X, Y, s], i) => put(X, Y, s, -1e8 * (1 + (i >> (A > 1 ? 1 : 0)))));
  return hide(sc);
}

// One leaf on its own (a main shoot without sprouts), for close-ups of the leaf's form.
export function buildLeaf({ plump = 0.5, lobes = 0.5, curl = 0.5, stalk = 0.1, bend = 0.4 } = {}) {
  MIN = 0; GAP = 0; PEN = PEN0; VEIN = VEIN0;
  const K = settings(0, 0, 0, 0, plump, lobes, curl, 0);
  Object.assign(K, { stalk, bend, ess: 0, sway: 0, depth: 0 });
  const sc = new Scene();
  grow(sc, K, 0, 0, Math.PI / 2, 1, -1, 0, 1, 0.01);
  return hide(sc);
}

export function bbox(items) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const it of items) for (let i = 0; i < it.pts.length; i += 2) {
    const a = it.pts[i], b = it.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}
