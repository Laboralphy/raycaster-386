import {
    CELL_OFFSET_MASK,
    CELL_OFFSET_SHIFT,
    CELL_PHYS_MASK,
    CELL_PHYS_SHIFT,
    PHYS_FIRST_DOOR,
    PHYS_INVISIBLE_BLOCK,
    PHYS_LAST_DOOR,
    PHYS_NONE,
    PHYS_OFFSET_BLOCK,
    PHYS_SECRET_BLOCK,
    PHYS_TRANSPARENT_BLOCK,
    type Face
} from '../consts.js';
import type { MarkerRegistry } from '../core/MarkerRegistry.js';
import type { RenderContext } from './context.js';
import type { Scene } from './Scene.js';

/**
 * True for a wall the rays pass through but that is still a wall: an opened
 * door, a window, a barrier, an invisible block.
 */
export function isWallTransparent(ctx: RenderContext, x: number, y: number): boolean {
    const phys = ctx.map.getPhys(x, y);
    if (phys === PHYS_NONE) {
        return false;
    }
    const offset = ctx.map.getOffset(x, y);
    return (
        (phys >= PHYS_FIRST_DOOR && phys <= PHYS_LAST_DOOR && offset !== 0) ||
        phys === PHYS_TRANSPARENT_BLOCK ||
        phys === PHYS_INVISIBLE_BLOCK
    );
}

/**
 * Decides whether an offset surface still belongs to the cell being entered.
 *
 * A recessed wall (an alcove, a door set back in its frame) is hit at a point
 * that may actually lie in the neighbouring cell; stepping the intersection
 * forward by the offset and re-deriving the cell tells the two apart.
 */
function sameOffsetWall(
    offset: number,
    x0: number,
    y0: number,
    xm: number,
    ym: number,
    dx: number,
    dy: number,
    ps: number
): boolean {
    const x = x0 + offset * dx;
    const y = y0 + offset * dy;
    return ((x / ps) | 0) === xm && ((y / ps) | 0) === ym;
}

/**
 * Casts one ray through the grid until it meets a solid surface, using a DDA
 * traversal that steps to whichever axis boundary comes first.
 *
 * Writes its result into `scene`. When it stops on a transparent surface it
 * arms `scene.resume` so the caller can continue past it.
 */
