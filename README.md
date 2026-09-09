# raycaster-386

A raycasting engine in TypeScript. Renders like it's 1992; runs like it isn't.

A modernised port of the
[o876-raycaster-engine](https://github.com/Laboralphy/o876-raycaster-engine)
renderer: strict TypeScript, built with esbuild, no runtime dependencies, and
verified pixel-for-pixel against the original.

```bash
npm install
npm run check      # typecheck + test + build
npm run demo       # playable demo on http://localhost:8080
npm run bench      # port vs the original engine
npm run build      # dist/index.js + dist/engine.js
```

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Build scaffold (esbuild, tsconfig, vitest) | done |
| 1 | Leaf modules | done |
| 2 | Textures, map, surfaces, lighting, sprites | done |
| 3 | Golden-image regression harness | done |
| 4 | Raycasting + renderer | done |
| 5 | Measured optimisations | done |
| 6 | Engine layer: doors + easing | done |
| 7 | Renderer-level demo | done |
| 8 | RCE-100 level loading | done |

`libs/raycaster` is fully ported, plus the first slice of the engine layer
(doors and easing) and a loader for the map editor's saved format. The port
renders all 34 golden cases; 29 are pixel-identical to the original and 5
differ deliberately (see below), and it is ~3% faster overall. `npm run demo`
plays it.

The library is built in **three tiers**: the renderer turns world state into
pixels, the simulation layer advances world state by a tick, and the game owns
the loop, input and rules. The invariant is the arrow — **tier 2 never imports
tier 1** — which is what keeps a god object like the original's `Engine.js`
from forming, and what would let the simulation run headless on a server. See
§12 of the migration doc, and
[documentation/ENGINE_INVENTORY.md](documentation/ENGINE_INVENTORY.md) for what
is in scope, what is not, and in what order.

Migration progress, decisions and known gaps are recorded in
[documentation/MIGRATION_FROM_JS.md](documentation/MIGRATION_FROM_JS.md), and
what remains of the original engine is inventoried feature by feature in
[documentation/ENGINE_INVENTORY.md](documentation/ENGINE_INVENTORY.md).

## Design decisions

Settled with the original author before the port started.

**No reactive options.** The original observed its options object with a
`Reactor` (`Object.defineProperty` on every scalar) so that a write showed up
in the next frame. Across the whole upstream repo only three sites ever used
that, and one of them — `shading.factor` — needs no recompute at all. It cost
a getter call per option read in the per-column and per-pixel loops.

Replaced by typed setters that mark a `Dirty` bitmask, revalidated once at the
top of `render()`. That keeps the one genuinely useful property of the Reactor
— coalescing several option writes into a single re-shade — and drops ~380
lines of `Reactor` + `Translator` + `Extender` machinery.

**Validation is a hook, not a dependency.** `Engine.buildLevel` validated
every level against a 22 kB JSON schema on every load, which costs an npm
dependency and a walk of a 120 kB document to catch what the map editor could
have caught on save. `loadLevel` takes an optional `validate` callback
instead, and the schema ships as data on its own entry point
(`raycaster-386/schema`), so a game can check its levels while developing and
drop both from its release build. What the library always does is stricter and
free: an unknown `@SYMBOL` throws, where the original's translator passed the
typo through as a string.

**No I/O in the renderer.** Callers pass already-decoded images
(`setWallTextures(canvas)`). The original loaded texture URLs from inside an
`async optionsReaction()` that was called without `await` from the render
path, so texture loading raced with rendering. Removing the I/O removes the
race structurally rather than patching it, and makes the whole option path and
`render()` synchronous.

**Dropped**: VR / stereo panels (half-implemented upstream, and its bounds
check sat in the innermost pixel loop of the flat rasteriser), `ShadedTileSet`
economy mode (no users), `CellSurface.diffuse` (written once, never read), and
`screen.focal` as an input (it was overwritten by `adaptFocal()` on every
resize, so it is now derived and read-only).

**Kept**: the second storey, and `paintSurface` wall decals.

**`SPRITE_Z_SCALE`** (upstream `MAGIC_DIST_RATIO`) is preserved exactly, only
renamed and documented. Wall shading and slice height both read the unscaled
wall distance, so normalising the two distance scales would shift the look.

## Layout

```
src/
  consts.ts               face / phys / fx codes, as const unions rather than enums
  core/
    canvas.ts             canvas creation, pixel filter, image loading (not used by the render path)
    Rainbow.ts            CSS colour parsing, dependency-free so shading is testable under Node
    MarkerRegistry.ts     set of marked 2D positions
    Grid.ts               dense 2D grid (replaces @laboralphy/grid)
    bresenham.ts          line walk with early abort
    geometry.ts           distance, circleInRect, linear
  map/
    CellMap.ts            flat Uint32Array of packed cell codes
    CellSurfaceManager.ts per-face decals and light strips
    MapHelper.ts          builds a renderer from a saved level (legend + grid)
  texture/
    ShadedTileSet.ts      pre-computed distance shading, layers stacked vertically
    TileAnimation.ts
  light/
    LightMap.ts           traced static lighting
    LightSource.ts
  Sprite.ts
  DebugDisplay.ts
  level/                  RCE-100 loading; an importer onto LevelMap, not a second native shape
    types.ts              the saved format, as written by the map editor
    constants.ts          "@PHYS_WALL" and friends, resolved strictly
    loadLevel.ts          builds a renderer; reports what it does not handle
    rce-100.json          the format schema, shipped unmodified on its own entry point
  engine/                 simulation above the renderer; separate bundle
    Easing.ts
    DoorContext.ts        one door's state machine
    DoorManager.ts        ticks every door, reports cell updates
    TypedEmitter.ts
```

`src/engine/` never imports the renderer. See §7 of the migration doc for why.

### Cell encoding

Each cell of `CellMap` packs three fields into one 32-bit int:

```
  bits 23..16   offset   (0..255)  door slide / block recess
  bits 15..12   phys     (0..15)   PhysCode
  bits 11..0    material (0..4095) index into the cell code table
```

Stored flat and row-major rather than as an array of arrays: `projectRay` reads
one cell per DDA step and `renderFlats` walks the map essentially at random, so
one indexed load beats two dependent ones.

## Testing

```bash
npm test
```

`tests/differential/` diffs ported modules against the original JS. The harness
bundles a module out of a sibling `o876-raycaster-engine` checkout and imports
it, so behaviour can be compared directly:

```bash
LEGACY_ENGINE=/path/to/o876-raycaster-engine npm test
```

These tests skip when that checkout is absent. `TileAnimation` and `Rainbow`
are currently pinned this way — including all 148 colour-table entries, which
were transcribed mechanically rather than by hand.

### Golden images

`tests/golden/` holds one committed PNG per (scene, camera) pair, captured
from the original engine running headless via `@napi-rs/canvas`. Phase 4
renders the same cases through the port and compares against them.

```bash
npm test                       # compare against the committed baselines
UPDATE_GOLDEN=1 npm test       # recapture them
```

A mismatch writes `actual`, `expected` and a red-on-grey `diff` image to
`.golden-out/`, and reports the differing pixel count, the largest channel
delta and a bounding box. Comparison is exact — tolerance defaults to 0,
because a faithful transcription should be exact and a nonzero default would
hide small regressions.

Scenes live in `tests/harness/scenes.ts` and cover four-wall rooms, both
camera-height branches of the flat rasteriser, sliding and lateral doors,
transparent and invisible blocks, traced light sources, a colour filter over
non-black fog, sprites at a range of distances and effect flags, painted wall
and flat decals, and a second storey. Texture atlases are generated per-texel from a formula
rather than drawn, so they are backend-independent and any sampling shift
changes a value.

The harness is self-checked: it proves the comparator detects a one-degree
rotation, a half-pixel translation and a single flipped bit; that the PNG
store round-trips losslessly; and that renders are deterministic across
instances and across repeated frames. It was validated end to end by
injecting a one-character off-by-one into the original's `projectRay`, which
it caught as a 26% pixel difference with a bounding box.

### Bugs fixed in the port

Three, all found by the harness rather than by reading:

- **`render()` now clears the frame.** The original painted background, flats
  and slices without clearing, so any pixel none of them covered kept the
  previous frame. A half-open door leaves exactly such a gap.
- **The light map is traced before the scene is cast.** The original called
  `updateStaticLightMap()` between building the z-buffer and drawing the
  flats, so the first frame after a light changed shaded its walls against a
  stale map while its floor already used the new one.
- **A storey inherits its parent's settings.** `createStorey()` copied
  nothing and the shading transmit in `optionsReaction` was commented out, so
  the original's upper floor shaded with the default 16 layers while sharing a
  tileset the ground floor had built with 8 — indexing past the end of the
  atlas. This is why `storey--centre` and `storey--centre-diag` are the two
  baselines that deliberately differ; `tests/differential/renderer.golden.test.ts`
  lists them in `KNOWN_LEGACY_DIFFERENCES` with the reason.

Two more surfaced later:

- **A flat texel could be sampled one row past the atlas.** The original
  computed a source row as `((fy % ps) + layer * ps) | 0`. Where `fy % ps`
  landed just under the cell size — 255.99999999999997 — adding the layer
  offset rounded the deficit away to exactly 512, one row too far, and the
  out-of-bounds read wrote a transparent pixel. The port truncates before
  adding. This is the `room--crouched` baseline difference.
- **`MapHelper` silently dropped block lights.** `buildMaterialItem` did not
  copy `light` onto the material it built, so the branch that creates a light
  per cell could never fire and `blockLights` always came back empty.

And two dead-code bugs fixed in passing: `getMemoryUsage()` called a method
that does not exist and so always threw, and `optimizeBuffer` pushed the same
slice three times when given fewer than three.

### Performance

`npm run bench` measures the port against the original on the same scenes,
headless. The port is **~3% faster overall**, and its rasteriser — 90% of a
frame — is **~15% faster**:

```
  room        original 1.293  port 1.215  +6.0%
  doors       original 1.632  port 1.576  +3.4%
  lit         original 1.271  port 1.202  +5.4%
  tinted      original 1.226  port 1.161  +5.2%
  sprites     original 1.231  port 1.196  +2.8%
  decals      original 1.227  port 1.209  +1.5%
  odd-spacing original 1.336  port 1.374  -2.9%
  TOTAL       original 9.215  port 8.933  +3.1%
```

`odd-spacing` uses a cell size of 48 and so takes the generic arithmetic path;
it is the one case the port does not win, and it exists to keep that path from
becoming dead code. `storey` is excluded because the two are not doing the
same work — the original's upper floor is mis-shaded and draws less.

Getting there took profiling rather than reasoning. The first working port was
**55% slower**. What actually mattered, in order:

- **Shifts instead of divisions in `renderFlats`.** A power-of-two cell size
  turns six divisions and moduli per pixel into shifts and masks — worth about
  7% of a whole frame. The loop is written out twice rather than branching per
  pixel: a branch there measured *worse* than the division it avoids, because
  it stops V8 keeping the values in registers across the loop body.
- **Per-cell lookups hoisted out of the per-pixel loop.** Cell surfaces, the
  material code and the light level change every ~64 pixels, not every pixel.
- **Flat tile indices resolved once per frame** into an `Int32Array`, instead
  of walking the cell-code table twice per pixel.
- **`castRay` skips `Set.clear()`** when the exclusion registry is already
  empty, which it almost always is — 7% of `computeScene` on its own.

An earlier estimate in this project's planning said the port would land
10-25% faster for a different reason: that hoisting option reads out of the
hot loops would win. That reasoning was wrong. `renderFlats` had already
hoisted everything into locals in the original, so there was nothing to gain
there — and it is the function that dominates.

### Original-engine behaviour the harness pins

Three quirks found while building the baseline. Phase 4 must decide about
each; all are pinned as tests in `renderer.golden.test.ts`.

- **`render()` never clears the canvas.** It paints the background,
  overwrites the flat area, then draws wall slices; any pixel none of those
  covers keeps the previous frame. A half-open door leaves exactly such a
  gap, so a frame can depend on the frame before it. The harness resets to
  opaque black before each capture.
- **The first frame shades walls against a stale light map.**
  `updateStaticLightMap()` runs *after* `computeScene()`, so frame 1 builds
  its zbuffer before any light is traced while its flats already use the
  fresh map. It settles after exactly one frame, which is why captures
  discard one warm-up frame.
- **One ceiling pixel is skipped at screen centre when camera height is not
  1.** Cosmetic, one pixel in 16384, only in the general branch of
  `renderFlats`.

## Why TypeScript costs nothing here

Types are erased; there is no runtime representation of a type in the output.
With this project's `tsconfig`, the emitted JS is what you would write by hand
— `dist/index.js` contains no injected helpers, and casts like `as PhysCode`
vanish entirely.

Three settings matter, and each is commented in `tsconfig.json`:

- `useDefineForClassFields: false` — with it on, esbuild emits a bare field
  declaration *and* the constructor assignment, doubling hidden-class
  transitions on every instance.
- `noUncheckedIndexedAccess: false` — with it on, every `zbuffer[i]` and
  `renderSurface32[ofs]` gains `| undefined`, putting non-null assertions in
  the hottest loops in the codebase.
- `target: ES2022` — a lower target downlevels `?.`, `??` and class fields
  into slower helper code.

Plain `const` unions are used instead of `enum`, which would emit a runtime
object and turn each member access into a property load.
