// Kurbits Leaves: a second Kurbits engine of line-drawn leaves, after Dalecarlian kurbits painting (dalmålning, c.
// 1780-1850) and acanthus scrollwork: curling, lobed, feathered and serrated leaves on a winding stem that ends in
// spirals, with scrolls, buds and tendrils in its bends. Everything is a pen line; nothing is filled.
//
// Like the Kurbits Machine (index.html) a border is a point in a continuous space: x, y and z (0 to 20), detail,
// variation, size and mirror (0 to 1) and aspect (width over height) are all real numbers, every point draws a
// border, and a small step in any of them changes the border only a little. Nothing is picked from a list: where the
// drawing gains a leaf, a lobe, a vein, a tooth or a scroll, it grows from nothing or slides in from an end.
// No dependencies; used by the Leaves tab of index.html and by cli/leaves.mjs.
//
// Output: pen lines, in drawing order, engine units (about one unit per border height), y up:
//   {t: 'l', pts: [x0, y0, x1, y1, ...], w}   a line of width w with round ends and joins (closed if it ends
//                                              where it starts)
// Hidden lines are already removed: a line that passes behind a leaf, a scroll or the stem stops a small gap short
// of its outline, as in an engraving.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// three incommensurate sines: smooth, never repeating, in [-1, 1]
const Q = t => (Math.sin(t) + Math.sin(1.6180339887 * t + 1.3) + Math.sin(2.6180339887 * t + 2.1)) / 3;
const PEN = 0.0105, VEIN = 0.0062;                // the outline pen and the vein pen, in border heights
let MIN = 0;                                       // the narrowest line kept for small prints, from build()
let GAP = 0;                                       // the narrowest gap between lines for small prints

// ------------------------------------------------------------------ lines and what hides them
// A scene collects pen lines and silhouettes, each at a depth z (larger is nearer). At the end every line is cut where
// a nearer silhouette covers it.
class Scene {
  constructor() { this.shapes = []; this.lines = []; this.k = 0; }
  z(layer) { return layer * 1e6 + this.k++; }      // later shapes of a layer lie in front of earlier ones
  line(pts, w, z) { if (pts.length >= 4) this.lines.push({ pts, w, z }); }
  // a silhouette (a closed polygon, not repeated at its end); lines behind it stop `halo` short of its edge
  shape(poly, halo, z) { if (poly.length >= 6) this.shapes.push({ sil: offset(poly, halo), z }); }
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
// so it moves smoothly as the shapes move. A piece shorter than twice its width is drawn thinner, in proportion, so
// that it shrinks away instead of vanishing as a dot (below 0.04 of its width it is too small to see and is left out;
// for small prints, MIN > 0, a piece shorter than its width is left out).
function hide(sc) {
  const S = sc.shapes; S.forEach(prep);
  const out = [], len = r => { let l = 0; for (let i = 2; i < r.length; i += 2) l += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]); return l; };
  const keep = (r, w) => { const l = len(r); if (MIN ? l > w : l > 0.04 * w) out.push({ t: 'l', pts: r, w: MIN ? w : w * Math.min(1, l / (2 * w)) }); };
  for (const L of sc.lines) {
    const p = L.pts, n = p.length / 2; let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (let i = 0; i < n; i++) { const x = p[2 * i], y = p[2 * i + 1]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const C = S.filter(s => s.z > L.z && s.x0 <= bx1 && s.x1 >= bx0 && s.y0 <= by1 && s.y1 >= by0);
    const hid = (x, y) => { for (let c = 0; c < C.length; c++) if (inside(C[c], x, y)) return true; return false; };
    const f = new Array(n); let any = false;
    if (C.length) for (let i = 0; i < n; i++) { f[i] = hid(p[2 * i], p[2 * i + 1]); if (f[i]) any = true; }
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
// a point, heading, on a sampled curve at u (0..1), interpolated
function at(c, u) {
  const v = clamp(u, 0, 1) * c.n, i = Math.min(c.n - 1, Math.floor(v)), f = v - i;
  return [lerp(c.X[i], c.X[i + 1], f), lerp(c.Y[i], c.Y[i + 1], f), lerp(c.H[i], c.H[i + 1], f)];
}
// The outline of a band of half-width w(u) around a sampled curve: one closed pen line with round ends. Where the curve
// turns tighter than the band is wide, the inner side is narrowed, so the outline never loops.
function band(c, w) {
  const n = c.n, Lft = [], Rgt = [], hw = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n, i + 1), ds = Math.hypot(c.X[b] - c.X[a], c.Y[b] - c.Y[a]) || 1e-9;
    const k = (c.H[b] - c.H[a]) / ds, ww = w(i / n), lim = q => ww / Math.pow(1 + Math.pow(Math.max(0, q * ww) / 0.8, 4), 0.25);
    const nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]), wl = lim(k), wr = lim(-k);
    Lft.push(c.X[i] + nx * wl, c.Y[i] + ny * wl); Rgt.push(c.X[i] - nx * wr, c.Y[i] - ny * wr); hw.push((wl + wr) / 2);
  }
  const cap = (i, dir) => {                        // a half circle round the end i, from the left side to the right
    const q = [], x = c.X[i], y = c.Y[i], h = c.H[i] + (dir < 0 ? Math.PI : 0), r = hw[i];
    for (let j = 1; j < 8; j++) { const a = h + Math.PI / 2 - Math.PI * j / 8; q.push(x + r * Math.cos(a), y + r * Math.sin(a)); }
    return q;
  };
  const P = Lft.slice();
  P.push(...cap(n, 1));
  for (let i = Rgt.length - 2; i >= 0; i -= 2) P.push(Rgt[i], Rgt[i + 1]);
  P.push(...cap(0, -1));
  return P;
}

