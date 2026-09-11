# Migrating from o876-raycaster-engine (JavaScript)

Progress log for porting `o876-raycaster-engine/libs/raycaster` to TypeScript
as **raycaster-386**.

**Status: `libs/raycaster` is fully ported**, and the first slice of
`libs/engine` — doors and easing — is ported alongside it. 114 tests, 34 golden
baselines, ~3% faster than the original overall. A playable demo runs the whole
thing against the original engine's own level and textures (§10).

Every rendering path is covered by a golden baseline. What remains of
`libs/engine` — `Engine.js` itself, thinkers, collision, tags, level loading —
is a separate undertaking of comparable size (§11).

---

## 1. What was ported

Every file in `libs/raycaster/`:

| Original | Port | Notes |
|---|---|---|
| `Renderer.js` (2121 lines) | `src/Renderer.ts` + `src/raycast/*` + `src/render/*` | Split into a facade plus pure functions |
| `CellSurfaceManager.js` | `src/map/CellSurfaceManager.ts` | |
| `ShadedTileSet.js` | `src/texture/ShadedTileSet.ts` | Economy mode dropped |
| `TileAnimation.js` | `src/texture/TileAnimation.ts` | |
| `Sprite.js` | `src/Sprite.ts` | |
| `MapHelper.js` | `src/map/MapHelper.ts` | |
| `DebugDisplay.js` | `src/DebugDisplay.ts` | |
| `consts/index.js` | `src/consts.ts` | `const` unions, not `enum` |

Shared libraries it depended on were absorbed rather than ported wholesale:

| Original | Port | Notes |
|---|---|---|
| `canvas-helper/` | `src/core/canvas.ts` | `text()` dropped (unused here) |
| `rainbow/` (327 lines) | `src/core/Rainbow.ts` | Only `parse`/`rgba`; colour table transcribed mechanically and verified entry by entry |
| `marker-registry/` | `src/core/MarkerRegistry.ts` | |
| `light-sources/` | `src/light/{LightMap,LightSource}.ts` | |
| `bresenham/` | `src/core/bresenham.ts` | |
| `geometry/` (108 lines) | `src/core/geometry.ts` | Only `distance`, `squareDistance`, `circleInRect`, `linear` |
| `@laboralphy/grid` | `src/core/Grid.ts` | External dependency removed |
| `object-helper/Reactor` (154) | — | Deleted, see §3 |
| `object-helper/Extender` (132) | — | Deleted |
| `translator/` (90) + `levenshtein/` | — | Deleted; it was a `Map` lookup with passthrough |
| `array-helper/` (109) | — | Deleted; only `uniq()`, only for the Reactor |
| `events` (npm) | — | Deleted; no runtime event surface |

The port has **no runtime dependencies**. 41.8 kB minified.

---

## 2. What was deliberately NOT ported

Decisions taken with the original author before starting.

- **VR / stereo panels.** Flagged `@todo VR rendering` upstream, used by one
  demo. Removing it took `vrPanel` threading out of `createScene`, `castRay`
  and `render`, and — more importantly — removed a bounds check from the
  innermost pixel loop of the flat rasteriser.
- **`ShadedTileSet` economy mode.** No users anywhere in the upstream repo.
  Removing it collapses `drawTile()` to a single unbranched `drawImage`.
- **`screen.focal` as an input.** `adaptFocal()` overwrote whatever the caller
  set on every resize, so it is now derived and read-only:
  `(width >> 1) * (16 / 9)`.
- **`CellSurface.diffuse`.** Written once at init, never read.

If VR is wanted later it should be reintroduced as a wrapper that renders two
scenes, not by threading a panel index through the hot loops again.

---

## 3. Architectural changes

### Options: no reactivity

The original observed its options object with a `Reactor` that installed a
`defineProperty` getter/setter on every scalar, so a write showed up in the
next frame. Across the whole upstream repo only three sites ever used that,
and one of them — `shading.factor` — needs no recomputation at all. The cost
was a getter call per option read in the per-column and per-pixel loops.

Replaced by typed setters that record a `Dirty` bitmask, revalidated once at
the top of `render()`. That keeps the one genuinely useful property — several
settings changed in a row cause a single re-shade — and drops ~380 lines.

