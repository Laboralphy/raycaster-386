# Where the migration stands

A handoff note: what is done, what is next, and what a fresh checkout does not
give you. The feature-by-feature plan lives in
[ENGINE_INVENTORY.md](ENGINE_INVENTORY.md); this is the shorter "pick it up
from here".

Last updated 2026-09-15. The demo was moved onto thinkers, then split so input
lives in its own class; a second demo was added on a real MapEdit level. The
last phase in the plan was E.

## Read this first

**The original `o876-raycaster-engine` is no longer in the repo.** It was the
reference for every differential test, the source of the golden baselines, and
where the mansion levels lived. All three dependencies were retired on
2026-09-11 (see "Retiring the original engine" below), and the imported copy
was deleted on 2026-09-15. It is recoverable from git history only.

The one optional fixture left is `demos/dark-village/assets/levels/level-1.json`,
the MapEdit save behind that demo's level. Without it `tests/mapedit/fidelity.test.ts`
skips, and `tests/harness/announce.ts` prints a banner saying so. Set
`RAYCASTER_REQUIRE_FIXTURES=1` to make that a hard failure instead.

**Check whether phase F is committed.** If `git status` shows
`src/level/buildObjects.ts` and `src/render/spriteFacing.ts` as untracked, the
work described under "Rendering" below is local only.

## State

271 tests, 26 files. `npm run check` is typecheck (three configs) + tests +
build. Bundles: `dist/index.js` (rendering, ~111 kB), `dist/simulation.js`
(~35 kB), `dist/schema.js` (the RCE-100 schema, ~22 kB).

### The perimeter

Four named tiers, each defined by what it *needs*:

| Tier | Where | Needs |
|---|---|---|
| **Core** | `src/core/` | nothing |
| **Rendering** | `raycaster-386` — all of `src/` bar the below | a screen |
| **Simulation** | `raycaster-386/simulation` — `src/simulation/` | a clock |
| **Game** | the caller; `demos/` stands in for it | a player |

**The invariant is the arrow: Simulation never imports Rendering.** It is
enforced, not just documented — `tsconfig.simulation.json` type-checks
`src/simulation/` with no DOM lib, so a `document` or `HTMLCanvasElement`
reference there fails the build.

### Done

| Phase | What |
|---|---|
| 0-8 | The renderer, level loading, the golden harness (pre-existing) |
| **A** | `CellMap` extracted to Core; no-DOM tsconfig; `DoorManager` restore |
| **B** | Door policy, cell helpers, secret passages |
| **C** | Wall sliding, actor collision, sector grid, `Vector` |
| **F** | Blueprint/tileset merge, decorative objects, sprite facing |
| **D** | Actors, the actor/sprite seam, `SpriteBinding` — thinkers declined |
| **E** | Tag grid, trigger dispatch, scheduler, save/restore |

**Rendering is complete.** A saved level loads with its architecture, decals,
lights and scenery — `mans-cabin`'s 89 objects included.

Simulation is ~1,790 lines: doors that open, close, lock, autoclose, refuse to
shut on an occupant, run secret passages and save/restore; wall sliding;
actor-vs-actor collision over a sector grid.

A door's easing is a `DoorPolicy` option as of 2026-09-11 — `openFunction` and
`closeFunction`, defaulting to `smoothstep` (ease-in-out, what the original
gave every door) and to replaying the open curve reversed. A secret passage is
deliberately outside it: its halves use paired accelerating and decelerating
curves so the effect reads as one wall shoving another, and one shared easing
would flatten that.

### The demos

Two of them, and together they are the acceptance test. `npm run demo` builds
both and serves each at its own route, so they can be compared side by side.

**`demos/simple/`** — everything the library does, on a hand-written 10x10 map.
Split so that each file answers one question:

- `world.ts` (217 lines) — composition. What a *game* decides: reach, that a
  door must not close on anyone, and which layer hands what to the other. The
  player is an actor, so the door's occupancy check is `actors.actorsAt(x, y)`
  rather than a hand-rolled cell comparison.
