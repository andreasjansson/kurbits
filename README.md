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

`leaves.js` is a second engine of line-drawn leaves and flowers after Dalecarlian kurbits painting (dalmålning,
about 1780-1870). A kurbits leaf is not a botanical leaf but a brush stroke: a thick band that comes out broad from
behind a flower or another leaf, swells, arches over like a horn or a breaking wave and tapers into a point that
hooks back, striped along its length. Fanned out from one point such strokes become a cluster of hooked fingers or,
shorter and rounder, a fan; closed into a ring they become a rosette, cupped together a tulip. The references were
two paintings on Wikimedia Commons: an anonymous bonad of 1799 with the ages of life on a stepped arch, and Back Olof
Andersson's painting of 1808 with two riders, a stacked plant and a border. Like the Machine the engine is one
recursive rule: a shoot (a stalk, then a head of strokes) grows smaller shoots from behind itself, along its length
and from behind its head, and they grow smaller ones, down to the depth that detail sets. Every number is
continuous, every point draws a design, a small step in any number changes it only a little, and the same numbers
always give the same design.

- x, y and z (0 to 20) choose the composition, read off slow waves through the space as in the Machine: how many main
  shoots spring from the root and where they head (up, sideways, down), how far they curl outwards, arch or sway, how
  much of them is stalk; how many sprouts each shoot grows, where along it (each shoot and generation in its own
  places, all along its length), on which side, in pairs, staggered or in whorls, whether they curl with their parent
  (stacked in a plume) and how many fan out from behind its head; fans of hairlines on the outer side of bends; how
  far the heads open into flowers, which of them, and whether the flowers are rosettes or tulips (about a third of
  the space keeps to leaves); and whether the design is mirrored (most of the space is).
- detail (0 to 1) is the depth: each third of it grows one more generation of shoots in from nothing, first as
  hairline tendrils that then fill out into leaves.
- aspect (0.25 to 48) is relative to the motif's own proportions: wider, repeats bud out along a runner (a frieze,
  up to dividers typically 30 to 80 times as wide as they are tall), itself a swelling stroke with fans of hairlines
  on the outer side of its crests and a flower or a leaf in each bay; taller, smaller tiers bud out of the top
  (telescoping, as in a tall panel). The repeats are not copies: repeat j reads the motif's waves with their phases
  shifted by a smooth walk along the repeats, zero at the motif, so neighbours are alike and the plants change
  gradually along the length (their shoots, sprouts, bends and arches, their flowers, and the leaf itself). How far
  they wander is a setting of x, y and z like any other, times variation, and never zero; a repeat depends only on
  its own place, so a longer frieze only adds repeats at its ends.
- plump, lobes and curl (0 to 1) shape the leaf: slender to fat strokes; one horn, a cluster of hooked fingers or a
  fan with round lobes; a gentle arch or a strong hook. variation is how much each leaf, and each repeat, differs
  from the next.

Each stroke grows along a spine given by its curvature (an arch that tightens towards the tip, then a hook that winds
like a logarithmic spiral, then perhaps a hairline). The band is broad at its base, swells and tapers to a point or
closes in a round end; stripes run along it, crowding towards its convex side, and its outline swells and thins as a
brush stroke does. A head is m such strokes fanned from one point; how far it has opened blends every number of the
head from the leaf's to the flower's, so a fan shortens, rounds off and closes into a rosette, which cups into a
tulip as cup rises. Everything is a pen line with hidden lines removed (sprouts lie behind their parents, so leaves
come out from behind leaves and flowers), so the SVG is ready for a plotter or an engraver. `settingsAt(point, j)`
reports the continuous settings a point gives (for repeat j of a frieze, or tier j of a tower), `buildRepeat(point,
j)` draws repeat j on its own, `buildLeaf({plump, lobes, curl, bloom, cup})` draws one head on its own, and
`build(point, {trace: []})` also records where every sprout comes out. The page's "How it is built" has the formulas.

Try it in the page's Leaves tab (`index.html#leaves`), which has the Machine's controls for every number, the print
limits below, fourteen presets (two of them long dividers), a sweep, and Copy or Download SVG. The tab imports
`leaves.js`, so locally serve the folder (e.g. `python3 -m http.server`) rather than opening the file. On the command
line:

```
node cli/leaves.mjs svg --at 7.79,10.26,18.62,0.9 -o crown.svg               # X,Y,Z,DETAIL[,ASPECT,PLUMP,LOBES,CURL,VARIATION]
node cli/leaves.mjs sheet --points "4.86,7.59,13.97,0;4.86,7.59,13.97,0.5;4.86,7.59,13.97,1" --cols 3 -o depth.png
node cli/leaves.mjs sheet --leaf --points "0.5,0,0.6;0.5,1,0.6;0.5,1,0.6,1,0;0.5,1,0.6,1,1" --cols 4 -o heads.png   # PLUMP,LOBES,CURL[,BLOOM,CUP]
node cli/leaves.mjs json --at 12.97,0.33,5.94,0.7,1 --min 0.015 --gap 0.015 -o print.json
node cli/leaves.mjs svg --at 3.62,6.55,3.36,0.62,28,0.4,0.6,0.7,0.5 --px 3000 -o border.png   # a long divider
```

Items are pen lines (`{t: 'l', pts, w}`, width w, round ends); a line that swells or tapers is several such lines end
to end. For small physical prints such as an engraving, `--min` sets the narrowest line and `--gap` the narrowest gap
between lines, both in engine units (about one unit per main shoot): lines keep at least that width, halos and the
spaces between stripes at least that gap, and stripes that no longer fit give way. `npm test` runs the tests in
`cli/`, including a continuity test: from random points, each number is stepped by 1/400 of its range (aspect by
1/400 of its range in proportion), and every step must move the drawing's ink only a little, with no step much larger
than its neighbours, also on friezes up to the longest. Further tests check that a longer frieze keeps the repeats it
had (only adding new ones at its ends), that neighbouring repeats differ, gradually, for nearly every point of the
space, that a single head morphs from horn to fan to rosette to tulip, and flowers grow into whole designs, without a
jump, and that sprouts come out all along their shoots, in different places on different shoots and generations.
