import {
    FACE_COUNT,
    FACE_EAST,
    FACE_NORTH,
    FACE_SOUTH,
    FACE_WEST,
    SURFACE_LIGHTMAP_SCALE,
    type Face,
    type WallFace,
} from '../consts.js';
import { ShadedTileSet } from '../texture/ShadedTileSet.js';

/**
 * Per-surface data attached to one face of one cell.
 */
export interface CellSurface {
    readonly x: number;
    readonly y: number;
    /** A painted-on texture overriding the cell's material, or null. */
    tileset: ShadedTileSet | null;
    /** Pixel data of the shaded decal. Flats only (faces 4 and 5). */
    imageData: ImageData | null;
    /** 32-bit view of {@link imageData}, read directly by the flat rasteriser. */
    imageData32: Uint32Array | null;
    /**
     * Light level along this surface, one entry per
     * {@link SURFACE_LIGHTMAP_SCALE} sub-column. A view into the manager's
     * shared buffer, so writes are contiguous in memory.
     */
    readonly lightMap: Uint8Array;
}

/**
 * Attaches paintable surfaces and light levels to every face of every cell.
 *
 * Surfaces are stored flat, indexed `(y * width + x) * FACE_COUNT + face`.
 */
export class CellSurfaceManager {
    private _surfaces: CellSurface[] = [];
    private _surfaceLightMaps = new Uint8Array(0);
    /** Light level per lightmap cell, at SURFACE_LIGHTMAP_SCALE per map cell. */
    private _lightMap = new Uint8Array(0);
    private _width = 0;
    private _height = 0;
    private _lightMapWidth = 0;

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    /** Lightmap cells per map cell. */
    get lightMapCellCount(): number {
        return SURFACE_LIGHTMAP_SCALE;
    }

    /**
     * The raw light levels, row-major at {@link lightMapWidth}.
     *
     * Exposed so the flat rasteriser can index it directly; it samples once
     * per pixel and cannot afford an accessor call there.
     */
    get lightMapData(): Uint8Array {
        return this._lightMap;
    }

    get lightMapWidth(): number {
        return this._lightMapWidth;
    }

    /**
     * The raw surface array, indexed `(y * width + x) * FACE_COUNT + face`.
     *
     * Same reason as {@link lightMapData}: the caller does its own bounds
     * check once per cell rather than per pixel.
     */
    get surfaces(): readonly CellSurface[] {
        return this._surfaces;
    }

    /**
     * Rebuilds the surface grid at a new size. All painted decals are lost.
     */
    setMapSize(w: number, h: number): void {
        this._width = w;
        this._height = h;

        const lmc = SURFACE_LIGHTMAP_SCALE;
        const count = w * h * FACE_COUNT;
        const surfaces: CellSurface[] = new Array<CellSurface>(count);
        // One contiguous buffer for every surface's light strip; each surface
        // gets a view into it rather than an array of its own.
        const lightMaps = new Uint8Array(count * lmc);

        for (let y = 0, i = 0; y < h; ++y) {
            for (let x = 0; x < w; ++x) {
                for (let face = 0; face < FACE_COUNT; ++face, ++i) {
                    surfaces[i] = {
                        x,
                        y,
                        tileset: null,
                        imageData: null,
                        imageData32: null,
                        lightMap: lightMaps.subarray(i * lmc, (i + 1) * lmc),
                    };
                }
            }
        }
        this._surfaces = surfaces;
        this._surfaceLightMaps = lightMaps;

        this._lightMapWidth = w * lmc;
        this._lightMap = new Uint8Array(this._lightMapWidth * h * lmc);
    }

    /**
     * The surface data for one face of one cell, or null if out of bounds.
     */
    getSurface(x: number, y: number, face: Face): CellSurface | null {
        if (x < 0 || y < 0 || x >= this._width || y >= this._height) {
            return null;
        }
        return this._surfaces[(y * this._width + x) * FACE_COUNT + face];
    }

    /**
     * The light level at a world position, in texel coordinates.
     *
     * @param ps cell size in world units
     */
    getLightMap(x: number, y: number, ps: number): number {
        const lmc = SURFACE_LIGHTMAP_SCALE;
        const xLM = ((lmc * x) / ps) | 0;
        const yLM = ((lmc * y) / ps) | 0;
        return this._lightMap[yLM * this._lightMapWidth + xLM];
    }

