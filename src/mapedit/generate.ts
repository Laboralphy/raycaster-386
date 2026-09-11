import {
    MAPEDIT_1, MAPEDIT_VERSIONS
} from './types.js';
import type {
    ImageAppender, MapEditBlock, MapEditCell, MapEditLevel, MapEditTile, MapEditVersion
} from './types.js';

/** Loop codes, by the index the editor stores. */
const LOOPS = ['@LOOP_NONE', '@LOOP_FORWARD', '@LOOP_YOYO'] as const;

/** Phys codes, by the index the editor stores. */
const PHYS = [
    '@PHYS_NONE',
    '@PHYS_WALL',
    '@PHYS_DOOR_UP',
    '@PHYS_CURT_UP',
    '@PHYS_DOOR_DOWN',
    '@PHYS_CURT_DOWN',
    '@PHYS_DOOR_LEFT',
    '@PHYS_DOOR_RIGHT',
    '@PHYS_DOOR_DOUBLE',
    '@PHYS_SECRET_BLOCK',
    '@PHYS_TRANSPARENT_BLOCK',
    '@PHYS_INVISIBLE_BLOCK',
    '@PHYS_OFFSET_BLOCK'
] as const;

/** The editor stores one animation per tileset, and it has no name. */
const DEFAULT_ANIMATION_NAME = 'default';

const SIGN = 'convertMapEditLevel: ';

function fail(message: string): never {
    throw new Error(SIGN + message);
}

/** Truncation to an integer, as the original's `| 0` did throughout. */
function int(value: number | string | undefined): number {
    return Number(value) | 0;
}

/**
 * Merges one tileset's frames into a sheet.
 *
 * A tileset with an animation is several source tiles that have to become one
 * image; one without is a single tile handed through the same path, so the
 * appender is the only thing that ever touches an image.
 */
async function buildTileset(
    tiles: readonly MapEditTile[], id: number | string, append: ImageAppender
): Promise<Record<string, unknown>> {
    const index = tiles.findIndex(t => t.id === id);
    if (index < 0) {
        fail(`tileset "${String(id)}" is referenced but not defined`);
    }
    const tile = tiles[index];
    // Coerced: the editor stores a frame count as the string its text input
    // held. The original never converted it, and got away with it only because
    // every use happened to coerce — `i < "3"` in a loop, `"3" | 0` in a field.
    const frames = tile.animation ? int(tile.animation.frames) : 1;
    if (frames === 0) {
        fail(`tileset "${String(id)}" declares an animation with no frames`);
    }
    // An animation's frames are the tiles that *follow* it in the array, so a
    // frame count reaching past the end is a malformed save. The original read
    // `undefined` here and failed inside the caller's image appender instead,
    // where the message says nothing about which tileset is wrong.
    if (index + frames > tiles.length) {
        fail(
            `tileset "${String(id)}" declares ${frames} animation frames, but only ` +
            `${tiles.length - index} tile(s) follow it — an animation's frames are ` +
            'the tiles after it in the list'
        );
    }
    const { src, width, height } = await append(tiles, index, frames);
    return {
        id,
        src,
        width,
        height,
        animations: tile.animation && frames > 1
            ? [{
                id: DEFAULT_ANIMATION_NAME,
                start: [0, 0, 0, 0, 0, 0, 0, 0],
                length: frames | 0,
                duration: int(tile.animation.duration),
                loop: LOOPS[int(tile.animation.loop)] ?? LOOPS[0]
            }]
            : []
    };
}

/**
 * One face of a block: a tile index, or an animation tuple.
 *
 * The index is a *position* in the atlas, not the editor's tile id — the
 * atlas was concatenated in declaration order, so position is what the
 * renderer can use.
 */
function buildFace(
    level: MapEditLevel, id: number | null, type: 'wall' | 'flat'
): number | (number | string)[] | null {
    if (id === null) {
        return null;
    }
    const tiles = type === 'wall' ? level.tiles.walls : level.tiles.flats;
    const index = tiles.findIndex(t => t.id === id);
    if (index < 0) {
        fail(`face references ${type} tile "${String(id)}", which is not defined`);
    }
    const tile = tiles[index];
    if (tile.animation) {
        return [
            index,
            int(tile.animation.frames),
            int(tile.animation.duration),
            LOOPS[int(tile.animation.loop)] ?? LOOPS[0]
        ];
    }
    return index;
}

function buildLegendEntry(level: MapEditLevel, block: MapEditBlock): Record<string, unknown> {
    const phys = PHYS[int(block.phys)];
    if (phys === undefined) {
        fail(`block ${String(block.id)} has phys code ${String(block.phys)}, which is not defined`);
    }
    return {
        code: block.id,
        phys,
        offset: int(block.offs),
        ref: block.ref,
        faces: {
            n: buildFace(level, block.faces.n, 'wall'),
            e: buildFace(level, block.faces.e, 'wall'),
            w: buildFace(level, block.faces.w, 'wall'),
            s: buildFace(level, block.faces.s, 'wall'),
            f: buildFace(level, block.faces.f, 'flat'),
            c: buildFace(level, block.faces.c, 'flat')
        }
    };
}

