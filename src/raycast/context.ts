import type { Face, WallFace } from '../consts.js';
import type { CellMap } from '../core/CellMap.js';
import type { CellSurfaceManager } from '../map/CellSurfaceManager.js';
import type { Profiler } from '../render/Profiler.js';
import type { ShadedTileSet } from '../texture/ShadedTileSet.js';
import type { TileAnimation } from '../texture/TileAnimation.js';

/**
 * A tile reference on one face of a material: a fixed tileset index, an
 * animation that yields one, or null for "draw nothing here".
 */
export type SurfaceTile = number | TileAnimation | null;

/**
 * Face assignments per material code, ordered [w, s, e, n, floor, ceiling] to
 * match the Face constants.
 */
export type CellCodes = (SurfaceTile[] | undefined)[];

/**
 * Resolves a face's tile reference to a tileset index.
 *
 * Returns null when the face draws nothing, or when the material was never
 * registered — the original indexed the table unguarded and threw a
 * TypeError on an unregistered code.
 */
export function resolveTile(codes: CellCodes, code: number, face: Face): number | null {
    const faces = codes[code];
    if (faces === undefined) {
        return null;
    }
    const tile = faces[face];
    if (tile === null || tile === undefined) {
        return null;
    }
    return typeof tile === 'object' ? tile.frame() : tile;
}

/**
 * Everything the raycasting and rasterising functions read.
 *
 * These are plain fields rather than nested option objects on purpose: the
 * original reached through `this._options.shading.factor` once per screen
 * column and once per pixel, and every one of those was a getter call
 * installed by the Reactor. Hoisting them here makes each a field load.
 */
export interface RenderContext {
    readonly map: CellMap;
    readonly csm: CellSurfaceManager;
    readonly cellCodes: CellCodes;
    walls: ShadedTileSet | null;
    /** Cell size in world units. */
    spacing: number;
    /** Wall height in texels. */
    wallHeight: number;
    screenWidth: number;
    screenHeight: number;
    /** Number of precomputed shading layers. */
    shades: number;
    /** World distance over which shading deepens by one layer. */
    shadingFactor: number;
    /** Vertical offset of the rendered band within the canvas. */
    offsetTop: number;
    /** Upper storeys are drawn at double height. */
    stretch: boolean;
    /** False for the upper storey instance. */
    firstFloor: boolean;
    /**
     * Per screen column, the rows an opaque wall will be drawn over.
     *
     * Filled while the z-buffer is cast and read by the flat rasteriser, which
     * skips the floor and ceiling pixels that fall inside the band: the wall
     * is drawn after the flats and repaints every one of them. `coverTop` is
     * the first covered row and `coverBottom` the first row past the band, so
     * an untouched column reads as an empty band.
     */
    coverTop: Int32Array;
    coverBottom: Int32Array;
    /** Collects per-phase timings when one is attached; null by default. */
    profiler: Profiler | null;
}

/** Narrowing helper for the four vertical faces. */
export function isWall(face: Face): face is WallFace {
    return face < 4;
}
