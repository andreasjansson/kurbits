// Kurbits Leaves: a second, leafier Kurbits engine, after Dalecarlian kurbits painting (dalmålning, c. 1780-1850):
// broad curling plume leaves with painted striations and lobed edges, rosettes built from rings of petals, tulips,
// the kurbits gourd itself, and stems with tendrils and berries, composed as a mirrored border.
//
// Like the Kurbits Machine (index.html), it is deterministic: the same x, y, z (0 to 20), detail (0 to 1) and
// aspect always give the same ornament, every number moves the design smoothly, and nothing is drawn by hand.
// No dependencies; used by the Leaves tab of index.html and by cli/leaves.mjs.
//
// Output: items in the Kurbits Machine's format, painted in order, engine units, y up:
//   {t: 'p', pts: [x0, y0, x1, y1, ...], h}   a filled polygon that first clears a halo of width h around itself
//   {t: 'x', pts: [...]}                       a cut: erases what was painted before it (painted striations, petal
//                                              lines), the dark lines of a painted leaf
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// three incommensurate sines: smooth, never repeating, in [-1, 1]
let MIN = 0;                                       // the smallest cut or dot kept (engine units), from build()
let GAP = 0;                                       // the smallest gap between overlapping shapes (engine units)
let LINE = true;                                   // line art (outlines and engraved lines) or filled shapes, from build()
const Q = t => (Math.sin(t) + Math.sin(1.6180339887 * t + 1.3) + Math.sin(2.6180339887 * t + 2.1)) / 3;

// ------------------------------------------------------------------ curves
// A curve from (x0, y0) at heading th0, length L, by integrating curvature k(s) (radians per unit length, s = 0..1).
function curve(x0, y0, th0, L, k, n = 140) {
  const X = [x0], Y = [y0], H = [th0]; let x = x0, y = y0, th = th0; const ds = L / n;
  for (let i = 0; i < n; i++) {
    const kk = 0.5 * (k(i / n) + k((i + 1) / n)), tm = th + 0.5 * kk * ds;
    x += Math.cos(tm) * ds; y += Math.sin(tm) * ds; th += kk * ds;
    X.push(x); Y.push(y); H.push(th);
  }
  return { X, Y, H, n };
}
// A curve whose heading is given directly, th(s) (s = 0..1), plus an extra curvature k(s) that is accumulated:
// a winding stem that keeps its general direction and ends in a spiral.
function curveH(x0, y0, L, th, k, n = 200) {
  const X = [x0], Y = [y0], H = [th(0)]; let x = x0, y = y0, e = 0; const ds = L / n;
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n, e1 = e + 0.5 * (k(s0) + k(s1)) * ds;
    const tm = 0.5 * (th(s0) + e + th(s1) + e1);
    x += Math.cos(tm) * ds; y += Math.sin(tm) * ds; e = e1;
    X.push(x); Y.push(y); H.push(th(s1) + e);
  }
  return { X, Y, H, n };
}
// curvature that winds into a spiral over the last part of a curve: `turns` is roughly the extra turns
const curl = (s, start, turns, L) => turns * TAU * smooth(start, 1, s) / ((1.06 - s) * 3.4 * L);

