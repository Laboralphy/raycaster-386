# Inventory of `libs/engine`

Everything the original engine does, sorted by which tier it belongs to, so that
scope stays a decision that can be revisited rather than an assumption.

**Historical.** This inventory was written during the migration, against an
imported copy of the original `o876-raycaster-engine` that is no longer in the
repo; its references to `tests/differential/` describe what was true then. See
PROGRESS.md. Line numbers refer to that copy and were measured.

**Totals.** `libs/engine/` is 3,668 lines, of which `Engine.js` alone is 1,529.
The collision, tag and geometry machinery it pulls from `libs/` adds ~1,100.

## The rule

| Tier | Owns | Needs | Never |
|---|---|---|---|
| **0. Core** — shared | Data and maths both sides need: the cell map, grid, markers, geometry, bresenham, the cell codes. | nothing | — |
| **1. Rendering** — `raycaster-386` | Turning world state into pixels: map rendering, textures, lighting, sprites, level loading. | a screen | Time. Input. I/O. |
| **2. Simulation** — `@laboralphy/raycaster-386/simulation` | Advancing world state by a tick: doors, movement, collision, triggers, actors. | a clock | Importing Rendering. Owning a loop. Touching the DOM. |
| **3. Game** — the caller, not shipped here | The loop, input, rules, assets, audio, UI. | a player | — |

Each tier is defined by what it *needs*. `ShadedTileSet` pre-computes distance
shading and is pointless with nothing to display; `DoorContext` advances a door
by a tick and is meaningful with no screen at all. That is the whole test.

**The invariant is the arrow: Simulation never imports Rendering.** That single
constraint is what stops an `Engine` god object from forming, because such an
object exists precisely to hold both sides at once. A feature that cannot be
written without reaching across belongs in Game.

`src/simulation/index.ts` already states this for the door layer. The rest of this
document applies it to everything else.

**The acceptance test is a headless server.** If Simulation can run a game room in
Node with no canvas — accepting input, ticking, and emitting deltas — the
separation is real. If it cannot, something has been put in the wrong tier.
See §5. Alongside it, `demos/` is the Tier-3 exemplar: `demos/simple/world.ts` holds a
whole simulation and knows nothing about the DOM, `demos/simple/main.ts` is the only
file that touches the browser, and `tests/demos/simple/world.test.ts` already runs the
lot headlessly. Growing it to exercise each new subsystem is what shows the
library is usable from outside.

**`games/mansion` is a reference, not a migration target.** It is not being
ported. It earns its place as the only real evidence of what a game asks of
this library — it is how the `extra.blueprints` gap in §3.1 surfaced, and how
`FPSControlThinker` turned out to be input-agnostic — and §4.7 measures its
demands rather than guessing at them.

## Verdicts

| Mark | Meaning |
|---|---|
| **done** | already in this port |
| **take** | belongs in the perimeter; port it |
| **split** | part belongs here, part does not; the row says where the seam is |
| **skip** | Game tier or out of scope; the demo shows a caller doing it |
| **never** | actively unwanted, with a reason |

---

## 1. Already ported

| Feature | Original | Now | Tier |
|---|---|---|---|
| Level building | `Engine.buildLevel` (1157-1498, 342 lines) | `src/level/` | Rendering |
| Door animation | `DoorContext` (207), `DoorManager` (67) | `src/simulation/` | Simulation |
| Easing curves | `libs/easing` (207) | `src/simulation/Easing.ts` | Simulation |
| Light sources | `Engine.createLightSource`/`removeLightSource` (1129-1156) | `Renderer.addLightSource` | Rendering |
| Renderer options | `Engine.initializeRenderer`, `updateRaycasterOption` (113-152) | typed setters | Rendering |
| Symbol resolution | `libs/translator` (92), non-strict | `src/level/constants.ts`, strict | Rendering |
| Texture decoding | `libs/canvas-helper` | the caller's `loadImage` | Game |
| Marker sets | `libs/marker-registry` | `src/core/MarkerRegistry.ts` | Core |
| 2D grid | `@laboralphy/grid` | `src/core/Grid.ts` | Core |

---

## 2. Structural work — **done**

Three changes that cost little then and a great deal once collision, triggers
and actors were built on the old shape. Completed as phase A.

### 2.1 Extract `CellMap` from `Renderer` — **done**

`Renderer.ts:128` owns `private _map = new CellMap()`, and `getCellPhys`
(371), `setCellPhys` (349) and `getCellMaterial` (367) are renderer methods.

Collision, doors and triggers all need to ask what is in a cell. As it stands,
a headless server would have to construct a `Renderer` — with its tilesets,
canvas and light map — purely to answer that question.

