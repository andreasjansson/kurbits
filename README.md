# Kurbits Machine

A purely mathematical ornament generator in the tradition of 18th-century pen
flourishes, printers' dividers and Swedish kurbits scrolls. One curve, one
recursive rule and symmetry: no drawn elements and no randomness.

Everything is in `index.html` (no build step, no dependencies beyond web fonts),
apart from the second engine, Kurbits Leaves, in `leaves.js` (below).

Live: https://andreasjansson.github.io/kurbits/ (Leaves: https://andreasjansson.github.io/kurbits/#leaves)

## Command line

`cli/kurbits.mjs` runs the page's own engine, presets and palettes (it reads them
out of `index.html`, so the page stays the one source). After `npm install`:

```
node cli/kurbits.mjs presets                                  # the twelve presets and their numbers
node cli/kurbits.mjs svg --preset Lily -o lily.svg            # what the page's Copy SVG gives
node cli/kurbits.mjs svg --at 12.2,17.3,17.9,0.41,4 --bg none --col '#d9b45f' --width-mm 60 -o swash.svg
node cli/kurbits.mjs json --at 3.1,5.1,0.2,0.27,1.3 -o shape.json   # raw polygons, engine units, y up
node cli/kurbits.mjs sheet --points "1,2,3,0.3,4;5,6,7,0.2,1" --cols 2 -o sheet.png
```

`--at X,Y,Z,DETAIL,ASPECT` picks any point (x, y, z from 0 to 20, detail 0 to 1,
aspect 0.25 to 6). An output name ending in `.png` is rendered with resvg
(`--px` sets the width). `node cli/kurbits.mjs --help` lists every option.

## Kurbits Leaves

`leaves.js` is a second engine of line-drawn leaves after Dalecarlian kurbits painting (dalmålning, about 1780-1850)
and acanthus scrollwork: curling, lobed, feathered and toothed leaves on a winding stem that ends in spirals, with
scrolls, buds and tendrils in its bends. Like the Machine it is a point in a continuous space, and every number is
continuous: x, y and z (0 to 20), detail, variation, size and mirror (0 to 1) and aspect (width over height). Every
point draws a border, and a small step in any number changes it only a little. Nothing is picked from a list: a leaf,
a lobe, a vein, a tooth or a scroll grows from nothing, and the same numbers always give the same border.

- x sets the leaf's edge: smooth, scalloped, lobed, feathered, then divided into leaflets (lobes are one bump
  repeated a fractional number of times along the leaf, so they grow in one by one; deep enough, the notches reach
  the midrib).
- z mostly sets slender or broad leaves, calm or curling; y the stem, from a gentle garland to deep scrolls, and
  whether its ends hang or rise. Both are read off slow waves through the space, as in the Machine.
- detail grows the veins, then scrolls inside the bends, second leaves and tendrils; variation makes each leaf and
  bend differ from its neighbours; size trades many small leaves for fewer, larger ones.
- mirror blends a running garland (0, every leaf pointing one way) into a border mirrored about its centre (1, with
  a crown of leaves rising there): the left half's leaves turn through the upright and their curl reverses.

Each leaf grows along a spine given by its curvature (an even bend and a tip curl that tightens like a logarithmic
spiral); its edge is a width envelope times lobes times teeth, its veins pinnate or striate like painted strokes.
The stem is a meander described by its heading, ending in logarithmic spirals. Everything is a pen line with hidden
lines removed, so the SVG is ready for a plotter or an engraver. `settingsAt(point)` reports the continuous settings
a point gives. The page's "How it is built" has the formulas.

Try it in the page's Leaves tab (`index.html#leaves`), which has the Machine's controls for every number, the print
limits below, twelve presets, a sweep, and Copy or Download SVG. The tab imports `leaves.js`, so locally serve the
folder (e.g. `python3 -m http.server`) rather than opening the file. On the command line:

```
node cli/leaves.mjs svg --at 6,17,13,0.9,6 -o border.svg               # X,Y,Z,DETAIL,ASPECT[,VARIATION,SIZE,MIRROR]
node cli/leaves.mjs sheet --points "0.3,0.5,3;12,14,16;20,8,2" --cols 1 -o sheet.png
node cli/leaves.mjs json --at 15,8,10,0.8,8,0.5,0.4,0 --min 0.015 --gap 0.015 -o print.json
```

Items are pen lines (`{t: 'l', pts, w}`, width w, round ends). For small physical prints such as an engraving,
`--min` sets the narrowest line and `--gap` the narrowest gap between lines, both in engine units (about one unit
per border height): lines keep at least that width, halos and the spaces between veins at least that gap, and veins
that no longer fit give way. `npm test` runs the tests in `cli/`, including a continuity test: from random points,
each number is stepped by 1/400 of its range, and every step must move the drawing's ink only a little, with no
step much larger than its neighbours.
