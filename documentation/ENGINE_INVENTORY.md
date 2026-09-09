# Inventory of `libs/engine`

Everything the original engine does, sorted by which tier it belongs to, so that
scope stays a decision that can be revisited rather than an assumption.

Source of truth is `_OLD_PROJECT_/`, the imported copy of the original
`o876-raycaster-engine`. Line numbers refer to it and were measured.

**Totals.** `libs/engine/` is 3,668 lines, of which `Engine.js` alone is 1,529.
The collision, tag and geometry machinery it pulls from `libs/` adds ~1,100.

## The rule

| Tier | Owns | Never |
|---|---|---|
| **1. Renderer** — `raycaster-386` | Turning world state into pixels: map rendering, textures, lighting, sprites, level loading. | Time. Input. I/O. |
| **2. Simulation** — `raycaster-386/engine` | Advancing world state by a tick: doors, movement, collision, triggers, actors. | Importing tier 1. Owning a loop. Touching the DOM. |
| **3. Game** — the caller | The loop, input, rules, assets, audio, UI. | — |

**The invariant is the arrow: tier 2 never imports tier 1.** That single
constraint is what stops an `Engine` god object from forming, because such an
object exists precisely to hold both sides at once. A feature that cannot be
written without reaching across belongs in tier 3.

`src/engine/index.ts` already states this for the door layer. The rest of this
document applies it to everything else.

**The acceptance test is a headless server.** If tier 2 can run a game room in
Node with no canvas — accepting input, ticking, and emitting deltas — the
separation is real. If it cannot, something has been put in the wrong tier.
See §5.

## Verdicts

| Mark | Meaning |
|---|---|
| **done** | already in this port |
| **take** | belongs in the perimeter; port it |
| **split** | part belongs here, part does not; the row says where the seam is |
| **skip** | tier 3 or out of scope; the demo shows a caller doing it |
| **never** | actively unwanted, with a reason |

---

## 1. Already ported

| Feature | Original | Now | Tier |
|---|---|---|---|
| Level building | `Engine.buildLevel` (1157-1498, 342 lines) | `src/level/` | 1 |
| Door animation | `DoorContext` (207), `DoorManager` (67) | `src/engine/` | 2 |
| Easing curves | `libs/easing` (207) | `src/engine/Easing.ts` | 2 |
| Light sources | `Engine.createLightSource`/`removeLightSource` (1129-1156) | `Renderer.addLightSource` | 1 |
| Renderer options | `Engine.initializeRenderer`, `updateRaycasterOption` (113-152) | typed setters | 1 |
| Symbol resolution | `libs/translator` (92), non-strict | `src/level/constants.ts`, strict | 1 |
| Texture decoding | `libs/canvas-helper` | the caller's `loadImage` | 3 |
| Marker sets | `libs/marker-registry` | `src/core/MarkerRegistry.ts` | shared |
| 2D grid | `@laboralphy/grid` | `src/core/Grid.ts` | shared |

---

## 2. Structural work — do this before anything else

Three changes that cost little now and a great deal after collision, triggers
and actors have been built on the current shape.

### 2.1 Extract `CellMap` from `Renderer` — `take`, structural

`Renderer.ts:128` owns `private _map = new CellMap()`, and `getCellPhys`
(371), `setCellPhys` (349) and `getCellMaterial` (367) are renderer methods.

Collision, doors and triggers all need to ask what is in a cell. As it stands,
a headless server would have to construct a `Renderer` — with its tilesets,
canvas and light map — purely to answer that question.

`CellMap` itself is already pure: a flat `Uint32Array` and some bit masks, no
DOM, no imports beyond `consts`. **It is world state that happens to live in
the render tier.** Hand it to the renderer instead of hiding it inside one.

`CellSurfaceManager` (decals, light strips) and `LightMap` stay in tier 1 —
those genuinely are appearance.

### 2.2 Enforce the no-DOM rule — `take`, ~10 lines of config

`tsconfig.json` sets `lib: ["ES2022", "DOM"]` for all of `src`, so nothing
stops a future tier-2 file from reaching for `document`. Give `src/engine/` its
own tsconfig with `lib: ["ES2022"]` and no DOM, and a violation becomes a
typecheck failure rather than something a reviewer has to notice.

The same trick already keeps Node types out of `src` via `types: []`.

Audited today: `src/engine/` has **zero** references to `document`, `window`,
`HTMLCanvas`, `Image`, `requestAnimationFrame` or `performance`.

### 2.3 `DoorManager` state setter — `take`, ~15 lines

