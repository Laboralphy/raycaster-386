import {
    CELL_MATERIAL_MASK,
    FX_DIM0,
    PHYS_CURT_DOWN,
    PHYS_CURT_UP,
    PHYS_DOOR_DOUBLE,
    PHYS_DOOR_DOWN,
    PHYS_DOOR_LEFT,
    PHYS_DOOR_RIGHT,
    PHYS_DOOR_UP,
    PHYS_INVISIBLE_BLOCK
} from '../consts.js';
import { offsetOf, physOf } from '../core/CellMap.js';
import type { ShadedTileSet } from '../texture/ShadedTileSet.js';
import type { RenderContext } from './context.js';
import type { Scene } from './Scene.js';
import type { ZSlice } from './ZBuffer.js';

/**
 * Turns one ray hit into a drawing operation: which texel column of which
 * tile, scaled to which screen rectangle, at which shading level.
 *
 * The switch afterwards displaces that rectangle for doors and curtains,
 * which slide within their own cell rather than opening as separate geometry.
 */
export function createScreenSlice(
    ctx: RenderContext,
    scene: Scene,
    x: number,
    tileset: ShadedTileSet,
    tile: number,
    light: number
): ZSlice {
    const z = Math.max(0.1, scene.distance);
    const nPos = scene.wallColumn;
    const dim = scene.wallXed;
    const panel = scene.cellCode;

    const ytex = ctx.wallHeight;
    const xtex = ctx.spacing;
    const xscr = ctx.screenWidth;
    const yscr = ctx.screenWidth >> 1;
    const shades = ctx.shades;
    const halfShades = shades >> 1;

    const dz = ((yscr * ytex) / z) | 0;
    const dzy = yscr - dz * scene.camera.height;

    const phys = physOf(panel);
    const offset = offsetOf(panel);

    let opacity = (z / ctx.shadingFactor) | 0;
    if (dim) {
        // x-axed surfaces are darkened by half the shading range, so the two
        // wall orientations read as differently lit.
        opacity = (((shades - halfShades) * opacity) / shades + halfShades - light) | 0;
    } else {
        opacity -= light;
    }
    opacity = Math.max(0, Math.min(shades - 1, opacity));

    const tileX = tile * xtex;
    const slice: ZSlice = [
        tileset,
        tileX + nPos,
        ytex * opacity,
        1,
        ytex,
        x,
        (dzy - ctx.offsetTop - 1) | 0,
        1,
        ((dz << 1) + 2) | 0,
        z,
        dim ? FX_DIM0 : 0
    ];

    switch (phys) {
        case PHYS_DOOR_UP:
            slice[2] += offset;
            if (offset > 0) {
                slice[4] = ytex - offset;
                slice[8] = slice[4] / (z / xscr) + 0.5;
            }
            break;

        case PHYS_CURT_UP:
            if (offset > 0) {
                slice[8] = (ytex - offset) / (z / xscr) + 0.5;
            }
            break;

        case PHYS_CURT_DOWN:
            slice[2] += offset;
        // falls through: a downward curtain is a downward door that also
        // scrolls its source. Do not reorder these two cases.
        case PHYS_DOOR_DOWN:
            if (offset > 0) {
                slice[4] = ytex - offset;
                slice[8] = slice[4] / (z / xscr) + 0.5;
                slice[6] += (dz - slice[8]) << 1;
                slice[8] <<= 1;
            }
            break;

        case PHYS_DOOR_LEFT:
            if (offset > 0) {
                if (nPos > xtex - offset) {
                    slice[0] = null;
                } else {
                    slice[1] = ((nPos + offset) % xtex) + tileX;
                }
            }
            break;

        case PHYS_DOOR_RIGHT:
            if (offset > 0) {
                if (nPos < offset) {
                    slice[0] = null;
                } else {
                    slice[1] = ((nPos + xtex - offset) % xtex) + tileX;
                }
            }
            break;

        case PHYS_DOOR_DOUBLE:
            if (offset > 0) {
                const half = xtex >> 1;
                if (nPos < half) {
                    if (nPos > half - offset) {
                        slice[0] = null;
                    } else {
                        slice[1] = ((nPos + offset) % xtex) + tileX;
                    }
                } else {
                    if (nPos < half + offset) {
                        slice[0] = null;
                    } else {
                        slice[1] = ((nPos + xtex - offset) % xtex) + tileX;
                    }
                }
            }
            break;

        case PHYS_INVISIBLE_BLOCK:
            slice[0] = null;
            break;
    }

    if (ctx.stretch && !ctx.firstFloor) {
        slice[6] -= slice[8];
        slice[8] <<= 1;
    }
    return slice;
}

/** The material code carried by a packed cell code. */
export function materialCodeOf(cellCode: number): number {
    return cellCode & CELL_MATERIAL_MASK;
}