// A filled ribbon around a curve, with widths wl(t) on the left and wr(t) on the right (t = 0..1).
function ribbon(c, wl, wr, t0 = 0, t1 = 1) {
  const L = [], R = [], i0 = Math.round(t0 * c.n), i1 = Math.round(t1 * c.n);
  for (let i = i0; i <= i1; i++) {
    const t = i / c.n, nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]);
    const a = wl(t), b = wr(t);
    L.push(c.X[i] + nx * a, c.Y[i] + ny * a); R.push(c.X[i] - nx * b, c.Y[i] - ny * b);
  }
  const pts = L.slice();
  for (let i = R.length - 2; i >= 0; i -= 2) pts.push(R[i], R[i + 1]);
  return pts;
}
// A tapered line along a curve offset by off(t) to the left: one painted stroke (a cut inside a leaf). The width is
// measured across the stroke's own path, so a stroke that follows a wavy edge keeps its width.
function stroke(c, off, w, t0, t1) {
  // tapered like a brush stroke, but never thinner than MIN, so a small print keeps every line whole
  const span = t1 - t0, wt = t => Math.max(w * Math.pow(Math.max(0, Math.sin(Math.PI * (t - t0) / span)), 0.55), MIN);
  const i0 = Math.ceil(t0 * c.n), i1 = Math.floor(t1 * c.n), P = [];
  for (let i = i0; i <= i1; i++) {
    const t = i / c.n, nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]), o = off(t);
    P.push([c.X[i] + nx * o, c.Y[i] + ny * o, t]);
  }
  const L = [], R = [];
  for (let j = 0; j < P.length; j++) {
    const a = P[Math.max(0, j - 1)], b = P[Math.min(P.length - 1, j + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const h = wt(P[j][2]) / 2;
    L.push(P[j][0] - ty * h, P[j][1] + tx * h); R.push(P[j][0] + ty * h, P[j][1] - tx * h);
  }
  const pts = L.slice();
  for (let i = R.length - 2; i >= 0; i -= 2) pts.push(R[i], R[i + 1]);
  return pts;
}
// A pen stroke of width wf(i) at vertex i along an open polyline P, with round ends. A closed outline is a polyline that
// ends where it starts; its two round ends meet.
function pen(P, wf) {
  const n = P.length / 2, L = [], R = [];
  let t0 = null, t1 = null;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = P[2 * b] - P[2 * a], ty = P[2 * b + 1] - P[2 * a + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const h = wf(i) / 2;
    L.push(P[2 * i] - ty * h, P[2 * i + 1] + tx * h); R.push(P[2 * i] + ty * h, P[2 * i + 1] - tx * h);
    if (i === 0) t0 = [tx, ty, h]; if (i === n - 1) t1 = [tx, ty, h];
  }
  const cap = (x, y, nx, ny, dx, dy, h) => {       // a half circle from the normal (nx, ny) round the direction (dx, dy)
    const q = []; for (let k = 1; k < 8; k++) { const th = Math.PI * k / 8; q.push(x + h * (Math.cos(th) * nx + Math.sin(th) * dx), y + h * (Math.cos(th) * ny + Math.sin(th) * dy)); }
    return q;
  };
  const pts = L.slice();
  pts.push(...cap(P[2 * n - 2], P[2 * n - 1], -t1[1], t1[0], t1[0], t1[1], t1[2]));
  for (let i = R.length - 2; i >= 0; i -= 2) pts.push(R[i], R[i + 1]);
  pts.push(...cap(P[0], P[1], t0[1], -t0[0], -t0[0], -t0[1], t0[2]));
  return pts;
}

// A shape in line art: its silhouette erases what lies behind it (with a halo), then a pen line of width w (or wf(i))
// is drawn round its edge.
function outlined(out, sil, w, halo, wf, closed = true) {
  out.push({ t: 'p', pts: sil, h: Math.max(halo, 2 * GAP) + w });
  out.push({ t: 'x', pts: sil.slice() });     // its own copy: mirroring and scaling change point arrays in place
  out.push({ t: 'p', pts: pen(closed ? sil.concat(sil.slice(0, 2)) : sil, wf || (() => w)), h: 0 });
}

// A small circle: a ring in line art when there is room for its hole, otherwise a dot.
function ringOrDot(out, cx, cy, r, halo) {
  const sil = circle(cx, cy, r, 28), w = Math.max(0.28 * r, MIN);
  if (LINE && r - w / 2 >= Math.max(MIN / 2, 0.3 * r)) outlined(out, sil, w, halo);
  else out.push({ t: 'p', pts: sil, h: halo });
}

function circle(cx, cy, r, n = 40) {
  const p = []; for (let i = 0; i < n; i++) { const a = TAU * i / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return p;
}
function polar(cx, cy, rf, n = 160, rot = 0) {
  const p = []; for (let i = 0; i < n; i++) { const a = TAU * i / n; const r = rf(a); p.push(cx + r * Math.cos(a + rot), cy + r * Math.sin(a + rot)); } return p;
}

// ------------------------------------------------------------------ motifs
// A kurbits leaf: a plume growing from (x, y) at heading th, bending and then curling at the tip towards `turn`
// (+1 anticlockwise, -1 clockwise). The convex (outer) edge carries rounded lobes; parallel painted strokes follow
// the leaf's curve, as on a painted leaf.
function leaf(out, x, y, th, len, wid, turn, o) {
  const bend = o.bend ?? 0.55, tip = o.tipTurns ?? 0.55, lobes = o.lobes ?? 4, depth = o.lobeDepth ?? 0.22;
  const c = curve(x, y, th, len, s => turn * (bend * TAU / 4 / len + curl(s, 0.5, tip, len)), 120);
  const W = t => wid * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.62))), 0.8) * (1 - 0.5 * t * t);
  const lobe = t => {
    if (t < 0.16 || t > 0.94) return 1;
    const u = (t - 0.16) / 0.78 * lobes, f = u - Math.floor(u);
    return 1 - depth + depth * Math.pow(Math.sin(Math.PI * Math.pow(f, 1.45)), 0.55);
  };
  // the curl turns towards the left normal when turn = +1, so the outer (lobed) edge is on the right
  const outerRight = turn > 0, wOut = t => W(t) * lobe(t), wIn = t => 0.5 * W(t);
  out.push({ t: 'p', pts: ribbon(c, outerRight ? wIn : wOut, outerRight ? wOut : wIn), h: o.halo });
  const sgn = outerRight ? -1 : 1, cw = Math.max((o.cut ?? 0.07) * wid, MIN);
  if (LINE) {
    // line art: the silhouette erases what lies behind it, a calligraphic outline (heavier on the outer, lobed edge)
    // runs from the base round the tip and back, then a midrib on the spine and engraved lines inside the lobe
    // notches, each kept a gap from its neighbours and from the outline
    out.pop();
    const pO = Math.max(0.06 * wid, MIN), pI = Math.max(0.04 * wid, MIN), Lp = [], Rp = [];
    for (let i = 0; i <= c.n; i++) {
      const t = i / c.n, nx = -Math.sin(c.H[i]), ny = Math.cos(c.H[i]);
      const a = outerRight ? wIn(t) : wOut(t), b = outerRight ? wOut(t) : wIn(t);
      Lp.push(c.X[i] + nx * a, c.Y[i] + ny * a); Rp.push(c.X[i] - nx * b, c.Y[i] - ny * b);
    }
    const sil = Lp.slice(); for (let i = Rp.length - 2; i >= 0; i -= 2) sil.push(Rp[i], Rp[i + 1]);
    const wL = outerRight ? pI : pO, wR = outerRight ? pO : pI;
    outlined(out, sil, pO, o.halo, i => lerp(wL, wR, smooth(c.n - 5, c.n + 6, i)), false);
    // veins: a midrib along the spine and, from the base, a fan of curved lines out towards the outer edge, each ending
    // just inside the crest of a lobe, as kurbits leaves are painted; a line starts only where its neighbours are far
    // enough away, so near the base the fan opens out of the midrib instead of merging into it
    const lw = MIN || 0.04 * wid, gap = MIN || 0.035 * wid, ts = 0.05, sep = lw + gap;
    const room = t => wOut(t) - pO / 2 - gap - lw / 2;           // the furthest a line's centre may be from the spine
    const nV = Math.max(0, Math.min(o.strokes ?? 4, lobes || 2));
    const ends = [];
    for (let k = 0; k < nV; k++)
      ends.push(lobes ? 0.16 + (Math.min(lobes - 1, Math.floor((k + 0.5) * lobes / nV)) + 0.62) / lobes * 0.78 : 0.55 + 0.32 * (k + 1) / (nV + 1));
    const offs = ends.map(te => {
      const E = Math.max(0, room(te));
      return t => Math.min(E * Math.pow(clamp((t - ts) / (te - ts), 0, 1), 2.4), Math.max(0, room(t)));
    });
    for (let k = 0; k < nV; k++) {
      const te = ends[k], inner = k + 1 < nV ? offs[k + 1] : () => 0;
      const ok = t => offs[k](t) - inner(t) >= sep && (k === 0 || t > ends[k - 1] || offs[k - 1](t) - offs[k](t) >= sep) && room(t) >= offs[k](t) - 1e-9;
      let t0 = te - 0.005;
      while (t0 > ts && ok(t0 - 0.005)) t0 -= 0.005;
      if (te - t0 < 0.08 || !ok(te - 0.01)) continue;
      out.push({ t: 'p', pts: stroke(c, t => sgn * offs[k](t), lw, t0, te), h: 0 });
    }
    let r1 = 0.86;                                // the midrib, while the inner half leaves room beside it
    while (r1 > 0.1 && wIn(r1) - pI / 2 < lw / 2 + gap) r1 -= 0.005;
    if (r1 - ts > 0.12) out.push({ t: 'p', pts: stroke(c, () => 0, lw, ts, r1), h: 0 });
    return c;
  }
  if (!MIN) {                                     // on screen: strokes fan out to the lobed edge, as painted
    const m = o.strokes ?? 4;
    for (let k = 1; k <= m; k++) {
      const f = k / (m + 0.6), t0 = 0.1 + 0.035 * k, t1 = 0.95 - 0.07 * k;
      out.push({ t: 'x', pts: stroke(c, t => sgn * f * W(t) * (1 - 0.25 * (1 - lobe(t))), cw * (1 - 0.12 * k), t0, t1) });
    }
    out.push({ t: 'x', pts: stroke(c, t => -sgn * 0.18 * W(t), cw * 0.7, 0.12, 0.78) });       // the midrib, inside
    return c;
  }
  // in print (MIN > 0): smooth parallel strokes inside the lobe notches, stopping where the fill between them would be
  // narrower than 0.8 MIN, so no line merges with its neighbour and no sliver is left too thin to print
  const lmin = 1 - (lobes ? depth : 0), m = Math.max(0, Math.min(o.strokes ?? 4, Math.floor(0.33 * wid * lmin / MIN - 1)));
  for (let k = 1; k <= m; k++) {
    const f = k / (m + 1), need = (m + 1) * 1.8 * MIN / lmin;
    let t0 = 0.1 + 0.035 * k, t1 = 0.95 - 0.07 * k;
    while (t1 > t0 && W(t1) < need) t1 -= 0.005;
    while (t0 < t1 && W(t0) < need) t0 += 0.005;
    if (t1 - t0 < 0.12) continue;
    out.push({ t: 'x', pts: stroke(c, t => sgn * f * W(t) * lmin, cw, t0, t1) });    // smooth, parallel, inside the scallops
  }
  let r0 = 0.12, r1 = 0.78;                       // the midrib, where the inner half leaves room on both sides
  while (r1 > r0 && W(r1) < 4.4 * MIN) r1 -= 0.005;
  while (r0 < r1 && W(r0) < 4.4 * MIN) r0 += 0.005;
  if (r1 - r0 > 0.12 && m > 0) out.push({ t: 'x', pts: stroke(c, t => -sgn * 0.18 * W(t), cw, r0, r1) });
  return c;
}

