import { Vector } from '../../src';
import { moveActor } from '../../src/simulation';
import type { Actor, Thinker } from '../../src/simulation';
import type { DemoContext } from './world.js';

/** Player movement speed, in world units per tick. */
const WALK_SPEED = 3.2;
/** Turn speed, in radians per tick. Mouse look in `input.ts` divides by this. */
export const TURN_SPEED = 0.045;

/**
 * Steers the player from the tick's input.
 *
 * Identical to `demos/simple`'s, deliberately: what changed between the two
 * demos is the level, not the way an actor is driven. Behaviour is Game's, so
 * it lives here rather than in the library — `Thinker` is the plug point.
 */
export class PlayerThinker implements Thinker<DemoContext> {
    think(actor: Actor<DemoContext>, context: DemoContext): void {
        const { input } = context;
        const p = actor.position;
        p.angle += input.turn * TURN_SPEED;
        if (input.forward === 0 && input.strafe === 0) {
            return;
        }
        const cos = Math.cos(p.angle);
        const sin = Math.sin(p.angle);
        moveActor(
            actor,
            context,
            new Vector(
                (cos * input.forward - sin * input.strafe) * WALK_SPEED,
                (sin * input.forward + cos * input.strafe) * WALK_SPEED
            )
        );
    }
}
