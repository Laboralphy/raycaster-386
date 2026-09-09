# Where the migration stands

A handoff note: what is done, what is next, and what a fresh checkout does not
give you. The feature-by-feature plan lives in
[ENGINE_INVENTORY.md](ENGINE_INVENTORY.md); this is the shorter "pick it up
from here".

Last updated after phase F.

## Read this first: two things that do not travel

**1. `_OLD_PROJECT_/` is gitignored.** It is the imported copy of the original
`o876-raycaster-engine` — the reference for every differential test, the source
of the golden baselines, and where the mansion levels live. A fresh clone does
not have it, and **10 of 23 test files silently skip** without it:

```
tests/differential/*.diff.test.ts     every bit-for-bit comparison
tests/differential/renderer.golden.test.ts
tests/level/loadLevel.test.ts         the real mansion levels
tests/level/buildObjects.test.ts
tests/bench/renderer.bench.ts
```

They skip rather than fail, so the suite still goes green — with roughly half
the coverage. To restore it, copy the original engine's `libs/`, `apps/` and
`games/` into `_OLD_PROJECT_/`, or point `LEGACY_ENGINE=/path/to/checkout` at a
copy elsewhere. `tests/harness/legacy.ts` resolves it.

**2. Check whether phase F is committed.** If `git status` shows
`src/level/buildObjects.ts` and `src/render/spriteFacing.ts` as untracked, the
work described under "Rendering" below is local only.

## State

203 tests, 22 files. `npm run check` is typecheck (three configs) + tests +
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

**Rendering is complete.** A saved level loads with its architecture, decals,
lights and scenery — `mans-cabin`'s 89 objects included.

Simulation is 1,770 lines with 1,234 lines of tests: doors that open, close,
lock, autoclose, refuse to shut on an occupant, run secret passages and
save/restore; wall sliding; actor-vs-actor collision over a sector grid.

`demos/simple/` consumes all of it — `world.ts` is 175 lines and holds only
what a *game* decides (walk speed, reach, and that a door must not close on the
player). `npm run demo` plays it; `npm run demo -- <name>` runs any other
directory under `demos/`.

### Next: phase D — actors (~1,210 lines)

**Do not start by writing code.** The first task is a decision:

> How does a Simulation actor bind to a Rendering sprite?

Upstream, `Entity` holds a `.sprite` — a Rendering object — and mansion's 2,280
lines of AI reach for `entity.sprite` nine times. So "actors do not hold
sprites" needs a *mechanism*, not a prohibition. The likely shape: the
Simulation actor holds an opaque id, and the game's own wrapper owns the
sprite. `Dummy` (from phase C) is already exactly that — position, radius,
tangibility masks, an opaque `entity` id, no sprite — so it is half the answer
already.

Get this wrong and Simulation imports Rendering and the whole separation
collapses. Everything in D and E inherits it.

Then: `Entity` + `Horde` (sprite-free), and the thinkers — base, mover,
tangible, static, missile, and `FPSControlThinker`, which belongs here because
it takes input through `keyDown`/`keyUp`/`isCommandOn` rather than reading the
DOM itself.

§4.7 of the inventory carries the measured contract: exactly what mansion's AI
touches, and which tier each of those lands in.

### Then: phase E — triggers and scheduling (~412 lines)

Tag grid, trigger dispatch rewritten actor-agnostic, scheduler, and
`getState`/`setState` across every subsystem. Depends on D, since dispatch
takes actor ids.

## Known open items

- **Shared `CellMap` writes** bypass the light re-trace. Mitigated: the
  accessor returns a `ReadonlyCellMap` view, so it will not compile. A
  determined cast still defeats it.
- **`DoorPolicy` has no differential test.** The largest ported surface with
  only unit coverage, because its logic lives in `Engine.js` methods that
  cannot be isolated without standing up the whole `Engine`. Every bug found so
  far came from tests, and three of the last four from *differential* tests.
- **Pre-existing lint debt**: ~20 `curly` errors in `demos/simple/main.ts` and
  older test files, all `--fix`-able. None in `src/`.
- **The README's benchmark table is stale** — it lists 7 scenes and +3.1%;
  `npm run bench` now runs 10, including `animated-flats` where the original
  mis-samples and the port is ~47% faster. The port is faster overall either
  way.

## Bugs found so far

Twelve, all found by tests rather than by reading. Ten were the original's;
one was introduced by this port's flat-array optimisation and fixed
(`CellMap` bounds); one was a typing bug in `Sprite.buildAnimation` that made
the directional-sprite form uncompilable. The README lists them.

The rate has been roughly one per subsystem ported, which is worth expecting to
continue into D and E.

## Commands

```bash
npm run check        # typecheck + test + build — the one to run before committing
npm test             # tests only
npm run typecheck    # three configs: src, src/simulation (no DOM), tests
npm run bench        # port vs original; needs _OLD_PROJECT_
npm run demo         # demos/simple on http://localhost:8080
UPDATE_GOLDEN=1 npm test    # recapture the 34 baselines from the original
```