// A rosette: rings of petals as on a painted dalmålning flower, R the outer radius.
function rosette(out, cx, cy, R, n, rot, o) {
  const petal = a => Math.pow(Math.abs(Math.cos(n * a / 2)), 0.55);
  if (LINE) {                                     // line art: the petal outline, lines between the petals, a ring of seeds
    const w = Math.max(0.06 * R, MIN), lw = MIN || 0.045 * R, gap = MIN || 0.04 * R;
    outlined(out, polar(cx, cy, a => R * (0.8 + 0.2 * petal(a)), 240, rot), w, o.halo);
    const free = 0.8 * R - w / 2 - gap;           // free radius inside the outline at the notches
    const rc = Math.max(0.12 * R, MIN / 2);
    if (free < rc + gap + lw) return;
    const big = !MIN || R >= 12 * MIN, ri = 0.5 * R;
    if (big || R >= 7 * MIN) for (let i = 0; i < n; i++) {        // a line between each pair of petals
      const a = rot + TAU * (i + 0.5) / n, ca = Math.cos(a), sa = Math.sin(a), c = { X: [], Y: [], H: [], n: 12 };
      const r0 = big ? ri : 0.42 * R;
      for (let j = 0; j <= 12; j++) { const r = lerp(r0, 0.8 * R, j / 12); c.X.push(cx + r * ca); c.Y.push(cy + r * sa); c.H.push(a); }
      out.push({ t: 'p', pts: ribbon(c, () => lw / 2, () => lw / 2), h: 0 });
    }
    if (big) {
      out.push({ t: 'p', pts: pen(circle(cx, cy, ri, 60).concat([cx + ri, cy]), () => lw), h: 0 });
      const n2 = Math.max(5, Math.round(n * 0.75)), rs = Math.max(0.06 * R, MIN / 2);
      if (2 * rs + gap <= TAU * 0.3 * R / n2 && 0.3 * R - rs - gap >= rc && ri - lw / 2 - gap >= 0.3 * R + rs)
        for (let i = 0; i < n2; i++) { const a = rot + TAU * (i + 0.5) / n2; out.push({ t: 'p', pts: circle(cx + 0.3 * R * Math.cos(a), cy + 0.3 * R * Math.sin(a), rs, 16), h: 0 }); }
    }
    out.push({ t: 'p', pts: circle(cx, cy, rc, 24), h: 0 });
    return;
  }
  out.push({ t: 'p', pts: polar(cx, cy, a => R * (0.8 + 0.2 * petal(a)), 240, rot), h: o.halo });
  if (MIN && R < 8 * MIN) { out.push({ t: 'x', pts: circle(cx, cy, Math.max(0.28 * R, MIN), 24) }); return; }   // small: an eye
  if (MIN && R < 14 * MIN) {                                       // medium: petal strokes round an eye
    for (let i = 0; i < n; i++) {
      const a = rot + TAU * i / n, ca = Math.cos(a), sa = Math.sin(a), c = { X: [], Y: [], H: [], n: 20 };
      for (let j = 0; j <= 20; j++) { const r = lerp(0.5 * R, 0.84 * R, j / 20); c.X.push(cx + r * ca); c.Y.push(cy + r * sa); c.H.push(a); }
      out.push({ t: 'x', pts: stroke(c, () => 0, MIN, 0, 1) });
    }
    out.push({ t: 'p', pts: circle(cx, cy, 0.5 * R, 30), h: 0 });
    out.push({ t: 'x', pts: circle(cx, cy, Math.max(0.24 * R, MIN), 24) });
    return;
  }
  const ring = (r, w) => {
    const p = polar(cx, cy, () => r + w / 2, 120), q = polar(cx, cy, () => r - w / 2, 120);
    out.push({ t: 'x', pts: p }); out.push({ t: 'p', pts: q, h: 0 });
  };
  for (let i = 0; i < n; i++) {                                   // a painted stroke down the middle of each petal
    const a = rot + TAU * i / n, ca = Math.cos(a), sa = Math.sin(a), r0 = 0.6 * R, r1 = 0.86 * R, w = Math.max(0.06 * R, MIN);
    const c = { X: [], Y: [], H: [], n: 20 };
    for (let j = 0; j <= 20; j++) { const r = lerp(r0, r1, j / 20); c.X.push(cx + r * ca); c.Y.push(cy + r * sa); c.H.push(a); }
    out.push({ t: 'x', pts: stroke(c, () => 0, w, 0, 1) });
  }
  ring(0.52 * R, Math.max(0.06 * R, MIN));
  const n2 = Math.max(5, Math.round(n * 0.75)), rs = Math.max(0.075 * R, MIN / 2);   // an inner ring of seeds
  if (2 * rs < 0.8 * TAU * 0.34 * R / n2) for (let i = 0; i < n2; i++) {
    const a = rot + TAU * (i + 0.5) / n2;
    out.push({ t: 'x', pts: circle(cx + 0.34 * R * Math.cos(a), cy + 0.34 * R * Math.sin(a), rs, 18) });
  }
  out.push({ t: 'x', pts: circle(cx, cy, Math.max(0.17 * R, 0.1 * R + MIN), 30) });
  if (0.1 * R >= MIN) out.push({ t: 'p', pts: circle(cx, cy, 0.1 * R, 24), h: 0 });
}