- `thinkers.ts` (70 lines) — behaviour. `PlayerThinker` and `SentinelThinker`,
  with the walk, turn and pacing speeds beside the only code that reads them.
- `input.ts` (88 lines) — `InputManager`: the keyboard and pointer-lock
  listeners, and the held-key state they write. `readInput()` turns that into
  one `Input` per tick, which is the only thing `World` ever sees.
- `main.ts` (84 lines) — the browser: canvas, texture loading, and the fixed
  step loop.

**`demos/dark-village/`** — the same five files in the same shape, but the map
is not written in them. It is a real MapEdit level: 59x59 cells with an upper
storey, 53 materials, 52 tilesets, 43 blueprints, 63 decorative objects, 32
decals, a double door, a secret passage and two tagged cells. `world.ts` (241
lines) reads it through `loadLevel` + `buildObjects` instead of `MapHelper`,
and adds `TagTriggers`; everything else is the first demo unchanged.

Two things that level taught us, both written into the demo:

- **Its tags are pushed, never walked into.** Both sit on solid cells — one a
  transparent block, one a wall — so `TagTriggers.process`'s enter/leave path
  never fires them. `push` is the route, which is what that method is for.
- **The crosshair cannot find them.** The centre ray passes *through* a
  transparent block and reports the opaque wall beyond, so `renderer.aimedCell`
  is no use for a tag on one. `use()` probes the cell the player physically
  faces; `aimedDoor()` still uses the crosshair, since a door is opaque and
  stops the ray.

The level arrived in the editor's own save format, which `loadLevel` does not
read — see "Two formats" in [MAPEDIT_ANALYSIS.md](MAPEDIT_ANALYSIS.md).
`scripts/convert-mapedit-level.mjs` converts it to RCE-100 by running the
original `libs/generate` unmodified, with an image appender over
@napi-rs/canvas that matches the browser editor's own (frames left to right,
*frame* dimensions reported rather than sheet).

**Only the conversion's output is kept**: `assets/level-1.rce.json` (47 kB)
and `assets/textures/` (55 files, 664 kB). The editor sources it was built
from — the MapEdit save and its 2.1 MB of unmerged tiles — were deleted on
2026-09-11 rather than committed, which halved the demo to 1.3 MB. **So this
level cannot be re-converted here.** Change it and the sources have to come
back from wherever they were imported. The converter script stays because it
is generic and documents how the artifact was produced, not because this demo
can still run it.

### The actor seam, as settled

An `Actor` holds a position, size, `data`, `ref` and a collision `Dummy` — **no
sprite and no light**. The link is `Actor.id`. Each tick, `ActorRegistry.process()`
returns an `ActorFrame` of plain data:

```ts
{ moved: readonly ActorUpdate[], removed: readonly ActorId[] }
```

`moved` is sparse, so static scenery costs nothing. `removed` is drained each
tick. The contract lives in `src/core/actorFrame.ts`, below both tiers, so
neither imports the other.

`SpriteBinding` (Rendering) consumes that frame: it moves sprites, moves their
lights, turns billboards to face the camera, and disposes the dead. A game
writes one line a tick:

```ts
this.binding.apply(this.actors.process(context), this.player.position);
```

Two rules worth not breaking:

- **`dead` is the game's flag** — "remove me now", not "hit points reached
  zero". A death animation runs while the actor is still alive.
- **`moved` is applied before `removed`**, since an actor can be in both.

**Thinker *implementations* were declined** (2026-09-10), and the demo now
shows what that leaves. The originals are a base class over a string-keyed
state machine; behaviour is Game's, and `Thinker<C>` — just
`think(actor, context)`, plus optional `attach`/`detach` — is the plug point
for whatever replaces it. `moveActor(actor, context, v)` is kept as the one
piece worth not rewriting: it wires wall sliding to an actor's position and
size.

The demo was moved onto that seam the same day. Nothing in `src/` changed:

- The player was the last thing moved by hand — `world.ts` called
  `computeWallCollisions` directly with its own `isSolid` closure. It now goes
  through `moveActor` like everything else, so there is one movement path
  rather than two.