`DoorManager` has a `state` getter and no setter. The original restored by
replaying `openDoor` and then forcing each context's phase
(`Engine.setDoorManagerState`, 1520-1528) — and `openDoor` is §4.1 below.

`DoorContext.setState` already round-trips correctly, replaying each phase so
listeners see the live sequence. Only the manager-level restore is missing.
Multiplayer promotes this from a nice-to-have to a requirement: reconnect and
late-join both need it.

---

## 3. Tier 1 — the renderer

### 3.1 Decorative objects — `take`, ~120 lines

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
| `blueprint.size` | reported, not acted on — a tier-2 collision radius |
| `blueprint.thinker` | reported; "do nothing" in every shipped level |

Animation definitions live on the tileset and are already in the right shape —
a torch is `{id: "default", start: [0,0,0,0,0,0,0,0], length: 4, duration: 120,
loop: "@LOOP_FORWARD"}`, which is exactly `Sprite.buildAnimation`'s
array-of-starts form.

Best as a separate `buildObjects(rc, loaded)` call rather than a `loadLevel`
flag, so a game with its own object handling does not pay for one it discards.

### 3.2 Sprite facing — `take`, ~20 lines

`Horde.updateLookingAngle` (`Horde.js:67-86`) picks a sprite's directional
frame from the camera angle. That is a sprite concern sitting inside the entity
registry; `src/Sprite.ts` is already ported and `setDirection` is already there.
Lift it alone, into tier 1, and leave `Horde` to §4.6.

---

## 4. Tier 2 — the simulation

Everything here manipulates world state as plain data. None of it needs a
canvas. Roughly **2,400 lines** on top of the 274 already ported.

### 4.1 Door policy — `take`, ~213 lines

`Engine._checkDoorClosability` (317-331), `_buildDoorContext` (332-387),
`_doorProcess` (388-402), `openDoor` (619-646), `lockDoor` (647-663),
`closeDoor` (664-676), `isDoor` (688-704), `isDoorClosed` (722-740),
`isDoorOpen` (741-752), `isDoorLocked` (753-773).

`DoorContext` animates a door; this decides which cells *are* doors, builds a
context from a cell's phys code, and handles autoclose, locking and refusing to
close on whatever stands in the doorway. Without it, opening a door means
writing the policy yourself, as `demo/world.ts` does.

The missing half of something already ported, and it closes §2.3.

Depends on: `DoorContext`, `MarkerRegistry` (locks), `CellMap` (§2.1). The
closability check takes a callback, so it need not know about actors.

### 4.2 Secret passages — `take`, ~143 lines

`Engine._forEachNeighbor` (209-251), `_buildSecretDoorContext` (252-316),
`_getSecretNeighborDoorContext` (601-618), `isSecretBlock` (705-721).

A block that recesses and drags its neighbour with it. Pure cell-offset work;
the recessed-wall geometry it relies on (`projectRay.sameOffsetWall`) is
already ported and golden-tested.

Depends on: §4.1.

### 4.3 Cell helpers — `take`, ~76 lines

`Engine.cellSize` (536-548), `getCellCenter` (549-562), `clipCell` (563-573),
`alterBlock` (574-588), `pushCell` (589-600), `getCellType` (677-687).

Clamp a coordinate into the map, find a cell's centre in world units, swap a
cell's material by its legend `ref` — `loadLevel` already returns those `ref`
strings. These become methods on the extracted `CellMap` (§2.1) rather than on
the renderer.

`pushCell` takes an entity upstream, but only to read its position.

### 4.4 Wall collision — `take`, 84 lines

`libs/wall-collider`. Slides a circle along walls instead of letting it stick.

**Zero imports** — the only file in this inventory with no dependencies at all,
and the cheapest thing here to port. `demo/world.ts` already hand-rolls a
version of it off `getCellPhys`.

### 4.5 Actor collision — `take`, ~533 lines

`libs/smasher` (`Smasher` 219, `Dummy` 146), `libs/force-field` (59),
`libs/sector-registry` (`SectorRegistry` 68, `Sector` 41).

Circle-versus-circle collision over a coarse sector grid, with push vectors.
Self-contained: geometry and events, no renderer.

Depends on: `libs/geometry` + `Vector` (286 total; take the subset actually
used), `libs/array-helper` (109, for `Sector`), `@laboralphy/grid`
(**ported**), `events` (replace with the ported `TypedEmitter`).

### 4.6 Actors — `split`, ~448 lines

`Entity` (136), `Horde` (171), `Engine.createEntity` (988-1057),
`destroyEntity` (1058-1076), `linkEntityLightSource` (1077-1092),
`_syncEntityDummy` (1093-1105), `_smashEntity` (1106-1128).