// The kurbits itself: a gourd of stacked rounded segments with a small crown of leaves, standing on its stem.
function gourd(out, cx, cy, w, h, o) {
  const body = [], n = 120;
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n, s = Math.sin(a), cs = Math.cos(a);
    const yy = cy + h / 2 * s, wide = s < 0 ? 1 : 1 - 0.35 * s * s;           // fuller below, narrowing to the top
    body.push(cx + w / 2 * Math.sign(cs) * Math.pow(Math.abs(cs), 0.8) * wide, yy);
  }
  const lineW = Math.max(0.05 * w, MIN);
  if (LINE) outlined(out, body, lineW, o.halo); else out.push({ t: 'p', pts: body, h: o.halo });
  const segs = o.segs ?? 4;
  for (let k = 1; k <= segs; k++) {                               // the segment lines, bowed like rings round the fruit
    const f = k / (segs + 1), yy = cy - h / 2 + h * f, s = (yy - cy) / (h / 2);
    const half = w / 2 * Math.sqrt(Math.max(0, 1 - s * s)) * (s < 0 ? 1 : 1 - 0.35 * s * s) * (LINE ? 1 : 0.86);   // line art: ring lines meet the outline
    const c = { X: [], Y: [], H: [], n: 30 };
    for (let j = 0; j <= 30; j++) { const u = j / 30 * 2 - 1; c.X.push(cx + u * half); c.Y.push(yy - 0.08 * h * (1 - u * u)); c.H.push(Math.atan2(0.16 * h * u, half)); }
    if (LINE) out.push({ t: 'p', pts: ribbon(c, () => (MIN || 0.04 * w) / 2, () => (MIN || 0.04 * w) / 2), h: 0 });
    else out.push({ t: 'x', pts: stroke(c, () => 0, Math.max(0.055 * w, MIN), 0, 1) });
  }
  for (const side of [-1, 0, 1]) {                                // the crown
    const th = Math.PI / 2 - side * 0.7, L = h * (side ? 0.32 : 0.4);
    leaf(out, cx + side * 0.08 * w, cy + h / 2 * 0.92, th, L, L * 0.38, side >= 0 ? 1 : -1, { halo: o.halo * 0.6, strokes: 1, lobes: 0, bend: 0.3, tipTurns: 0.25 });
  }
}

