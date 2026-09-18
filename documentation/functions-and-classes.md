# Functions and classes

A summary of every class and function the package exports, grouped by entry
point and then by area. Each class lists its public members; each function
gets one line.

Types, interfaces and constants are not listed. The `PHYS_*` codes and the
cell layout are explained in the README's
[cell map section](../README.md#the-cell-map), and every declaration ships with
its full doc comment in the package's `.d.ts` files, which editors show on
hover.

- [`@laboralphy/raycaster386`](#laboralphyraycaster-386)
  - [Core](#core)
  - [Canvas helpers](#canvas-helpers)
  - [Rendering](#rendering)
  - [Textures and animation](#textures-and-animation)
  - [Lighting](#lighting)
  - [Map building and level loading](#map-building-and-level-loading)
  - [The raycasting pipeline](#the-raycasting-pipeline)
- [`@laboralphy/raycaster386/simulation`](#laboralphyraycaster-386simulation)
  - [Doors](#doors)
  - [Actors](#actors)
  - [Collision](#collision)
  - [Tags and triggers](#tags-and-triggers)
  - [Time and events](#time-and-events)
- [`@laboralphy/raycaster386/schema`](#laboralphyraycaster-386schema)
- [`@laboralphy/raycaster386/mapedit`](#laboralphyraycaster-386mapedit)

---

## `@laboralphy/raycaster386`

Core and rendering. Core is DOM-free and shared with the simulation; rendering
needs a Canvas 2D implementation.

## Core

### `CellMap`

The square grid of cells a level is made of. Each cell packs a material code,
a phys code and an offset into one 32-bit integer, stored row-major in a
`Uint32Array`. Every accessor is bounds-checked: reads outside the map answer
as a wall, and writes there are dropped.

| Member | What it does |
|---|---|
| `new CellMap()` | Creates an empty map of size 0. |
| `size` | Width and height, in cells. |
| `data` | The backing `Uint32Array`, row-major. For hot loops; read-only by convention. |
| `setSize(size)` | Resizes the map, keeping the cells that still fit. |
| `isInside(x, y)` | True if the cell lies within the map. |
| `get(x, y)` / `set(x, y, code)` | Reads or writes a whole packed cell code. |
| `getMaterial(x, y)` / `setMaterial(x, y, code)` | Reads or writes the material code. |
| `getPhys(x, y)` / `setPhys(x, y, code)` | Reads or writes the phys code. `setPhys` returns whether the value changed. |
| `getOffset(x, y)` / `setOffset(x, y, code)` | Reads or writes the offset: a door's slide, or a block's recess. |

### Cell functions

| Function | What it does |
|---|---|
| `materialOf(code)` | Extracts the material code from a packed cell code. |
| `physOf(code)` | Extracts the phys code from a packed cell code. |
| `offsetOf(code)` | Extracts the offset from a packed cell code. |
| `worldToCell(x, y, spacing)` | The cell containing a world position. Does not clamp to the map. |
| `cellCenter(x, y, spacing)` | The world position at the centre of a cell. |
| `alterBlock(x, y, material, block)` | Describes swapping a cell to another material, as a `CellChange` of material, phys and offset for the caller to apply. |

### `Vector`

A 2D vector. `add`, `sub`, `neg`, `mul` and `normalize` return a new vector;
`set`, `translate` and `scale` modify this one and return it.

| Member | What it does |
|---|---|
| `new Vector(x?, y?)` | Creates a vector from two numbers, or copies another vector. |
| `x`, `y` | The components. |
| `Vector.zero()` | A new zero vector. |
| `set(x, y?)` | Sets both components, from numbers or from another vector. |
| `translate(v)` | Adds `v` to this vector, in place. |
| `scale(f)` | Multiplies both components by `f`, in place. |
| `add(v)` / `sub(v)` | The sum or difference, as a new vector. |
| `neg()` | The opposite vector. |
| `mul(f)` | The scalar multiple, as a new vector. |
| `dot(v)` | The dot product. |
| `length()` | The vector's length. |
| `normalize()` | A unit vector in the same direction; a zero vector stays zero rather than becoming `NaN`. |
| `angle()` | The angle from the +x axis, in radians. |
| `toString()` | A readable form, for debugging. |

### `Grid<T>`

A dense 2D grid of arbitrary values, stored row-major in a flat array.

| Member | What it does |
|---|---|
| `new Grid<T>()` | Creates an empty grid. |
| `width`, `height` | The grid's dimensions. |
| `setSize(width, height, init)` | Resizes the grid and fills every cell with `init(x, y)`, discarding previous content. |
| `cell(x, y)` | The value at a cell. |
| `iterate(f)` | Calls `f(x, y, value)` for every cell; returning a value replaces the cell. |

### `MarkerRegistry`

A set of marked 2D integer positions — visible cells, locked doors, cells
already visited.

| Member | What it does |
|---|---|
| `new MarkerRegistry()` | Creates an empty set. |
| `size` | How many positions are marked. |
| `state` | The marked positions as a serialisable array; assigning it restores them. |
| `mark(x, y)` / `unmark(x, y)` | Adds or removes a position. |
| `isMarked(x, y)` | True if a position is marked. |
| `clear()` | Removes every position. |
| `iterate(f)` | Calls `f(x, y)` for every marked position. |
| `merge(other)` | Adds every position of another registry to this one. |
| `toArray()` | The marked positions as `{ x, y }` objects. |

### Geometry and utilities

| Function | What it does |
|---|---|
| `distance(x1, y1, x2, y2)` | The distance between two points. |
| `squareDistance(x1, y1, x2, y2)` | The squared distance between two points, avoiding a square root. |
| `circleInRect(xc, yc, r, xr, yr, wr, hr)` | True if a circle overlaps a rectangle. |
| `linear(v, x1, y1, x3, y3)` | Linear interpolation: the y of `v` on the segment from `(x1, y1)` to `(x3, y3)`. |
| `bresenhamLine(x0, y0, x1, y1, plot)` | Walks the integer points of a line, calling `plot` for each; returning `false` from `plot` stops the walk. |
| `floodFill(x, y, test)` | Collects the four-connected region around a cell for which `test(x, y)` is true, each cell once. |
| `quoteSplit(s)` | Splits a string into words, keeping double-quoted runs together: `'sound "door open"'` gives `['sound', 'door open']`. |

## Canvas helpers

Exported as the `Canvas` namespace: `import { Canvas } from '@laboralphy/raycaster386'`.
These need a DOM. The renderer itself loads nothing; `loadCanvas` and
`loadCanvases` are conveniences for callers.

| Function | What it does |
|---|---|
| `Canvas.loadCanvas(url)` | Loads an image URL and resolves with a canvas holding a copy of it. |
| `Canvas.loadCanvases(urls)` | Loads several image URLs at once, in order. |
| `Canvas.createCanvas(width, height)` | Creates a canvas, applying the default image smoothing. |
| `Canvas.cloneCanvas(source)` | Copies an image or canvas into a new canvas. |
| `Canvas.resize(canvas, width, height)` | Rescales a canvas into a new one. |
| `Canvas.context2d(canvas)` | A canvas' 2D context; throws if none can be acquired. |
| `Canvas.applyFilter(canvas, f)` | Runs `f(x, y, color)` over every pixel in place; mutating `color` changes the pixel. Slow — meant for precomputation. |
| `Canvas.getData(canvas, type?)` | The canvas as a data URL, PNG by default. |
| `Canvas.setImageSmoothing(canvas, on)` / `Canvas.getImageSmoothing(canvas)` | Sets or reads image smoothing on one canvas. |
| `Canvas.setDefaultImageSmoothing(on)` / `Canvas.getDefaultImageSmoothing()` | Sets or reads the smoothing that new canvases start with. |
| `Canvas.isCanvas(value)` | True if the value is an `HTMLCanvasElement`; safe where the DOM is absent. |
| `Canvas.isImage(value)` | True if the value is an `HTMLImageElement`; safe where the DOM is absent. |

## Rendering

### `Renderer`

Renders a raycast world into a canvas. Settings go through typed setters that
record what they invalidated; the work happens once, at the top of the next
`render()`. It performs no I/O: textures are passed in already decoded.

| Member | What it does |
|---|---|
| `new Renderer(map?)` | Creates a renderer. Pass a `CellMap` to share it with the simulation; otherwise the renderer owns a private one. |
| **Settings** | |
| `setScreen({ width, height })` | Sets the size of the frame, in pixels. |
| `setMetrics({ spacing, height })` | Sets the cell size in world units and the wall height in texels. |
| `setShading({ shades, color, filter, brightness })` | Sets the number of shading layers, the fog colour, an optional colour filter and the base brightness. |
| `shadingFactor` | The world distance over which shading deepens by one layer. Takes effect on the next frame. |
| `setTextureSmoothing(on)` | Turns texture smoothing on or off; off suits pixel art. |
| `setStretch(on)` | Draws upper storeys at double height. |
| `screen`, `metrics`, `shading` | The current settings, read-only. |
| `focal` | The projection focal length, derived from the screen width. |
| **Textures** | |
| `setWallTextures(image)` | Sets the wall atlas: tiles `spacing` wide and `height` tall. |
| `setFlatTextures(image)` | Sets the floor and ceiling atlas: square tiles. |
| `setBackground(image)` | Sets the backdrop seen past the walls, scaled to the screen height. |
| `backgroundOffset` | The backdrop's horizontal scroll, in pixels. |
| `buildTileSet(image, width, height, noShading?)` | Creates a shaded tileset for sprites and registers it; `noShading` keeps it from dimming with distance. |
| `removeUnusedTileSets()` | Drops tilesets no sprite still uses. |
| `getMemoryUsage()` | Approximate bytes held by every tileset. |
| **The map** | |
| `setMapSize(size)` / `getMapSize()` | Resizes the square map, with its surfaces, lights and upper storey, or reads its size. |
| `cellMap` | The map, as a read-only view. |
| `registerCellMaterial(code, faces)` | Assigns tiles to a material code, per face: a tile index, a `TileAnimation`, or nothing. |
| `setCellMaterial(x, y, code)` / `getCellMaterial(x, y)` | Writes or reads a cell's material. |
| `setCellPhys(x, y, code)` / `getCellPhys(x, y)` | Writes or reads a cell's phys code; a change re-traces the lights it affects. |
| `setCellOffset(x, y, code)` / `getCellOffset(x, y)` | Writes or reads a cell's offset. |
| **Upper storey** | |
| `createStorey()` | Creates the renderer for the floor above, which takes every setting from this one. |
| `storey` | The upper floor's renderer, or `null`. |
| `adoptShared(resources)` | Takes on the resources the floor below shares with its storey. Called by `createStorey`. |
| **Lights and surfaces** | |
| `addLightSource(x, y, r0, r1, v)` | Adds a light in world coordinates: full intensity up to `r0`, fading to nothing at `r1`. Returns a handle whose fields can be changed, and a `remove()`. |
| `updateStaticLightMap()` | Re-traces any light whose geometry changed. `render()` does this itself. |
| `paintSurface(x, y, face, draw)` | Lets `draw` paint onto one face of one cell, replacing its appearance — decals, scorch marks. |
| `shadeSurface(x, y, face)` | Recomputes the shading of one painted surface. |
| **Sprites and animation** | |
| `buildSprite(tileset)` | Creates a sprite drawing from a tileset, and adds it to the scene. |
| `disposeSprite(sprite)` | Removes a sprite from the scene. |
| `buildSurfaceAnimation(def)` | Creates an animation for a wall or flat face, and registers it. |
| `linkAnimation(animation)` | Registers an existing animation so it advances with the others. |
| `computeAnimations(timeInc)` | Advances every surface and sprite animation by `timeInc`. |
| `resetAnimations()` | Rewinds every animation to its first frame. |
| **Drawing** | |
| `render(x, y, angle, height)` | Draws one frame from a camera position, angle and eye height. |
| `renderCanvas` | The canvas frames are drawn into; `null` before the first frame. |
| `flip(target)` | Copies the last frame into another 2D context. |
| `screenshot(width?, height?, type?)` | The last frame as a data URL, optionally rescaled. |
| `computeScene(x, y, angle, height)` | Casts a frame's rays without drawing, and returns the resulting `Scene`. |
| **After a frame** | |
| `aimedCell` | The cell the centre ray struck, with the hit position and face. |
| `visibleCells` | Every cell a ray reached. |
| `visibleFrontCells` | The cells the centre ray reached. |
| `isCellVisible(x, y)` | True if any ray reached a cell. |
| `debug` | A `DebugDisplay` for text overlays. |

### `Sprite`

A billboard drawn inside the world. Animations are grouped under a name, one
animation per facing, so a directional sprite shows the side the camera sees.
Create one with `renderer.buildSprite()`.

| Member | What it does |
|---|---|
| `x`, `y` | World position. |
| `h` | Altitude above the floor. |
| `visible` | Whether it is drawn. |
| `scale` | Divides the projected size: larger values shrink the sprite. |
| `flags` | `FX_*` effect flags: additive blending, light source, opacity. |
| `addFlag(v)` / `removeFlag(v)` / `hasFlag(v)` | Sets, clears or tests an effect flag. |
| `lastRendered` | The source and screen rectangles the sprite was last drawn with — useful for hit-testing. |
| `buildAnimation(def, ref?)` | Adds an animation group under `ref`, one animation per entry of `def.starts`. |
| `setCurrentAnimation(ref, index?)` | Switches to an animation group, keeping the current facing unless `index` is given. |
| `getCurrentAnimation()` | The animation currently playing. |
| `getFirstAnimation()` | The name of the first group declared. |
| `animation` | The animation currently playing, which can be replaced directly. |
| `setDirection(direction)` / `direction` | Changes or reads the facing shown, keeping the frame cursor so a walk cycle does not restart. |
| `facings` | How many facings the current group has. |
| `getCurrentFrame()` | The tileset index of the frame shown. |
| `animate(time)` | Advances the sprite's animation, and its children's. |
| `setTileSet(tileset)` / `getTileSet()` | Changes or reads the tileset it draws from. |
| `addChild(sprite)` / `removeChild(sprite)` / `children` | Attaches sprites that animate along with this one. The renderer does not draw children. |

### `SpriteBinding`

Draws what the simulation reports. Bind a sprite to an actor id once, then pass
each tick's `ActorFrame` to `apply()`: it moves sprites and their lights, turns
directional sprites to face the camera, and disposes the sprites of removed
actors.

| Member | What it does |
|---|---|
| `new SpriteBinding(renderer)` | Creates a binding for a renderer. |
| `bind(id, sprite, { light? })` | Ties a sprite, and optionally a light that follows it, to an actor id. |
| `unbind(id)` | Unties an actor, disposing its sprite and removing its light. |
| `get(id)` | The sprite bound to an actor. |
| `apply(frame, camera)` | Applies one tick of movement and removals. |
| `clear()` | Unties everything. |
| `size` | How many actors are bound. |

### Rendering functions

| Function | What it does |
|---|---|
| `faceCamera(sprite, facing, cameraX, cameraY)` | Turns a directional sprite pointing at angle `facing` to show the side a camera at `(cameraX, cameraY)` sees. Leaves the sprite alone when the frame would not change. |
| `renderBackground(background, context, screenHeight, offset)` | Paints the scrolling backdrop into a context. |

### `DebugDisplay`

A small overlay of text lines drawn over a frame. Reach the renderer's own
through `renderer.debug`.

| Member | What it does |
|---|---|
| `new DebugDisplay()` | Creates an empty overlay. |
| `print(...args)` | Adds a line, joining the arguments with spaces. |
| `clear()` | Removes every line. |
| `display(context, x, y)` | Draws the lines into a context, starting at `(x, y)`. |

## Textures and animation

### `ShadedTileSet`

A tileset that precomputes its own distance shading. Every shading layer is
stacked vertically in one image, so drawing a shaded tile is a plain
`drawImage` from the right row. Renderers create these through
`buildTileSet()`.

| Member | What it does |
|---|---|
| `new ShadedTileSet()` | Creates an empty tileset. |
| `setImage(image, tileWidth, tileHeight)` | Sets the source image, kept unmodified so shading can be recomputed later. |
| `tileWidth`, `tileHeight` | The tile size. |
| `setShadingLayerCount(n)` / `getShadingLayerCount()` | Sets or reads how many shading layers are computed. |
| `shading` | When false, only one unshaded layer is computed. |
| `compute(color, filter, brightness)` | Builds the shaded image for a fog colour, filter and brightness. |
| `recompute()` | Rebuilds it with the parameters last used. |
| `getImage()` | The shaded image, or `null` before `compute()`. |
| `getOriginalImage()` | The source image. |
| `drawTile(ctx, sx, sy, sw, sh, dx, dy, dw, dh)` | Draws a region of the shaded image into a context. |
| `extractTile(tile, level, target?)` | Copies one tile at one shading level into its own canvas. |
| `applyFogShading(canvas, level)` | Applies the fog for one shading level to a canvas, in place. |
| `getMemoryUsage()` | Approximate bytes held by the tileset's canvases. |

### `TileAnimation`

A cursor over a run of consecutive tiles, advanced by elapsed time.

| Member | What it does |
|---|---|
| `new TileAnimation()` | Creates an animation with default settings. |
| `base` | The tileset index of the first frame. |
| `count` | The number of frames. |
| `duration` | How long one frame lasts. |
| `loop` | The loop mode: none, forward, or back and forth. |
| `iterations` | Remaining loops; setting it also sets what `reset()` restores. |
| `index`, `time`, `loopDir` | The current frame, the time spent in it, and the playing direction. |
| `frozen` | While true, `animate()` does nothing. |
| `animate(timeInc)` | Advances the animation. |
| `frame()` | The tileset index of the frame shown. |
| `reset()` | Rewinds to the first frame. |

| Function | What it does |
|---|---|
| `createTileAnimation(def?)` | Creates a `TileAnimation` from a partial definition — `start`, `length`, `duration`, `loop`, `iterations` — filling in defaults. |

## Lighting

The renderer drives these through `addLightSource()`, whose handle works in
world coordinates; the classes themselves work in lightmap cells.

### `LightMap`

Traced static lighting over a grid of lightmap cells. Sources are traced with
rays that stop at light-blocking cells, so walls cast shadows, and each cell
composites every source that reaches it.

| Member | What it does |
|---|---|
| `new LightMap()` | Creates an empty light map. |
| `setSize(width, height)` / `width`, `height` | Resizes the map, discarding traced light, or reads its size. |
| `setLightBlocking(x, y, w, h, blocking)` | Marks a region as blocking light or not, and invalidates the sources that reach it. |
| `addSource(x, y, r0, r1, intensity)` | Adds a point light. |
| `removeSource(source)` | Removes a light, and the light it cast. |
| `clearSources()` | Removes every light. |
| `traceAllSources()` | Re-traces every invalidated source. |
| `filter(f)` | Passes every changed cell's final intensity to `f`, downsampled 2×2. |
| `invalidate()` / `isInvalid()` / `clearInvalidFlag()` | Marks the map as needing work, tests it, or clears the mark. |
| `getPixelCount()` | How many source contributions are held across all cells. |
| `LightMap.alphaSum(a, b)` | Composites two intensities. |

### `LightSource`

One point light in a `LightMap`.

| Member | What it does |
|---|---|
| `new LightSource()` | Creates a light. `LightMap.addSource()` is the usual way. |
| `id` | A unique id. |
| `x`, `y` | Position, in lightmap cells. Changing it invalidates the light. |
| `r0`, `r1` | The full-intensity radius and the radius where light reaches zero. |
| `v` | Intensity, 0 to 1. |
| `state` | Its id, position, radii and intensity, as plain data; assigning it restores them. |
| `invalidate()` / `isInvalid()` / `clearInvalidFlag()` | Marks the light as needing a re-trace, tests it, or clears the mark. |
| `resetCache()` | Starts a new trace: everything lit last time is provisionally unlit. |
| `lightPixel(x, y)` | Records that the current trace lit a cell. |
| `computed`, `deadPixels` | The cells lit by the current trace, and those it no longer lights. |
| `onInvalidate` | A callback the owning map sets, so a change here invalidates the map too. |

### `CellSurfaceManager`

The paintable surfaces and light levels of every face of every cell: what lets
a wall carry a decal and pick up the light of the floor beside it.

| Member | What it does |
|---|---|
| `new CellSurfaceManager()` | Creates an empty surface grid. |
| `setMapSize(width, height)` / `width`, `height` | Rebuilds the grid at a new size, losing painted decals, or reads its size. |
| `getSurface(x, y, face)` | One face of one cell, or `null` outside the map. |
| `surfaces` | Every surface, indexed `(y * width + x) * FACE_COUNT + face`. |
| `setDecal(x, y, face, tile)` / `removeDecal(x, y, face)` | Paints a texture onto a face, replacing its material there, or removes it. |
| `rotateWallSurfaces(x, y, clockwise)` | Rotates a cell's four wall surfaces. |
| `shadeSurface(x, y, face, shades, fog, filter, brightness)` | Recomputes the shading of one painted surface. |
| `shadeAllSurfaces(shades, fog, filter, brightness)` | Recomputes every painted surface. |
| `getLightMap(x, y, spacing)` | The light level at a world position. |
| `setLightMap(xc, yc, value)` | Writes one lightmap cell, and onto the walls bordering it. |
| `clearLightMap()` | Resets every light level to zero. |
| `lightMapData`, `lightMapWidth`, `lightMapCellCount` | The raw light levels, their row width, and lightmap cells per map cell. |

| Function | What it does |
|---|---|
| `isWallFace(face)` | True for the four vertical faces; narrows the type. |

## Map building and level loading

### `MapHelper`

Builds a renderer's map from a `LevelMap`: a legend of materials and a grid of
rows that index it, with an optional upper storey. Identical animated faces
share one animation.

| Member | What it does |
|---|---|
| `new MapHelper()` | Creates a helper. |
| `build(renderer, level)` | Registers the level's materials, sizes and fills the map and its upper storey, and returns the materials with any lights they created. |
| `materials` | The materials from the last build, by legend index. |

### Level functions

| Function | What it does |
|---|---|
| `loadLevel(renderer, level, options)` | Loads an RCE-100 level into a renderer — metrics, shading, textures, map, storey, decals and lights — and returns what it built, plus the sections it does not handle. Images are decoded through `options.loadImage`. |
| `buildObjects(renderer, loaded, options)` | Places a loaded level's objects as sprites, with their animations, flags and lights. Behaviour and collision are left to the caller. |
| `decalOffset(align, surfaceWidth, surfaceHeight, tileWidth, tileHeight)` | Where a decal sits on its surface, from a numpad-style alignment code: 7 top-left, 5 centre, 3 bottom-right. |
| `resolveConstant(name)` | The value of one `@SYMBOL` such as `"@PHYS_WALL"`; throws for an unknown symbol. |
| `resolveConstants(value)` | A copy of a structure with every `@SYMBOL` string resolved. The input is not modified. |

## The raycasting pipeline

The steps `Renderer.render()` is made of, exported for tools, tests and custom
renderers. A game using `Renderer` does not need them.

| Function | What it does |
|---|---|
| `createScene(options)` | Creates the `Scene` one frame is cast into: camera position, direction, height and focal length, screen width, cell size, and an optional upper storey scene. |
| `castRay(ctx, scene, x, y, dx, dy, xScreen, visible, zbuffer, exclusion)` | Casts one screen column's ray, adding a slice to the z-buffer for each surface it meets — several, when it passes a see-through wall. |
| `projectRay(ctx, scene, x, y, dx, dy, exclusion, visible)` | Steps one ray through the grid until it meets a surface, recording the hit on the scene. |
| `isWallTransparent(ctx, x, y)` | True for a wall rays continue past: an opened door, a transparent or invisible block. |
| `createScreenSlice(ctx, scene, x, tileset, tile, light)` | Turns a ray hit into a drawing operation: which texel column, where on screen, at which shade. |
| `resolveTile(codes, code, face)` | The tileset index a material shows on a face, or `null` if it draws nothing there. |
| `compareSlices(a, b)` | Sort order for the z-buffer: back to front, so translucent surfaces draw over what is behind them. |
| `optimizeBuffer(zbuffer)` | Merges neighbouring columns that sample the same texture at about the same depth into wider slices. |
| `renderScreenSlice(slice, context)` | Draws one slice. |
| `renderScreenSliceBuffer(scene, context)` | Draws every slice of a scene, in buffer order. |
| `renderFlats(ctx, scene, context, flatContext)` | Draws the floor and ceiling, pixel by pixel. |
| `createFlatContext()` | Creates the pixel cache `renderFlats` samples from. |
| `resetFlatContext(flatContext)` | Drops that cache, forcing a re-read on the next frame. |
| `renderSprite(ctx, scene, sprite)` | Projects one sprite into the z-buffer as a billboard. |
| `renderSprites(ctx, scene, sprites, isCellVisible)` | Projects every sprite standing in a cell the rays reached. |

---

## `@laboralphy/raycaster386/simulation`

World state advanced by ticks. Nothing here imports the renderer or touches the
DOM, so all of it runs headless.

## Doors

### `DoorPolicy`

Decides which cells are doors from their phys codes, and opens, closes and
locks them. Call `process()` once a tick and apply the cell updates it returns.

| Member | What it does |
|---|---|
| `new DoorPolicy(options)` | Creates a policy over a map and its metrics. Options set timings, easing, an occupancy check that stops a door closing on someone, and per-kind door shapes. |
| `openDoor(x, y, autoclose?)` | Opens a door or secret block. Returns its `DoorContext`, or `null` if it is not a door, is locked, or is already open. |
| `closeDoor(x, y)` | Starts closing an open door; a blocked door waits and retries. |
| `lockDoor(x, y, locked)` | Locks or unlocks a door or secret block. |
| `isDoor(x, y)` | True for a door or curtain. |
| `isSecretBlock(x, y)` | True for a push-wall block. |
| `isDoorOpen(x, y)` | True if a door stands fully open. |
| `isDoorClosed(x, y)` | True if a door or secret block is not open. |
| `isDoorLocked(x, y)` | True if a cell is locked. |
| `process()` | Advances every live door one tick, and returns the cell updates to apply. |
| `contexts` | Every live door. |
| `locks` | The locked cells. |
| `events` | Emits `opened`, `closing`, `closed` and `locked`. |
| `doors` | The underlying `DoorManager`. |
| `state` / `setState(state)` | Saves or restores live doors and locks. |
| `buildDoorContext(x, y, autoclose)` | Builds and registers a cell's door — both halves, for a secret passage. `openDoor` calls it. |

### `DoorManager`

Ticks a set of doors and reports what changed. A door that finishes closing is
reported one last time, then dropped.

| Member | What it does |
|---|---|
| `new DoorManager()` | Creates an empty manager. |
| `linkDoorContext(door)` | Registers a door, replacing any already at its cell. |
| `unlinkDoorContext(door)` | Removes a door without running its closing phase. |
| `getDoorContext(x, y)` | The live door at a cell, if any. |
| `doors` | Every live door. |
| `process()` | Advances every door one tick, and returns one cell update per door. |
| `state` | Every live door's position and progress, as plain data. |
| `setState(entries, build)` | Rebuilds live doors from saved entries, using `build` to create each one. |

### `DoorContext`

One door's state machine: closed, opening, open, closing, done. It produces an
offset and a phase, and knows nothing about rendering.

| Member | What it does |
|---|---|
| `new DoorContext(options?)` | Creates a door with sliding, holding and delay durations, a travel distance, and opening and closing easings. |
| `process()` | Advances the door one tick. |
| `offset` | How far the door has slid, in texels. |
| `getPhase()` | The current phase. |
| `isOpen()` / `isClosed()` / `isDone()` | Tests the phase; a done door can be retired. |
| `close()` | Starts closing, unless it already is — the way to shut a door that never closes by itself. |
| `dispose()` | Retires the door at once. |
| `reset()` | Returns to the closed phase, with its time and offset at zero. |
| `initPhase(phase)` | Enters a phase and sets up what it needs. |
| `data` | Where the door is and how it behaves, filled in by its creator. |
| `events` | Emits `opening`, `open`, `closing` and `close` as it moves through its phases, and `check` to ask whether it may close. |
| `getState()` / `setState(state)` / `state` | Saves or restores the phase and time, replaying phases so listeners see the same sequence. |

### Door functions

| Function | What it does |
|---|---|
| `forEachNeighbor(map, x, y, visit, types)` | Calls `visit(x, y, phys)` for the cells around a cell — sides, corners and the cell itself, chosen by the `CELL_NEIGHBOR_*` flags in `types`. Cells outside the map are skipped. |

## Actors

### `Actor<C>`

A thing in the world: a position, a size, a collision body and a behaviour. It
holds no sprite and no light; the game ties those to its `id`.

| Member | What it does |
|---|---|
| `new Actor(id)` | Creates an actor. `ActorRegistry.spawn()` is the usual way. |
| `id` | Its identifier, used to bind a sprite. |
| `position` | `x`, `y`, `z` and `angle`, in world units and radians. |
| `size` | Its collision radius. |
| `dummy` | Its collision body. |
| `thinker` | The behaviour run on each tick, or `null`. |
| `data` | Free-form data for the game. |
| `ref` | The name of its blueprint, if a level gave one. |
| `dead` | Set to `true` to have the registry remove the actor on its next tick. |
| `hasMoved()` | True if the actor moved since it was last reported. |
| `markReported()` | Records the current position as reported. |

### `ActorRegistry<C>`

Holds the actors, runs their thinkers each tick, and reports what moved and
what was removed. Actors are also filed into a coarse sector grid, so finding
who stands in a cell is a lookup.

| Member | What it does |
|---|---|
| `new ActorRegistry<C>()` | Creates an empty registry; `C` is the context type passed to thinkers. |
| `setSectors(count, size)` | Sizes the sector grid: `count` sectors per side, each `size` world units wide. |
| `spawn(init)` | Creates an actor at a position, with optional altitude, angle, size, `ref` and `data`, and adds it. |
| `link(actor)` | Adds an existing actor. |
| `unlink(actor)` | Removes an actor at once; its id is reported as removed on the next tick. |
| `get(id)` | The actor with an id. |
| `actors` | Every actor. |
| `actorsAt(x, y)` | The actors filed in one sector. |
| `process(context)` | Runs every thinker, refiles what moved, removes dead actors, and returns the tick's `ActorFrame`. |
| `state` / `setState(state)` | Saves or restores every actor. Thinkers are not saved and must be reattached. |

### Actor functions

| Function | What it does |
|---|---|
| `moveActor(actor, context, v, crashWall?)` | Moves an actor by `v`, sliding along solid cells — or stopping dead with `crashWall` — and returns how far it really moved. |

## Collision

### `Dummy`

The collision body of one actor: a circle with a position, radius, mass,
tangibility masks and a force field.

| Member | What it does |
|---|---|
| `new Dummy()` | Creates a body. Every `Actor` has one. |
| `position` | Its centre, as a `Vector`. |
| `radius`, `mass` | Its size and mass. |
| `tangibility` | Masks deciding what it collides with. |
| `forceField` | The forces pushing on it. |
| `force` | This tick's resultant force, written by the solver. |
| `entity` | An id pointing back to the caller's object. |
| `dead` | Set when a `Smasher` unregisters the body. |
| `hits(other)` | True if two bodies overlap and are tangible to each other. |
| `tangibleWith(other)` | True if this body's mask accepts the other's type. |
| `distanceTo(other)` / `angleTo(other)` | The distance or angle to another body. |
| `nearerThan(other, d)` | True if another body is closer than `d`. |
| `smashers` / `setSmashers(list)` / `clearSmashers()` | Reads, sets or clears the bodies currently overlapping this one. |
| `colliderSector` | The sector it is filed in. |

### `ForceField`

The forces pushing on one body, each a vector with a decay factor.

| Member | What it does |
|---|---|
| `new ForceField()` | Creates an empty field. |
| `addForce(v, f)` | Adds a force `v`, multiplied by `f` on each reduction, and returns it. A factor of 0 makes a force that lasts one tick. |
| `forces` | Every force. |
| `computeForces()` | The sum of every force, as a new vector. |
| `reduceForces()` | Decays every force, dropping those that became negligible. |
| `clear()` | Removes every force. |

### `Smasher`

Circle-against-circle collision between registered entities. Each overlap adds
a separating force to the bodies involved, lasting one tick; nothing is moved.
Only the nine sectors around an entity are compared.

| Member | What it does |
|---|---|
| `new Smasher()` | Creates a solver. Size its grid with the `SectorRegistry` methods. |
| `registerEntity(entity)` | Adds anything with an `id` and a `dummy`. |
| `unregisterEntity(entity)` | Marks an entity dead and stops tracking it. |
| `process()` | Files every entity into its sector, then resolves all overlaps. |
| `updateEntity(entity)` | Moves one entity to the sector it now stands in. |
| `processEntity(entity)` | Resolves one entity's overlaps into forces. |
| `entities` | Every registered entity. |
| `origin` | The world position the grid starts at. |
| `events` | Emits `dummy.update` before each entity is filed, and `smashed` for each overlapping entity. |

### `SectorRegistry<T>` and `Sector<T>`

A coarse grid of buckets, so that only nearby things are compared. `Smasher`
extends `SectorRegistry`.

| Member | What it does |
|---|---|
| `new SectorRegistry<T>()` | Creates an empty grid. |
| `setSize(width, height)` | Resizes the grid, in sectors, emptying it. |
| `setCellWidth(w)` / `setCellHeight(h)` | Sets a sector's size in world units. |
| `getCellWidth()` / `getCellHeight()` | Reads a sector's size. |
| `sector(x, y)` | The sector at grid coordinates, or `null`. |
| `sectorFromVector(v)` | The sector containing a world position, or `null`. |
| `grid` | The underlying `Grid` of sectors. |
| `new Sector<T>()` | Creates one bucket. |
| `Sector.x`, `Sector.y` | A sector's grid position. |
| `Sector.add(o)` / `Sector.remove(o)` | Adds or removes an object. |
| `Sector.objects` / `Sector.count()` / `Sector.get(i)` | Lists, counts or indexes what the sector holds. |

### Collision functions

| Function | What it does |
|---|---|
| `computeWallCollisions(x, y, dx, dy, size, spacing, crashWall, isSolid)` | Moves a square body by `(dx, dy)`, cancelling the axis that would enter something solid so it slides along walls — or stopping both with `crashWall`. `isSolid` answers for world positions. |

## Tags and triggers

### `TagGrid`

Command strings attached to cells, such as `teleport 12 3`. Each distinct string
is stored once under a numeric id.

| Member | What it does |
|---|---|
| `new TagGrid()` | Creates an empty grid. |
| `setSize(width, height)` / `width`, `height` | Resizes the grid, discarding every tag, or reads its size. |
| `addTag(x, y, tag)` | Places a tag on a cell, and returns its id. |
| `removeTag(x, y, id)` | Removes a tag from one cell; returns whether it was there. |
| `removeTagRegion(x, y, id)` | Removes a tag from every connected cell carrying it; returns how many. |
| `idsAt(x, y)` | The tag ids on a cell. |
| `tagOf(id)` | The text of a tag. |
| `commandOf(id)` | A tag split into a command and its arguments. |
| `visit(fromX, fromY, toX, toY)` | The tags entered and left moving from one cell to another. |
| `state` | Every tag as plain data; assigning it restores them. |

### `TagTriggers`

Turns actor movement across a `TagGrid` into `enter`, `leave` and `push`
events, reading the `ActorFrame` the registry already produces.

| Member | What it does |
|---|---|
| `new TagTriggers()` | Creates triggers with an empty grid. |
| `setMapSize(size, spacing)` | Sizes the grid to a square map and records the cell size. |
| `grid` | The `TagGrid` to place tags on. |
| `process(frame)` | Fires `enter` and `leave` for every actor that moved this tick. |
| `push(actorId, x, y)` | Fires `push` for a cell an actor tried to use. |
| `forget(actorId)` | Forgets an actor, so its next move counts as an arrival. |
| `events` | Emits `enter`, `leave` and `push`, with the command, its arguments, and `remove()` to retire the tag's region. |

## Time and events

### `Scheduler`

Runs commands on the simulation's clock, counting ticks rather than
milliseconds, so a paused or replayed game stays in step.

| Member | What it does |
|---|---|
| `new Scheduler()` | Creates an empty scheduler. |
| `delay(command, ticks)` | Runs a command once, `ticks` from now; returns an id. |
| `loop(command, ticks)` | Runs a command every `ticks`; returns an id. Zero or less is rejected. |
| `cancel(id)` | Cancels a command; returns whether it was pending. |
| `clear()` | Cancels everything. |
| `schedule(time)` | Advances to tick `time`, running whatever fell due; a repeating command catches up on missed runs. |
| `time` | The tick last passed to `schedule`. |
| `pending` | How many commands are waiting. |

### `Easing`

Interpolates a value from one bound to another over a number of steps, along a
named curve or a function of your own.

| Member | What it does |
|---|---|
| `new Easing({ from?, to?, steps?, use? })` | Creates an easing. |
| `from(y)` / `to(y)` / `steps(n)` / `use(curve)` | Chainable setters for the bounds, step count and curve. |
| `setOutputRange(y0, y1)` / `setStepCount(n)` / `setFunction(curve)` | The same settings, as plain setters. |
| `compute(x?)` | Moves to step `x`, or one step on, and recomputes the value. |
| `y` | The current value. |
| `x` | The current step. |
| `over()` | True once the last step is reached. |
| `reset()` | Returns to step 0 and the starting value. |

### `TypedEmitter<E>`

A small event emitter whose event names and listener arguments are checked by
TypeScript. It is what `events` is on doors, tags and the collision solver.

| Member | What it does |
|---|---|
| `new TypedEmitter<E>()` | Creates an emitter for an event map `E`. |
| `on(event, listener)` / `off(event, listener)` | Adds or removes a listener. |
| `once(event, listener)` | Adds a listener that runs a single time. |
| `emit(event, ...args)` | Calls the event's listeners with the arguments. |
| `removeAllListeners(event?)` | Removes the listeners of one event, or of all. |
| `listenerCount(event)` | How many listeners an event has. |

---

## `@laboralphy/raycaster386/schema`

No classes or functions: the RCE-100 JSON schema, as `RCE_100_SCHEMA` and as
the default export. Pass it to a JSON-schema validator inside `loadLevel`'s
`validate` hook.

---

## `@laboralphy/raycaster386/mapedit`

| Function | What it does |
|---|---|
| `convertMapEditLevel(save, append)` | Compiles a MapEdit save into an RCE-100 level. Combining tiles into sheets is delegated to `append`, the one host-specific step. Refuses a save version it does not know. |
| `mapEditVersionOf(save)` | The save's format version, treating a file that predates the field as the first version. |
