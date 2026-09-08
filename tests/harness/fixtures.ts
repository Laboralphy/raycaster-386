import { makeCanvas } from './dom.js';

/**
 * An animated face: [start tile, frame count, ticks per frame, loop mode].
 * Matches the array form MapHelper accepts in a level legend.
 */
export type FaceAnimation = readonly [number, number, number, number];

/** A face is a fixed tile, an animation, or nothing. */
export type FaceDef = number | FaceAnimation | null;

/** A tile's face assignment for one material code. */
export interface MaterialFaces {
    n: FaceDef;
    e: FaceDef;
    s: FaceDef;
    w: FaceDef;
    f: FaceDef;
    c: FaceDef;
}

export function isFaceAnimation(f: FaceDef): f is FaceAnimation {
    return Array.isArray(f);
}

export interface CameraPose {
    name: string;
    x: number;
    y: number;
    angle: number;
    /** 1 is eye level; anything else takes the general (slower) flat path. */
    height: number;
    /**
     * Ticks to advance surface animations by before rendering.
     *
     * Animations only move when the caller advances them, so pinning this per
     * pose keeps an animated scene as reproducible as a static one, and lets
     * several poses capture different frames of the same animation.
     */
    animationTime?: number;
}

/** A billboard placed in the world. */
export interface SpriteSpec {
    x: number;
    y: number;
    /** Altitude above the floor. */
    h?: number;
    /** Projected size is divided by this. */
    scale?: number;
    /** FX_* flags. */
    flags?: number;
    /** Tile index within the sprite atlas. */
    tile?: number;
}

/** A texture painted onto one face of one cell. */
export interface DecalSpec {
    x: number;
    y: number;
    face: number;
    /** Solid fill drawn over the extracted tile. */
    fill: string;
}

/** An upper floor, sharing this scene's materials and atlases. */
export interface StoreySpec {
    map: string[];
}

export interface LightSpec {
    x: number;
    y: number;
    r0: number;
    r1: number;
    v: number;
}

/** What one map character means. */
export interface LegendEntry {
    material: number;
    phys?: number;
    offset?: number;
}

/**
 * A complete, declarative description of a scene to render. The same spec
 * drives the original engine and the port, so any pixel difference is a
 * difference in the renderer, not in the setup.
 */
export interface SceneSpec {
    name: string;
    screen: { width: number; height: number };
    metrics: { spacing: number; height: number };
    shading: { shades: number; color: string; filter: string | null; brightness: number };
    /** Number of distinct tiles in the generated atlases. */
    tileCount: number;
    materials: Record<number, MaterialFaces>;
    /** One string per row; each character is looked up in `legend`. */
    map: string[];
    legend: Record<string, LegendEntry>;
    lights?: LightSpec[];
    /**
     * A backdrop drawn behind everything. Only visible through cells whose
     * ceiling face is null, since the flat rasteriser paints over it.
     */
    background?: { width: number; height: number };
    sprites?: SpriteSpec[];
    decals?: DecalSpec[];
    storey?: StoreySpec;
    cameras: CameraPose[];
}

/** Sprite atlas tile size. Deliberately not the wall tile size. */
export const SPRITE_TILE_WIDTH = 32;
export const SPRITE_TILE_HEIGHT = 48;

/** Sprite atlas: narrower and shorter tiles than the walls use. */
export function buildSpriteAtlas(tiles = 4): HTMLCanvasElement {
    return buildAtlas(tiles, SPRITE_TILE_WIDTH, SPRITE_TILE_HEIGHT);
}

/** Resolves a storey's map grid into per-cell entries. */
export function* storeyCells(spec: SceneSpec): Generator<{ x: number; y: number; entry: LegendEntry }> {
    const storey = spec.storey;
    if (storey === undefined) {
        return;
    }
    for (let y = 0; y < storey.map.length; ++y) {
        const row = storey.map[y];
        for (let x = 0; x < row.length; ++x) {
            const entry = spec.legend[row[x]];
            if (entry === undefined) {
                throw new Error(`fixtures: storey map character "${row[x]}" is not in the legend`);
            }
            yield { x, y, entry };
        }
    }
}