// A tulip: a pointed middle petal between two curling side petals, on a small cup.
function tulip(out, cx, cy, size, th, o) {
  for (const side of [-1, 1])
    leaf(out, cx, cy, th - side * 0.55, size * 0.95, size * 0.42, side, { halo: o.halo, strokes: 2, lobes: 0, bend: -0.35, tipTurns: 0.45 });
  leaf(out, cx, cy, th, size * 1.05, size * 0.5, 1, { halo: o.halo, strokes: 2, lobes: 0, bend: 0.05, tipTurns: 0.05 });
  ringOrDot(out, cx, cy, size * 0.17, o.halo);
}

// A tendril: a thin curling stem ending in a berry.
function tendril(out, x, y, th, len, turn, o) {
  const c = curve(x, y, th, len, s => turn * (0.6 * TAU / 4 / len + curl(s, 0.35, 0.9, len)), 80);
  const w = o.w;
  out.push({ t: 'p', pts: ribbon(c, t => Math.max(w * (1 - 0.65 * t), MIN / 2), t => Math.max(w * (1 - 0.65 * t), MIN / 2)), h: o.halo });
  if (o.berry) out.push({ t: 'p', pts: circle(c.X[c.n], c.Y[c.n], o.berry, 22), h: o.halo });
}

// ------------------------------------------------------------------ the composition
// An urn with its rim at (cx, cy) and height h: foot, stem, a full body with painted bands, shoulder, neck and lip.
function urn(out, cx, cy, h, o) {
  const V = [[0, 0.3], [0.06, 0.3], [0.13, 0.11], [0.2, 0.16], [0.42, 0.44], [0.62, 0.38], [0.74, 0.24], [0.84, 0.17], [0.9, 0.3], [1, 0.32]];
  const half = v => {                                              // piecewise-smooth half-width (fraction of h)
    let i = 0; while (i < V.length - 2 && V[i + 1][0] < v) i++;
    const [v0, r0] = V[i], [v1, r1] = V[i + 1], t = smooth(0, 1, (v - v0) / (v1 - v0));
    return lerp(r0, r1, t);
  };
  const R = [], Lf = [], n = 90, y0 = cy - h;
  for (let i = 0; i <= n; i++) { const v = i / n; R.push(cx + half(v) * h, y0 + v * h); }
  for (let i = n; i >= 0; i--) { const v = i / n; Lf.push(cx - half(v) * h, y0 + v * h); }
  if (LINE) outlined(out, R.concat(Lf), Math.max(0.035 * h, MIN), o.halo); else out.push({ t: 'p', pts: R.concat(Lf), h: o.halo });
  for (const v of [0.34, 0.5, 0.86]) {                            // painted bands round the body and below the lip
    const hw = half(v) * h * (LINE ? 1 : 0.82), c = { X: [], Y: [], H: [], n: 30 };
    for (let j = 0; j <= 30; j++) { const u = j / 30 * 2 - 1; c.X.push(cx + u * hw); c.Y.push(y0 + v * h + 0.06 * h * (1 - u * u)); c.H.push(Math.atan2(-0.12 * h * u, hw)); }
    if (LINE) out.push({ t: 'p', pts: ribbon(c, () => (MIN || 0.03 * h) / 2, () => (MIN || 0.03 * h) / 2), h: 0 });
    else out.push({ t: 'x', pts: stroke(c, () => 0, Math.max(0.035 * h, MIN), 0.04, 0.96) });
  }
}

// A fan of three tulips rising from one point, with two leaves curling down from its base.
function fan(out, cx, cy, size, o) {
  for (const sd of [-1, 1]) leaf(out, cx, cy, -Math.PI / 2 + sd * 1.0, size * 0.85, size * 0.3, -sd, { halo: o.halo, strokes: 3, lobes: 3, lobeDepth: 0.22, bend: 0.6, tipTurns: 0.7 });
  for (const sd of [-1, 1]) tulip(out, cx + sd * 0.1 * size, cy + 0.05 * size, size * 0.62, Math.PI / 2 + sd * 0.72, o);
  tulip(out, cx, cy + 0.08 * size, size * 0.78, Math.PI / 2, o);
}

// A bunch of grapes hanging from (x, y) in direction th: rows of 3, 2 and 1 berries on a short stalk.
function grapes(out, x, y, th, r, o) {
  const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
  const st = { X: [], Y: [], H: [], n: 10 };
  for (let j = 0; j <= 10; j++) { st.X.push(x + dx * r * 1.2 * j / 10); st.Y.push(y + dy * r * 1.2 * j / 10); st.H.push(th); }
  out.push({ t: 'p', pts: ribbon(st, () => Math.max(0.2 * r, MIN / 2), () => Math.max(0.2 * r, MIN / 2)), h: o.halo });
  [[3, 1.3], [2, 2.85], [1, 4.4]].forEach(([n, d]) => {
    for (let i = 0; i < n; i++) {
      const l = (i - (n - 1) / 2) * 1.85 * r;
      ringOrDot(out, x + dx * d * r + nx * l, y + dy * d * r + ny * l, r, o.halo);
    }
  });
}

// A closed bud: a pointed leaf with two small sepals.
function bud(out, x, y, th, size, o) {
  for (const sd of [-1, 1]) leaf(out, x, y, th + sd * 0.7, size * 0.55, size * 0.22, sd, { halo: o.halo, strokes: 1, lobes: 0, bend: 0.2, tipTurns: 0.3 });
  leaf(out, x, y, th, size, size * 0.42, 1, { halo: o.halo, strokes: 2, lobes: 0, bend: 0.05, tipTurns: 0.06 });
}