```ts
rc.setScreen({ width: 256, height: 256 });   // derives focal, marks Dirty.Screen
rc.setMetrics({ spacing: 64, height: 96 });
rc.setShading({ shades: 16, color: 'black', filter: null, brightness: 0 });
rc.shadingFactor = 50;                       // live field: read per frame, no recompute
```

### No I/O in the renderer

Callers pass already-decoded images. The original loaded texture URLs inside
an `async optionsReaction()` that was called *without* `await` from the render
path, so texture loading raced with rendering. Removing the I/O removes the
race structurally. Every method on `Renderer` is now synchronous.

```ts
const walls = await Canvas.loadCanvas('walls.png');   // helper, not required
rc.setWallTextures(walls);
```

### Storey ownership

An upper floor is no longer independently configurable. The parent owns every
setting and forwards it; `createStorey()` and the setters push down. The
original wrote directly into the other instance's private fields.

### Data layout

- `CellMap` is a flat `Uint32Array` instead of `number[][]`. `projectRay`
  reads one cell per DDA step and `renderFlats` walks the map essentially at
  random, so one indexed load beats two dependent ones.
- `CellSurfaceManager` allocates one contiguous `Uint8Array` for all surface
  light strips and hands each surface a `subarray` view.
- `SURFACE_LIGHTMAP_SCALE` is derived from `METRIC_LIGHTMAP_SCALE`, replacing
  a factor of 2 that existed only as a hard-coded `>> 1` in `LightMap.filter`
  while `CellSurfaceManager` independently hard-coded 4.

### Preserved deliberately

- **`SPRITE_Z_SCALE`** (upstream `MAGIC_DIST_RATIO = 1.14734748441786`).
  Renamed and documented, not normalised away: wall shading and slice height
  both read the *unscaled* wall distance, so changing the scale shifts the
  rendered look. It is a sort-key correction only.
- **The 3-deep lookback in `optimizeBuffer`.** It merges interleaved slices
  from transparent walls, where one column emits several through
  `scene.resume`. `castRay` allows up to six resumes, so three is a
  cost/benefit cap, not full coverage.

---

## 4. Bugs found in the original

All found by the golden-image harness, not by reading. All fixed in the port.

1. **`render()` never clears the canvas.** It paints background, overwrites
   the flat area via `putImageData`, then draws wall slices. Any pixel none of
   those covers keeps the previous frame. A half-open door leaves exactly such
   a gap — the `doors` scene ghosted 6.5% of pixels between cameras.
2. **First frame shades walls against a stale light map.**
   `updateStaticLightMap()` ran *after* `computeScene()`, so frame 1 built its
   z-buffer before any light was traced while its flats already used the fresh
   map. Dark walls, lit floor, for exactly one frame.
3. **A flat texel could be sampled one row past the atlas.** The source row
   was `((fy % ps) + layer * ps) | 0`. Where `fy % ps` landed just under the
   cell size — 255.99999999999997 — adding `7 * 64` rounded the deficit away
   to exactly 512.0, one row too far. The out-of-bounds read returned
   `undefined`, which a `Uint32Array` store turns into a transparent pixel.
   The port truncates before adding.
4. **`createStorey()` copies no settings**, and the shading transmit in
   `optionsReaction` is commented out, so the upper floor shaded with the
   default 16 layers while sharing a tileset the ground floor built with 8 —
   indexing past the end of the atlas.
5. **`MapHelper` silently dropped block lights.** `buildMaterialItem` never
   copied `light` onto the material it built, so the branch creating a light
   per cell could not fire and `blockLights` always came back empty.
6. **`Renderer.getMemoryUsage()` always threw** — it called
   `getConsumedBytes()`, which does not exist on `ShadedTileSet`.
7. **`optimizeBuffer` pushed the same slice three times** when given fewer
   than three, because its three cursors aliased one object.
8. **`LightMap.removeSource` could not remove the first source** — it tested
   `if (n)` on an `indexOf` result. `clearSources` spliced the array it was
   iterating. `LightMap.filter` never cleared its changed-cell set, so every
   invalidation re-pushed every cell ever touched.
9. **`Sprite.setCurrentAnimation` clamped to `group.length`** instead of
   `length - 1`, which could index one past the end.

Items 3 and 4 make the port's output legitimately differ from the original.
Those three baselines (`room--crouched`, `storey--centre`,
`storey--centre-diag`) are listed in `KNOWN_LEGACY_DIFFERENCES` in
`tests/differential/renderer.golden.test.ts` with the reason. Every other
baseline is byte-identical.

