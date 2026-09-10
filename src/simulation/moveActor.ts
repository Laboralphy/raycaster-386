import { PHYS_NONE } from '../consts.js';
import type { ReadonlyCellMap } from '../core/CellMap.js';
import { Vector } from '../core/Vector.js';
import type { Actor } from './Actor.js';
import { computeWallCollisions } from './wallCollider.js';

/** What sliding an actor needs to know about the world. */
export interface MotionContext {
    /** Read to decide what blocks movement. */
    map: ReadonlyCellMap;
    /** Cell size in world units. */
    spacing: number;
}

/**
 * Displaces an actor by `v`, sliding it along whatever is solid.
 *
 * The bridge between {@link computeWallCollisions} and an {@link Actor}: it
 * reads the actor's size for the probe distance, consults the map through the
 * context, and writes the result back into the actor's position.
 *
 * Deliberately a function rather than a base class. Behaviour is the game's —
 * this is only the movement primitive that would otherwise be rewritten in
 * every one.
 *
 * @param crashWall stop dead on contact instead of sliding, as a projectile does
 * @returns how far the actor actually moved, which is less than `v` against a wall
 */
export function moveActor(
    actor: Actor<never> | Actor<unknown>,
    context: MotionContext,
    v: Vector,
    crashWall = false
): Vector {
    if (v.x === 0 && v.y === 0) {
        return new Vector(0, 0);
    }
    const ps = context.spacing;
    const map = context.map;
    const result = computeWallCollisions(
        actor.position.x,
        actor.position.y,
        v.x,
        v.y,
        actor.size,
        ps,
        crashWall,
        (x, y) => map.getPhys((x / ps) | 0, (y / ps) | 0) !== PHYS_NONE
    );
    actor.position.x += result.speed.x;
    actor.position.y += result.speed.y;
    return new Vector(result.speed.x, result.speed.y);
}
