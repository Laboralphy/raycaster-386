/**
 * Which sides of a mobile touched something this move.
 *
 * `x` and `y` are -1, 0 or 1: the direction of the side that hit, not a
 * distance. `c` is true if anything hit at all.
 */
export interface WallCollisionFlags {
    x: number;
    y: number;
    c: boolean;
}

export interface WallCollisionResult {
    /** Where the mobile ends up. */
    pos: { x: number; y: number };
    /** How far it actually moved, which is less than asked for on a hit. */
    speed: { x: number; y: number };
    wcf: WallCollisionFlags;
}

/** True if this world position is inside something solid. */
export type SolidTest = (x: number, y: number) => boolean;

/**
 * Moves a square mobile, sliding it along walls rather than stopping it dead.
 *
 * The mobile is probed at four points, `size` out from its centre along each
 * axis. A probe that would land in something solid cancels that axis of the
 * movement, so a diagonal into a wall keeps the component running parallel to
 * it — which is what makes a corridor walkable without pixel-perfect steering.
 *
 * `crashWall` turns that off: both axes stop together, for something that
 * should hit a wall rather than slide along it, like a projectile.
 *
 * Nothing here knows about the map: `isSolid` answers for a world position, so
 * a caller can consult cell phys codes, a door's state, or anything else.
 */
export function computeWallCollisions(
    x: number,
    y: number,
    dx: number,
    dy: number,
    size: number,
    spacing: number,
    crashWall: boolean,
    isSolid: SolidTest
): WallCollisionResult {
    const startX = x;
    const startY = y;
    const wcf: WallCollisionFlags = { x: 0, y: 0, c: false };

    // The probe on the trailing side is skipped: moving east tests north, east
    // and south but not west. Without this a mobile straddling a door frame is
    // caught by the edge it has already passed and sticks in the doorway.
    const ignored = (Math.abs(dx) > Math.abs(dy) ? 1 : 0) | (dx > dy || (dx === dy && dx < 0) ? 2 : 0);

    let corrected = false;
    // i is a direction: 0 north, 1 east, 2 south, 3 west.
    for (let i = 0; i < 4; ++i) {
        if (ignored === i) {
            continue;
        }
        const xci = (i & 1) * Math.sign(2 - i);
        const yci = ((3 - i) & 1) * Math.sign(i - 1);
        const ix = size * xci + x;
        const iy = size * yci + y;
        // Each axis is tested with only its own delta applied, so hitting a
        // wall head-on does not also cancel the movement running along it.
        if (isSolid(ix + dx, iy)) {
            wcf.c = true;
            dx = 0;
            if (crashWall) {
                dy = 0;
                wcf.y = yci || wcf.y;
            }
            wcf.x = xci || wcf.x;
            corrected = true;
        }
        if (isSolid(ix, iy + dy)) {
            wcf.c = true;
            dy = 0;
            if (crashWall) {
                dx = 0;
                wcf.x = xci || wcf.x;
            }
            wcf.y = yci || wcf.y;
            corrected = true;
        }
    }

    x += dx;
    y += dy;

    if (!corrected) {
        return { pos: { x, y }, speed: { x: dx, y: dy }, wcf };
    }

    // Snap flush against the cell face that stopped it, so repeated pushes into
    // a wall do not accumulate a sub-texel gap. The -1 keeps the mobile just
    // inside its own cell rather than exactly on the boundary.
    if (wcf.x > 0) {
        x = ((x / spacing) | 0) * spacing + spacing - 1 - size;
    } else if (wcf.x < 0) {
        x = ((x / spacing) | 0) * spacing + size;
    }
    if (wcf.y > 0) {
        y = ((y / spacing) | 0) * spacing + spacing - 1 - size;
    } else if (wcf.y < 0) {
        y = ((y / spacing) | 0) * spacing + size;
    }
    return { pos: { x, y }, speed: { x: x - startX, y: y - startY }, wcf };
}
