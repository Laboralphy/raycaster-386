import { Vector } from '../../src';
import { moveActor } from '../../src/simulation';
import type { Actor, Thinker } from '../../src/simulation';
import type { DemoContext } from './world.js';

/** Player movement speed, in world units per tick. */
const WALK_SPEED = 3.2;
/** Turn speed, in radians per tick. */
const TURN_SPEED = 0.045;
/** The sentinel's pacing speed, in world units per tick. */
const SENTINEL_SPEED = 1.1;

/**
 * Behaviour, one class per kind of actor.
 *
 * A thinker is the library's unit of behaviour: the registry runs `think` on
 * every actor once a tick, so nothing here is called by hand and `World` never
 * grows a branch per actor kind. Both of these move through
 * {@link moveActor}, which slides them along walls — the player and the
 * sentinel are the same kind of thing to the simulation, and only differ in
 * what they decide to do.
 */

/**
 * Steers the player from the tick's input.
 *
 * The input arrives on the context rather than on the actor, because it is a
 * property of the tick and not of the player: the same snapshot is what a
 * replay would feed back in. Opening a door is *not* here — that reads what
 * the centre ray struck, which is renderer state, so `World` owns it.
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

/**
 * Paces the sentinel north and south, turning where it is blocked.
 *
 * `moveActor` returns how far the actor *actually* went, so a zero on the axis
 * it was walking means a wall — no probing of the map needed to know it has
 * arrived at one.
 */
export class SentinelThinker implements Thinker<DemoContext> {
    think(actor: Actor<DemoContext>, context: DemoContext): void {
        const direction = actor.data.direction as number;
        const travelled = moveActor(actor, context, new Vector(0, direction * SENTINEL_SPEED));
        if (travelled.y === 0) {
            actor.data.direction = -direction;
        }
        // Face the way it is walking, so the billboard picks the right frame.
        actor.position.angle = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
}