- Behaviour moved out of `World` into thinkers attached at spawn, so the tick
  is four steps — run the thinkers, handle `use`, then the two handoffs — with
  no per-actor branch.

`use` deliberately stayed in `World`: it reads `renderer.aimedCell`, and a
thinker reaching for renderer state is the arrow this perimeter exists to
prevent.

Three follow-ups were considered and **not** taken, recorded so they are not
re-litigated:

- **A name → thinker registry**, so `RceBlueprint.thinker` (`src/level/types.ts:152`)
  and `ActorRegistry.setState` could resolve a behaviour by name. It is the
  right shape — Simulation owning the slot, Game the contents. The second demo
  was meant to settle it, and half did: **every one of `dark-village`'s 43
  blueprints names a thinker** (the test pins this), so level data really does
  use the seam. But they are `StaticThinker` x40 and `StaticTangibleThinker`
  x3 — scenery that does not think, which `buildObjects` places as sprites
  needing no behaviour at all. The level's one piece of real behaviour is
  `camera.thinker: "IntroThinker"`, and that is the camera's, not an actor's.
  So: still deferred, now for a sharper reason — nothing has yet needed a
  *non-static* thinker resolved by name. If it is built, `ActorRecord` needs to
  carry the thinker name: it has `ref`, and a blueprint keeps `ref` and
  `thinker` as separate fields.
- **A shipped `TangibleThinker`**, and then the same wiring inside
  `ActorRegistry`. Both rejected. An actor has one `thinker` slot and the
  library must not occupy it, and applying a collision push is a *decision* —
  a heavy actor shrugs it off — so it cannot be done for every game in
  `process()`.
- Which turned out to be moot: **the tangible pattern is already one line from
  a thinker.** `Smasher.processEntity` sums and decays the field itself
  (`Smasher.ts:113-114`) and `ActorRegistry.file()` re-syncs `dummy.position`
  each tick, so a tangible thinker is `moveActor(actor, context, actor.dummy.force)`
  plus `registerEntity`/`unregisterEntity` in `attach`/`detach`. What is
  missing is a demo showing it, not library code.

### The plan is finished

Every phase is done bar the thinker implementations, which belong to Game and
were declined. What the library now covers:

**Rendering** — the whole raycaster, level loading, decorative objects, sprite
facing. **Simulation** — doors and secret passages, wall sliding, actor
collision, actors and their registry, tags and triggers, scheduling, and save
and restore across all of it. **Core** — the cell map, grid, markers, vectors,
geometry, flood fill.

### What is worth doing next, in rough order

1. **Package it**: the version is still 0.1.0 and nothing has been published.

Done since this list was written: a second demo (`dark-village`), the vitest
upgrade (now 5.0.0), the four steps that retire the original engine (below), and
`DoorPolicy`'s missing coverage (`tests/simulation/doorShapes.test.ts`).

### Retiring the original engine

Decided 2026-09-11: the original is obsolete and the port evolves on its own.
Differential testing is a *migration* technique, and the migration is over.
All four steps are done, and the imported copy itself was deleted on
2026-09-15:

1. **Port `libs/generate`** — done. `src/mapedit`, its own entry point, with a
   fidelity test proving it reproduces the original converter field for field
   on a real level. This was the irreversible one: nothing else can compile a
   MapEdit save, and no other save exists anywhere.
2. **Widen the golden baselines** — done. 34 to 45, the new poses captured from
   the original *while it could still answer*. They cover wound camera angles,
   the sprite cull's accept side, boundary and reject side, and a camera wedged
   into a corner — all gaps that let the sprite-culling bug survive 276 tests.
3. **Vendor the level fixtures and rewrite the bench** — done. See above and
   `tests/bench/baseline.json`.
4. **Delete the differential suite** — done. The six `*.diff.test.ts`,
   `renderer.golden.test.ts`, `tests/harness/legacy.ts`, `legacyRenderer.ts`,
   the `hasLegacy` gate and its banner are gone: 7 files, 38 tests. The three
   tests that never needed the original moved to `tests/renderer/`, which is
   what `tests/differential/` had been reduced to.