// ------------------------------------------------------------------ the leaf
// The lobes and teeth of a leaf's edge are one profile: a bump from 0 (a notch) to 1 (a tip) with period 1 in its
// phase f, bent by a skew a (tips that lean towards the leaf's tip) and an exponent p (below 1: round scallops between
// sharp notches; above 1: pointed lobes between round bays).
const bump = (f, a, p) => Math.pow(Math.max(0, 0.5 - 0.5 * Math.cos(TAU * f - a * (1 - Math.cos(TAU * f)))), p);
// where a skewed bump peaks: the phase f with 2 pi f - a (1 - cos 2 pi f) = pi
function peak(a) { let f = 0.5; for (let i = 0; i < 10; i++) f -= (TAU * f - a * (1 - Math.cos(TAU * f)) - Math.PI) / (TAU - a * TAU * Math.sin(TAU * f)); return f; }

// One leaf, growing from (x0, y0) at heading h0, of length L, with form F (see settings()) and chirality c (-1 to 1:
// the leaf bends and curls clockwise or anticlockwise; at 0 it is straight and symmetric). The spine bends and curls
// at its tip like a logarithmic spiral; the edge on each side is the width envelope times the lobes times the teeth;
// the lobes may sweep forwards like feathers. Drawn as an outline, a midrib and veins out to the lobes.
function leaf(sc, x0, y0, h0, L, F, c, layer) {
  if (!(L > 0.004)) return;
  const n = Math.min(360, 70 + Math.round(10 * F.N + 7 * F.N * F.M * smooth(0, 0.03, F.S)));   // more samples for teeth
  // the spine's curvature: a bend spread along it, and a tip curl whose radius shrinks with the length left (r0 keeps
  // it finite), turning F.curl times round; a small leaf curls less and more openly, so its tip never closes into a dot
  const r0 = 0.07 + 0.006 / L, tc = 0.4, Cc = TAU * F.curl * Math.sqrt(smooth(0.03, 0.3, L)) / Math.log((1 - tc + r0) / r0);
  const sp = curve(x0, y0, h0, L, u => c * (F.bend + Cc * smooth(tc, tc + 0.25, u) / (1 - u + r0)), n);
  const K = sp.H.map((h, i) => (sp.H[Math.min(n, i + 1)] - sp.H[Math.max(0, i - 1)]) / ((Math.min(n, i + 1) - Math.max(0, i - 1)) / n * L));
  // the envelope: zero at both ends, widest at tPeak, round (p2 < 1) or pointed (p2 > 1) at the tip, with a short stalk
  const ts = F.tPeak, p2 = F.p2, p1 = p2 * ts / (1 - ts), W0 = L * F.b;
  const env = u => (u <= 0 || u >= 1) ? 0 : Math.sqrt(smooth(0, 0.1, u)) * Math.pow(u / ts, p1) * Math.pow((1 - u) / (1 - ts), p2);
  // the lobes' phase runs from the base to the tip, quickening towards the tip so that the lobes there are shorter
  const fpk = peak(F.a), tpk = peak(0.4), tb = 0.06, gam = 1.35, N = F.N, ph = u => N * (1 - Math.pow(1 - clamp((u - tb) / (1 - tb), 0, 1), gam));
  const phInv = f => tb + (1 - tb) * (1 - Math.pow(1 - clamp(f / N, 0, 1), 1 / gam));
  const g = Math.sqrt(Math.min(1, L / 0.3)), pw = Math.max(MIN, PEN * g), vw = Math.max(MIN, VEIN * g);
  const gapH = Math.max(GAP, 0.8 * PEN), gapV = Math.max(GAP, 0.75 * PEN * g), sep = vw + gapV;
  // each side: s = +1 the left, -1 the right. The outer side (away from the curl) carries the full lobes and teeth,
  // the inner side `inner` of them and `innerW` of the width; a straight leaf (c = 0) is the same on both sides
  const side = s => {
    const o = s > 0 ? (1 - c) / 2 : (1 + c) / 2, D = F.D * lerp(F.inner, 1, o), S = F.S * lerp(F.inner, 1, o), k = W0 * lerp(F.innerW, 1, o);
    const w = [], wn = [], ex = [], E = [], roll = smooth(0.15, 0.6, F.curl);
    for (let i = 0; i <= n; i++) {
      const u = i / n, e = env(u), f = ph(u), lim = Math.pow(1 + Math.pow(Math.max(0, s * K[i] * k * e) / 0.8, 4), 0.25);
      const fade = 1 - roll * smooth(0.6, 0.95, u), Du = D * fade, b = bump(f, F.a, F.p);   // a rolled tip is smooth
      const ww = k * e * (1 - Du * (1 - b)) * (1 - S * fade * Math.sqrt(b) * (1 - bump((f - fpk) * F.M + tpk, 0.4, 0.5))) / lim;
      const base = k * e / lim, x = Math.max(0, ww - base * (1 - Du)) * F.sw;   // lobe tips sweep forwards
      w.push(ww); wn.push(base); ex.push(x);
      const h = sp.H[i], cx = Math.cos(h), sx = Math.sin(h);
      E.push(sp.X[i] - s * ww * sx + x * cx, sp.Y[i] + s * ww * cx + x * sx);
    }
    return { s, o, w, wn, ex, E };
  };
  const Lf = side(1), Rt = side(-1);
  const poly = Lf.E.slice(), U = [];
  for (let i = n - 1; i >= 1; i--) poly.push(Rt.E[2 * i], Rt.E[2 * i + 1]);
  for (let i = 0; i <= n; i++) U.push(i / n); for (let i = n - 1; i >= 0; i--) U.push(i / n);
  // the leaf hides what lies behind it (a small leaf less round itself), and its tip, from 0.72 of the way along, is a
  // nearer shape of its own, so that a tip rolled back over the leaf hides the lines beneath it
  const z = sc.z(layer), zt = sc.z(layer), halo = (pw / 2 + gapH + PEN / 2) * Math.min(1, L / 0.12), it = Math.round(0.72 * n);
  sc.shape(poly, halo, z);
  const tip = Lf.E.slice(2 * it); for (let i = n - 1; i >= it; i--) tip.push(Rt.E[2 * i], Rt.E[2 * i + 1]);
  sc.shape(tip, Math.min(halo, 0.05 * L), zt);
  // a line along the leaf goes to the leaf (z) where u < 0.62 and to the tip (zt) beyond
  const put = (P, U, w, closed) => {
    const runs = []; let cur = [P[0], P[1]], tipSide = U[0] > 0.62;
    for (let i = 1; i < U.length; i++) {
      if ((U[i] > 0.62) !== tipSide) {
        const f = (0.62 - U[i - 1]) / (U[i] - U[i - 1]), x = lerp(P[2 * i - 2], P[2 * i], f), y = lerp(P[2 * i - 1], P[2 * i + 1], f);
        cur.push(x, y); runs.push([cur, tipSide]); cur = [x, y]; tipSide = !tipSide;
      }
      cur.push(P[2 * i], P[2 * i + 1]);
    }
    runs.push([cur, tipSide]);
    if (closed && runs.length > 1 && runs[0][1] === runs[runs.length - 1][1]) { const a = runs.pop(); runs[0][0] = a[0].concat(runs[0][0].slice(2)); }
    for (const [r, t] of runs) sc.line(r, w, t ? zt : z);
  };
  put(poly.concat(poly.slice(0, 2)), U, pw, true);
  // the midrib, from the stalk to where the leaf (without its lobes) grows too narrow to hold it
  const room = i => Math.min(Lf.wn[i], Rt.wn[i]) - pw / 2 - gapV - vw / 2;
  let top = -1, best = -1e9;
  for (let i = 0; i <= n; i++) best = Math.max(best, room(i));
  for (let i = n - 1; i >= 0 && top < 0; i--) if (room(i) >= 0) top = (i + clamp(room(i) / (room(i) - room(i + 1)), 0, 1)) / n;
  if (top > 0) {
    const te = top * smooth(0, 0.5 * PEN, best), M = [], MU = [];
    for (let i = 0; i / n < te; i++) { M.push(sp.X[i], sp.Y[i]); MU.push(i / n); }
    const e = at(sp, te); M.push(e[0], e[1]); MU.push(te);
    if (M.length >= 4) put(M, MU, vw, false);
  }
  // veins: on each side, one to each lobe's tip, ending inside it. Pinnate veins leave the midrib at the notch before
  // their lobe; striate ones (painted kurbits strokes) start near the base and run beside the midrib before turning
  // out, the outermost first. A vein begins only where it is a line and a gap clear of its neighbour and of the edge,
  // so the fan opens out of the midrib; F.veins grows every vein back along its path from its lobe.
  const q = lerp(1.15, 2.6, F.striate);
  for (const Sd of [Lf, Rt]) {
    const reach = F.veins * lerp(F.veinsIn, 1, Sd.o);
    if (reach <= 0) continue;
    const ival = (A, t) => { const v = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(v)); return lerp(A[i], A[i + 1], v - i); };
    const roomS = t => ival(Sd.w, t) - pw / 2 - gapV - vw / 2;
    const paths = [];
    for (let j = 0; (j + fpk) < N; j++) {
      const tj = phInv(j + fpk), t0 = lerp(phInv(j), 0.04, F.striate), wj = ival(Sd.w, tj);
      const oe = Math.min(0.8 * wj, roomS(tj));
      paths.push(oe > 0 && tj > t0 + 1e-3 ? { t0, tj, oe, sw: ival(Sd.ex, tj) / Math.max(1e-9, wj) } : null);
    }
    const off = (P, t) => !P || t <= P.t0 ? 0 : P.oe * Math.pow(Math.min(1, (t - P.t0) / (P.tj - P.t0)), q);
    for (let j = 0; j < paths.length; j++) {
      const P = paths[j]; if (!P) continue;
      const nxt = paths[j + 1], te = P.tj, ta = lerp(P.tj, P.t0, reach);
      const margin = t => { const o = off(P, t); return Math.min(roomS(t) - o, o - off(nxt, t) - sep); };
      if (margin(te) < 0) continue;
      let t1 = ta, mPrev = margin(te), tPrev = te;
      for (let i = Math.ceil(te * n) - 1; i >= 0; i--) {   // back from the end to where the vein stops being clear
        const t = Math.max(ta, i / n), m = margin(t);
        if (m < 0) { t1 = t + (tPrev - t) * clamp(-m / (mPrev - m), 0, 1); break; }
        if (t <= ta) { t1 = ta; break; }
        mPrev = m; tPrev = t;
      }
      if (te - t1 < 1e-4) continue;
      const V = [], VU = [], pt = t => {
        const [x, y, h] = at(sp, t), o = off(P, t), sh = o * P.sw;
        V.push(x - Sd.s * o * Math.sin(h) + sh * Math.cos(h), y + Sd.s * o * Math.cos(h) + sh * Math.sin(h)); VU.push(t);
      };
      pt(t1); for (let i = Math.floor(t1 * n) + 1; i < te * n; i++) pt(i / n); pt(te);
      put(V, VU, vw, false);
    }
  }
}