**This is the most important seam in the migration.** Upstream, `Entity` holds
a `.sprite` — a tier-1 object. A tier-2 actor must hold position, size, inertia
and state plus an opaque id; binding that id to a `Sprite` is the game's job,
or a thin tier-1 adapter's.

Cut that link and the same actor code runs on a server with no renderer. Leave
it and tier 2 imports tier 1, and the whole separation collapses.

`Blueprint` (21) similarly splits: the tileset/animation half is tier-1 sprite
construction (§3.1), the size/behaviour half is a tier-2 actor template.

`linkEntityLightSource` reaches into the renderer's light list — in tier 2 it
becomes "this actor emits light", reported as data, applied by whoever owns
both.

### 4.7 Behaviour — `split`, ~477 of 785 lines

`thinkers/`: `Thinker` (102), `MoverThinker` (139), `TangibleThinker` (44),
`StaticThinker` (17), `StaticTangibleThinker` (18), `MissileThinker` (157).

Movement and projectile maths over actors. A base class the *game* subclasses
and the simulation ticks is a callback, not inversion of control, so it passes
the rule.

`FPSControlThinker` (287) reads the keyboard and mouse — **tier 3**. It is the
player controller, and belongs in the demo. Plus `Engine._useThinker`,
`useThinkers`, `createThinkerInstance` (836-906): a string-keyed registry with
Levenshtein "did you mean" suggestions — replace with passing constructors.

### 4.8 Tag grid — `take`, 172 lines

`libs/tag-grid` (`TagGrid.js`, 170). Tags on cells: add, remove, query, remove
over a painted region, and `visit(from, to)` diffing two positions into
enter/leave events. `loadLevel` already hands back the level's `tags` section
untouched.

Depends on: `@laboralphy/grid` (**ported**), `libs/quote-split` (15, parses
`tag(arg, "quoted arg")`), `libs/painting` (78, flood fill — used only by
`removeTagRegion`).

### 4.9 Trigger dispatch — `take`, ~133 lines

`TagManager` (94) and `Engine._tagEnter`/`_tagLeave`/`_tagPush`/`addTag`/`tags`
(797-835). Turns grid visits into enter/leave/push events and parses tag
commands.

Upstream this couples to entities; under §4.6 it couples to actor ids instead,
which is also what makes it usable when there is more than one player.

### 4.10 Scheduling — `take`, ~107 lines

`Scheduler` (84), `Engine.delayCommand` (774-784), `cancelCommand` (785-796).

Delay, loop and cancel commands against the simulation clock. It takes a tick
count rather than reading a clock, so it is deterministic and serialisable —
which is what moves it inside the perimeter rather than out with the loop.

### 4.11 Vector maths — `take`, subset of 286 lines

`libs/geometry` (`index` 108, `Vector` 152, `Point` 26). Needed by §4.5.
`src/core/geometry.ts` already covers distance, `circleInRect` and `linear`;
take only what collision actually uses rather than the whole module.

### 4.12 Position — `take`, 56 lines

`Position` (56). `vector()` and `front(d)` are the useful parts. Fold into the
actor type rather than shipping a module.

### 4.13 Save / restore — `take`, ~31 lines

`Engine.getEngineState`/`setEngineState` (1499-1515), `getDoorManagerState`/
`setDoorManagerState` (1516-1528). Serialises door phases, locks, tags and the
clock. Every tier-2 subsystem needs the same pair — see §5.

---

## 5. What the headless-server test demands

Tier 2 is the part a multiplayer server would run with no canvas: accept input,
tick, emit deltas. Four constraints follow, and they are cheap to adopt now.

**Deltas are the house pattern.** `DoorManager.process()` already returns
`DoorCellUpdate[]` — `{x, y, phys, offset}` per door. That is a wire format.
Every tier-2 subsystem should return what changed, not just mutate.

**Snapshots on every subsystem.** `getState`/`setState`, as `DoorContext`
already has. Late joiners and reconnects need them; §2.3 is the outstanding gap.

**No single-actor assumption.** Collision and triggers take an actor identity,
never "the player". This is where the original would have bitten hardest —
`Engine` held one camera and one horde.

**Instantiable N times.** One process, many rooms. No module-level mutable
state. `DoorManager` passes today; keep it that way as the tier grows.

### Determinism

Only relevant if server *and* client both simulate (prediction and
reconciliation). Across all of tier 2 today there are exactly two
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

## 6. Tier 3 and out of scope