export function projectRay(
    ctx: RenderContext,
    scene: Scene,
    x: number,
    y: number,
    dx: number,
    dy: number,
    exclusionRegistry: MarkerRegistry,
    visibleRegistry: MarkerRegistry
): void {
    const map = ctx.map;
    const mapData = map.data;
    const mapSize = map.size;
    // The DDA loop below runs several times per screen column, so the field
    // extractions are inlined rather than going through CellMap's accessors.
    const nScale = scene.spacing;
    const cmax = scene.maxDistance;
    const resume = scene.resume;

    let side = 0;
    let xi: number;
    let yi: number;

    if (resume.active) {
        xi = resume.xi;
        yi = resume.yi;
    } else {
        xi = (x / nScale) | 0;
        yi = (y / nScale) | 0;
    }
    const xoff = x / nScale - xi;
    const yoff = y / nScale - yi;

    let xt: number;
    let dxt: number;
    let dxi: number;
    if (dx < 0) {
        xt = -xoff / dx;
        dxt = -1 / dx;
        dxi = -1;
    } else {
        xt = (1 - xoff) / dx;
        dxt = 1 / dx;
        dxi = 1;
    }

    let yt: number;
    let dyt: number;
    let dyi: number;
    if (dy < 0) {
        yt = -yoff / dy;
        dyt = -1 / dy;
        dyi = -1;
    } else {
        yt = (1 - yoff) / dy;
        dyt = 1 / dy;
        dyi = 1;
    }

    const xScale = nScale * dx;
    const yScale = nScale * dy;

    let t = 0;
    let done = false;
    let c = 0;
    let stillVisible = true;
    let nOfs = 0;
    let nTOfs = 0;
    let cellCode = 0;
    let phys = 0;
    let xint = 0;
    let yint = 0;

    while (!done) {
        if (xt < yt) {
            xi += dxi;
            if (xi >= 0 && xi < mapSize) {
                cellCode = mapData[yi * mapSize + xi];
                phys = (cellCode >>> CELL_PHYS_SHIFT) & CELL_PHYS_MASK;

                if (cellCode !== 0 && exclusionRegistry.isMarked(xi, yi)) {
                    phys = cellCode = 0;
                }

                if (phys >= PHYS_FIRST_DOOR && phys <= PHYS_LAST_DOOR) {
                    // Doors sit half a cell in.
                    nOfs = nScale >> 1;
                } else if (
                    phys === PHYS_SECRET_BLOCK ||
                    phys === PHYS_TRANSPARENT_BLOCK ||
                    phys === PHYS_OFFSET_BLOCK
                ) {
                    nOfs = (cellCode >>> CELL_OFFSET_SHIFT) & CELL_OFFSET_MASK;
                } else {
                    nOfs = 0;
                }

                if (nOfs) {
                    xint = x + xScale * xt;
                    yint = y + yScale * xt;
                    if (sameOffsetWall(nOfs, xint, yint, xi, yi, dx, dy, nScale)) {
                        nTOfs = (dxt / nScale) * nOfs;
                        yint = y + yScale * (xt + nTOfs);
                        if (((yint / nScale) | 0) !== yi) {
                            phys = cellCode = 0;
                        }
                        if (cellCode !== 0 && exclusionRegistry.isMarked(xi, yi)) {
                            phys = cellCode = 0;
                        }
                    } else {
                        phys = cellCode = 0;
                    }
                } else {
                    nTOfs = 0;
                }

                if (phys === PHYS_INVISIBLE_BLOCK || phys === PHYS_NONE) {
                    if (stillVisible) {
                        visibleRegistry.mark(xi, yi);
                    }
                    xt += dxt;
                } else {
                    t = xt + nTOfs;
                    xint = x + xScale * t;
                    yint = y + yScale * t;
                    done = true;
                    side = 1;
                    stillVisible = false;
                }
            } else {
                // Left the map.
                t = xt;
                c = cmax;
            }
        } else {
            yi += dyi;
            if (yi >= 0 && yi < mapSize) {
                cellCode = mapData[yi * mapSize + xi];
                phys = (cellCode >>> CELL_PHYS_SHIFT) & CELL_PHYS_MASK;

                if (cellCode !== 0 && exclusionRegistry.isMarked(xi, yi)) {
                    phys = cellCode = 0;
                }

                if (phys >= PHYS_FIRST_DOOR && phys <= PHYS_LAST_DOOR) {
                    nOfs = nScale >> 1;
                } else if (
                    phys === PHYS_SECRET_BLOCK ||
                    phys === PHYS_TRANSPARENT_BLOCK ||
                    phys === PHYS_OFFSET_BLOCK
                ) {
                    nOfs = (cellCode >>> CELL_OFFSET_SHIFT) & CELL_OFFSET_MASK;
                } else {
                    nOfs = 0;
                }

                if (nOfs) {
                    xint = x + xScale * yt;
                    yint = y + yScale * yt;
                    if (sameOffsetWall(nOfs, xint, yint, xi, yi, dx, dy, nScale)) {
                        nTOfs = (dyt / nScale) * nOfs;
                        xint = x + xScale * (yt + nTOfs);
                        if (((xint / nScale) | 0) !== xi) {
                            phys = cellCode = 0;
                        }
                        if (cellCode !== 0 && exclusionRegistry.isMarked(xi, yi)) {
                            phys = cellCode = 0;
                        }
                    } else {
                        phys = cellCode = 0;
                    }
                } else {
                    nTOfs = 0;
                }

                if (phys === PHYS_INVISIBLE_BLOCK || phys === PHYS_NONE) {
                    if (stillVisible) {
                        visibleRegistry.mark(xi, yi);
                    }
                    yt += dyt;
                } else {
                    t = yt + nTOfs;
                    xint = x + xScale * t;
                    yint = y + yScale * t;
                    done = true;
                    side = 2;
                    stillVisible = false;
                }
            } else {
                t = yt;
                c = cmax;
            }
        }
        ++c;
        if (c >= cmax) {
            done = true;
        }
    }

    if (c < cmax) {
        scene.cellCode = mapData[yi * mapSize + xi];
        scene.wallXed = side === 1;
        let cellSide: Face = (side - 1) as Face;
        let wallColumn = scene.wallXed ? yint % scene.spacing | 0 : xint % scene.spacing | 0;
        if (scene.wallXed && dxi < 0) {
            wallColumn = scene.spacing - wallColumn - 1;
            cellSide = 2;
        }
        if (!scene.wallXed && dyi > 0) {
            wallColumn = scene.spacing - wallColumn - 1;
            cellSide = 3;
        }
        scene.cellSide = cellSide;
        scene.wallColumn = wallColumn;
        scene.xCell = xi;
        scene.yCell = yi;
        scene.distance = t * nScale;
        scene.exterior = false;
        scene.dx = dx;
        scene.dy = dy;
        scene.x = x;
        scene.y = y;
        scene.xint = xint;
        scene.yint = yint;
        if (isWallTransparent(ctx, xi, yi)) {
            resume.active = true;
            resume.xi = xi;
            resume.yi = yi;
        } else {
            resume.active = false;
        }
    } else {
        scene.distance = t * nScale;
        scene.exterior = true;
        resume.active = false;
    }
}
