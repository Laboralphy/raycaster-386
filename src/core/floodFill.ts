import { MarkerRegistry } from './MarkerRegistry.js';

/** A cell visited by {@link floodFill}. */
export interface FilledCell {
    x: number;
    y: number;
}

/**
 * Flood-fills outward from a cell, four-connected.
 *
 * `test` says whether a cell belongs to the region; it is called at most once
 * per cell. Used to clear a tag from a whole room at once, where the "region"
 * is every neighbouring cell carrying the same tag.
 *
 * The original marked a cell only once it was popped, so a cell could be
 * pushed by several neighbours before that happened and be reported more than
 * once — and it pushed the starting cell twice outright, guaranteeing at least
 * one duplicate in every result. Marking on push fixes both, and halves the
 * work on any region wider than a corridor.
 */
export function floodFill(
    x: number,
    y: number,
    test: (x: number, y: number) => boolean
): FilledCell[] {
    const seen = new MarkerRegistry();
    const out: FilledCell[] = [];
    const stack: FilledCell[] = [];

    const consider = (cx: number, cy: number): void => {
        if (seen.isMarked(cx, cy) || !test(cx, cy)) {
            return;
        }
        seen.mark(cx, cy);
        stack.push({ x: cx, y: cy });
    };

    consider(x, y);
    while (stack.length > 0) {
        const cell = stack.pop() as FilledCell;
        out.push(cell);
        consider(cell.x, cell.y - 1);
        consider(cell.x, cell.y + 1);
        consider(cell.x + 1, cell.y);
        consider(cell.x - 1, cell.y);
    }
    return out;
}