`CellMap` itself is already pure: a flat `Uint32Array` and some bit masks, no
DOM, no imports beyond `consts`. **It is world state that happens to live in
the render tier.** Hand it to the renderer instead of hiding it inside one.

`CellSurfaceManager` (decals, light strips) and `LightMap` stay in Rendering —
those genuinely are appearance.

**Done:** `CellMap` moved to `src/core/CellMap.ts` (Core). `Renderer` takes one
as an optional constructor argument and exposes `get cellMap()`, so a game can
share one map between tiers and a server can hold one with no renderer at all.
The `CELL_*` masks stayed in `src/consts.ts`, which is already DOM-free and
shared; splitting that module is a separate, optional tidy-up.

One rule came out of it: **reads are free, writes go through the renderer while
one is attached.** `setCellPhys` also re-traces the light map and `setMapSize`
resizes the surface and light buffers, so writing to the shared map directly
skips both. That is not a new constraint — it is why `DoorManager.process()`
already returns deltas for the caller to apply rather than mutating anything
itself.

That rule is now enforced by type rather than documented: `Renderer.cellMap`
returns a `ReadonlyCellMap` view — the same object, through an interface with
no setters and no `data`, erased at build time so it copies nothing and costs
nothing. Verified by writing through it: `setPhys` and `data` are both
rejected, and neither name appears in the emitted bundles. Whoever constructed
the map keeps the writable `CellMap`; a headless caller with no renderer has no
buffers to keep in step and writes freely.

`CellMap` is also bounds-checked now, which it was not when it was extracted —
see the note in the bug list in [PORT_NOTES.md](PORT_NOTES.md). That defect was introduced by this port
rather than inherited: the original stored the map as an array of arrays, where
`this._map[y][x]` with a bad `y` threw a TypeError, and flattening it to a
`Uint32Array` for speed turned a loud failure into a silent one.

### 2.2 Enforce the no-DOM rule — **done**

`tsconfig.json` sets `lib: ["ES2022", "DOM"]` for all of `src`, so nothing
stops a future Simulation file from reaching for `document`. Give `src/simulation/` its
own tsconfig with `lib: ["ES2022"]` and no DOM, and a violation becomes a
typecheck failure rather than something a reviewer has to notice.

The same trick already keeps Node types out of `src` via `types: []`.

Audited: `src/simulation/` has **zero** references to `document`, `window`,
`HTMLCanvas`, `Image`, `requestAnimationFrame` or `performance`.

**Done:** `tsconfig.simulation.json` type-checks `src/simulation/` with
`lib: ["ES2022"]` and no DOM, and `npm run typecheck` runs it. Verified by
injecting `const _violation: HTMLCanvasElement` into `DoorManager.ts`: the new
config fails with `TS2304: Cannot find name 'HTMLCanvasElement'` while the main
config accepts it, so the check does work the existing build did not. Because
tsc follows imports, it also keeps `src/core/` and `src/consts.ts` DOM-free.

### 2.3 `DoorManager` state setter — **done**

`DoorManager` has a `state` getter and no setter. The original restored by
replaying `openDoor` and then forcing each context's phase
(`Engine.setDoorManagerState`, 1520-1528) — and `openDoor` is §4.1 below.

`DoorContext.setState` already round-trips correctly, replaying each phase so
listeners see the live sequence. Only the manager-level restore is missing.
Multiplayer promotes this from a nice-to-have to a requirement: reconnect and
late-join both need it.

**Done:** `DoorManager.setState(entries, build)`. It takes a factory because an
entry records where a door is and how far through its cycle it got, but not the
timings, easing or travel — those follow from the cell's phys code, which is
door policy (§4.1) and not ported. §4.1 will supply a default `build`.

Writing the round-trip test found a sixth inherited bug: **`DoorContext.setState`
never restored the offset.** It computed the easing at the restored time and
threw the result away (`DoorContext.js:143` upstream), so a door reloaded
mid-slide reported offset 0 until its next tick and drew shut for a frame. Now
the sliding phases take their offset from the easing; `OPEN` and `DONE` keep
setting theirs in `initPhase`.

---

## 3. Rendering

### 3.1 Decorative objects — **done**

`loadLevel` currently returns a level's `objects` and `blueprints` under
`unhandled`, so a mansion level renders its architecture, decals and lights,
but none of its torches or furniture.

Measured across the four shipped mansion levels: **300 objects, 102
blueprints, every one of them `StaticThinker` (96) or `StaticTangibleThinker`
(6)**. There is no AI anywhere in the shipped content. The object tier as
*used* is decoration.

