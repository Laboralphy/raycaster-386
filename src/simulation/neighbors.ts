import type { ReadonlyCellMap } from '../core/CellMap.js';

/** Cells sharing an edge with the subject. */
export const CELL_NEIGHBOR_SIDE = 1;
/** Cells sharing only a corner. */
export const CELL_NEIGHBOR_CORNER = 2;
/** The subject cell itself. */
export const CELL_NEIGHBOR_SELF = 4;

/**
 * Visits the cells around one cell, passing each cell's phys code.
 *
 * `types` is a bitmask of the `CELL_NEIGHBOR_*` flags above.
 *
 * Cells outside the map are skipped. `CellMap` indexes a flat array without a
 * bounds check, so `getPhys(-1, y)` reads the last cell of the row above and
 * reports it as this cell's neighbour — which upstream could link a secret
 * passage to an unrelated block on the far edge of the map.
 */
export function forEachNeighbor(
    map: ReadonlyCellMap,
    x: number,
    y: number,
    visit: (x: number, y: number, phys: number) => void,
    types: number
): void {
    const sides = (types & CELL_NEIGHBOR_SIDE) > 0;
    const corners = (types & CELL_NEIGHBOR_CORNER) > 0;
    const self = (types & CELL_NEIGHBOR_SELF) > 0;
    for (let dx = -1; dx < 2; ++dx) {
        for (let dy = -1; dy < 2; ++dy) {
            const wanted = dx === 0 && dy === 0 ? self : dx === 0 || dy === 0 ? sides : corners;
            if (!wanted) {
                continue;
            }
            const cx = x + dx;
            const cy = y + dy;
            if (cx < 0 || cy < 0 || cx >= map.size || cy >= map.size) {
                continue;
            }
            visit(cx, cy, map.getPhys(cx, cy));
        }
    }
}