---

## 5. Verification

### Golden images

`tests/golden/` holds 34 committed PNGs, one per (scene, camera), captured from the
original engine running headless via `@napi-rs/canvas` plus a small DOM shim.
The port renders the same cases and is compared with **tolerance 0**.

```bash
npm test                     # compare against committed baselines
UPDATE_GOLDEN=1 npm test     # recapture
LEGACY_ENGINE=/path/... npm test   # point at the original engine checkout
```

A mismatch writes actual / expected / diff PNGs to `.golden-out/` with a pixel
count, max channel delta and bounding box. Differential tests skip when the
original engine is not checked out alongside.

The harness is self-checked: it proves the comparator detects a one-degree
rotation, a half-pixel translation and a single flipped bit, and that its PNG
store round-trips losslessly. It was validated end to end by injecting a
one-character off-by-one into `projectRay` — first in the original, then in
the port — and confirming both produced the *same* 4261-pixel diff.

### Scenes

`tests/harness/scenes.ts`: four-wall rooms, both camera-height branches of the
flat rasteriser, sliding and lateral doors, transparent and invisible blocks,
traced light sources, a colour filter over non-black fog, sprites at a range
of distances and effect flags, painted wall and flat decals, a second storey,
and a non-power-of-two cell size, a scrolling backdrop seen through open ceilings,
and animated wall and flat faces sampled at several points in their cycle.

Texture atlases are computed per texel from a formula rather than drawn, so
they are backend-independent and any sampling shift changes a value.

### Coverage gaps

Ported and type-checked, but **never verified in a rendered frame**:
`flip()`, `screenshot()`, `getMemoryUsage()`, `removeUnusedTileSets()`,
`disposeSprite()`, `setTextureSmoothing()`, `setStretch()`,
`CellSurfaceManager.rotateWallSurfaces()`, `removeDecal()`,
`Sprite.setDirection()` and sprite children.

These are utility surface rather than rendering paths. Every rendering path is
now covered: backdrops by the `sky` scene and animated surfaces by
`animated` and `animated-flats`.

Animations only move when the caller ticks them, so a pose pins its own
`animationTime` and the drivers rewind before advancing — absolute rather
than cumulative, so a pose lands on the same frame however many frames were
rendered before it. `Renderer.resetAnimations()` exists for that, and is
useful in its own right when restarting a level.

---

## 6. Performance

`npm run bench`. The port is ~3% faster overall; its rasteriser, 90% of a
frame, is ~15% faster.

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

`odd-spacing` uses a cell size of 48 and takes the generic arithmetic path; it
exists so that path does not become dead code. `storey` is excluded from the
total because the two engines are not doing the same work there (bug 4).

**The first working port was 55% slower.** What closed it, in order of effect:

- **Shifts instead of divisions in `renderFlats`** for power-of-two cell
  sizes — six divisions and moduli per pixel become shifts and masks, worth
  about 7% of a whole frame. The loop is written out twice rather than
  branching per pixel: a branch there measured *worse* than the division it
  avoided, because it stops V8 keeping the values in registers across the loop
  body. `tests/differential/port.golden.test.ts` pins the arithmetic
  equivalence so the two copies cannot drift.
- **Per-cell lookups hoisted out of the per-pixel loop.** Cell surfaces, the
  material code and the light level change every ~64 pixels, not every pixel.
- **Flat tile indices resolved once per frame** into an `Int32Array`.
- **`castRay` skips `Set.clear()`** when the exclusion registry is already
  empty, which it almost always is — 7% of `computeScene` alone.

### Does TypeScript cost anything?

No. Types are erased and `dist/index.js` contains no injected helpers; casts
like `as PhysCode` vanish entirely. Three `tsconfig` settings matter and are
commented in place: `useDefineForClassFields: false`,
`noUncheckedIndexedAccess: false`, `target: ES2022`. Plain `const` unions are
used instead of `enum`, which would emit a runtime object.

A prediction made early in this migration — that the port would land 10-25%
*faster* because hoisting option reads out of the hot loops would win — was
wrong. `renderFlats` dominates the frame and had already hoisted every option
read into locals in the original. Profile before predicting; `npm run bench`
and `--cpu-prof` exist for that.

---

## 7. Decision: the renderer stays a pure function of world state