And it maps almost one-to-one onto `Sprite`, which is fully ported:

| Level data | Sprite API |
|---|---|
| `blueprint.tileset` | `rc.buildSprite(tileset)` |
| `object.x`, `object.y` | `sprite.x`, `sprite.y` — already world units |
| `object.z` (0, −8, −32 in the wild) | `sprite.h`, the altitude field |
| `object.animation: "default"` | `sprite.setCurrentAnimation('default')` |
| `blueprint.fx: ["@FX_LIGHT_SOURCE"]` | `sprite.flags`; `resolveConstants` already resolves these |
| `blueprint.lightsource: {r0,r1,v}` | `rc.addLightSource(...)` |
| `object.angle` | `setDirection`, given an angle→index mapping |
| `blueprint.size` | reported, not acted on — a Simulation collision radius |
| `blueprint.thinker` | reported; "do nothing" in every shipped level |

Animation definitions live on the tileset and are already in the right shape —
a torch is `{id: "default", start: [0,0,0,0,0,0,0,0], length: 4, duration: 120,
loop: "@LOOP_FORWARD"}`, which is exactly `Sprite.buildAnimation`'s
array-of-starts form.

Best as a separate `buildObjects(rc, loaded)` call rather than a `loadLevel`
flag, so a game with its own object handling does not pay for one it discards.

**Prerequisite: `loadLevel` cannot yet take blueprints from outside the level.**
`Engine.buildLevel(data, extra)` merges caller-supplied `extra.blueprints` and
`extra.tilesets` into the level's own before building, and `extra.startpoint`
picks the start point. `games/mansion` depends on it — its bestiary is shared
across levels and compiled at runtime, so it is never in the level JSON:

```js
extra.tilesets   = DATA.TILESETS;
extra.blueprints = this.getCompiledBlueprints();
await this.buildLevel(oLevelData, extra);
```

Any game with a shared bestiary works the same way. Without it, decorative
objects can only resolve blueprints a level happens to carry inline.
`LoadLevelOptions` needs `blueprints?` and `tilesets?`, merged before use;
`startpoint` is already there. Small, but a prerequisite for phase F, not a
nice-to-have.