### 6.1 Game loop — `skip`, ~95 lines

`Engine.startDoomLoop` (514-521), `stopDoomLoop` (522-535), `_update`
(403-439), `_render` (440-469), `getTime`, `timeInterval`. A fixed-timestep
loop driving doors, the scheduler, the horde and rendering. Worth *documenting*
as a pattern in the demo rather than shipping — it is the one thing whose owner
defines the tier boundary.

### 6.2 Player control — `skip`, 287 lines

`FPSControlThinker`. Reads input devices; see §4.7.

### 6.3 Asset registry — `skip`, ~35 lines

`Engine.loadTileSet` (907-931), `getTileSet` (917). `loadLevel` already returns
the tilesets a level referenced, decoded and undecorated.

### 6.4 Canvas and screenshots — `skip`, ~84 lines

`Engine.setRenderingCanvas` (484-497), `getRenderingContext` (506),
`screenshot` (470-483), `initializeCamera` (133-143). The caller wires its own
canvas; `Renderer.renderCanvas` is exposed.

### 6.5 Visual filters — `skip` here, separate package

`engine/filters/`: `Blur` (64), `FadeIn` (36), `FadeOut` (37), `Flash` (59),
`Foreground` (30), `Halo` (54), `Link` (43), `Pulse` (93), `Timed` (38); plus
`libs/filters` `AbstractFilter` (85), `FilterManager` (79). **642 lines.**

They post-process a finished canvas, so they need neither tier 1 nor tier 2 —
only a `CanvasRenderingContext2D`. That makes them a clean standalone package,
usable by any canvas project, rather than a third entry point here.

### 6.6 Events plumbing — `skip`

`level.loading` progress, `level.load`, via `events`. `TypedEmitter` is already
ported for the door layer; whoever owns the loop emits what it likes.

### 6.7 Camera — `skip`, 6 lines

`Camera` is an `Entity` subclass. Under §4.6 the camera is just an actor the
game marks as the viewpoint.

### 6.8 Misc helpers — `skip`

`libs/object-helper` (`Extender`, deep merge), `libs/levenshtein` (`suggest`,
for "did you mean"), `libs/json-validate` (10 lines over `jsonschema` —
replaced by the `validate` hook, §11 of the migration doc), `libs/canvas-helper`
(replaced by `loadImage`).

### 6.9 `Engine.js` as a class — `never`

Not a feature but a shape. It is 1,529 lines because it became the place
anything cross-cutting landed: it owned the loop, held the canvas, loaded
assets, ran the AI, and every subsystem reached the others through it.

**The guard is not a line budget.** It is this: every tier-2 module must be
constructible and testable on its own, with no reference to a central object.
`DoorManager` passes that test today. Ask it of each new one.

---

## 7. Phases

Ordered by dependency, and by what gets expensive to change later.

**A — structural.** Do first; everything else is built on it.
1. Extract `CellMap` from `Renderer` (§2.1)
2. No-DOM tsconfig for `src/engine/` (§2.2)
3. `DoorManager` state setter (§2.3)

**B — cells and doors.** Completes a layer that is already half-built.
4. Door policy (§4.1)
5. Cell helpers, onto `CellMap` (§4.3)
6. Secret passages (§4.2)

**C — movement.** Cheapest first; `wall-collider` has no dependencies at all.
7. `wall-collider` (§4.4)
8. Vector subset (§4.11)
9. Sector registry, then `Smasher` + `force-field` (§4.5)

**D — actors.** The seam that decides whether tier 2 is really renderer-free.
10. Sprite-free actor type + registry (§4.6)
11. Thinker base, mover, tangible, static, missile (§4.7)

**E — triggers and scheduling.**
12. Tag grid (§4.8)
13. Trigger dispatch, actor-agnostic (§4.9)
14. Scheduler (§4.10)
15. Save/restore across every subsystem (§4.13, §5)

**F — tier 1 finish.** Independent of B-E; can be done any time.
16. Decorative objects (§3.1)
17. Sprite facing from camera angle (§3.2)

### Totals if taken as recommended

| Tier | Lines | Note |
|---|---|---|
| 1 — new | ~140 | decorative objects, sprite facing |
| 2 — new | ~2,400 | on top of 274 already ported |
| 3 / out | ~1,140 | loop, player control, assets, canvas, misc |
| Separate package | 642 | filters |
| Never | 1,529 | `Engine.js` as a class |

The acceptance test for the whole thing: `games/mansion` runs on tiers 1 and 2
with the game supplying only its loop, input and rules — and tier 2 alone runs
a room in Node with no canvas.