// A closed bud: a pointed, symmetric leaf (c = 0) between two small sepals that curl away from it.
const BUD = { b: 0.42, tPeak: 0.42, p2: 1.5, N: 1, D: 0, p: 0.5, a: 0.2, sw: 0, S: 0, M: 2, inner: 1, innerW: 1, striate: 1, bend: 0, curl: 0, veins: 0, veinsIn: 0 };
const SEPAL = { ...BUD, b: 0.3, tPeak: 0.5, p2: 1.1, bend: 0.4, curl: 0.25 };
function bud(sc, x, y, h, L, layer) {
  for (const sd of [-1, 1]) leaf(sc, x, y, h + sd * 0.6, 0.55 * L, SEPAL, -sd, layer);
  leaf(sc, x, y, h, L, BUD, 0, layer);
}

// ------------------------------------------------------------------ settings
// Every setting is a smooth function of the point. x, y and z do not appear in the drawing itself: each setting is
// read off a slow wave through the space (or, for the leaf's edge, mostly off x), so that moving through the space
// mixes them in ever-new combinations.
function settings(x, y, z, d, V, size, mirror) {
  const W = (a, b, c, e) => 0.5 + 0.5 * Math.sin(a * x + b * y + c * z + e);   // a slow wave, 0 to 1
  // x: the leaf's edge, from smooth through scalloped, lobed and feathered to divided into leaflets
  const edge = clamp(x / 20 + 0.07 * Math.sin(0.29 * z + 0.21 * y + 1.3), 0, 1);
  const curl = W(0.03, 0.13, 0.2, -2.3);          // calm to curling: leaf tips, scrolls and the stem's spirals
  const scale = 0.8 + 0.6 * size;                  // leaves and bends together: fine and busy, or large
  const lam = (0.66 - 0.22 * W(0.04, 0.15, 0.05, -1.4)) * scale;   // the stem's half-wavelength
  const F = {                                      // the leaf form (leaf())
    b: 0.11 + 0.37 * W(0.04, 0.02, 0.24, -1.75),   // width over length: slender to broad
    tPeak: 0.32 + 0.34 * W(0.19, 0.08, 0.06, 0.6), // where it is widest: near the base (ovate) or the tip (a plume)
    p2: 0.6 + 0.85 * W(0.1, 0.17, 0.13, 2.2),     // a round or a pointed tip
    N: 2.6 + 1.6 * smooth(0.2, 0.7, edge) + 2.4 * smooth(0.82, 1, edge) + 1.6 * W(0.07, 0.19, 0.13, -0.7),   // lobes along each edge
    D: 0.3 * smooth(0.04, 0.32, edge) + 0.36 * smooth(0.42, 0.68, edge) + 0.3 * smooth(0.8, 1, edge),   // their depth
    p: 0.42 + 0.12 * smooth(0.85, 1, edge),         // round-topped lobes between sharp notches
    a: 0.15 + 0.35 * smooth(0.35, 0.85, edge),     // lobes that lean towards the tip (below 1)
    sw: 0.4 * smooth(0.5, 0.92, edge),             // and sweep forwards like feathers
    S: 0.12 * smooth(0.5, 0.8, edge) * (1 - 0.5 * smooth(0.9, 1, edge)) * (0.35 + 0.65 * smooth(0.3, 0.9, d)),   // teeth
    M: 1.7 + 1.5 * W(0.17, 0.05, 0.11, 0.9),       // teeth per lobe
    inner: smooth(0.42, 0.88, edge),               // lobes on the inner edge too (acanthus) or only the outer (kurbits)
    innerW: 0.55 + 0.35 * smooth(0.3, 0.9, edge),  // the inner half's width
    striate: 1 - smooth(0.35, 0.7, edge),          // painted strokes from the base, or pinnate veins
    bend: -0.45 + 1.4 * W(0.13, 0.05, 0.17, 1.9),  // the spine's bend (radians): below 0, an S with the tip curl
    curl: 0.05 + 0.85 * Math.pow(curl, 1.3),       // turns of the tip curl
    veins: smooth(0.05, 0.45, d),                  // how far the veins grow
    veinsIn: lerp(0.15, 1, smooth(0.35, 0.8, edge)) * smooth(0.25, 0.7, d),   // veins on the inner side
  };
  return {
    edge, curl, size, variation: V, mirror, scale, lam, F,
    // the stem
    wind: 0.3 + 0.95 * W(0.05, 0.16, 0.04, -1.9), // the meander's swing (radians)
    arch: 0.4 * Math.sin(0.29 * y + 0.11 * x + 0.5),   // ends that hang (< 0), lie level or rise (> 0)
    turns: -0.6 + 2.9 * (0.55 * curl + 0.45 * W(0.13, 0.07, 0.1, 2.5)),   // the end spiral (< 0 curls upwards)
    stemW: 0.0125 * (0.85 + 0.4 * size),           // the stem's half-width at the centre
    // the leaves on it
    place: -0.3 + 0.5 * W(0.23, 0.11, 0.07, -0.2), // where a leaf sits by its bend, in half-waves
    len: lam * (0.95 + 0.5 * W(0.09, 0.14, 0.2, 1.2)),
    lean: 0.45 + 0.6 * W(0.12, 0.2, 0.09, 2.8),    // the angle between a leaf and the stem
    pair: 0.7 * W(0.11, 0.18, 0.05, 3.0) * smooth(0.2, 0.55, d),   // a second leaf opposite
    shoots: (0.35 + 0.65 * curl) * W(0.15, 0.1, 0.12, -0.4) * smooth(0.25, 0.5, d),   // scrolls in the bends
    shootLeaf: smooth(0.5, 0.85, d),
    tendrils: W(0.09, 0.2, 0.17, 1.1) * smooth(0.55, 0.95, d),
    crown: (0.6 + 0.4 * W(0.08, 0.13, 0.19, 0.3)) * smooth(0.3, 1, mirror),   // the leaves rising from the centre
    crownN: 0.5 + 2 * W(0.17, 0.09, 0.21, -1.1),
    seed: 0.29 * x + 0.53 * y + 0.41 * z,          // where along Q the variations are read (moves smoothly)
  };
}

