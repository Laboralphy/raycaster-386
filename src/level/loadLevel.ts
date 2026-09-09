import { MapHelper } from '../map/MapHelper.js';
import type { BlockLight, BuiltMaterial, FaceDef, LevelMap, MaterialDef } from '../map/MapHelper.js';
import type { Face } from '../consts.js';
import type { LightHandle, Renderer } from '../Renderer.js';
import { resolveConstants } from './constants.js';
import type {
    DecalAlign, RceBlueprint, RceDecal, RceDecalFace, RceLevel, RceObject,
    RceStartPoint, RceTag, RceTileset
} from './types.js';

/** The only level format version this loader accepts. */
export const RCE_VERSION = 'RCE-100';

/**
 * Decal faces in surface-index order, so a face's position in this string is
 * the {@link Face} the renderer stores it under.
 */
const FACES = ['w', 's', 'e', 'n', 'f', 'c'] as const;

/** A tileset the level referenced, decoded but not shaded. */
export interface LoadedTileset {
    id: string | number;
    image: HTMLCanvasElement;
    /** Tile size, in pixels. */
    width: number;
    height: number;
    /** Sprite animations declared alongside it. Not interpreted here. */
    animations: readonly unknown[];
}

/**
 * The parts of a level this library does not implement, handed back intact.
 *
 * Entities, their blueprints, the camera's thinker and the tag grid belong to
 * a game, not to a renderer. Reporting them rather than dropping them is what
 * lets a caller build its own entity tier on top without re-parsing the file.
 */
export interface UnhandledSections {
    /** Merged with any supplied through {@link LoadLevelOptions.blueprints}. */
    blueprints: readonly RceBlueprint[];
    objects: readonly RceObject[];
    tags: readonly RceTag[];
    camera: unknown;
}

export interface LoadLevelOptions {
    /**
     * Decodes a texture named by the level, relative to wherever its assets
     * live. The library performs no I/O of its own: a browser resolves this
     * with `Image`, Node with a canvas package, a bundler with an import map.
     */
    loadImage: (src: string) => Promise<HTMLCanvasElement>;

    /**
     * Checks the level before anything is loaded, throwing if it is malformed.
     *
     * Left out, nothing is checked beyond the version and the symbols. Pass a
     * JSON-schema validator over the shipped `RCE_100_SCHEMA` to check the
     * whole document — worth doing while developing or in a level editor,
     * rarely worth the bytes in a release build that only loads its own
     * levels. It runs first, so a rejected level leaves the renderer untouched.
     */
    validate?: (data: unknown) => void;

    /**
     * Blueprints to merge into whatever the level declares.
     *
     * A game's bestiary is usually shared across levels and compiled at
     * runtime, so it is never in the level file — upstream this was
     * `Engine.buildLevel(data, extra)`. Supplied entries are appended, so a
     * level can still carry its own.
     */
    blueprints?: readonly RceBlueprint[];

    /** Tilesets to merge into whatever the level declares. See {@link blueprints}. */
    tilesets?: readonly RceTileset[];

    /** Which start point to report. Defaults to the first. */
    startpoint?: number;

    /** Loads a level whose version is not {@link RCE_VERSION}. */
    ignoreVersion?: boolean;
}

export interface LoadedLevel {
    /** The legend, resolved and bound to the renderer, in legend order. */
    materials: readonly BuiltMaterial[];
    /** Lights created because a material declares one. */
    blockLights: readonly BlockLight[];
    /** Lights declared by the level's own `lightsources` section. */
    lightsources: readonly LightHandle[];
    /** Only the tilesets a decal actually referenced, by id. */
    tilesets: ReadonlyMap<string | number, LoadedTileset>;
    /**
     * Every tileset declared, by id, including any supplied through the
     * options. Undecoded — {@link buildObjects} draws on this.
     */
    declaredTilesets: ReadonlyMap<string | number, RceTileset>;
    /** The chosen start point, in cell coordinates, or null if none. */
    startpoint: RceStartPoint | null;
    /** Every start point the level declares. */
    startpoints: readonly RceStartPoint[];
    unhandled: UnhandledSections;
}

/** Turns an RCE face entry into the shape {@link MapHelper} accepts. */
function toFaceDef(face: unknown): FaceDef | undefined {
    if (face === null || face === undefined) {
        return undefined;
    }
    return face as FaceDef;
}

/**
 * Projects the RCE-100 map section onto this library's own level shape.
 *
 * Written out rather than cast so that the two formats stay separable: RCE-100
 * is one importer onto {@link LevelMap}, not the shape the library thinks in.
 */
function toLevelMap(level: RceLevel['level']): LevelMap {
    return {
        map: level.map as LevelMap['map'],
        uppermap: (level.uppermap ?? null) as LevelMap['uppermap'],
        legend: level.legend.map((m): MaterialDef => {
            const f = m.faces;
            return {
                code: m.code,
                // Resolved from "@PHYS_*" before this runs.
                phys: m.phys as number,
                offset: m.offset ?? 0,
                ref: m.ref ?? '',
                faces: {
                    n: toFaceDef(f.n),
                    e: toFaceDef(f.e),
                    s: toFaceDef(f.s),
                    w: toFaceDef(f.w),
                    f: toFaceDef(f.f),
                    c: toFaceDef(f.c)
                }
            };
        })
    };
}

/**
 * Where a decal tile sits within the surface it is painted on.
 *
 * `align` is a numpad code: 7 is the top-left corner, 5 the centre, 3 the
 * bottom-right. Column and row fall straight out of it, replacing the
 * original's nine-case switch — exported so that equivalence can be tested
 * rather than argued.
 */