    /**
     * Writes one lightmap cell, and mirrors it onto the wall surfaces it
     * borders so that walls pick up the light of the floor next to them.
     *
     * @param xc lightmap cell coordinates
     * @param yc lightmap cell coordinates
     */
    setLightMap(xc: number, yc: number, value: number): void {
        const lmc = SURFACE_LIGHTMAP_SCALE;
        this._lightMap[yc * this._lightMapWidth + xc] = value;

        const xMod = xc % lmc;
        const yMod = yc % lmc;
        const xCell = (xc / lmc) | 0;
        const yCell = (yc / lmc) | 0;

        if (yMod === 0) {
            // Northern row of this cell: also the south face of the cell above.
            const surf = this.getSurface(xCell, yCell - 1, FACE_SOUTH);
            if (surf) {
                surf.lightMap[xMod] = value;
            }
        }
        if (yMod === lmc - 1) {
            // Southern row: also the north face of the cell below.
            const surf = this.getSurface(xCell, yCell + 1, FACE_NORTH);
            if (surf) {
                surf.lightMap[lmc - 1 - xMod] = value;
            }
        }
        if (xMod === 0) {
            // Western column: also the east face of the cell to the left.
            const surf = this.getSurface(xCell - 1, yCell, FACE_EAST);
            if (surf) {
                surf.lightMap[lmc - 1 - yMod] = value;
            }
        }
        if (xMod === lmc - 1) {
            // Eastern column: also the west face of the cell to the right.
            const surf = this.getSurface(xCell + 1, yCell, FACE_WEST);
            if (surf) {
                surf.lightMap[yMod] = value;
            }
        }
    }

    /**
     * Rotates the four wall surfaces of a cell.
     *
     * Used to prepare a texture on a hidden face and reveal it later without
     * paying to redraw it.
     */
    rotateWallSurfaces(x: number, y: number, clockwise: boolean): void {
        const base = (y * this._width + x) * FACE_COUNT;
        const s = this._surfaces;
        const tilesets = [
            s[base].tileset,
            s[base + 1].tileset,
            s[base + 2].tileset,
            s[base + 3].tileset,
        ];
        if (clockwise) {
            tilesets.push(tilesets.shift() as ShadedTileSet | null);
        } else {
            tilesets.unshift(tilesets.pop() as ShadedTileSet | null);
        }
        for (let i = 0; i < 4; ++i) {
            s[base + i].tileset = tilesets[i];
        }
    }

    /**
     * Attaches a painted texture to a surface, replacing the cell's material
     * there. The tileset is left unshaded; call {@link shadeSurface} after.
     */
    setDecal(x: number, y: number, face: Face, tile: HTMLCanvasElement): void {
        const surface = this.getSurface(x, y, face);
        if (surface === null) {
            throw new RangeError(`CellSurfaceManager.setDecal: (${x}, ${y}) is outside the map`);
        }
        surface.imageData = null;
        surface.imageData32 = null;
        const ts = new ShadedTileSet();
        // A decal on a floor or a ceiling is sampled per pixel by the flat
        // rasteriser and never drawn, so it holds its shaded layers as pixels.
        ts.setPixelStorage(!isWallFace(face));
        ts.setImage(tile, tile.width, tile.height);
        surface.tileset = ts;
    }

    removeDecal(x: number, y: number, face: Face): void {
        const surface = this.getSurface(x, y, face);
        if (surface !== null) {
            surface.tileset = null;
            surface.imageData = null;
            surface.imageData32 = null;
        }
    }

    /**
     * Recomputes the shading of one painted surface. For flats, also caches
     * the shaded pixels for the flat rasteriser to sample directly.
     */
    shadeSurface(
        x: number,
        y: number,
        face: Face,
        shades: number,
        fogColor: string,
        filter: string | null,
        brightness: number
    ): void {
        const surface = this.getSurface(x, y, face);
        if (surface === null) {
            return;
        }
        const ts = surface.tileset;
        if (ts === null) {
            return;
        }
        ts.setShadingLayerCount(shades);
        ts.compute(fogColor, filter, brightness);
        if (!isWallFace(face)) {
            surface.imageData = ts.getPixels();
            surface.imageData32 = ts.getPixels32();
        }
    }

    /**
     * Recomputes every painted surface. Only worth calling when the shading
     * settings themselves change.
     */
    shadeAllSurfaces(
        shades: number,
        fogColor: string,
        filter: string | null,
        brightness: number
    ): void {
        const s = this._surfaces;
        for (let i = 0, l = s.length; i < l; ++i) {
            const surface = s[i];
            if (surface.tileset !== null) {
                this.shadeSurface(
                    surface.x,
                    surface.y,
                    (i % FACE_COUNT) as Face,
                    shades,
                    fogColor,
                    filter,
                    brightness
                );
            }
        }
    }

    /**
     * Approximate bytes held by painted decals and by the light maps.
     *
     * Decals are counted once each: {@link rotateWallSurfaces} moves one
     * tileset between the faces of a cell rather than copying it.
     */
    getMemoryUsage(): { decals: number; lightMaps: number } {
        const counted = new Set<ShadedTileSet>();
        const s = this._surfaces;
        for (let i = 0, l = s.length; i < l; ++i) {
            const ts = s[i].tileset;
            if (ts !== null) {
                counted.add(ts);
            }
        }
        let decals = 0;
        for (const ts of counted) {
            decals += ts.getMemoryUsage();
        }
        return {
            decals,
            lightMaps: this._surfaceLightMaps.byteLength + this._lightMap.byteLength,
        };
    }

    /** Clears every surface light level back to zero. */
    clearLightMap(): void {
        this._lightMap.fill(0);
        this._surfaceLightMaps.fill(0);
    }
}

/** Narrowing helper: true for the four vertical faces. */
export function isWallFace(face: Face): face is WallFace {
    return face < 4;
}