/**
 * Builds a deterministic texture atlas of `tiles` tiles, each `tw` x `th`.
 *
 * Pixels are computed per-texel rather than drawn with canvas primitives, so
 * the atlas is identical on any backend, and every texel is distinguishable:
 * a horizontal ramp exposes a column sampling error, a vertical ramp exposes
 * a row error, and the per-tile border exposes an off-by-one tile offset.
 */
export function buildAtlas(tiles: number, tw: number, th: number): HTMLCanvasElement {
    const canvas = makeCanvas(tiles * tw, th);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(tiles * tw, th);
    const d = img.data;
    const w = tiles * tw;

    for (let y = 0; y < th; ++y) {
        for (let x = 0; x < w; ++x) {
            const tile = (x / tw) | 0;
            const lx = x % tw;
            const i = (y * w + x) * 4;

            const border = lx === 0 || lx === tw - 1 || y === 0 || y === th - 1;
            const diagonal = ((lx + y) % 16) < 2;

            if (border) {
                // Solid per-tile border colour: an off-by-one tile shows up here.
                d[i] = 255;
                d[i + 1] = (tile * 40) & 0xff;
                d[i + 2] = 0;
            } else if (diagonal) {
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = 255;
            } else {
                // Ramps in both axes: any sampling shift changes the value.
                d[i] = ((lx * 255) / tw) | 0;
                d[i + 1] = ((y * 255) / th) | 0;
                d[i + 2] = (40 + tile * 53) & 0xff;
            }
            d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/** Wall atlas: tiles are `spacing` wide and `height` tall. */
export function buildWallAtlas(spec: SceneSpec): HTMLCanvasElement {
    return buildAtlas(spec.tileCount, spec.metrics.spacing, spec.metrics.height);
}

/**
 * A backdrop: vertical bands with a horizon, wide enough that turning wraps it.
 *
 * Built at the screen height so neither engine rescales it, which keeps the
 * comparison about rendering rather than about resampling.
 */
export function buildBackground(spec: SceneSpec): HTMLCanvasElement {
    const { width, height } = spec.background ?? { width: 384, height: 128 };
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.createImageData(width, height);
    const d = img.data;
    const horizon = height >> 1;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const i = (y * width + x) * 4;
            const band = (x / 24) | 0;
            if (y < horizon) {
                // Sky: banded, darkening upward, so a horizontal shift shows.
                d[i] = (30 + band * 17) & 0xff;
                d[i + 1] = (60 + y * 2) & 0xff;
                d[i + 2] = 160 + ((y * 3) & 0x3f);
            } else {
                d[i] = (90 + band * 11) & 0xff;
                d[i + 1] = 70;
                d[i + 2] = 50;
            }
            d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/** Flat atlas: tiles are square, `spacing` on a side. */
export function buildFlatAtlas(spec: SceneSpec): HTMLCanvasElement {
    return buildAtlas(spec.tileCount, spec.metrics.spacing, spec.metrics.spacing);
}

/** Resolves the map grid of a spec into per-cell entries. */
export function* cells(spec: SceneSpec): Generator<{ x: number; y: number; entry: LegendEntry }> {
    for (let y = 0; y < spec.map.length; ++y) {
        const row = spec.map[y];
        for (let x = 0; x < row.length; ++x) {
            const ch = row[x];
            const entry = spec.legend[ch];
            if (entry === undefined) {
                throw new Error(`fixtures: map character "${ch}" is not in the legend`);
            }
            yield { x, y, entry };
        }
    }
}

/** Map size implied by a spec's grid. Always square. */
export function mapSizeOf(spec: SceneSpec): number {
    const h = spec.map.length;
    for (const row of spec.map) {
        if (row.length !== h) {
            throw new Error(`fixtures: map must be square, got a ${row.length}-wide row in a ${h}-row map`);
        }
    }
    return h;
}