// The leaf form F moved by variation: the k-th leaf's j-th variation is q(k, j), -1 to 1.
function vary(F, V, q, k) {
  return { ...F, b: F.b * (1 + 0.3 * V * q(k, 2)), curl: Math.max(0, F.curl * (1 + 0.8 * V * q(k, 3))), bend: F.bend + 0.5 * V * q(k, 4),
    N: Math.max(1.5, F.N + 1.4 * V * q(k, 5)), D: Math.min(0.97, F.D * (1 + 0.3 * V * q(k, 7))), tPeak: clamp(F.tPeak + 0.08 * V * q(k, 11), 0.25, 0.72) };
}

// ------------------------------------------------------------------ the stem
// One half of the stem, from the centre outwards: a curve described by its heading, which swings to and fro (a
// meander whose depth and rhythm drift with variation) about a line that hangs or rises, calms towards the end and
// winds into a logarithmic spiral. mix: 0 the right half's variations, 1 others of its own.
function halfStem(K, A, mix) {
  const V = K.variation, lam = K.lam, Lsp = 0.42 * K.scale, a = K.wind;
  // a winding stem advances only about J0(a) of its length (the mean of cos(a sin)), so it is lengthened to fill
  // the border
  const J0 = 1 - a * a / 4 + a ** 4 / 64 - a ** 6 / 2304, Ls = Math.max(0.8, (A / 2 - 0.1) / J0 + 0.3 * Lsp);
  const n = Math.round(240 * Math.max(1, Ls / 2.2)), ds = Ls / n;
  const q = (u, k) => lerp(Q(u + K.seed + k), Q(u + K.seed + k + 23.1), mix);
  const ph = s => Math.PI * s / lam + 0.7 * V * (q(0.8 * s / lam, 0) - q(0, 0));
  const head = s => K.arch * Math.min(1, 2.2 / Ls) * s / Ls + a * (1 + 0.3 * V * q(0.6 * s / lam, 4.1)) * Math.sin(ph(s)) * smooth(0.5 * Lsp, 1.4 * Lsp, Ls - s);
  // the spiral's eye (radius r0 / |C|) is kept at least 1.6 pens wide
  let r0 = 0.03 * K.scale, C = 0;
  for (let i = 0; i < 3; i++) { C = TAU * K.turns / Math.log((Lsp + r0) / r0); r0 = Math.max(0.03 * K.scale, 1.6 * PEN * Math.abs(C)); }
  const kap = s => -C * smooth(Lsp, 0.55 * Lsp, Ls - s) / (Ls - s + r0);
  const X = [0], Y = [0], H = [0], P = [0]; let x = 0, y = 0, e = 0; const d4 = ds / 4;   // four sub-steps per sample
  for (let i = 0; i < 4 * n; i++) {
    const s0 = i * d4, s1 = s0 + d4, e1 = e + 0.5 * (kap(s0) + kap(s1)) * d4, hm = 0.5 * (head(s0) + e + head(s1) + e1);
    x += Math.cos(hm) * d4; y += Math.sin(hm) * d4; e = e1;
    if (i % 4 === 3) { X.push(x); Y.push(y); H.push(head(s1) + e1); P.push(ph(s1)); }
  }
  return { X, Y, H, P, n, L: Ls, Ls, Lsp };
}

