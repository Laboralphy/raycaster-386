import { ShadedTileSet } from '../texture/ShadedTileSet.js';

/**
 * One drawing operation: a vertical strip of texture, or a whole sprite.
 *
 * Kept as a tuple rather than an object because a frame produces one per
 * screen column plus one per sprite, and this is the shape the original used.
 * The element names below are what the editor shows for `slice[2]`.
 *
 * ```
 *   0 tileset   1 sx   2 sy   3 sw   4 sh
 *   5 dx        6 dy   7 dw   8 dh
 *   9 z        10 fx
 * ```
 *
 * A null tileset means "skip this slice" — invisible blocks and fully closed
 * door panels produce them.
 */
export type ZSlice = [
    tileset: ShadedTileSet | null,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    z: number,
    fx: number
];

/**
 * Orders slices back to front, so translucent surfaces composite over what is
 * behind them. Ties break on destination x to keep the order stable.
 */
export function compareSlices(a: ZSlice, b: ZSlice): number {
    if (a[9] !== b[9]) {
        return b[9] - a[9];
    }
    return a[5] - b[5];
}

/** Depth difference below which two slices count as the same surface. */
const MERGE_Z_TOLERANCE = 8;

/**
 * Merges adjacent screen columns that sample the same texture at the same
 * column and roughly the same depth, widening one slice instead of drawing
 * several one-pixel ones.
 *
 * The lookback is three deep because a transparent wall makes one screen
 * column emit several slices at different depths through `scene.resume`, so
 * consecutive buffer entries interleave between near and far surfaces.
 * castRay's watchdog allows up to six resumes, so three is a deliberate
 * cost/benefit cap rather than full coverage.
 */
export function optimizeBuffer(zb: ZSlice[]): ZSlice[] {
    const zbl = zb.length;
    if (zbl === 0) {
        return [];
    }
    // With fewer than three entries the three cursors below would alias the
    // same slice, and the tail would push it three times with three different
    // widths. The original did exactly that, drawing one slice three times.
    if (zbl < 3) {
        return zb.slice();
    }

    const out: ZSlice[] = [];
    const abs = Math.abs;
    let last = zb[0];
    let lastN = 1;
    let last2 = last;
    let last2N = 1;
    let last3 = last;
    let last3N = 1;

    for (let i = 0; i < zbl; ++i) {
        const b = zb[i];
        if (b[10] === last[10] && b[0] === last[0] && b[1] === last[1] && abs(b[9] - last[9]) < MERGE_Z_TOLERANCE) {
            ++lastN;
        } else if (b[10] === last2[10] && b[0] === last2[0] && b[1] === last2[1] && abs(b[9] - last2[9]) < MERGE_Z_TOLERANCE) {
            ++last2N;
        } else if (b[10] === last3[10] && b[0] === last3[0] && b[1] === last3[1] && abs(b[9] - last3[9]) < MERGE_Z_TOLERANCE) {
            ++last3N;
        } else {
            last3[7] = last3N;
            out.push(last3);
            last3 = last2;
            last3N = last2N;
            last2 = last;
            last2N = lastN;
            last = b;
            lastN = 1;
        }
    }
    last3[7] = last3N;
    out.push(last3);
    last2[7] = last2N;
    out.push(last2);
    last[7] = lastN;
    out.push(last);

    return out;
}
