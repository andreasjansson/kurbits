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

`leaves.js` is a second engine of line-drawn leaves after Dalecarlian kurbits painting (dalmålning, about
1780-1870): plump, banded leaves that bend in a C or an S and wind their tips into curls, coming out from behind one
another, generation after generation. Like the Machine it is one recursive rule: a shoot (a stalk, then a leaf, then a
curl) grows smaller shoots out from behind its edges, and they grow smaller ones, down to the depth that detail sets.
Every number is continuous, every point draws a design, a small step in any number changes it only a little, and the
same numbers always give the same design.

- x, y and z (0 to 20) choose the composition, read off slow waves through the space as in the Machine: how many main
  shoots spring from the root and where they head (up, sideways, down), how far they curl outwards, arch or sway, how
  much of them is stalk, how many sprouts each shoot grows, where, how large and on which side, whether they rise,
  and whether the design is mirrored (most of the space is). The space holds upright plants with a crown, bouquets,
  candelabra, lyres and arches, garlands, fountains, sprays and single sweeping stems.
- detail (0 to 1) is the depth: each third of it grows one more generation of shoots in from nothing, first as
  hair-thin curls that then fill out into leaves.
- aspect (0.25 to 8) is relative to the motif's own proportions: wider, repeats bud out along a runner (a frieze);
  taller, smaller tiers bud out of the top (telescoping, as in a tall panel).
- plump, lobes and curl (0 to 1) shape the leaf: slender to plump; a smooth edge to rounded billows, each notch
  marked by a hook; a calm tip to one rolled into a spiral. variation is how much each leaf differs from the next.

Each shoot grows along a spine given by its curvature (a bend that may reverse into an S, then a tip curl that tightens
like a logarithmic spiral). The blade's edge is a width envelope times the billows, the convex side swelling more; it
is banded with stripes that follow the outline and run together into the base and the tip. Everything is a pen line
with hidden lines removed (sprouts lie behind their parents, so small leaves peek out from behind big ones), so the SVG
is ready for a plotter or an engraver. `settingsAt(point)` reports the continuous settings a point gives, and
`buildLeaf({plump, lobes, curl})` draws one leaf on its own. The page's "How it is built" has the formulas.

Try it in the page's Leaves tab (`index.html#leaves`), which has the Machine's controls for every number, the print
limits below, twelve presets, a sweep, and Copy or Download SVG. The tab imports `leaves.js`, so locally serve the
folder (e.g. `python3 -m http.server`) rather than opening the file. On the command line:

```
node cli/leaves.mjs svg --at 16,1,2,0.8 -o crown.svg                    # X,Y,Z,DETAIL[,ASPECT,PLUMP,LOBES,CURL,VARIATION]
node cli/leaves.mjs sheet --points "16,1,2,0;16,1,2,0.5;16,1,2,1" --cols 3 -o depth.png
node cli/leaves.mjs sheet --leaf --points "0.2,0,0.3;0.8,1,0.9" --cols 2 -o leaves.png   # PLUMP,LOBES,CURL
node cli/leaves.mjs json --at 2,9.5,13,0.6,3.5 --min 0.015 --gap 0.015 -o print.json
```

Items are pen lines (`{t: 'l', pts, w}`, width w, round ends). For small physical prints such as an engraving,
`--min` sets the narrowest line and `--gap` the narrowest gap between lines, both in engine units (about one unit
per main shoot): lines keep at least that width, halos and the spaces between stripes at least that gap, and stripes
that no longer fit give way. `npm test` runs the tests in `cli/`, including a continuity test: from random points,
each number is stepped by 1/400 of its range (aspect by 1/400 of its range in proportion), and every step must move
the drawing's ink only a little, with no step much larger than its neighbours.