What is lost is the ability to ask the original what the correct output is. The
45 baselines in `tests/golden/` are the frozen answer; `port.golden.test.ts` —
which never needed the tree — enforces them from here. **`tests/golden/README.md`
records where they came from, and why 7 of them deliberately differ from what
the original produced**, because a baseline nobody can explain is a baseline
nobody dares change.

`UPDATE_GOLDEN=1` now re-records from the port, not the original, so a bug
introduced and then blessed becomes the new truth. Read `.golden-out/` before
re-recording.

## Known open items

- **Shared `CellMap` writes** bypass the light re-trace. Mitigated: the
  accessor returns a `ReadonlyCellMap` view, so it will not compile. A
  determined cast still defeats it.
- ~~**`DoorPolicy` has no differential test.**~~ Closed 2026-09-11, though not
  as a differential test. Bundling `Engine.js` fails on five unresolved imports
  — including `jsonschema`, which the legacy tree has no `node_modules` for —
  and `_buildDoorContext` needs `initializeRenderer()`, which stands up
  Renderer, DoorManager, TagManager, Scheduler, Horde and a camera. Standing
  all that up to check a decision table did not justify reinstating the retired
  harness. `tests/simulation/doorShapes.test.ts` pins the table instead, every
  number cited to `Engine.js:337-370` and `:252`. The gap it closes is real and
  was measured: with the 1.5 and 1.8 sliding factors swapped, all 23 existing
  door tests pass and the new suite fails 5 — up/down and curtain doors travel
  identically and were told apart by nothing.
- **Pre-existing lint debt**: 16 `curly` errors, all `--fix`-able, entirely in
  older test files — `tests/harness/compare.ts` (4),
  `tests/simulation/doors.test.ts` (4), `tests/renderer/port.golden.test.ts`
  (4), `tests/demos/simple/world.test.ts` (3),
  `tests/simulation/doorIntegration.test.ts` (1). None in `src/` or `demos/`.
  Down from 20; four went with the retired suite.
- **`dark-village` keeps its MapEdit save but not its tiles.**
  `assets/levels/level-1.json` is back — it is the fidelity fixture for
  `src/mapedit` — but the 2.1 MB of unmerged source tiles it was built from are
  not. So the level can be *converted* (the converter is `src/mapedit` and needs
  nothing external) but not *re-atlased*: editing it means re-importing the
  tiles.
- **The README's benchmark table describes a comparison that no longer runs.**
  It reports the port against the original per scene (+3.1% overall), but
  `npm run bench` now measures the port against its own recorded baseline —
  the original is gone. The measurements were true when taken and are worth
  keeping as history; the section needs a line saying so. The port is faster
  either
  way.

## Bugs found so far

Thirteen. Eleven were the original's; one was introduced by this port's
flat-array optimisation and fixed (`CellMap` bounds); one was a typing bug in
`Sprite.buildAnimation` that made the directional-sprite form uncompilable.
The README lists them.

Twelve were found by tests rather than by reading. The thirteenth —
sprites vanishing once the camera had wound past ~1.38 turns, because the
bearing was reduced by a single `2 * PI` correction — was found by *playing*
`demos/dark-village`, and could not have been found otherwise: every golden
and differential pose renders at a small fixed angle, well inside the range
where one correction is enough. `tests/spriteCulling.test.ts` covers it now.
An argument for the demos being part of the test surface, not a showcase.

The rate has been roughly one per subsystem ported, which is worth expecting to
continue into D and E.

## Commands

```bash
npm run check        # typecheck + test + build — the one to run before committing
npm test             # tests only
npm run typecheck    # three configs: src, src/simulation (no DOM), tests
npm run bench        # the renderer against tests/bench/baseline.json
UPDATE_BENCH=1 npm run bench    # re-record that baseline
npm run demo         # every demo on http://localhost:8080, one route each
npm run demo -- --watch     # ...rebuilding both on change
UPDATE_GOLDEN=1 npm test    # re-record the 45 baselines FROM THE PORT — read the diffs first

# Converts a MapEdit save to RCE-100. Needs only the save and its tiles.
node scripts/convert-mapedit-level.mjs <demo-dir>
```
