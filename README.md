# raycaster-386

A raycasting engine for the browser, in TypeScript. Renders like it's 1992;
runs like it isn't.

Textured walls, floors and ceilings, sliding doors and push-wall passages,
billboard sprites with directional facings, traced light sources, distance fog,
wall decals and a second storey — plus a simulation layer for doors, actors,
collisions and triggers that runs just as well on a server with no canvas.

- **No runtime dependencies.** Strict TypeScript, compiled to ES2022, shipped
  as ESM with declarations.
- **The renderer performs no I/O.** You hand it decoded images, and every call
  on it is synchronous.
- **Simulation never imports rendering.** World logic runs headless, in a
  browser, a worker or Node.
- **Deterministic by construction.** Doors, animations and scheduled commands
  advance on ticks you supply, and every stateful piece can be saved and
  restored.
- **Real level format.** Loads RCE-100 levels, the format the MapEdit level
  editor publishes.

## Contents

- [Installation](#installation)
- [Entry points](#entry-points)
- [Quick start](#quick-start)
- [Loading a level](#loading-a-level)
- [The cell map](#the-cell-map)
- [The game loop](#the-game-loop)
- [Simulation](#simulation)
- [Architecture](#architecture)
- [Development](#development)
- [Background](#background)

## Installation

```bash
npm install @laboralphy/raycaster386
```

The package is **ESM only**: load it with `import`, or with `await import()`
from CommonJS. Type declarations are included.

Rendering needs a Canvas 2D implementation — a browser, or a canvas package
under Node. The simulation and the schema need nothing.

## Entry points

| Import | Contains | Runs in |
|---|---|---|
| `@laboralphy/raycaster386` | Core (`CellMap`, `Vector`, geometry, constants) and rendering (`Renderer`, `Sprite`, `MapHelper`, `loadLevel`, `buildObjects`, `SpriteBinding`) | a browser, for rendering |
| `@laboralphy/raycaster386/simulation` | `DoorPolicy`, `ActorRegistry`, `Actor`, `moveActor`, `Smasher`, `TagTriggers`, `Scheduler`, `Easing` | anywhere |
| `@laboralphy/raycaster386/schema` | The RCE-100 JSON schema, as data | anywhere |

Code shared between entry points is emitted once, so a `Vector` imported from
the root is the same class the simulation works with.

## Quick start

A five-by-five room, drawn from a hand-written map:

```ts
import { Canvas, MapHelper, PHYS_NONE, PHYS_WALL, Renderer } from '@laboralphy/raycaster386';
import type { LevelMap } from '@laboralphy/raycaster386';

const level: LevelMap = {
    legend: [
        // Open floor: floor tile 0 and ceiling tile 1 of the flats atlas.
        { code: ' ', phys: PHYS_NONE, faces: { f: 0, c: 1 } },
        // A wall: tile 0 of the walls atlas on all four sides.
        { code: '#', phys: PHYS_WALL, faces: { n: 0, e: 0, s: 0, w: 0 } },
    ],
    map: ['#####', '#   #', '#   #', '#   #', '#####'],
};

// The renderer performs no I/O: decode textures yourself and hand them in.
const [walls, flats] = await Canvas.loadCanvases(['walls.png', 'flats.png']);

const renderer = new Renderer();
renderer.setScreen({ width: 320, height: 200 });
renderer.setMetrics({ spacing: 64, height: 96 });
renderer.setShading({ shades: 16, color: '#000000', filter: null, brightness: 0.1 });
renderer.setWallTextures(walls);
renderer.setFlatTextures(flats);
new MapHelper().build(renderer, level);

const screen = document.querySelector('canvas')!;
const target = screen.getContext('2d')!;
target.imageSmoothingEnabled = false;

let angle = 0;
function draw(): void {
    angle += 0.01;
    // Camera in the middle of cell (2, 2), at standing eye height.
    renderer.render(2.5 * 64, 2.5 * 64, angle, 1);
    const frame = renderer.renderCanvas;
    if (frame !== null) {
        target.drawImage(frame, 0, 0, screen.width, screen.height);
    }
    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
```

`walls.png` is a row of tiles `spacing` wide and `height` tall — 64×96 here —
and `flats.png` a row of 64×64 tiles. Render at a low resolution and let the
canvas scale it up.

Settings are applied lazily: each setter records what it invalidated and the
work happens once, at the top of the next `render()`, so changing several in a
row costs one re-shade.

**Coordinates.** World units are texels, and a cell is `spacing` units wide, so
the centre of cell `(x, y)` is `((x + 0.5) * spacing, (y + 0.5) * spacing)`.
Angles are in radians: `0` looks along +x, and `-Math.PI / 2` looks towards the
top of the map as written. The last argument of `render()` is eye height, where
`1` is standing.

## Loading a level

Real levels are RCE-100 documents, the format the MapEdit level editor
publishes. `loadLevel` applies everything the renderer understands — metrics,
shading, textures, the map, the upper storey, decals and static lights — and
hands back the rest.

```ts
import { Canvas, Renderer, buildObjects, loadLevel } from '@laboralphy/raycaster386';
import type { RceLevel } from '@laboralphy/raycaster386';

const renderer = new Renderer();
// Before loading: the backdrop is scaled to the screen height as it loads.
renderer.setScreen({ width: 320, height: 200 });

const data = (await (await fetch('levels/level-1.rce.json')).json()) as RceLevel;

// Texture paths in the level are relative to wherever its assets live.
const loadImage = (src: string) => Canvas.loadCanvas(`levels/${src}`);

const level = await loadLevel(renderer, data, { loadImage });

// Optional: place the level's decorative objects as sprites.
const objects = await buildObjects(renderer, level, { loadImage });

const spacing = data.level.metrics.spacing;
const start = level.startpoint ?? { x: 1, y: 1, z: 1, angle: 0 };
renderer.render((start.x + 0.5) * spacing, (start.y + 0.5) * spacing, start.angle, start.z);
```

What a renderer cannot act on comes back under `level.unhandled` —
`blueprints`, `objects`, `tags` and `camera` — so a game can build its own
entity tier on top without parsing the file again. `buildObjects` turns
objects into sprites with their animations and lights, and reports each one's
blueprint and collision size without acting on them.

Symbols such as `"@PHYS_WALL"` are resolved strictly: an unknown one throws
rather than passing through as a string.

### Validating levels

Validation is a hook rather than a dependency. The schema ships as data on its
own entry point, so you can check levels while developing and leave both the
schema and the validator out of a release build.

```ts
import { Validator } from 'jsonschema';
import RCE_100_SCHEMA from '@laboralphy/raycaster386/schema';
import { Canvas, Renderer, loadLevel } from '@laboralphy/raycaster386';
import type { RceLevel } from '@laboralphy/raycaster386';

const validator = new Validator();

function validate(data: unknown): void {
    const result = validator.validate(data, RCE_100_SCHEMA as object);
    if (result.errors.length > 0) {
        throw new Error(result.errors[0].stack);
    }
}

const data = (await (await fetch('levels/level-1.rce.json')).json()) as RceLevel;
await loadLevel(new Renderer(), data, { loadImage: Canvas.loadCanvas, validate });
```

`validate` runs before anything is loaded, so a rejected level leaves the
renderer untouched. The schema is the editor's, unmodified: it requires the
`blueprints`, `objects` and `camera` sections, even though this library only
reports them.

## The cell map

A level's grid lives in a `CellMap`: one packed 32-bit integer per cell, read
by the renderer and the simulation alike.

### Dimensions

The map is always square, and `size` is its width and height in cells:

```ts
import { Renderer } from '@laboralphy/raycaster386';

const renderer = new Renderer();
renderer.setMapSize(32);

console.log(renderer.getMapSize()); // 32 cells per side
console.log(renderer.cellMap.size); // 32, read from the map itself
console.log(renderer.cellMap.isInside(31, 31)); // true
console.log(renderer.cellMap.isInside(32, 0)); // false: cells run from 0 to size - 1

// In world units (texels), the map is size × spacing wide.
const worldWidth = renderer.getMapSize() * renderer.metrics.spacing;
```

`MapHelper` and `loadLevel` size the map from the level's grid, so read the
size after loading rather than assuming one. `CellMap.setSize()` resizes and
keeps the cells that still fit; `renderer.setMapSize()` also resizes the
renderer's surface and light buffers, and its upper storey — whose own map,
`renderer.storey?.cellMap`, is always the same size as the ground floor's.

A world position converts to a cell, and back to that cell's centre, with the
cell size from the level's metrics:

```ts
import { cellCenter, worldToCell } from '@laboralphy/raycaster386';

console.log(worldToCell(200, 90, 64)); // { x: 3, y: 1 }
console.log(cellCenter(3, 1, 64)); // { x: 224, y: 96 }
```

`worldToCell` does not clamp: check the result with `isInside()` before using a
position that may be off the map.

### Structure of a cell

Each cell packs three fields into one unsigned 32-bit integer:

```
  bits 31..24   unused
  bits 23..16   offset     0..255    how far a door has slid, or a block is set back
  bits 15..12   phys       0..15     a PHYS_* code: how the cell behaves
  bits 11..0    material   0..4095   which registered material draws its faces
```

**`material`** is the code a material was registered under with
`renderer.registerCellMaterial(code, faces)`, which gives the cell's four walls,
floor and ceiling their tiles. `MapHelper` and `loadLevel` register each legend
entry under its index, so `level.materials[i]` describes material `i`.

**`phys`** decides what the cell does to movement, rays and light:

| Code | Value | Blocks movement | Rendering |
|---|---|---|---|
| `PHYS_NONE` | 0 | no | empty: rays pass through |
| `PHYS_WALL` | 1 | yes | an opaque wall |
| `PHYS_DOOR_UP`, `PHYS_DOOR_DOWN` | 2, 4 | yes | a door sliding up or down; rays see past it once it has moved |
| `PHYS_CURT_UP`, `PHYS_CURT_DOWN` | 3, 5 | yes | a curtain rising or falling, likewise |
| `PHYS_DOOR_LEFT`, `PHYS_DOOR_RIGHT` | 6, 7 | yes | a door sliding sideways, likewise |
| `PHYS_DOOR_DOUBLE` | 8 | yes | a double door parting in the middle, likewise |
| `PHYS_SECRET_BLOCK` | 9 | yes | a wall set back by `offset`: a push-wall passage |
| `PHYS_TRANSPARENT_BLOCK` | 10 | yes | drawn, and rays continue behind it: bars, windows |
| `PHYS_INVISIBLE_BLOCK` | 11 | yes | not drawn at all |
| `PHYS_OFFSET_BLOCK` | 12 | yes | a wall set back by `offset` |

A door stops blocking movement because `DoorPolicy` writes `PHYS_NONE` into its
cell while it stands open, and the shut code back when it closes. Light passes
through `PHYS_NONE`, transparent and invisible blocks; every other code blocks
it.

**`offset`** is 0 for most cells. For a door it is how far the door has slid,
in texels, as reported each tick by `doors.process()`; for an offset or secret
block, how far the wall is set back.

### Reading and writing cells

```ts
import { CellMap, PHYS_DOOR_UP, PHYS_WALL, materialOf, offsetOf, physOf } from '@laboralphy/raycaster386';

const map = new CellMap();
map.setSize(16);

map.setMaterial(3, 4, 2);
map.setPhys(3, 4, PHYS_DOOR_UP);
map.setOffset(3, 4, 32);

const code = map.get(3, 4); // all three fields in one number
console.log(materialOf(code), physOf(code), offsetOf(code)); // 2 2 32

console.log(map.getPhys(-1, 0) === PHYS_WALL); // true: outside the map reads as a wall
map.set(99, 99, 0); // ignored: writes outside the map are dropped
```

Every accessor is bounds-checked. Code that needs raw speed can read
`map.data`, a `Uint32Array` stored row-major — cell `(x, y)` is at index
`y * size + x` — and unpack it with the exported `CELL_MATERIAL_MASK`,
`CELL_PHYS_SHIFT`, `CELL_PHYS_MASK`, `CELL_OFFSET_SHIFT` and `CELL_OFFSET_MASK`.

**With a renderer, write through the renderer.** `renderer.cellMap` is a
read-only view, because a phys change must also re-trace the lights around the
cell: use `renderer.setCellMaterial()`, `setCellPhys()` and `setCellOffset()`,
and their `getCell…()` counterparts. Without a renderer, the `CellMap` is yours
to write to directly, as in [Running headless](#running-headless).

## The game loop

The library draws and it simulates; **your game owns the loop**. A tick
advances the simulation, and two pieces of plain data cross from the
simulation to the renderer: door cell updates, and an `ActorFrame` of what
moved.

```ts
import { Renderer, SpriteBinding, Vector } from '@laboralphy/raycaster386';
import { ActorRegistry, DoorPolicy, moveActor } from '@laboralphy/raycaster386/simulation';
import type { MotionContext, Thinker } from '@laboralphy/raycaster386/simulation';

const TICK_MS = 1000 / 60;
const spacing = 64;

const renderer = new Renderer();
// ...screen, metrics, textures and map, as in the quick start.

const actors = new ActorRegistry<MotionContext>();
// One sector per cell, so "who is standing here" is a lookup.
actors.setSectors(renderer.getMapSize(), spacing);

const doors = new DoorPolicy({
    map: renderer.cellMap,
    metrics: renderer.metrics,
    // A door never closes on anyone standing in it.
    isCellOccupied: (x, y) => actors.actorsAt(x, y).length > 0,
});

// Behaviour lives in thinkers. Fill `keys` from your input handling.
const keys = { forward: 0, turn: 0 };
const walker: Thinker<MotionContext> = {
    think(actor, context) {
        const p = actor.position;
        p.angle += keys.turn * 0.05;
        const step = new Vector(Math.cos(p.angle), Math.sin(p.angle)).scale(keys.forward * 3);
        moveActor(actor, context, step); // slides along walls
    },
};

const player = actors.spawn({ x: 2.5 * spacing, y: 2.5 * spacing, size: 12 });
player.thinker = walker;

const binding = new SpriteBinding(renderer);

function tick(): void {
    // 1. Behaviour: every actor's thinker runs.
    const frame = actors.process({ map: renderer.cellMap, spacing });

    // 2. Doors: apply each cell update to the renderer.
    for (const { x, y, offset, phys } of doors.process()) {
        renderer.setCellOffset(x, y, offset | 0);
        renderer.setCellPhys(x, y, phys);
    }

    // 3. Actors: move every bound sprite, its light and its facing.
    binding.apply(frame, player.position);

    // 4. Texture and sprite animations run on the simulation's clock.
    renderer.computeAnimations(TICK_MS);
}

let previous = performance.now();
let carry = 0;
function loop(now: number): void {
    // A fixed step, so door timing does not depend on the frame rate.
    carry += Math.min(now - previous, 250);
    previous = now;
    while (carry >= TICK_MS) {
        tick();
        carry -= TICK_MS;
    }
    const p = player.position;
    renderer.render(p.x, p.y, p.angle, 1);
    // ...copy renderer.renderCanvas to the screen, as in the quick start.
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

The renderer knows which cell is under the crosshair, which is the usual way to
open a door:

```ts
import type { Renderer } from '@laboralphy/raycaster386';
import type { DoorPolicy } from '@laboralphy/raycaster386/simulation';

function use(renderer: Renderer, doors: DoorPolicy): void {
    const aimed = renderer.aimedCell;
    if (aimed !== null && doors.isDoor(aimed.xCell, aimed.yCell)) {
        doors.openDoor(aimed.xCell, aimed.yCell, true); // true: closes again by itself
    }
}
```

### Sprites

A sprite draws from a tileset, and is tied to an actor by its id. Bind it once;
`binding.apply()` does the rest every tick, and disposes the sprite and its
light when the actor is removed.

```ts
import { ANIM_LOOP_FORWARD, Canvas, Renderer, SpriteBinding } from '@laboralphy/raycaster386';
import { ActorRegistry } from '@laboralphy/raycaster386/simulation';

const renderer = new Renderer();
const binding = new SpriteBinding(renderer);
const actors = new ActorRegistry();

const guard = actors.spawn({ x: 320, y: 160, size: 10, ref: 'guard' });

const tileset = renderer.buildTileSet(await Canvas.loadCanvas('guard.png'), 64, 96);
const sprite = renderer.buildSprite(tileset);
// Four frames per facing, eight facings laid end to end: starts at 0, 4, 8...
sprite.buildAnimation(
    {
        starts: Array.from({ length: 8 }, (_, facing) => facing * 4),
        length: 4,
        duration: 150,
        loop: ANIM_LOOP_FORWARD,
    },
    'walk'
);
sprite.setCurrentAnimation('walk');

const light = renderer.addLightSource(guard.position.x, guard.position.y, 24, 110, 0.6);
binding.bind(guard.id, sprite, { light });
```

`starts` holds one first tile per facing; a single entry is a sprite that looks
the same from every side. The binding picks the facing from the actor's angle
and the camera's position. Animation `duration` is in the unit you pass to
`computeAnimations` — milliseconds in the loop above.

## Simulation

Everything here comes from `@laboralphy/raycaster386/simulation`, holds no
reference to a renderer, and advances only when you call it.

### Doors

`DoorPolicy` reads a cell's phys code to know what is a door and how it moves:
`PHYS_DOOR_UP`, `PHYS_DOOR_DOWN`, `PHYS_DOOR_LEFT`, `PHYS_DOOR_RIGHT` and
`PHYS_DOOR_DOUBLE` slide, `PHYS_CURT_UP` and `PHYS_CURT_DOWN` are curtains, and
`PHYS_SECRET_BLOCK` is a push-wall passage: the block recesses and shoves the
one behind it back.

- `openDoor(x, y, autoclose)`, `closeDoor(x, y)` and `lockDoor(x, y, locked)`
  drive them. A closing door that finds something in the way waits and retries.
- `doors.events` emits `opened`, `closing`, `closed` and `locked`.
- `slidingDuration` and `maintainDuration` set timings, in ticks.
  `openFunction` and `closeFunction` take an easing name or function.
- `doorShape(code, phys)` gives one kind of door its own travel, speed or
  easing — a heavy stone slab next to a light wooden door.

### Actors and thinkers

An `Actor` is a position, a size, a collision body and a `thinker`. It holds no
sprite and no light, which is what lets it exist on a server. `ActorRegistry`:

- `spawn(init)` creates one; `ref` and `data` are yours to use.
- `process(context)` runs every thinker, then returns an `ActorFrame`: the
  actors that moved, and the ids removed. Setting `actor.dead = true` removes
  an actor on the next tick.
- A `Thinker` has `think(actor, context)`, plus optional `attach` and `detach`.
  The context type is whatever your game passes to `process()`.

### Collision

- **Against walls:** `moveActor(actor, context, v)` slides an actor along
  whatever is solid and returns how far it really went. Pass `crashWall` to stop
  dead instead, as a projectile would. `computeWallCollisions` is the primitive
  underneath.
- **Between actors:** `Smasher` compares circles over a sector grid and adds a
  separating force to each overlapping actor's `dummy.force`. It moves nothing:
  applying the force is your decision.

### Tags and triggers

A tag is a command string attached to cells — `teleport 12 3`, or
`sound "door open"` — which is how the editor stores triggers. `TagTriggers`
turns movement across tagged cells into events:

```ts
import { ActorRegistry, TagTriggers } from '@laboralphy/raycaster386/simulation';

const actors = new ActorRegistry();
const tags = new TagTriggers();
tags.setMapSize(32, 64); // map size in cells, cell size in world units
tags.grid.addTag(4, 7, 'teleport 12 3');

tags.events.on('enter', (event) => {
    if (event.command === 'teleport') {
        const [x, y] = event.parameters.map(Number);
        console.log(`actor ${event.actor} wants to go to ${x}, ${y}`);
        event.remove(); // a one-shot trigger retires its whole region
    }
});

// Every tick, after the registry:
tags.process(actors.process(undefined));
```

`enter` and `leave` fire as actors cross cells; `tags.push(actorId, x, y)` fires
`push` for a solid cell someone tried to use. Loaded levels report their tags
under `level.unhandled.tags`.

### Scheduling and easing

`Scheduler` runs commands on the simulation's clock rather than the wall
clock's, so a paused or replayed game stays in step:

```ts
import { Easing, Scheduler } from '@laboralphy/raycaster386/simulation';

const scheduler = new Scheduler();
scheduler.delay(() => console.log('two seconds of ticks later'), 120);
const heartbeat = scheduler.loop(() => console.log('beat'), 60);
scheduler.cancel(heartbeat);

let tick = 0;
scheduler.schedule(++tick); // call once per tick

const fade = new Easing({ from: 0, to: 1, steps: 30, use: 'smoothstep' });
while (!fade.over()) {
    fade.compute();
    console.log(fade.y);
}
```

### Save and restore

Actors, doors and tags expose their state as plain, JSON-safe data:

```ts
import type { ActorRegistry, DoorPolicy, TagTriggers } from '@laboralphy/raycaster386/simulation';

function save(actors: ActorRegistry, doors: DoorPolicy, tags: TagTriggers): string {
    return JSON.stringify({ actors: actors.state, doors: doors.state, tags: tags.grid.state });
}

function restore(json: string, actors: ActorRegistry, doors: DoorPolicy, tags: TagTriggers): void {
    const saved = JSON.parse(json);
    actors.setState(saved.actors);
    doors.setState(saved.doors);
    tags.grid.state = saved.tags;
}
```

Behaviour is code, not data, so thinkers are not saved: reattach them after a
restore, using each actor's `ref` to tell which is which.

### Running headless

The simulation only needs a `CellMap`. Without a renderer, you own the map and
apply the door updates to it directly:

```ts
import { CellMap, PHYS_DOOR_UP, PHYS_WALL } from '@laboralphy/raycaster386';
import { DoorPolicy } from '@laboralphy/raycaster386/simulation';

const map = new CellMap();
map.setSize(16);
for (let i = 0; i < 16; ++i) {
    map.setPhys(i, 0, PHYS_WALL);
}
map.setPhys(5, 5, PHYS_DOOR_UP);

const doors = new DoorPolicy({ map, metrics: { spacing: 64, height: 96 } });
doors.openDoor(5, 5, false);

for (let tick = 0; tick < 60; ++tick) {
    for (const { x, y, phys, offset } of doors.process()) {
        map.setPhys(x, y, phys);
        map.setOffset(x, y, offset | 0);
    }
}

console.log(doors.isDoorOpen(5, 5)); // true
```

Importing the root entry point under Node is safe: only rendering calls need a
canvas.

## Architecture

The library is built in tiers, and one rule holds them apart.

| Tier | Owns | Never |
|---|---|---|
| **Core** | The cell map, vectors, grids, geometry, the `ActorFrame` contract | Touches the DOM |
| **Rendering** | Turning world state into pixels | Advances time, performs I/O |
| **Simulation** | Advancing world state by a tick | Imports rendering, touches the DOM, owns a loop |
| **Game** — yours | The loop, input, rules, and moving data between the two | — |

**Simulation never imports rendering.** Doors report cell updates and actors
report frames, as plain data; the game applies them. That keeps the renderer a
pure function of world state, and lets the whole simulation run headless. The
build enforces it: `src/simulation` is type-checked without the DOM library.

### Source layout

```
src/
  consts.ts       phys, face, animation and effect codes
  core/           CellMap, Vector, Grid, MarkerRegistry, geometry, flood fill, canvas helpers
  raycast/        ray casting and the z-buffer
  render/         flats, wall slices, sprites, sprite facing, SpriteBinding
  texture/        distance-shaded tilesets, tile animations
  light/          traced light map and light sources
  map/            per-face surfaces and decals, MapHelper
  level/          RCE-100 types, loadLevel, buildObjects, the schema
  simulation/     doors, actors, collision, tags, scheduler, easing
  Renderer.ts     the renderer
  Sprite.ts       billboards
```

## Development

```bash
npm install
npm run check         # typecheck, lint, format, test and build: run before committing
npm test              # tests only
npm run demo          # the demos on http://localhost:8080
npm run bench         # renderer cost against tests/bench/baseline.json
npm run build         # bundles into dist/
npm run types         # declarations into dist/, after build
npm run profile       # per-phase frame timings for the dark-village level
```

The demos are small complete games: `demos/simple` builds its map in code,
`demos/dark-village` loads a real 59×59 level with an upper storey, a secret
passage and tagged cells, and `demos/sprite-stress` generates a large open
level to measure what sprites cost.

### Golden images

Rendering is verified against 45 committed baseline images in `tests/golden/`,
one per scene and camera pose, compared with a tolerance of zero. A mismatch
writes the actual image, the expected one and a diff to `.golden-out/`, with
the differing pixel count and bounding box.

```bash
UPDATE_GOLDEN=1 npm test     # re-record the baselines from the current renderer
UPDATE_BENCH=1 npm run bench # re-record the benchmark baseline
```

Re-recording blesses whatever the renderer draws now, bugs included: read the
diffs in `.golden-out/` first. [`tests/golden/README.md`](tests/golden/README.md)
records where the baselines came from, and why seven of them deliberately
differ from the original engine's output.

## Background

raycaster-386 is a TypeScript port of the renderer and engine of
[o876-raycaster-engine](https://github.com/Laboralphy/o876-raycaster-engine),
checked pixel for pixel against the original until the port replaced it.
The history is kept in `documentation/`:

- [PORT_NOTES.md](documentation/PORT_NOTES.md) — design decisions, the bugs
  fixed along the way, and performance against the original
- [MIGRATION_FROM_JS.md](documentation/MIGRATION_FROM_JS.md) — the migration
  log, subsystem by subsystem
- [ENGINE_INVENTORY.md](documentation/ENGINE_INVENTORY.md) — everything the
  original engine did, sorted by tier
- [PROGRESS.md](documentation/PROGRESS.md) — where the work stands
- [MAPEDIT_ANALYSIS.md](documentation/MAPEDIT_ANALYSIS.md) — what replacing the
  level editor would take

## License

[ISC](LICENSE) © 2026 Raphaël Marandet