// The leaves, scrolls and tendrils on one half of the stem, from the centre outwards. flow 0: the leaves point
// outwards (a mirrored half); flow 1: they point back to the centre with their curls reversed, which the mirror
// turns into the left half of a running garland. In between each leaf turns smoothly through the upright, where it
// is straight and symmetric.
function half(sc, K, st, flow, mix) {
  const V = K.variation, lam = K.lam, Ls = st.Ls;
  const q = (k, j) => lerp(Q(1.618 * k + 2.39 * j + K.seed), Q(1.618 * k + 2.39 * j + K.seed + 41.3), mix);
  // leaves grow from nothing at the centre (more slowly beside a crown) and near the end spiral
  const grow = s => smooth(0, lerp(0.08, 0.45, K.crown) * lam, s) * smooth(0.45 * st.Lsp, 1.2 * st.Lsp, Ls - s);
  const sAt = target => {                          // the arc length where the meander's phase reaches target
    if (target < 0 || target > st.P[st.n]) return -1;
    let lo = 0, hi = st.n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (st.P[m] <= target) lo = m; else hi = m; }
    return (lo + (target - st.P[lo]) / (st.P[hi] - st.P[lo])) * st.L / st.n;
  };
  const turn = (sg, al) => sg * al + flow * sg * (Math.PI - 2 * al), chi = Math.cos(Math.PI * flow);
  for (let k = 0; ; k++) {
    const s = sAt((k + K.place) * Math.PI); if (s < 0) { if ((k + K.place) * Math.PI > st.P[st.n]) break; continue; }
    const gr = grow(s) * (k === 0 ? 1 - flow : 1), sg = k % 2 ? 1 : -1;   // sides alternate, outside each bend
    if (gr <= 0) continue;
    const [x, y, h] = at(st, s / Ls), rhythm = 1 + 0.3 * V * Math.sin(TAU * s / (3.7 * lam) + K.seed);
    const len = K.len * gr * rhythm * (1 + 0.4 * V * q(k, 1)) * (1 - 0.2 * s / Ls), F = vary(K.F, V, q, k);
    const al = clamp(K.lean * (1 + 0.35 * V * q(k, 6)), 0.2, 1.45);
    // a scroll in the bay inside the bend, behind the stem: a curve that curls into a spiral (or ends in a bud),
    // leaves on its outside
    const sh = sAt((k + K.place + 0.12) * Math.PI), Lh = sh < 0 ? 0 : K.shoots * lam * 1.35 * grow(sh) * (1 + 0.35 * V * q(k, 9));
    if (Lh > 0.01) {
      // its spiral's eye (radius Lh r0 / C) is kept at least 1.6 pens wide, so it never fills in
      const [hx, hy, hh] = at(st, sh / Ls), T = 0.7 + 1.3 * K.curl; let r0 = 0.1, C = 0;
      for (let i = 0; i < 3; i++) { C = TAU * T / Math.log((0.6 + r0) / r0); r0 = Math.max(0.1, 1.6 * PEN * C / Lh); }
      const c = curve(hx, hy, hh - sg * (0.75 + 0.25 * q(k, 12)), Lh, u => -sg * (0.5 + C * smooth(0.4, 0.6, u) / (1 - u + r0)), 90);
      const zc = sc.z(1), wh = K.stemW * 0.7 * Math.sqrt(Math.min(1, Lh / lam)), P = band(c, u => wh * (1 - 0.7 * u));
      sc.shape(P, (PEN + Math.max(GAP, 0.8 * PEN)) * Math.min(1, Lh / 0.12), zc);   // a young scroll is drawn finer
      sc.line(P.concat(P.slice(0, 2)), Math.max(MIN, PEN * Math.sqrt(Math.min(1, Lh / 0.3))), zc);
      for (const [u, f, wt] of [[0.22, 0.55, 1], [0.48, 0.4, K.shootLeaf]]) {
        const [lx, ly, lh] = at(c, u);
        leaf(sc, lx, ly, lh + sg * 0.75, Lh * f * wt, vary(K.F, V, q, k + 0.5 + u), -sg, 1);
      }
      // a scroll that hardly curls ends in a bud, which shrinks away as the curl tightens
      const Lb = Lh * 0.3 * (1 - smooth(1, 1.6, T));
      if (Lb > 0.004) { const [bx, by, bh] = at(c, 1); bud(sc, bx, by, bh, Lb, 1); }
    }
    // a tendril behind the leaf, on the outside of the bend, curling back
    const st2 = sAt((k + K.place - 0.1) * Math.PI), Lt = st2 < 0 ? 0 : K.tendrils * lam * 0.6 * grow(st2) * (1 + 0.4 * V * q(k, 10));
    if (Lt > 0.01) {
      const [tx, ty, th] = at(st, st2 / Ls), r0 = 0.2, C = TAU * 1.3 / Math.log((0.65 + r0) / r0);
      const c = curve(tx, ty, th + sg * (Math.PI - 1.0 - 0.2 * q(k, 13)), Lt, u => -sg * (0.6 + C * smooth(0.35, 0.55, u) / (1 - u + r0)), 70), T = [];
      for (let i = 0; i <= c.n; i++) T.push(c.X[i], c.Y[i]);
      sc.line(T, Math.max(MIN, 1.15 * VEIN * Math.sqrt(Math.min(1, Lt / 0.2))), sc.z(1));
    }
    // a second, smaller leaf opposite, then the leaf itself
    const Lp = K.pair * len * (0.7 + 0.2 * q(k, 8)), ap = Math.min(1.5, al + 0.5);
    leaf(sc, x, y, h + turn(-sg, ap), Lp, vary(K.F, V, q, k + 0.31), sg * chi, 3);
    leaf(sc, x, y, h + turn(sg, al), len, F, -sg * chi, 3);
  }
  // where the stem ends with little or no spiral, a last leaf continues it
  const tw = (1 - smooth(0.2, 0.85, Math.abs(K.turns))) * grow(Ls - 1.2 * st.Lsp);
  if (tw > 0) { const [x, y, h] = at(st, 1); leaf(sc, x, y, h, K.len * 0.85 * tw, vary(K.F, V, q, 99), -Math.tanh(2 * K.turns), 3); }
}