**Agreed 2026-09-08.** Simulation state — anything that evolves with time and
is read by more than the renderer — stays out of the rendering package.

The test is not "is it animation?" but **does anything other than rendering
need to read this?** Door openness is read by collision (can the player pass),
AI pathfinding, audio, triggers and save games. `TileAnimation` lives *inside*
the renderer because nothing ever asks what frame a wall texture is on; it is
purely visual. That is the line.

Three reasons, in order of weight:

1. **It is what makes the port verifiable.** `render(x, y, angle, height)` is
   currently a pure function of the map: same state, same pixels, every time.
   That is the only reason the golden harness works. Give the renderer an
   internal clock and a frame becomes a function of state *and elapsed time*,
   baselines stop being pinnable, and the regression net built in Phase 3
   loses most of its value.
2. **The coupling is already minimal and one-directional** — two setter calls
   per door per tick. Moving the state machine in would replace that with
   open / close / lock / query-phase / serialise / emit-events.
3. **It is what every comparable engine does.** Doom splits its source into
   `p_` (play) and `r_` (render); doors are `p_doors.c` sector thinkers and
   the renderer only reads the resulting heights. Wolfenstein 3D keeps door
   positions in a `doorposition[]` array that the ray caster merely reads.
   Unity, Unreal and Godot put doors in the gameplay layer and let the
   renderer consume transforms. ECS designs separate a door system from a
   render system. Simulation writes, renderer reads.

`Sprite` is the template already in place: the renderer owns the drawable, the
simulation owns the entity and writes position into it each frame. Doors work
the same way — the renderer owns the cell's 8-bit offset, the simulation owns
the
phase and easing.

## 8. The simulation tier

Ported as the first slice of Simulation, in `src/simulation/`, built as a
**separate bundle** (`dist/simulation.js`, 4.7 kB minified) so a project that only
needs rendering does not pull in door simulation. Nothing in `src/simulation/`
imports the renderer.

| Original | Port |
|---|---|
| `libs/easing/Easing.js` | `src/simulation/Easing.ts` |
| `libs/engine/DoorContext.js` | `src/simulation/DoorContext.ts` |
| `libs/engine/DoorManager.js` | `src/simulation/DoorManager.ts` |
| door constants from `libs/engine/consts` | `src/simulation/consts.ts` |
| `events` (npm) | `src/simulation/TypedEmitter.ts` |

`Easing` dispatched on strings that happened to be method names, via
`this[name]`; curves are now plain functions in a lookup, which is what makes
`EasingName` a checkable union.

### The seam

All of it, and the caller owns it — deliberately, since neither layer should
depend on the other:

```ts
for (const { x, y, offset, phys } of doorManager.process()) {
    renderer.setCellOffset(x, y, offset | 0);
    renderer.setCellPhys(x, y, phys);   // PHYS_NONE while open
}
```

`DoorPolicy` sits above both: it reads a cell's phys code to know a door is
there, gives it the travel and timing that code implies — a double door opens
half a cell, a curtain slides slower than a door — and owns the lock register
and secret passages. What stands in a doorway is an `isCellOccupied` callback,
so none of this needs an actor tier.

`DoorManager` also restores a saved state: `setState(entries, build)` takes a
factory for the contexts, because an entry records where a door is and how far
through its cycle it got, but not the timings that follow from its cell's phys
code — that is door policy, which this tier does not own yet.

`tests/simulation/doorIntegration.test.ts` drives a real door through a full
open-and-shut cycle and checks the picture changes on most sliding ticks, that
the cell frees for movement only while open, that the frame returns exactly to
the shut one, and that no neighbouring cell is disturbed.

### Verified against the original

`tests/differential/doors.diff.test.ts` runs both implementations tick for
tick — 96 combinations of sliding, maintain and delay durations across four
curves, plus asymmetric open/close curves, a cancelled close, and an explicit
`close()` on a never-autoclosing door. Offset and phase match on every tick.

### Bugs fixed in this slice

- **`DoorManager.linkDoorContext` could hang.** It looped until
  `getDoorContext` came back empty while only calling `dispose()`, which marks
  a door done without unregistering it — so registering a second door at an
  occupied cell spun forever. Disposed doors are now removed.
- **`new Easing()` threw on first use.** The default function was the *name*
  `'_linear'` rather than a function, so `compute()` hit its
  "easing function is not defined" branch.

### Easing serves far more than doors