export function decalOffset(
    align: DecalAlign, surfaceWidth: number, surfaceHeight: number,
    tileWidth: number, tileHeight: number
): { x: number; y: number } {
    const xs = [0, (surfaceWidth - tileWidth) >> 1, surfaceWidth - tileWidth];
    const ys = [0, (surfaceHeight - tileHeight) >> 1, surfaceHeight - tileHeight];
    const column = (align - 1) % 3;
    const row = 2 - (((align - 1) / 3) | 0);
    return { x: xs[column], y: ys[row] };
}

/** Draws one tile of a tileset onto a surface, aligned within it. */
function drawDecal(
    canvas: HTMLCanvasElement, ts: LoadedTileset, tile: number, align: DecalAlign
): void {
    const at = decalOffset(align, canvas.width, canvas.height, ts.width, ts.height);
    const context = canvas.getContext('2d');
    if (context === null) {
        throw new Error('loadLevel: could not get a 2d context to paint a decal');
    }
    context.drawImage(
        ts.image,
        tile * ts.width, 0, ts.width, ts.height,
        at.x, at.y, ts.width, ts.height
    );
}

/**
 * Builds a renderer from a saved RCE-100 level.
 *
 * Call {@link Renderer.setScreen} first: the backdrop is scaled to the screen
 * height as it is loaded.
 *
 * Everything the renderer understands — metrics, shading, textures, the map,
 * decals and static lights — is applied to `renderer`. Everything above it is
 * returned under {@link LoadedLevel.unhandled} for the caller to act on.
 *
 * The level object is not modified, so it can be loaded again or kept as the
 * source of truth.
 */
export async function loadLevel(
    renderer: Renderer, level: RceLevel, options: LoadLevelOptions
): Promise<LoadedLevel> {
    const { loadImage, validate, ignoreVersion = false, startpoint = 0 } = options;

    // Before anything touches the renderer: a level that fails halfway leaves
    // it half-configured, with some materials registered and some not.
    validate?.(level);
    if (!ignoreVersion && level.version !== RCE_VERSION) {
        throw new Error(`loadLevel: expected version ${RCE_VERSION}, got "${String(level.version)}"`);
    }

    // Caller-supplied blueprints and tilesets are appended before resolution,
    // so their `@FX_*` symbols resolve like the level's own.
    const data = resolveConstants({
        ...level,
        blueprints: [...(level.blueprints ?? []), ...(options.blueprints ?? [])],
        tilesets: [...(level.tilesets ?? []), ...(options.tilesets ?? [])]
    });
    const { metrics, textures } = data.level;

    renderer.setMetrics(metrics);
    renderer.setTextureSmoothing(!!textures.smooth);
    renderer.setStretch(!!textures.stretch);
    if (data.shading !== undefined) {
        const { color, filter, brightness, shades } = data.shading;
        renderer.setShading({
            // No saved level writes a layer count; the renderer's own default
            // stands rather than being overwritten with a guess.
            shades: shades ?? renderer.shading.shades,
            color,
            filter,
            brightness
        });
        renderer.shadingFactor = data.shading.factor;
    }

    // Shading and metrics are set first: both atlases are sliced at the cell
    // size and pre-shaded into as many layers as the settings above ask for.
    if (textures.sky !== undefined && textures.sky !== '') {
        renderer.setBackground(await loadImage(textures.sky));
    }
    renderer.setWallTextures(await loadImage(textures.walls));
    renderer.setFlatTextures(await loadImage(textures.flats));

    const { materials, blockLights } = new MapHelper().build(renderer, toLevelMap(data.level));

    // Decals. A tileset is decoded the first time a decal names it, so a level
    // carrying a sheet only its entities use costs nothing here.
    const declared = new Map<string | number, RceTileset>(
        (data.tilesets ?? []).map(ts => [ts.id, ts])
    );
    const tilesets = new Map<string | number, LoadedTileset>();

    const tileset = async (id: string | number): Promise<LoadedTileset> => {
        const loaded = tilesets.get(id);
        if (loaded !== undefined) {
            return loaded;
        }
        const def = declared.get(id);
        if (def === undefined) {
            throw new Error(`loadLevel: a decal refers to tileset "${String(id)}", which the level does not declare`);
        }
        const built: LoadedTileset = {
            id,
            image: await loadImage(def.src),
            width: def.width,
            height: def.height,
            animations: def.animations ?? []
        };
        tilesets.set(id, built);
        return built;
    };

    for (const decal of data.decals ?? []) {
        for (let face = 0; face < FACES.length; ++face) {
            const paint = decal[FACES[face] as keyof RceDecal] as RceDecalFace | undefined;
            if (paint === undefined) {
                continue;
            }
            const ts = await tileset(paint.tileset);
            const align = paint.align as DecalAlign;
            const tile = paint.tile ?? 0;
            renderer.paintSurface(decal.x, decal.y, face as Face, (_x, _y, _face, canvas) => {
                drawDecal(canvas, ts, tile, align);
            });
        }
    }

    const lightsources = (data.lightsources ?? []).map(ls =>
        renderer.addLightSource(ls.x, ls.y, ls.r0, ls.r1, ls.v)
    );

    const startpoints = data.startpoints ?? [];

    return {
        materials,
        blockLights,
        lightsources,
        tilesets,
        declaredTilesets: declared,
        startpoint: startpoints[startpoint] ?? null,
        startpoints,
        unhandled: {
            blueprints: data.blueprints ?? [],
            objects: data.objects ?? [],
            tags: data.tags ?? [],
            camera: data.camera
        }
    };
}
