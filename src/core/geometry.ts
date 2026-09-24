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
    xc: number,
    yc: number,
    r: number,
    xr: number,
    yr: number,
    wr: number,
    hr: number
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

/** A full turn, in radians. */
const TURN = Math.PI * 2;

/**
 * Reduces an angle to [0, 2*PI), whatever it started as.
 *
 * For keeping an accumulated heading tidy: a sprite turning on the spot winds
 * past a revolution within seconds, and an angle read back as 48213.9 tells
 * nobody anything, in a log or in a saved game.
 *
 * Not for precision — a double holds an angle to about 1e-15 rad at one
 * revolution and still to 1e-9 after a year of spinning, against 0.004 rad for
 * one screen pixel of rotation, so nothing here is at risk either way. The
 * engine's own maths reduces what it is given: see `faceCamera`.
 *
 * `%` alone would not do: it keeps the sign of its left operand, so -0.3
 * stays -0.3 rather than becoming 5.98.
 */
export function wrapAngle(a: number): number {
    const wrapped = a - TURN * Math.floor(a / TURN);
    // floor() of a tiny negative puts the result exactly on the turn, which is
    // outside the range this promises.
    return wrapped === TURN ? 0 : wrapped;
}

/**
 * Reduces an angle to (-PI, PI], the half turn either side of straight ahead.
 *
 * The form to use for a difference between two angles: the sign is the way to
 * turn and the magnitude is how far, so the shorter way round falls out.
 */
export function wrapAngleSigned(a: number): number {
    const wrapped = wrapAngle(a + Math.PI) - Math.PI;
    return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * Linear interpolation: the y of `v` on the segment (x1, y1)-(x3, y3).
 */
export function linear(v: number, x1: number, y1: number, x3: number, y3: number): number {
    return ((v - x1) * (y3 - y1)) / (x3 - x1) + y1;
}