Worth knowing before trimming anything: `Easing` has 17 consumers upstream,
and doors are a minority of them.

| Use | Consumers |
|---|---|
| Entity / sprite movement | `WraithThinker` (eases x and y directly), `PlayerThinker`, `IntroThinker`, `FPSControlThinker`, `DevKbdThinker` |
| Screen filters | `Flash`, `Pulse`, `FadeIn`, `FadeOut`, `CameraObscura`, `PhotoMogrify`, `SimpleText`, `Splash`, `AmbientLight` |
| Doors | `DoorContext`, `Engine` |

So the full curve set is not padding — `CUBE_ACCEL`/`CUBE_DECCEL` are
`CameraObscura`'s lens raise and lower, `SQUARE_ACCEL`/`SQUARE_DECCEL` the
secret-passage pair in `Engine.js` and `Flash`. All eleven are kept because
they serve consumers not yet ported, which also makes `Easing` a good first
thing to have taken: it unblocks the filters and thinkers as well as doors.

### Preserved, with a note

`cubeInOut` rises to 1 at the midpoint and returns to 0 — it interpolates
there and back rather than landing on the target, despite its name. Ported
faithfully and pinned by a test that says so.

No file references it statically. That is *not* proof it is unused: thinkers
select curves by name from their data (`setFunction(data.easing || ...)` in
`WraithThinker`), so a curve can be chosen by content rather than by code. No
game JSON in the upstream repo currently supplies one, so changing `cubeInOut`
into a real ease-in-out is very probably safe — but check level content first,
not just a grep.

`EasingFunctions`, a second table of quad/cubic/quart/quint curves at the top
of the original file, was dropped. That one is genuinely unreachable: it is a
module-local `const` and the file only does `export default Easing`, so no
consumer could ever have reached it.

## 9. Scope boundary: what the raycaster does *not* do

Worth stating explicitly, because it is the first question anyone asks.

**Door and secret-passage animation is not part of `libs/raycaster` and was
not ported.** The split upstream is:

| Piece | Lives in | Role |
|---|---|---|
| Rendering a door at a given offset | `Renderer.createScreenSlice` | **ported** |
| Storing that offset per cell | `Renderer.setCellOffset` (8 bits) | **ported** |
| Rays passing through an open door | `projectRay` / `isWallTransparent` | **ported** |
| Recessed-wall geometry | `projectRay.sameOffsetWall` | **ported** |
| Deciding the offset over time | `libs/engine/DoorContext.js` | **ported, §8** |
| Ticking every door each frame | `libs/engine/DoorManager.js` | **ported, §8** |
| Easing curves | `libs/easing/Easing.js` | **ported, §8** |

The renderer can display a door in **any** state — the `doors` golden scene
holds a half-open `PHYS_DOOR_UP` at offset 48 and a `PHYS_DOOR_LEFT` at
offset 24, both pixel-verified. What *moves* one now lives in `src/simulation/`
(§8), one layer up, per the decision in §7.

The good news is that the coupling is tiny. All of `Engine`'s door handling
reaches the renderer through eight lines:

```js
_doorProcess() {
    this._dm.process().forEach(({x, y, offset, phys}) => {
        rc.setCellOffset(x, y, offset);
        rc.setCellPhys(x, y, phys);   // an open door stops blocking movement
    });
}
```

That surface already exists on the port and is verified:
`tests/differential/doorAnimation.test.ts` drives the `doors` fixture's
`PHYS_DOOR_UP` from shut to open a step at a time and checks each step renders
differently, that the frame depends only on the current offset however it was
reached, and that the offset round-trips the full 8-bit range without
disturbing the material or phys sharing that cell.

One detail matters for a per-tick caller: `setCellPhys` returns early when the
value has not changed. A *real* change re-traces every light source whose
radius overlaps the cell, so a door manager writing the same phys every frame
costs nothing, while opening the door pays once.

`Easing.js` is ~205 lines of pure maths with no dependencies; `DoorContext` is
a per-door state machine over it; `DoorManager` is a 67-line registry. Roughly
460 lines in total, touching the renderer through two method calls — so door
animation can be lifted out of `libs/engine` on its own, without dragging in
`Engine.js` (51.6 kB) or the thinker/collision machinery.

## 10. The demo

`demos/` holds browser demos driving the port directly — no `Engine`. Each is
a directory with its own `index.html` and `main.ts`, so one can be rewritten
without disturbing the others.

