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

`leaves.js` is a second, leafier engine after Dalecarlian kurbits painting (dalmålning, about 1780-1850): broad
curling plume leaves with painted lines and scalloped edges, rosettes, tulips and the kurbits gourd on a winding stem,
mirrored into a border. Like the Machine it is generated, not drawn, and deterministic: the same x, y, z (0 to 20),
detail (0 to 1) and aspect (width over height) always give the same border. x sets how deeply the stem winds (a
gentle garland to a leaf scroll with a leaf at every bend) and, with z, broad or feathered leaves; y sets whether the
ends hang, stay level or rise; z picks the centre (rosette, gourd, tulip, urn bouquet, tulip fan) and small rosettes
or grapes; detail adds leaves, flowers and tendrils. A sixth number, variation (0 to 1, default 0.7), sets how much
each leaf, flower and bend differs from its neighbours, like the Machine's variation term: leaf size (with a slow
swell along the stem), width, curl, bend, lobes and angle, paired leaves, rolled acanthus tips, mixed flowers and a
drifting meander. A seventh, size (0 to 1, default 0.3), trades a fine, busy garland for fewer, larger leaves
that lie flatter along a calmer stem and read as leaves from further away. Everything is drawn as line art by default:
each shape's silhouette erases what lies behind it and a calligraphic pen line runs round its edge, with a midrib
and engraved lines in each leaf (`style: 'fill'`, `--style fill`, gives the earlier filled shapes). `form` sets the
layout: `centred` (a centrepiece between two mirrored garlands), `mirrored` (two garlands joined in the middle on
one stem, no centrepiece) or `running` (one garland from end to end). The shapes move smoothly; the choices of motif change at fixed places. `settingsAt(point)` reports
what a point chose.

Try it in the page's Leaves tab (`index.html#leaves`), which has the Machine's controls for every number, the style,
the form and the print limits below, twelve presets, a sweep, and Copy or Download SVG. The tab imports `leaves.js`, so
locally serve the folder (e.g. `python3 -m http.server`) rather than opening the file. On the command line:

```
node cli/leaves.mjs svg --at 2,3,3,0.5,6 -o border.svg
node cli/leaves.mjs sheet --points "2,3,3,0.5,6;9,4,9,0.6,6" --cols 1 -o sheet.png
node cli/leaves.mjs json --at 9,4,9,0.6,8 --min 0.015 --gap 0.015 -o print.json
```

Items are filled shapes (with a halo that clears what lies under them) and cuts (painted lines that erase what lies
under them). For small physical prints such as an engraving, `--min` sets the narrowest painted line and `--gap` the narrowest
gap between overlapping shapes, both in engine units (about one unit per border height): lines then run as smooth
parallel strokes that stop before their neighbours merge, and small flowers lose detail they cannot hold.
`npm test` runs the tests in `cli/`.
