# Where the migration stands

A handoff note: what is done, what is next, and what a fresh checkout does not
give you. The feature-by-feature plan lives in
[ENGINE_INVENTORY.md](ENGINE_INVENTORY.md); this is the shorter "pick it up
from here".

Last updated 2026-09-11. The demo was moved onto thinkers, then split so input
lives in its own class; a second demo was added on a real MapEdit level. The
last phase in the plan was E.

## Read this first: two things that do not travel

**1. `_OLD_PROJECT_/` is gitignored.** It is the imported copy of the original
`o876-raycaster-engine` — the reference for every differential test, the source
of the golden baselines, and where the mansion levels live. A fresh clone does
not have it, and **9 test files lose some or all of their coverage** without it:

```
tests/differential/*.diff.test.ts     every bit-for-bit comparison (6 files)
tests/differential/renderer.golden.test.ts   all 15 skip
tests/level/loadLevel.test.ts         9 of 14 skip; the file still reports "passed"
tests/level/buildObjects.test.ts      6 of 15 skip; likewise
tests/bench/renderer.bench.ts         not part of `npm test`
```

The last two are the reason the banner exists: they report as *passed files*
while running a third to two-thirds of their tests, so they never appear in the
skipped count at all.

They skip rather than fail, so the suite still goes green. **`tests/harness/announce.ts`
now prints a banner when the tree is missing**, naming every gated file and
saying what the run no longer proves — a skipped suite is otherwise just a
number in the summary, indistinguishable from a full run. Set
`RAYCASTER_REQUIRE_FIXTURES=1` to turn that banner into a hard failure, for a
checkout that is meant to be complete.

To restore it, copy the original engine's `libs/`, `apps/` and `games/` into
`_OLD_PROJECT_/`, or point `LEGACY_ENGINE=/path/to/checkout` at a copy
elsewhere. `tests/harness/legacy.ts` resolves it.

`scripts/convert-mapedit-level.mjs` **no longer needs it**: the converter is
`src/mapedit`, this project's own TypeScript port of `libs/generate`.

**2. Check whether phase F is committed.** If `git status` shows
`src/level/buildObjects.ts` and `src/render/spriteFacing.ts` as untracked, the
work described under "Rendering" below is local only.

## State

272 tests, 28 files. `npm run check` is typecheck (three configs) + tests +
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

Simulation is 1,770 lines with 1,234 lines of tests: doors that open, close,
lock, autoclose, refuse to shut on an occupant, run secret passages and
save/restore; wall sliding; actor-vs-actor collision over a sector grid.

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

1. **The legacy tree decision** (see the top of this file). The suite skips ten
   files silently without `_OLD_PROJECT_`; a ~2.9 MB subset would make a fresh
   clone fully testable. Either vendor it or add an import script, and make the
   skip loud regardless.
2. **`DoorPolicy` has no differential test** — the largest ported surface with
   only unit coverage, because its original cannot be isolated from `Engine.js`.
3. **Port `libs/generate` to TypeScript.** `scripts/convert-mapedit-level.mjs`
   shells out to the original, so converting a level needs `_OLD_PROJECT_`.
   [MAPEDIT_ANALYSIS.md](MAPEDIT_ANALYSIS.md) already lists this as the piece
   worth keeping, and the mansion levels are known-good fixtures to test it
   against. Folds into item 1.
4. **Package it**: the version is still 0.1.0 and nothing has been published.

Done since this list was written: a second demo (`dark-village`, above) and the
vitest upgrade (now 5.0.0).

## Known open items

- **Shared `CellMap` writes** bypass the light re-trace. Mitigated: the
  accessor returns a `ReadonlyCellMap` view, so it will not compile. A
  determined cast still defeats it.
- **`DoorPolicy` has no differential test.** The largest ported surface with
  only unit coverage, because its logic lives in `Engine.js` methods that
  cannot be isolated without standing up the whole `Engine`. Every bug found so
  far came from tests, and three of the last four from *differential* tests.
- **Pre-existing lint debt**: 20 `curly` errors, all `--fix`-able, now entirely
  in older test files — `tests/harness/compare.ts`, `tests/simulation/doors*`,
  `tests/differential/*`, `tests/demos/simple/world.test.ts`. None in `src/`,
  and none left in `demos/` since the prettier pass.
- **`dark-village` keeps no level sources.** Its RCE-100 and atlases are
  committed and the demo runs from a fresh clone, but the MapEdit save and
  tiles it was generated from were deleted, and `scripts/convert-mapedit-level.mjs`
  needs `_OLD_PROJECT_` anyway. Editing the level means re-importing both.
- **The README's benchmark table is stale** — it lists 7 scenes and +3.1%;
  `npm run bench` now runs 10, including `animated-flats` where the original
  mis-samples and the port is ~47% faster. The port is faster overall either
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
npm run bench        # port vs original; needs _OLD_PROJECT_
npm run demo         # every demo on http://localhost:8080, one route each
npm run demo -- --watch     # ...rebuilding both on change
UPDATE_GOLDEN=1 npm test    # recapture the 34 baselines from the original

# Converts a MapEdit save to RCE-100; needs _OLD_PROJECT_ and the level sources,
# neither of which is in the repo. Kept for the next level, not for this one.
node scripts/convert-mapedit-level.mjs <demo-dir>
```
