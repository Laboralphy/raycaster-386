/**
 * The RCE-100 level format, as written by the original map editor.
 *
 * These types describe the file on disk, not the shape the renderer works
 * with: symbolic constants are still strings here (`"@PHYS_WALL"`), and the
 * entity-tier sections are carried through untouched. {@link
 * ../level/loadLevel.loadLevel} resolves the former and reports the latter.
 *
 * Fields that hold a constant are typed `string | number` because both forms
 * are legal: a saved level writes the symbol, and one declared in code may
 * reference the exported constant directly.
 */

/** A symbolic constant (`"@PHYS_WALL"`) or its resolved value. */
export type ConstantRef = string | number;

/** Cell size and wall height, in world units and texels. */
export interface RceMetrics {
    spacing: number;
    height: number;
}

/** The three texture atlases a level names, and how they are sampled. */
export interface RceTextures {
    walls: string;
    flats: string;
    /** Backdrop. Empty or absent means no sky. */
    sky?: string;
    /** Nearest-neighbour when false. */
    smooth?: boolean;
    /** Draw upper storeys at double height. */
    stretch?: boolean;
}

/**
 * Fog and ambient colour.
 *
 * `shades` is absent from every saved level, which is why it is optional here:
 * the editor never wrote it and the renderer's default stands.
 */
export interface RceShading {
    color: string;
    /** World distance over which shading deepens by one layer. */
    factor: number;
    brightness: number;
    filter: string | null;
    shades?: number;
}

/** One face of a legend entry: a tile index, an animation, or nothing. */
export type RceFace = number | readonly [start: number, length: number, duration: number, loop: ConstantRef] | null;

/** One entry of the legend: a material, and the six faces it presents. */
export interface RceMaterial {
    /** The value used for this material in the map grid. */
    code: string | number;
    phys: ConstantRef;
    offset?: number;
    /** Free-form identifier, carried through for the caller's use. */
    ref?: string;
    faces: {
        n?: RceFace;
        e?: RceFace;
        s?: RceFace;
        w?: RceFace;
        f?: RceFace;
        c?: RceFace;
    };
}

/** The map proper: a legend, a grid indexing it, and an optional upper floor. */
export interface RceLevelMap {
    map: readonly (readonly (string | number)[])[];
    uppermap?: readonly (readonly (string | number)[])[] | null;
    legend: readonly RceMaterial[];
    textures: RceTextures;
    metrics: RceMetrics;
}

/** A sheet of tiles, referenced by decals and by entity sprites. */
export interface RceTileset {
    id: string | number;
    src: string;
    width: number;
    height: number;
    animations?: readonly unknown[];
}

/** Where a decal sits on its face. Numpad layout: 7 is top-left, 5 centre. */
export type DecalAlign = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** A decal on one face of one cell. */
export interface RceDecalFace {
    tileset: string | number;
    align: ConstantRef;
    /** Index into the tileset. Defaults to 0. */
    tile?: number;
}

/** A cell carrying decals, on any of its six faces. */
export interface RceDecal {
    x: number;
    y: number;
    n?: RceDecalFace;
    e?: RceDecalFace;
    s?: RceDecalFace;
    w?: RceDecalFace;
    f?: RceDecalFace;
    c?: RceDecalFace;
}

/** A traced static light, in world coordinates. */
export interface RceLightSource {
    x: number;
    y: number;
    /** Radius of full intensity. */
    r0: number;
    /** Radius at which intensity reaches zero. */
    r1: number;
    /** Intensity, 0..1. */
    v: number;
}

/** Where the camera starts, in cell coordinates. */
export interface RceStartPoint {
    x: number;
    y: number;
    /** Eye height, 1 being the default. */
    z: number;
    /** Heading, in radians. */
    angle: number;
}

/** Tags attached to a cell. Meaningless to the renderer; reported as-is. */
export interface RceTag {
    x: number;
    y: number;
    tags: readonly string[];
}

/**
 * A complete RCE-100 level.
 *
 * `blueprints`, `objects`, `camera` and `tags` belong to the entity tier,
 * which this library does not implement. They are typed loosely, never
 * interpreted, and handed back under {@link LoadedLevel.unhandled}.
 */
export interface RceLevel {
    version: string;
    level: RceLevelMap;
    shading?: RceShading;
    tilesets?: readonly RceTileset[];
    decals?: readonly RceDecal[];
    lightsources?: readonly RceLightSource[];
    startpoints?: readonly RceStartPoint[];
    blueprints?: readonly unknown[];
    objects?: readonly unknown[];
    tags?: readonly RceTag[];
    camera?: unknown;
    /** A thumbnail the editor stores. Ignored. */
    preview?: string;
}