// The settings a point gives (the shape numbers, all continuous), for pages and tools that describe a design.
export function settingsAt({ x = 5, y = 5, z = 5, detail = 0.5, variation = 0.5, size = 0.4, mirror = 1 } = {}) {
  return settings(x, y, z, detail, variation, size, mirror);
}

// mirror: 1 mirrored about the centre, 0 a running garland whose leaves all point one way, and every blend between.
export function build({ x = 5, y = 5, z = 5, detail = 0.5, aspect = 6, variation = 0.5, size = 0.4, mirror = 1 } = {}, opt = {}) {
  MIN = opt.min || 0; GAP = opt.gap || 0;
  const K = settings(x, y, z, detail, variation, size, mirror), sc = new Scene(), flow = 1 - clamp(mirror, 0, 1);
  const right = halfStem(K, aspect, 0), left = halfStem(K, aspect, flow);
  // the stem: one band from the left end through the centre to the right end (the left half mirrored)
  const X = [], Y = [], H = [];
  for (let i = left.n; i >= 1; i--) { X.push(-left.X[i]); Y.push(left.Y[i]); H.push(-left.H[i]); }
  for (let i = 0; i <= right.n; i++) { X.push(right.X[i]); Y.push(right.Y[i]); H.push(right.H[i]); }
  const stem = { X, Y, H, n: X.length - 1 };
  const sw = u => K.stemW * (1 - 0.6 * Math.abs(2 * u - 1)) * (1 + 0.2 * (1 - Math.abs(2 * u - 1)));
  const P = band(stem, sw), zs = sc.z(2);
  sc.shape(P, PEN + Math.max(GAP, 0.8 * PEN), zs); sc.line(P.concat(P.slice(0, 2)), Math.max(MIN, PEN), zs);
  // the left half, drawn in its own frame and mirrored, then the right half
  const s0 = sc.shapes.length, l0 = sc.lines.length;
  half(sc, K, left, flow, flow);
  for (const sh of sc.shapes.slice(s0)) for (let i = 0; i < sh.sil.length; i += 2) sh.sil[i] = -sh.sil[i];
  for (const ln of sc.lines.slice(l0)) for (let i = 0; i < ln.pts.length; i += 2) ln.pts[i] = -ln.pts[i];
  half(sc, K, right, 0, 0);
  // the crown: an upright leaf between pairs that lean out and curl outwards, rising from the centre
  if (K.crown > 0) {
    const L0 = K.lam * 1.2 * K.crown;
    for (let j = 2; j >= 1; j--) {
      const wt = smooth(j - 1, j, K.crownN), off = 0.75 + 0.45 * (j - 1);
      for (const sd of [-1, 1]) leaf(sc, 0, 0, Math.PI / 2 - sd * off, L0 * (1 - 0.16 * j) * wt, K.F, -sd, 4);
    }
    leaf(sc, 0, 0, Math.PI / 2, L0, K.F, 0, 4);
  }
  return hide(sc);
}

export function bbox(items) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const it of items) for (let i = 0; i < it.pts.length; i += 2) {
    const a = it.pts[i], b = it.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}