/** The cell grid, plus an upper storey only if any cell declares one. */
function buildMap(level: MapEditLevel): Record<string, unknown> {
    const grid = level.grid;
    const out: Record<string, unknown> = {
        map: grid.map(row => row.map(cell => cell.block || 0))
    };
    // Faithful to the original: the *presence* test is `!== 0`, so a cell
    // holding null counts as an upper storey even though it writes 0 into the
    // map. A grid of nulls therefore emits an all-zero uppermap rather than
    // none. Harmless, and changing it would diverge from levels already built.
    if (grid.some(row => row.some(cell => cell.upperblock !== 0))) {
        out.uppermap = grid.map(row => row.map(cell => cell.upperblock || 0));
    }
    return out;
}

async function buildTextures(
    level: MapEditLevel, append: ImageAppender
): Promise<Record<string, unknown>> {
    if (level.tiles.walls.length === 0) {
        fail('no wall tile is defined');
    }
    if (level.tiles.flats.length === 0) {
        fail('no flat tile is defined');
    }
    const walls = await append(level.tiles.walls, 0, level.tiles.walls.length);
    const flats = await append(level.tiles.flats, 0, level.tiles.flats.length);
    return {
        flats: flats.src,
        walls: walls.src,
        sky: level.ambiance.sky,
        smooth: !!level.flags.smooth,
        stretch: !!level.flags.stretch
    };
}

function buildBlueprint(level: MapEditLevel, id: number | string): Record<string, unknown> {
    const thing = level.things.find(t => t.id === id);
    if (thing === undefined) {
        fail(`blueprint references thing "${String(id)}", which is not defined`);
    }
    const fx: string[] = [];
    const out: Record<string, unknown> = {
        id,
        tileset: thing.tile,
        // The editor has no behaviour picker: a thing is scenery, and the only
        // choice it offers is whether you can walk through it.
        thinker: thing.tangible ? 'StaticTangibleThinker' : 'StaticThinker',
        size: int(thing.size),
        ref: thing.ref,
        fx
    };
    if (thing.ghost) {
        fx.push('@FX_LIGHT_ADD');
    }
    if (thing.light.enabled) {
        fx.push('@FX_LIGHT_SOURCE');
        out.lightsource = {
            r0: parseFloat(String(thing.light.inner)),
            r1: parseFloat(String(thing.light.outer)),
            v: parseFloat(String(thing.light.value))
        };
    }
    const alpha = ['', '@FX_ALPHA_75', '@FX_ALPHA_50', '@FX_ALPHA_25'][int(thing.opacity)];
    if (alpha !== undefined && alpha !== '') {
        fx.push(alpha);
    }
    return out;
}

function buildShading(level: MapEditLevel): Record<string, unknown> {
    const a = level.ambiance;
    return {
        color: a.fog.color,
        factor: int(a.fog.distance),
        brightness: int(a.brightness) / 100,
        // The original wrote `a.filter.enabled && a.filter.length > 0`, but
        // `filter` is an object and has no `length`, so the test was always
        // false and a configured sprite filter was silently dropped.
        filter: a.filter.enabled && a.filter.color.length > 0 ? a.filter.color : null
    };
}

/**
 * Splits the things placed in cells into scenery and decals.
 *
 * Which one a thing becomes is decided by the cell it stands in, not by the
 * thing: in a walkable cell it is a sprite standing on the floor, and against
 * a solid one it is painted onto the wall face it touches.
 */
function buildObjectsAndDecals(level: MapEditLevel): {
    objects: Record<string, unknown>[];
    decals: Record<string, unknown>[];
} {
    const objects: Record<string, unknown>[] = [];
    const decals: Record<string, unknown>[] = [];
    const ps = int(level.metrics.tileWidth);
    const sprites = level.tiles.sprites;

    level.grid.forEach((row: MapEditCell[], y: number) => row.forEach((cell, x) => {
        const block = level.blocks.find(b => b.id === cell.block);
        const walkable = (block ? block.phys : 0) === 0;

        for (const placed of cell.things) {
            const thing = level.things.find(t => t.id === placed.id);
            if (thing === undefined) {
                fail(`cell ${x},${y} places thing "${String(placed.id)}", which is not defined`);
            }
            if (walkable) {
                const tile = sprites.find(t => t.id === thing.tile);
                if (tile === undefined) {
                    fail(`thing "${String(thing.id)}" draws with sprite tile ` +
                        `"${String(thing.tile)}", which is not defined`);
                }
                // Left, centre and right of the cell, inset so a wide sprite
                // does not overhang into the next one.
                const half = (tile.width >> 1) | 0;
                const offsets = [half, ps >> 1, ps - half];
                objects.push({
                    x: x * ps + offsets[int(placed.x)],
                    y: y * ps + offsets[int(placed.y)],
                    z: (tile.height >> 1) - 48,
                    angle: 0,
                    blueprint: placed.id,
                    animation: tile.animation ? DEFAULT_ANIMATION_NAME : null
                });
            } else {
                decals.push(buildDecal(x, y, thing.tile, int(placed.x), int(placed.y)));
            }
        }
    }));
    return { objects, decals };
}

