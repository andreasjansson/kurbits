# Kurbits Machine

A purely mathematical ornament generator in the tradition of 18th-century pen
flourishes, printers' dividers and Swedish kurbits scrolls. One curve, one
recursive rule and symmetry: no drawn elements and no randomness.

Everything is in `index.html` (no build step, no dependencies beyond web fonts).

Live: https://andreasjansson.github.io/kurbits/

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