// Settings from the point (x, y, z, detail): every number is a smooth function of the inputs, except the choices of
// motif, which change at fixed places.
function settings(x, y, z, d, variation = 0.7, size = 0.3) {
  const u = v => 0.5 + 0.5 * v, narrow = u(Q(0.23 * z + 0.41 * x + 1.9));
  const endQ = Q(0.43 * x + 1.7);
  return {
    // the stem's meander: a gentle garland (0.45) to a deep scroll (1.05), calmer with big leaves so they fill the band
    wave: (0.45 + 0.6 * u(Math.sin(0.29 * x + 1.1))) * (1 - 0.35 * size),
    waves: (1.4 + 0.7 * u(Q(0.2 * y + 1.3))) / (1 + 0.6 * size),   // half-waves per unit of width
    arch: 0.42 * Math.sin(0.33 * y + 0.4),           // the garland hangs (< 0) or rises like a crest (> 0)
    rise: 0.15 * Q(0.27 * y + 2.1),
    tip: 1.2 + 0.7 * u(Q(0.23 * x + 0.19 * y)),     // turns of the stem's final spiral
    leafLen: (0.7 + 0.15 * Q(0.29 * y + 0.4)) * (1 + 0.25 * narrow),   // narrow leaves are also longer
    leafWide: 0.42 - 0.16 * narrow,                  // broad plume leaves to long feathered ones
    lobes: 4 + 2 * u(Q(0.41 * y + 0.3 * z)) + 3 * narrow,
    leafBend: 0.5 + 0.25 * Q(0.33 * z + 0.2),
    leafTip: 0.7 + 0.3 * Q(0.21 * x + 0.5 * z),
    lobeDepth: 0.22 + 0.12 * u(Q(0.17 * x + 2.7)),
    strokes: 4 + 2 * d,
    density: 0.8 + 0.6 * d,                          // leaves per unit of width on each side
    motif: ['rosette', 'gourd', 'tulip', 'urn', 'fan'][Math.min(4, Math.floor(z / 4))],
    petals: Math.round(9 + 4 * u(Q(0.5 * z + 0.3))),
    small: Q(0.37 * z + 2.3) > 0 ? 'rosette' : 'grapes',   // small rosettes or bunches of grapes along the stems
    end: endQ > 0.15 ? 'tulip' : endQ < -0.2 ? 'rosette' : 'bud',
    flowers: d > 0.3,
    tendrils: d > 0.45,
    variation,                                      // how much each leaf, flower and bend differs from its neighbours
    size,                                           // leaf size: 0 a fine, busy garland; 1 fewer, larger leaves that read from afar
    seed: 0.37 * x + 0.71 * y + 0.53 * z,          // where along Q the variations are read (moves smoothly with the point)
  };
}