/**
 * Places a decal on the faces its sub-cell position touches.
 *
 * A corner touches two walls and is painted on both, half on each, which is
 * why those cases emit two faces with opposite alignments. The centre of the
 * cell touches nothing and is dropped.
 */
function buildDecal(
    x: number, y: number, tileset: number | string, sx: number, sy: number
): Record<string, unknown> {
    const decal: Record<string, unknown> = { x, y };
    const at = (align: string): Record<string, unknown> => ({ tileset, align });
    switch (sx * 10 + sy) {
        case 0:
            decal.w = at('@DECAL_ALIGN_LEFT');
            decal.n = at('@DECAL_ALIGN_RIGHT');
            break;
        case 10:
            decal.n = at('@DECAL_ALIGN_CENTER');
            break;
        case 20:
            decal.n = at('@DECAL_ALIGN_LEFT');
            decal.e = at('@DECAL_ALIGN_RIGHT');
            break;
        case 1:
            decal.w = at('@DECAL_ALIGN_CENTER');
            break;
        case 11:
            break;
        case 21:
            decal.e = at('@DECAL_ALIGN_CENTER');
            break;
        case 2:
            decal.w = at('@DECAL_ALIGN_RIGHT');
            decal.s = at('@DECAL_ALIGN_LEFT');
            break;
        case 12:
            decal.s = at('@DECAL_ALIGN_CENTER');
            break;
        case 22:
            decal.s = at('@DECAL_ALIGN_RIGHT');
            decal.e = at('@DECAL_ALIGN_LEFT');
            break;
    }
    return decal;
}

function buildTags(level: MapEditLevel): Record<string, unknown>[] {
    const tags: Record<string, unknown>[] = [];
    level.grid.forEach((row, y) => row.forEach((cell, x) => {
        if (cell.tags.length > 0) {
            tags.push({ x, y, tags: cell.tags.slice(0) });
        }
    }));
    return tags;
}

/** One light per cell whose block declares one, placed at the cell's centre. */
function buildLightsources(level: MapEditLevel): Record<string, unknown>[] {
    const ps = int(level.metrics.tileWidth);
    const half = ps >> 1;
    const lights: Record<string, unknown>[] = [];
    level.grid.forEach((row, y) => row.forEach((cell, x) => {
        const block = level.blocks.find(b => b.id === cell.block);
        if (block && block.light.enabled) {
            lights.push({
                x: x * ps + half,
                y: y * ps + half,
                r0: int(block.light.inner),
                r1: int(block.light.outer),
                v: parseFloat(String(block.light.value))
            });
        }
    }));
    return lights;
}

/** Reads the save's version, defaulting a file that predates the field. */
export function mapEditVersionOf(level: MapEditLevel): MapEditVersion {
    const declared = level.version;
    if (declared === undefined) {
        return MAPEDIT_1;
    }
    const known = MAPEDIT_VERSIONS.find(v => v === declared);
    if (known === undefined) {
        fail(
            `unknown save version "${declared}". This converter understands ` +
            `${MAPEDIT_VERSIONS.join(', ')}. A file with no version is read as ${MAPEDIT_1}.`
        );
    }
    return known;
}

/**
 * Compiles a MapEdit save into an RCE-100 level.
 *
 * A port of the original engine's `libs/generate` (521 lines of CommonJS that
 * ran behind a `/publish/` endpoint), kept out of the library proper: the
 * engine reads RCE-100 and must never learn the editor's shape, or the
 * editor's format could not change without changing the engine.
 *
 * An unrecognised `version` is refused rather than converted on a guess — the
 * same lesson as `resolveConstant`, where the original let a typo'd
 * `@PHYS_WALLL` through and produced a level that loaded and then behaved
 * wrongly.
 *
 * @param append combines tiles into sheets; see {@link ImageAppender}
 */
export async function convertMapEditLevel(
    level: MapEditLevel, append: ImageAppender
): Promise<Record<string, unknown>> {
    if (typeof append !== 'function') {
        fail('an image appender is required; see ImageAppender');
    }
    mapEditVersionOf(level);

    const tilesets: Record<string, unknown>[] = [];
    for (const ts of level.tiles.sprites) {
        tilesets.push(await buildTileset(level.tiles.sprites, ts.id, append));
    }

    return {
        version: 'RCE-100',
        tilesets,
        blueprints: level.things.map(t => buildBlueprint(level, t.id)),
        level: {
            ...buildMap(level),
            legend: level.blocks.map(b => buildLegendEntry(level, b)),
            textures: await buildTextures(level, append),
            metrics: {
                spacing: int(level.metrics.tileWidth),
                height: int(level.metrics.tileHeight)
            }
        },
        shading: buildShading(level),
        ...buildObjectsAndDecals(level),
        startpoints: level.startpoints.map(sp => ({
            x: sp.x,
            y: sp.y,
            z: 1,
            angle: sp.angle * Math.PI
        })),
        camera: { thinker: level.actor.thinker },
        tags: buildTags(level),
        lightsources: buildLightsources(level),
        preview: level.preview
    };
}