**Done.** `LoadLevelOptions` takes `blueprints` and `tilesets`, appended to
whatever the level declares and resolved with it, so a supplied entry's
`@FX_LIGHT_SOURCE` resolves like the level's own. `buildObjects(rc, loaded,
{ loadImage })` then turns objects into sprites — position, altitude from `z`,
scale, effect flags, the tileset's named animations, and any light the
blueprint carries. `thinker` and `size` are reported on each `PlacedObject`,
never acted on.

A separate call rather than a `loadLevel` flag, so a game with its own object
handling does not pay for one it discards.

Tested against the shipped mansion levels: every object placed, animations
started, negative `z` sinking objects below the floor, and a blueprint supplied
from outside the level surviving the merge and placing an object.

The decal-alignment maths is now `decalOffset`, exported and pinned by a
nine-case table read off the original's switch — it was the one part of this
path rewritten rather than transcribed, and nothing had exercised it.

### 3.2 Sprite facing — **done**

`Horde.updateLookingAngle` (`Horde.js:67-86`) picks a sprite's directional
frame from the camera angle. That is a sprite concern sitting inside the entity
registry; `src/Sprite.ts` is already ported and `setDirection` is already there.
Lift it alone, into Rendering, and leave `Horde` to §4.6.

**Done:** `faceCamera(sprite, facing, cameraX, cameraY)` in
`src/render/spriteFacing.ts`. It caches on the sprite — a new `Sprite.direction`
getter — rather than on an entity, so it needs no actor tier, and it is a no-op
when the frame would not change, which is what stops a walk cycle restarting
every tick.

Porting it exposed a typing bug: `Sprite.buildAnimation` declared its parameter
as `TileAnimationDef & { start?: number | number[] }`, and the intersection
collapsed `start` to `number` — so the array-of-starts form that declares a
directional sprite, which the runtime has always handled, would not compile.
Now `Omit<TileAnimationDef, 'start'> & …`.

---

## 4. Simulation

Everything here manipulates world state as plain data. None of it needs a
canvas. Roughly **2,400 lines** on top of the 274 already ported.

### 4.1 Door policy — **done**

`Engine._checkDoorClosability` (317-331), `_buildDoorContext` (332-387),
`_doorProcess` (388-402), `openDoor` (619-646), `lockDoor` (647-663),
`closeDoor` (664-676), `isDoor` (688-704), `isDoorClosed` (722-740),
`isDoorOpen` (741-752), `isDoorLocked` (753-773).

`DoorContext` animates a door; this decides which cells *are* doors, builds a
context from a cell's phys code, and handles autoclose, locking and refusing to
close on whatever stands in the doorway. Without it, opening a door means
writing the policy yourself, which `demos/simple/world.ts` used to do and no
longer does: it now constructs a `DoorPolicy` and supplies only the game's own
decision, that a door must not close on the player.

The missing half of something already ported, and it closes §2.3.

**Done:** `src/simulation/DoorPolicy.ts`. It holds a `DoorManager` and a locks
`MarkerRegistry`, reads a cell's phys code to know a door is there, and gives
it the travel and timing that code implies. `isCellOccupied` is a constructor
callback rather than a call into an actor registry, so the tier stays actor-free
— without one, doors always close. It supplies the default `build` that §2.3
left open, so `DoorPolicy.setState(entries)` restores doors on its own.

Two more inherited bugs surfaced:

- **`Engine.isDoorOpen` always threw.** It called `oDoor.isDoorOpen(x, y)`, a
  method `DoorContext` does not define, so every cell that had a context raised
  a TypeError. Dead code upstream; ported as `dc.isOpen()`.
- **A secret passage restored from the wrong end ran backwards.** Saved state
  recorded no way to tell the two halves apart, so rebuilding from the trailing
  block made it the pusher. `DoorManagerStateEntry` now carries the leading
  half's `child` cell, and `DoorPolicy.setState` restores leaders first.

### 4.2 Secret passages — **done**

`Engine._forEachNeighbor` (209-251), `_buildSecretDoorContext` (252-316),
`_getSecretNeighborDoorContext` (601-618), `isSecretBlock` (705-721).

A block that recesses and drags its neighbour with it. Pure cell-offset work;
the recessed-wall geometry it relies on (`projectRay.sameOffsetWall`) is
already ported and golden-tested.

**Done:** inside `DoorPolicy`, with the neighbour walk in
`src/simulation/neighbors.ts`. A second defect here: the lookup for a passage's
other half accepted any adjacent secret context, so **an ordinary door beside an
open secret passage adopted it** — its `closing` event fired from the passage
(which never autocloses, so never) and `closeDoor` shut the passage instead of
the door. The lookup now returns nothing unless the subject door is itself
secret. A third inherited bug came out of it: **the
neighbour walk could pair a block with one on the opposite map edge.**
`CellMap` indexes a flat array with no bounds check, so `getPhys(-1, y)` reads
the last cell of the row above. `forEachNeighbor` now skips cells outside the
map, which is a deliberate divergence from the original.

### 4.3 Cell helpers — **done**

`Engine.cellSize` (536-548), `getCellCenter` (549-562), `clipCell` (563-573),
`alterBlock` (574-588), `pushCell` (589-600), `getCellType` (677-687).

Clamp a coordinate into the map, find a cell's centre in world units, swap a
cell's material by its legend `ref` — `loadLevel` already returns those `ref`
strings. These become methods on the extracted `CellMap` (§2.1) rather than on
the renderer.

`pushCell` takes an entity upstream, but only to read its position.

**Done:** `src/core/cells.ts` — `worldToCell`, `cellCenter` and `alterBlock`.
Two notes on what changed:

- `clipCell` was renamed `worldToCell`. It clips nothing; it converts. A caller
  wanting the result inside the map clamps it against `map.size`.
- `alterBlock` returns a `CellChange` rather than writing to a renderer,
  matching `DoorCellUpdate`: a phys change re-traces every overlapping light,
  so the write has to go through the renderer when one is attached. Looking the
  material up by `ref` stays with the caller, which is who holds the table
  `loadLevel` returns.

`getCellType` needed no port — it is `map.getPhys`. `pushCell` is
`openDoor` plus a tag event, so it lands with §4.9.

### 4.4 Wall collision — **done**

`libs/wall-collider`. Slides a circle along walls instead of letting it stick.

**Zero imports** — the only file in this inventory with no dependencies at all,
and the cheapest thing here to port. `demos/simple/world.ts` used to hand-roll a
version of it off `getCellPhys`; it now calls this one.

**Done:** `src/simulation/wallCollider.ts`. `isSolid` is a callback taking a
world position, so it knows nothing about the map and a caller can answer from
cell phys, a door's state, or anything else.
`tests/differential/wallCollider.diff.test.ts` proves it bit-identical to the
original across 900 cases and a 200-step walk where each step feeds the next.

### 4.5 Actor collision — **done**

`libs/smasher` (`Smasher` 219, `Dummy` 146), `libs/force-field` (59),
`libs/sector-registry` (`SectorRegistry` 68, `Sector` 41).

Circle-versus-circle collision over a coarse sector grid, with push vectors.
Self-contained: geometry and events, no renderer.

Depends on: `libs/geometry` + `Vector` (286 total; take the subset actually
used), `libs/array-helper` (109, for `Sector`), `@laboralphy/grid`
(**ported**), `events` (replace with the ported `TypedEmitter`).

**Done:** `Dummy`, `ForceField`, `Sector`/`SectorRegistry` and `Smasher` in
`src/simulation/`. Nothing is moved: each overlap contributes a separating
force, the resultant lands on `dummy.force`, and the caller decides what to do
with it. `Dummy` holds a position, radius, tangibility masks and an opaque
`entity` id — no sprite, no behaviour — which is the shape §4.6 needs.

`tests/differential/smasher.diff.test.ts` proves it bit-identical to the
original across a 40-actor crowd, tangibility masks, and 25 ticks of feeding
each tick's force back into position, where any divergence compounds. Two
harness additions made that possible: the grid shim gained the `rebuild` event
`SectorRegistry` needs, and `importLegacyBundle` bundles several original
modules into one module graph so their `instanceof` checks hold.

A tenth inherited bug: **exactly coincident actors produced a `NaN` force.**
`_computeSmashingForces` normalised a zero-length vector, `computeForces`
summed the `NaN` onto `dummy.force`, and a caller adding that to a position
made the position `NaN` permanently. `reduceForces` then discarded the force,
so nothing survived to show where the corruption came from. The port separates
coincident actors along a fixed axis, which is deterministic — lockstep needs
that — and `Vector.normalize()` returns zero rather than `NaN` for a zero
vector.

### 4.6 Actors — **done**

`Entity` (136), `Horde` (171), `Engine.createEntity` (988-1057),
`destroyEntity` (1058-1076), `linkEntityLightSource` (1077-1092),
`_syncEntityDummy` (1093-1105), `_smashEntity` (1106-1128).

**This is the most important seam in the migration.** Upstream, `Entity` holds
a `.sprite` — a Rendering-tier object. A Simulation actor must hold position, size, inertia
and state plus an opaque id; binding that id to a `Sprite` is the game's job,
or a thin Rendering-tier adapter's.

Cut that link and the same actor code runs on a server with no renderer. Leave
it and Simulation imports Rendering, and the whole separation collapses.

`Blueprint` (21) similarly splits: the tileset/animation half is Rendering-tier sprite
construction (§3.1), the size/behaviour half is a Simulation actor template.

`linkEntityLightSource` reaches into the renderer's light list — in Simulation it
becomes "this actor emits light", reported as data, applied by whoever owns
both.

**Done.** `Actor` holds a position, size, `data`, `ref` and a `Dummy` — no
sprite and no light. `ActorRegistry` ticks behaviour, files actors into
sectors, and returns an `ActorFrame` of plain data: `moved` (sparse) and
`removed` (drained each tick). `SpriteBinding`, in Rendering, consumes that
frame and moves sprites, moves lights, turns billboards and disposes the dead,
so a game writes one line a tick.

The contract itself lives in `src/core/actorFrame.ts`, below both tiers, so
neither imports the other.

Two notes on what changed:

- **Movement is detected against the actor's own last reported position.** The
  original compared against `sprite.z`, which `Sprite` does not define, so the
  answer was always "moved" and every light and sector was rewritten every
  frame. Detecting it in Simulation is also what lets it work headless.
- **`dead` is the game's flag.** It means "remove me now", not "hit points
  reached zero" — mansion's ghosts play a death animation while still alive.
  The registry sweeps on the next tick and reports the id once.

`moveActor(actor, context, v)` is the movement primitive extracted from
`MoverThinker`: it wires `computeWallCollisions` to an actor's position and
size. A function, not a base class, since §4.7 was declined.

### 4.7 Behaviour — **skip** (decided 2026-09-10)

`thinkers/`: `Thinker` (102), `MoverThinker` (139), `TangibleThinker` (44),
`StaticThinker` (17), `StaticTangibleThinker` (18), `MissileThinker` (157),
`FPSControlThinker` (287).

Movement, projectile and first-person-control maths over actors. A base class
the *game* subclasses and the simulation ticks is a callback, not inversion of
control, so it passes the rule.

**Not ported, by the author's decision.** The thinkers are a base class over
`libs/automaton`, a string-keyed state machine (`main: { loop: ['$move'] }`,
dispatched by `this[name](...)`), and the author would rather bring a different
state-machine implementation than carry that one forward. Behaviour is the
game's; the library ships the `Thinker<C>` interface as the plug point, and
`moveActor` as the one piece worth not rewriting — see §4.6.

What follows is kept as a record of what was analysed, in case the decision is
revisited.

**`FPSControlThinker` would belong here, not in Game.** An earlier verdict put it out
of scope on the grounds that it reads the keyboard. It does not: it imports only
`Easing`, `TangibleThinker`, consts and `Vector`, and takes input through an
abstract command API — `keyDown(key)`, `keyUp(key)`, `isCommandOn(cmd)`,
`setupCommands(keyMap)`, `look(x)`. The *caller* wires the DOM:

```js
window.addEventListener('keydown', e => engine.camera.thinker.keyDown(e.key));
```

That is the same shape as `loadImage` and `DoorPolicy`'s `isCellOccupied`: the
host supplies the primitive, the logic stays inside. `games/mansion`'s
`PlayerThinker` extends it, which is the intended use.

Only `Engine._useThinker`, `useThinkers`, `createThinkerInstance` (836-906) stay
out — a string-keyed registry with Levenshtein "did you mean" suggestions,
replaced by passing constructors.

#### The surface a real game needs

`games/mansion/src/thinkers.d/` is 2,280 lines of game-side AI across 20+
thinkers — `VengefulThinker` (448) alone dwarfs anything here — all subclassing
these bases. It is not being ported, but what it *touches* is the measured
contract for this section:

| Surface | Uses | Tier |
|---|---|---|
| `entity.position` | 16 | Simulation |
| `context.game` | 13 | Game — the thinker's own context object |
| `entity.data` | 12 | Simulation — free-form per-actor bag |
| `entity.sprite` | 9 | **Rendering** — the seam §4.6 must cut |
| `engine.filters` | 6 | separate package (§6.4) |
| `engine.getTime` | 4 | Game — owns the clock |
| `entity.dead`, `entity.dummy`, `entity.size` | 7 | Simulation |
| `createEntity`, `pushCell`, `getCellCenter`, `delayCommand` | 6 | Simulation |

Note `entity.sprite`: real game AI reaches for a sprite from inside a thinker,
nine times over. "Actors do not hold sprites" therefore needs a designed answer
rather than a prohibition — most likely the game's own actor wrapper holds the
sprite while the Simulation actor holds an id.

### 4.8 Tag grid — **done**

`libs/tag-grid` (`TagGrid.js`, 170). Tags on cells: add, remove, query, remove
over a painted region, and `visit(from, to)` diffing two positions into
enter/leave events. `loadLevel` already hands back the level's `tags` section
untouched.

Depends on: `@laboralphy/grid` (**ported**), `libs/quote-split` (15, parses
`tag(arg, "quoted arg")`), `libs/painting` (78, flood fill — used only by
`removeTagRegion`).

**Done:** `src/simulation/TagGrid.ts`, with `quoteSplit` and `floodFill` in
Core. Tags are interned against numeric ids, so the same text over a whole room
is one id and retiring it is one `removeTagRegion`. Off-map reads answer as an
empty cell rather than throwing, which matters because an actor's previous cell
starts at (-1, -1). Two bugs came out of it — see the list in [PORT_NOTES.md](PORT_NOTES.md).

### 4.9 Trigger dispatch — **done**

`TagManager` (94) and `Engine._tagEnter`/`_tagLeave`/`_tagPush`/`addTag`/`tags`
(797-835). Turns grid visits into enter/leave/push events and parses tag
commands.

Upstream this couples to entities; under §4.6 it couples to actor ids instead,
which is also what makes it usable when there is more than one player.

**Done:** `src/simulation/TagTriggers.ts`. It consumes the `ActorFrame` the
registry already produces, so only actors that moved are considered and a room
of static scenery costs nothing. Its bookkeeping is its own map of id to last
cell, rather than stashed inside each actor's user data as upstream did.

### 4.10 Scheduling — **done**

`Scheduler` (84), `Engine.delayCommand` (774-784), `cancelCommand` (785-796).

Delay, loop and cancel commands against the simulation clock. It takes a tick
count rather than reading a clock, so it is deterministic — which is what moves
it inside the perimeter rather than out with the loop.

**Done:** `src/simulation/Scheduler.ts`. Commands due in a tick are collected
before any of them runs, so one that schedules another does not have it fire in
the same tick. A repeat still catches up across a skipped interval, but a
non-positive interval is now rejected instead of hanging.

Not serialisable, deliberately: a command is a function. A game that needs a
delayed effect to survive a save records its own intent and re-schedules on
load.

### 4.11 Vector maths — **done**

`libs/geometry` (`index` 108, `Vector` 152, `Point` 26). Needed by §4.5.
`src/core/geometry.ts` already covers distance, `circleInRect` and `linear`;
take only what collision actually uses rather than the whole module.

**Done:** `src/core/Vector.ts` plus `angle` added to `core/geometry.ts`.
Measured first — collision touches only `add`, `sub`, `scale`, `normalize`,
`squareDistance`, `distance` and `angle`. Two changes from the original: its
single `mul` returned either a vector or a dot product depending on its
argument's type, split here into `mul` and `dot`; and `normalize()` no longer
divides by zero. The mixed mutability is preserved and documented, because
`v.normalize().scale(n)` depends on it.

`angle` is the only transcendental the tier pulls in, and only `Dummy.angleTo`
— a query — uses it, so lockstep simulation is not exposed to `Math.atan2`
being unspecified in precision.

### 4.12 Position — `take`, 56 lines

`Position` (56). `vector()` and `front(d)` are the useful parts. Fold into the
actor type rather than shipping a module.

### 4.13 Save / restore — **done**

`Engine.getEngineState`/`setEngineState` (1499-1515), `getDoorManagerState`/
`setDoorManagerState` (1516-1528). Serialises door phases, locks, tags and the
clock. Every Simulation subsystem needs the same pair — see §5.

**Done.** `DoorPolicy.state` carries doors *and* locks — a lock outlives the
door context, since a door that has closed and retired is still locked.
`TagGrid.state` round-trips ids as well as text, so an event's `remove()` still
names the right tag after a load. `ActorRegistry.state` carries positions,
sizes, refs and user data, and restoring reports every actor as moved so a view
catches up; behaviour is not restored, because a thinker is code, and `ref` is
what the game reattaches by.

`tests/simulation/saveRestore.test.ts` puts a whole world — a door caught
mid-slide, a lock, tags and actors — through `JSON.stringify` and back, then
ticks both for 300 steps and asserts they stay identical.

---

## 5. What the headless-server test demands

Simulation is the part a multiplayer server would run with no canvas: accept input,
tick, emit deltas. Four constraints follow, and they are cheap to adopt now.

**Deltas are the house pattern.** `DoorManager.process()` already returns
`DoorCellUpdate[]` — `{x, y, phys, offset}` per door. That is a wire format.
Every Simulation subsystem should return what changed, not just mutate.

**Snapshots on every subsystem.** `getState`/`setState`, as `DoorContext`
already has. Late joiners and reconnects need them; §2.3 is the outstanding gap.

**No single-actor assumption.** Collision and triggers take an actor identity,
never "the player". This is where the original would have bitten hardest —
`Engine` held one camera and one horde.

**Instantiable N times.** One process, many rooms. No module-level mutable
state. `DoorManager` passes today; keep it that way as the tier grows.

### Determinism

Only relevant if server *and* client both simulate (prediction and
reconciliation). Across all of Simulation today there are exactly two
transcendental calls, both in optional easing curves — `sine` and `cosine`,
`Easing.ts:51-52`. Everything else is `+ - * /` and `min`/`max`, which are
IEEE-754 exact and identical across JS engines.

`Math.sin` is not specified to any precision by ECMAScript, so if both sides
simulate, avoid those two curves or replace them with polynomial
approximations. Watch for the same when porting §4.5, and prefer `Math.sqrt`
(IEEE-exact) over `Math.atan2` where there is a choice.

Time is already ticks, not wall-clock: `DoorContext` counts `_time` down per
`process()` call, with no `Date.now()` anywhere. The caller decides what a tick
is, which is what a fixed-timestep server needs.

---

## 6. Game tier and out of scope

### 6.1 Game loop — `skip`, ~95 lines

`Engine.startDoomLoop` (514-521), `stopDoomLoop` (522-535), `_update`
(403-439), `_render` (440-469), `getTime`, `timeInterval`. A fixed-timestep
loop driving doors, the scheduler, the horde and rendering. Worth *documenting*
as a pattern in the demo rather than shipping — it is the one thing whose owner
defines the tier boundary.

### 6.2 Asset registry — `skip`, ~35 lines

`Engine.loadTileSet` (907-931), `getTileSet` (917). `loadLevel` already returns
the tilesets a level referenced, decoded and undecorated.

### 6.3 Canvas and screenshots — `skip`, ~84 lines

`Engine.setRenderingCanvas` (484-497), `getRenderingContext` (506),
`screenshot` (470-483), `initializeCamera` (133-143). The caller wires its own
canvas; `Renderer.renderCanvas` is exposed.

### 6.4 Visual filters — `skip` here, separate package

`engine/filters/`: `Blur` (64), `FadeIn` (36), `FadeOut` (37), `Flash` (59),
`Foreground` (30), `Halo` (54), `Link` (43), `Pulse` (93), `Timed` (38); plus
`libs/filters` `AbstractFilter` (85), `FilterManager` (79). **642 lines.**

They post-process a finished canvas, so they need neither Rendering nor Simulation —
only a `CanvasRenderingContext2D`. That makes them a clean standalone package,
usable by any canvas project, rather than a third entry point here.

### 6.5 Events plumbing — `skip`

`level.loading` progress, `level.load`, via `events`. `TypedEmitter` is already
ported for the door layer; whoever owns the loop emits what it likes.

### 6.6 Camera — `skip`, 6 lines

`Camera` is an `Entity` subclass. Under §4.6 the camera is just an actor the
game marks as the viewpoint.

### 6.7 Misc helpers — `skip`

`libs/object-helper` (`Extender`, deep merge), `libs/levenshtein` (`suggest`,
for "did you mean"), `libs/json-validate` (10 lines over `jsonschema` —
replaced by the `validate` hook, §11 of the migration doc), `libs/canvas-helper`
(replaced by `loadImage`).

### 6.8 `Engine.js` as a class — `never`

Not a feature but a shape. It is 1,529 lines because it became the place
anything cross-cutting landed: it owned the loop, held the canvas, loaded
assets, ran the AI, and every subsystem reached the others through it.

**The guard is not a line budget.** It is this: every Simulation module must be
constructible and testable on its own, with no reference to a central object.
`DoorManager` passes that test today. Ask it of each new one.

---

## 7. Phases

Ordered by dependency, and by what gets expensive to change later.

**A — structural. Done.** Everything else is built on it.
1. ~~Extract `CellMap` from `Renderer`~~ (§2.1)
2. ~~No-DOM tsconfig for `src/simulation/`~~ (§2.2)
3. ~~`DoorManager` state setter~~ (§2.3)

**B — cells and doors. Done.** Completed the half-built door layer.
4. ~~Door policy~~ (§4.1)
5. ~~Cell helpers~~ (§4.3)
6. ~~Secret passages~~ (§4.2)

**C — movement. Done.** Actors can now be pushed around a map.
7. ~~`wall-collider`~~ (§4.4)
8. ~~Vector subset~~ (§4.11)
9. ~~Sector registry, then `Smasher` + `force-field`~~ (§4.5)

**D — actors.** The seam that decides whether Simulation is really renderer-free.
10. Sprite-free actor type + registry (§4.6)
11. Thinker base, mover, tangible, static, missile, FPS control (§4.7)

    Design the actor/sprite binding first: mansion's AI reaches for
    `entity.sprite` nine times, so the answer has to be a mechanism, not a ban.

**E — triggers and scheduling. Done.**
12. ~~Tag grid~~ (§4.8)
13. ~~Trigger dispatch, actor-agnostic~~ (§4.9)
14. ~~Scheduler~~ (§4.10)
15. ~~Save/restore across every subsystem~~ (§4.13, §5)

**F — Rendering finish. Done.** Levels now load with their scenery.
16. ~~`blueprints` / `tilesets` merged into `LoadLevelOptions`~~ (§3.1)
17. ~~Decorative objects~~ (§3.1)
18. ~~Sprite facing from camera angle~~ (§3.2)

### Totals

Phases A, B, C and F are done. Rendering is complete: a saved level now loads
with its architecture, decals, lights *and* its scenery. Simulation stands at
1,770 lines — doors, door
policy, secret passages, locks, save/restore, wall sliding, actor collision and
the sector grid — with 1,234 lines of tests, two of them differential against
the original. Core gained `CellMap`, `cells.ts` and `Vector`.

What remains, if taken as recommended:

| Tier | Lines | Note |
|---|---|---|
| Rendering — remaining | — | complete |
| Simulation — remaining | — | complete, less the thinkers (§4.7, declined) |
| Game / out | ~853 | loop, assets, canvas, events, camera, misc |
| Separate package | 642 | filters |
| Never | 1,529 | `Engine.js` as a class |

Simulation grew by 287 and Game shrank by the same, because
`FPSControlThinker` moved in (§4.7).

The acceptance test for the whole thing, now that no game is being ported:
each demo under `demos/` grows to exercise the subsystems it needs while its
`main.ts` stays the only file touching the browser — and Simulation alone runs a room in Node with no
canvas.
