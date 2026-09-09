/**
 * The two geometry helpers the renderer actually needs: sprite projection
 * distance, and the light-source / dirty-region overlap test.
 */

export function distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

export function squareDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

/**
 * True if the circle (xc, yc, r) overlaps the rectangle (xr, yr, wr, hr).
 */
export function circleInRect(
    xc: number, yc: number, r: number,
    xr: number, yr: number, wr: number, hr: number
): boolean {
    const xNearest = Math.max(xr, Math.min(xc, xr + wr));
    const yNearest = Math.max(yr, Math.min(yc, yr + hr));
    const xDelta = xc - xNearest;
    const yDelta = yc - yNearest;
    return xDelta * xDelta + yDelta * yDelta < r * r;
}

/**
 * The angle from (x1, y1) to (x2, y2), measured from the +x axis.
 *
 * The only transcendental in the simulation tier's dependencies. It is used by
 * `Dummy.angleTo`, a query, never by the collision solver — so a client and
 * server simulating in lockstep are not exposed to `Math.atan2` being
 * unspecified in precision. Keep it that way.
 */
export function angle(x1: number, y1: number, x2: number, y2: number): number {
    return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Linear interpolation: the y of `v` on the segment (x1, y1)-(x3, y3).
 */
export function linear(v: number, x1: number, y1: number, x3: number, y3: number): number {
    return ((v - x1) * (y3 - y1)) / (x3 - x1) + y1;
}