// One half of the border (or, running, the whole of it): the stem from x0 rightwards with its leaves, flowers, tendrils
// and end motif. opt.x0 sets where the stem starts (default: leaving room for a centrepiece); opt.join starts it level,
// so two mirrored halves meet in one smooth line; opt.level removes the arch and the starting tilt (a running stem);
// opt.skipStem leaves the stem for the caller to draw. Returns the stem's curve, width and halo.
function side(out, K, A, mirror, opt = {}) {
  const big = 1 + 0.9 * K.size, cs = 1 + 0.6 * K.size;   // leaf size, and the centrepiece's (which the stems leave room for)
  // (opt.reach: a winding stem advances only about J0(amplitude) of its length, so it is lengthened to cover the width;
  // the centred form keeps its original length, so its designs are unchanged)
  const amp0 = K.wave * 1.5, J00 = 1 - amp0 ** 2 / 4 + amp0 ** 4 / 64 - amp0 ** 6 / 2304;
  const half = A / 2, x0 = opt.x0 ?? 0.3 * cs, L = (half - x0) * 1.08 / (opt.reach ? Math.max(0.4, J00) : 1), w0 = (LINE ? 0.017 : 0.04) * (1 + 0.3 * K.size), halo = 0.026;
  const nw = K.waves * (half - x0);                  // half-waves along this side
  // the heading swings about the horizontal (or a rising or falling line), so the stem winds along the band and ends
  // in a spiral
  // (the arch and the starting tilt lift or drop the ends by at most about half the border's height, whatever its length)
  const arch = (opt.level ? 0 : K.arch) * Math.min(1, 2.2 / L), rise = (opt.level || opt.join ? 0 : K.rise) * Math.min(1, 2.2 / L);
  // the meander calms over the last 0.6 units and the stem winds into a spiral over its last Ls units: both fixed in
  // size, so a long border ends like a short one
  const Ls = 0.46, rem = s => (1 - s) * L;
  // with variation, the meander's depth and rhythm drift along the stem, so no two bends are alike
  const V = K.variation, vq = (i, k) => Q(1.618 * i + 2.39 * k + K.seed);   // the i-th leaf's k-th variation, -1 to 1
  const ph0 = opt.join ? V * 0.8 * Q(K.seed) : 0;  // joined halves start level: the meander starts at its zero
  const phase = s => Math.PI * nw * s + V * 0.8 * Q(0.9 * nw * s + K.seed) - ph0;
  const ampAt = s => K.wave * 1.5 * (1 + 0.3 * V * Q(0.7 * nw * s + K.seed + 4.1));
  const th = s => rise * (1 - s) + arch * s + ampAt(s) * Math.sin(phase(s)) * smooth(0.3, 0.6, rem(s));
  const spiral = s => -K.tip * TAU * smooth(0, 1, 1 - rem(s) / Ls) / ((rem(s) + 0.375 * Ls) * 3.4);
  const c = curveH(x0, -0.02, L, th, spiral, Math.round(260 * Math.max(1, half / 3)));
  if (!opt.skipStem) out.push({ t: 'p', pts: ribbon(c, t => Math.max(w0 * (1 - 0.55 * t), MIN / 2), t => Math.max(w0 * (1 - 0.55 * t), MIN / 2)), h: halo });
  // leaves sit where the stem bends most, alternating sides, a little smaller towards the end
  // spaced by how far the stem advances, not by its length: a deeply winding stem gets as many leaves per width
  // as a gentle one (the mean of cos(A sin) is the Bessel function J0(A))
  const amp = K.wave * 1.5, J0 = 1 - amp ** 2 / 4 + amp ** 4 / 64 - amp ** 6 / 2304;
  // a deeply winding stem (a rinceau) carries one leaf at every bend, on alternate sides, so no loop is left bare
  const sMax = 0.94 - 0.7 / L, bends = K.wave > 0.75 * (1 - 0.35 * K.size);   // (the size-calmed meander keeps its scrolls)
  let S = [];
  if (bends) {                                    // the bends: where the phase passes a multiple of pi
    let k0 = Math.floor(phase(0) / Math.PI);
    for (let q = 1; q <= 4000; q++) {
      const sq = q / 4000 * sMax, k = Math.floor(phase(sq) / Math.PI);
      if (k !== k0) { S.push(sq); k0 = k; }
    }
    if (S.length < 2) S = [0.3 * sMax, 0.7 * sMax];
  } else {
    const n = Math.max(2, Math.round(K.density * (half - x0) * 2 * J0 / (1 + 1.1 * K.size)));
    for (let i = 0; i < n; i++) S.push(clamp(0.06 + (sMax - 0.06) * (i + 0.35 + 0.3 * V * vq(i, 0)) / n, 0.04, sMax));
  }
  if (opt.join) S.unshift(0.2 / L);              // joined halves: a leaf rising from beside the joint (mirrored: a pair)
  const n = S.length;
  for (let i = 0; i < n; i++) {
    const s = S[i], j = Math.round(s * c.n);
    const up = opt.join && i === 0 ? 1 : Math.cos(phase(s)) >= 0 ? -1 : 1;  // the outside of the bend
    // each leaf differs: length (with a slow swell of big and small leaves along the stem), width, bend, curl,
    // lobes, angle
    const rhythm = 1 + 0.32 * V * Math.sin(TAU * 2.2 * s + K.seed);
    const len = big * K.leafLen * (1 - 0.3 * s) * rhythm * (1 + 0.45 * V * vq(i, 1)), wid = len * K.leafWide * (1 + 0.35 * V * vq(i, 2));
    const roll = V > 0.5 && vq(i, 16) > 0.62;     // now and then an acanthus leaf that rolls its tip into a spiral
    const th = c.H[j] + up * (0.85 - 0.35 * K.size + 0.2 * Q(i * 1.7 + K.wave * 9) + 0.5 * V * vq(i, 7));   // big leaves lie flatter
    leaf(out, c.X[j], c.Y[j], th, len, wid, -up, { halo, strokes: Math.round(K.strokes), lobes: Math.max(2, Math.round(K.lobes + 2.2 * V * vq(i, 5))),
      lobeDepth: K.lobeDepth * (1 + 0.35 * V * vq(i, 6)), bend: K.leafBend * (1 + 0.8 * V * vq(i, 3)) * (roll ? 1.3 : 1),
      tipTurns: Math.max(0.15, K.leafTip * (1 + 0.9 * V * vq(i, 4))) * (roll ? 1.9 : 1) });
    if (V > 0.3 && vq(i, 8) > 0.62 - 0.3 * V) {   // now and then a smaller second leaf on the other side
      const l2 = len * (0.5 + 0.12 * vq(i, 9));
      leaf(out, c.X[j], c.Y[j], c.H[j] - up * (0.95 + 0.3 * V * vq(i, 10)), l2, l2 * K.leafWide, up,
        { halo, strokes: Math.max(1, Math.round(K.strokes) - 2), lobes: Math.max(2, Math.round(K.lobes) - 1), lobeDepth: K.lobeDepth, bend: K.leafBend, tipTurns: K.leafTip * (1 + 0.5 * V * vq(i, 11)) });
    }
    const next = i < n - 1 ? S[i + 1] : sMax, j2 = Math.round(Math.min(sMax, (s + next) / 2) * c.n), u2 = -up;
    if (K.flowers && i % 2 === 1 && i < n - 1) {  // a small flower or a bunch of grapes inside the next bend
      const nx = -Math.sin(c.H[j2]) * u2, ny = Math.cos(c.H[j2]) * u2;
      const swap = V > 0.5 && vq(i, 12) > 0.55, kind = swap ? (K.small === 'rosette' ? 'grapes' : 'rosette') : K.small;
      if (kind === 'rosette') {
        const r = 0.12 * (1 + 0.5 * K.size) * (1 + 0.25 * V * vq(i, 13));
        rosette(out, c.X[j2] + nx * (r + 0.05), c.Y[j2] + ny * (r + 0.05), r, Math.round(8 + 2 * V * vq(i, 14)), 0.2 * i, { halo });
      } else grapes(out, c.X[j2], c.Y[j2], Math.atan2(ny, nx), 0.034 * (1 + 0.5 * K.size) * (1 + 0.2 * V * vq(i, 13)), { halo: halo * 0.7 });
    } else if (K.tendrils && i < n - 1) {
      tendril(out, c.X[j2], c.Y[j2], c.H[j2] + up * 1.0, 0.26 * (1 + 0.5 * K.size) * (1 + 0.4 * V * vq(i, 15)), -up, { w: 0.01 * (1 + 0.3 * K.size), berry: 0.034 * (1 + 0.4 * K.size), halo: 0.016 });
    }
  }
  const je = Math.round((1 - 0.42 / L) * c.n), te = c.H[je] + 1.4;   // the end motif, where the stem begins to spiral
  if (K.end === 'tulip') tulip(out, c.X[je], c.Y[je], 0.22 * cs, te, { halo });
  else if (K.end === 'bud') bud(out, c.X[je], c.Y[je], te, 0.24 * cs, { halo });
  else rosette(out, c.X[je] - Math.sin(c.H[je]) * 0.16 * cs, c.Y[je] + Math.cos(c.H[je]) * 0.16 * cs, 0.13 * cs, 9, 0, { halo });
  out.push({ t: 'p', pts: circle(c.X[c.n], c.Y[c.n], 0.035, 24), h: halo });
  if (mirror) for (const it of out.slice(mirror)) for (let i = 0; i < it.pts.length; i += 2) it.pts[i] = -it.pts[i];
  return { c, w0, halo };
}