```bash
npm run demo             # builds every demo, one route each
npm run demo:watch       # rebuilds on change
```

It uses the original engine's `tagged-level` map and its actual `walls.png`
and `flats.png`, so it exercises real level data and real textures rather than
the generated atlases the golden scenes use. WASD to move, arrows or the mouse
to turn, <kbd>E</kbd> to open the door.

What it demonstrates end to end:

- `MapHelper.build()` turning a legend and a grid into a configured renderer
- Textures decoded by the caller and handed in, the renderer doing no I/O
- Collision from `getCellPhys`, sliding along walls rather than sticking
- `renderer.aimedCell` deciding what is under the crosshair
- A `DoorContext` opening on demand, animating, and refusing to close on the
  player — with the two-call handoff from §8 in the game loop

`demos/simple/world.ts` holds the whole simulation and knows nothing about the
DOM; `demos/simple/main.ts` is the only part that touches the browser. That
split is what lets `tests/demos/simple/world.test.ts` run it headlessly against the
real PNGs: building the level, walking into walls, aiming at the door, opening
it, watching it animate, and walking through.

### What the demo revealed

Level loading is not part of `libs/raycaster`. The upstream RCE-100 format
wraps the map in `level: { metrics, textures, map, legend }` alongside
`tilesets`, `blueprints`, `startpoints`, `objects`, `tags` and `lightsources`,
and writes phys codes as `"@PHYS_WALL"` strings resolved by a translator at
load time. `MapHelper` handles only the legend and grid; everything else is
`Engine.buildLevel()`. The demo therefore declares its level with the
constants referenced directly — see `demos/simple/level.ts`.

## 11. The level loader

`src/level/` loads the RCE-100 files the original map editor saves — the gap
§10 found. It covers everything the renderer understands and nothing above it.

**RCE-100 is an importer, not the native shape.** `toLevelMap()` projects the
file's `level` section onto `LevelMap`, the structure `MapHelper` already took.
It is written out field by field rather than cast, so the two can diverge: a
level declared in code (`demos/simple/level.ts`) never touches the RCE types, and a
second input format would be a second importer rather than a change here.

**Symbols resolve strictly.** A saved level writes `"@PHYS_WALL"` rather than
`1`, so the file survives a renumbering. The original resolved these through a
`Translator` with `strict = false`, so `"@PHYS_WALLL"` stayed a string and the
level loaded and then behaved wrongly — that cell silently became walkable. A
schema cannot catch it either: the typo is a perfectly good string. Here an
unknown symbol throws. All 13 symbols the shipped mansion levels use resolve.

**Schema validation is a hook, not a dependency.** `Engine.buildLevel` called
`jsonValidate(data, SCHEMA_RCE_100)` unconditionally, which costs an npm
dependency and a walk of a 120 kB document on every load, to catch a class of
bug the map editor could have caught when it saved. So `loadLevel` takes an
optional `validate` hook instead, and the schema ships as data on its own entry
point:

```ts
import RCE_100_SCHEMA from 'raycaster-386/schema';

await loadLevel(rc, level, {
    loadImage,
    validate: import.meta.env.DEV ? d => jsonValidate(d, RCE_100_SCHEMA) : undefined
});
```

A game shipping levels it authored validates while developing and drops both
the validator and the 22 kB from its release build; a level editor, or a game
loading maps it did not write, wires it permanently. The library holds the
format and the loader; the caller decides when checking is worth paying for.
It is the same cut as `loadImage`, which the library also refuses to own —
one primitive that differs per host, supplied from outside, with all the logic
staying in.

The hook runs first, before anything touches the renderer, so a rejected level
cannot leave it half-configured with some materials registered and some not.

The schema is shipped **unmodified**, so a level valid here is valid upstream.
That means it still requires `blueprints`, `objects` and `camera` — sections
this library reports rather than interprets. A level authored for this library
alone, omitting the entity tier, will not satisfy it. Relaxing that is a format
change and would need a new version string, not an edit to RCE-100.

**Everything above the renderer is reported, not dropped.** `LoadedLevel.unhandled`
hands back `blueprints`, `objects`, `tags` and `camera` intact, so a caller can
build its own entity tier without re-parsing the file. `tags` is the clearest
case: the original owned a `TagManager` and a tag grid; here the cells and
their tags are simply handed over.

