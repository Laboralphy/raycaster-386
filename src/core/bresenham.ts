/**
 * Walks the integer points of the line (x0, y0) -> (x1, y1), calling back for
 * each one. Returning `false` from the callback aborts the walk.
 *
 * @returns false if the callback aborted, true if the line was completed.
 */
export function line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    plot: (x: number, y: number, n: number) => boolean | void
): boolean {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let n = 0;
    for (;;) {
        if (plot(x0, y0, n) === false) {
            return false;
        }
        if (x0 === x1 && y0 === y1) {
            return true;
        }
        const e2 = err << 1;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
        ++n;
    }
}