// The settings a point gives (the motifs chosen and the shape numbers), for pages and tools that describe a design.
export function settingsAt({ x = 5, y = 5, z = 5, detail = 0.5, variation = 0.7, size = 0.3 } = {}) { return settings(x, y, z, detail, variation, size); }

// form: 'centred' (a centrepiece between two mirrored garlands), 'mirrored' (two mirrored garlands joined in the middle,
// no centrepiece) or 'running' (one garland from end to end, no mirror).
export function build({ x = 5, y = 5, z = 5, detail = 0.5, aspect = 6, variation = 0.7, size = 0.3, style = 'line', form = 'centred' } = {}, opt = {}) {
  MIN = opt.min || 0; GAP = opt.gap || 0; LINE = style !== 'fill';
  const K = settings(x, y, z, detail, variation, size), out = [], halo = 0.03;
  if (form === 'running') {                       // one stem across the whole width, its start beyond the left end
    side(out, K, 2 * aspect, 0, { x0: 0, level: true, reach: true });
    for (const it of out) for (let i = 0; i < it.pts.length; i += 2) it.pts[i] -= aspect / 2;
    return finish(out);
  }
  if (form === 'mirrored') {                      // two halves meeting level in the middle, on one stem drawn first
    const r = side(out, K, aspect, 0, { x0: 0, join: true, skipStem: true, reach: true });
    const m = out.length; side(out, K, aspect, m, { x0: 0, join: true, skipStem: true, reach: true });
    const c = r.c, X = [], Y = [], H = [];
    for (let i = c.n; i >= 1; i--) { X.push(-c.X[i]); Y.push(c.Y[i]); H.push(-c.H[i]); }   // the mirrored half, reversed
    for (let i = 0; i <= c.n; i++) { X.push(c.X[i]); Y.push(c.Y[i]); H.push(c.H[i]); }
    const w = t => Math.max(r.w0 * (1 - 0.55 * Math.abs(2 * t - 1)), MIN / 2);
    out.unshift({ t: 'p', pts: ribbon({ X, Y, H, n: X.length - 1 }, w, w), h: r.halo });
    return finish(out);
  }
  side(out, K, aspect, 0);
  const m = out.length; side(out, K, aspect, m);
  const c0 = out.length, cs = 1 + 0.6 * K.size;          // the centrepiece, drawn at unit size and then scaled with the leaves
  if (K.motif === 'urn') {                                         // an urn with a bouquet: tulip, leaves, two flowers
    urn(out, 0, -0.02, 0.6, { halo });
    for (const sd of [-1, 1]) leaf(out, 0, 0.0, Math.PI / 2 + sd * 0.95, 0.5, 0.2, sd, { halo, strokes: 4, lobes: 3, lobeDepth: 0.24, bend: 0.7, tipTurns: 0.8 });
    for (const sd of [-1, 1]) rosette(out, sd * 0.2, 0.3, 0.12, 8, 0.3, { halo });
    tulip(out, 0, 0.0, 0.42, Math.PI / 2, { halo });
  } else if (K.motif === 'fan') {
    fan(out, 0, -0.18, 0.62, { halo });
  } else {
    for (const sd of [-1, 1]) {                                    // a crown of four leaves round the main flower
      leaf(out, 0, -0.1, Math.PI / 2 + sd * 0.55, 0.62, 0.25, sd, { halo, strokes: 5, lobes: 4, lobeDepth: 0.26, bend: 0.75, tipTurns: 0.8 });
      leaf(out, 0, -0.16, -Math.PI / 2 + sd * 1.35, 0.5, 0.2, -sd, { halo, strokes: 4, lobes: 3, lobeDepth: 0.22, bend: 0.6, tipTurns: 0.7 });
    }
    if (K.motif === 'rosette') rosette(out, 0, 0.0, 0.34, K.petals, 0, { halo });
    else if (K.motif === 'gourd') gourd(out, 0, 0.0, 0.42, 0.56, { halo, segs: 4 });
    else tulip(out, 0, -0.22, 0.56, Math.PI / 2, { halo });
  }
  if (cs !== 1) for (const it of out.slice(c0)) for (let i = 0; i < it.pts.length; i++) it.pts[i] *= cs;
  return finish(out);
}

function finish(out) {
  if (GAP) for (const it of out) if (it.t === 'p' && it.h > 0) it.h = Math.max(it.h, 2 * GAP);   // a halo clears h/2 round a shape
  return out;
}

export function bbox(items) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const it of items) for (let i = 0; i < it.pts.length; i += 2) {
    const a = it.pts[i], b = it.pts[i + 1]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b;
  }
  return { x0, x1, y0, y1 };
}