Tilesets are decoded lazily — only when a decal names one — so a sheet that
only entities use costs nothing, and they are returned undecorated rather than
pre-shaded, since what a game does with a sprite sheet is the game's business.

## 11b. Movement and collision

Two independent pieces, both verified against the original rather than by
inspection.

**Wall sliding** (`wallCollider.ts`) probes four points around a mobile and
cancels one axis at a time, so a diagonal into a wall keeps the component
running along it. The probe on the trailing side is skipped — without that, a
mobile straddling a door frame catches on the edge it has already passed and
sticks in the doorway. `isSolid` is a callback over world coordinates, so the
module knows nothing about maps.

**Actor collision** (`Smasher`, `Dummy`, `ForceField`, `SectorRegistry`) moves
nothing. Each overlapping pair contributes a force proportional to how deeply
the two overlap, the resultant lands on `dummy.force`, and the caller decides
what to do with it. Comparisons are limited to the nine sectors around each
actor, so cost tracks local crowding rather than actor count. A `Dummy` carries
a position, radius, tangibility masks and an opaque id — no sprite and no
behaviour — which is the shape the actor tier needs.

Both are pinned by differential tests. The collision one runs a 40-actor crowd
for 25 ticks with each tick's force fed back into position, so any divergence
compounds rather than cancelling; it matches the original exactly. Making that
possible needed two harness additions: the grid shim gained the `rebuild` event
`SectorRegistry` relies on, and `importLegacyBundle` bundles several original
modules into a single module graph, without which their `instanceof` checks
fail across separately-bundled copies.

## 12. Scope: named tiers, one arrow

The original grew into a framework: `Engine.js` alone is 1,529 lines and owns
the game loop, asset loading, audio, the entity tier and the camera's AI. This
port is deliberately not that — but the problem with it was *control direction*,
not feature count. Collision, actor movement and sector triggers can all ship
without a single line of `Engine`.

| Tier | Owns | Never |
|---|---|---|
| **0. Core** — shared | Data both sides need: the cell map, grid, markers, geometry. | — |
| **1. Rendering** — `raycaster-386` | Turning world state into pixels. | Time. Input. I/O. |
| **2. Simulation** — `raycaster-386/simulation` | Advancing world state by a tick. | Importing Rendering. Owning a loop. Touching the DOM. |
| **3. Game** — the caller, not shipped | The loop, input, rules, assets, audio, UI. | — |

**The invariant is the arrow: Simulation never imports Rendering.** A god object
exists precisely to hold both sides at once, so forbidding the import is what
prevents one forming. §7 already states this for the door layer, and it is why
`DoorManager.process()` returns cell updates as plain data rather than calling
the renderer itself.

Each tier is defined by what it *needs*: Core needs nothing, Rendering needs a
screen, Simulation needs a clock, Game needs a player. Two consequences worth
stating, because they are what the rule buys:

**Golden-image tests exist because Rendering is a pure function of world
state.** Keep Simulation equally pure — data in, deltas out — and it is unit-testable with
no canvas, which is why `doorAnimation.test.ts` can drive a door from shut to
open without rendering anything.

**A headless server is the acceptance test.** If Simulation can run a game room in
Node with no canvas — accepting input, ticking, emitting deltas — the
separation is real. Time is already ticks rather than wall-clock, and
`src/simulation/` has zero DOM references today. The two things standing in the way
are that `CellMap` still lives inside `Renderer`, and that the no-DOM rule is a
convention rather than a typecheck.

What is deliberately out: the game loop (it owns time), `FPSControlThinker` (it
reads input devices), the asset registry and audio (I/O), and `Engine.js` as a
shape. Visual filters post-process a finished canvas and need neither tier, so
they are a separate package rather than a third entry point here.

The feature-by-feature inventory — every piece of `libs/engine`, its line
count, its dependencies, its tier and a verdict, with the work sequenced into
phases — is in [ENGINE_INVENTORY.md](ENGINE_INVENTORY.md).

## Appendix: commands

```bash
npm run check      # typecheck (src and tests) + tests + build
npm test           # tests only
npm run bench      # port vs original
npm run build      # dist/index.js + dist/index.min.js
npm run typecheck  # tsc --noEmit, both configs
```

`src` is type-checked with `types: []` so Node globals cannot leak into a
browser library; tests get them via `tsconfig.tests.json`.
