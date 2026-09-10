import type { ActorId } from '../core/actorFrame.js';
import { Dummy } from './Dummy.js';

/** Where an actor is, and which way it points. */
export interface ActorPosition {
    /** World coordinates, in texels. */
    x: number;
    y: number;
    /** Altitude above the floor; negative sinks it in. */
    z: number;
    /** Facing, in radians. */
    angle: number;
}

/**
 * Behaviour, run once a tick. `C` is whatever context the game passes.
 *
 * The original drove every thinker through a string-keyed state machine
 * (`main: { loop: ['$move'] }`, dispatched by `this[name](...)`). For the
 * thinkers this library ships that only says "run this each tick", which is
 * what `think` already means, so the machine is not ported: a game wanting
 * states brings its own and calls it from `think`.
 */
export interface Thinker<C = unknown> {
    think(actor: Actor<C>, context: C): void;
    /** Called once, before the first {@link think}. */
    attach?(actor: Actor<C>, context: C): void;
    /** Called when the actor leaves the registry, to undo {@link attach}. */
    detach?(actor: Actor<C>, context: C): void;
}

/**
 * A thing in the world: a position, a size, a collision body and a behaviour.
 *
 * **It holds no sprite and no light.** Those belong to the renderer, and an
 * actor that referenced them could not run on a server with no canvas. What
 * ties the two together is {@link Actor.id}: the game binds that id to a
 * sprite, and the registry reports movement against it.
 *
 * `dead` is the game's flag, not the library's — it means "remove me now",
 * not "my hit points reached zero". A death animation runs while the actor is
 * still alive; the game sets `dead` once it has played out, and the registry
 * sweeps it on the next tick.
 */
export class Actor<C = unknown> {
    readonly id: ActorId;
    readonly position: ActorPosition = { x: 0, y: 0, z: 0, angle: 0 };
    /** The collision body. Its radius is kept in step with {@link size}. */
    readonly dummy = new Dummy();
    /** Free-form payload. The library never reads it. */
    data: Record<string, unknown> = {};
    /** A name the level gave this actor's blueprint, if any. */
    ref = '';
    thinker: Thinker<C> | null = null;
    /** Set by the game when it is finished with this actor. */
    dead = false;

    /** Position as last reported in an {@link ActorFrame}. */
    private _lastX = NaN;
    private _lastY = NaN;
    private _lastZ = NaN;
    private _lastAngle = NaN;

    constructor(id: ActorId) {
        this.id = id;
        this.dummy.entity = id;
    }

    /** Collision radius. */
    get size(): number {
        return this.dummy.radius;
    }

    set size(value: number) {
        this.dummy.radius = value;
    }

    /**
     * True if the actor has moved since it was last reported.
     *
     * The comparison is against this actor's own last reported position, not
     * against a sprite — which is what lets it work with nothing drawing. The
     * original compared `sprite.z` against `entity.position.z`, and `Sprite`
     * has no `z`, so the answer was always "yes" and every actor's light and
     * sector were rewritten every frame.
     */
    hasMoved(): boolean {
        const p = this.position;
        return (
            p.x !== this._lastX || p.y !== this._lastY ||
            p.z !== this._lastZ || p.angle !== this._lastAngle
        );
    }

    /** Records the current position as reported. */
    markReported(): void {
        const p = this.position;
        this._lastX = p.x;
        this._lastY = p.y;
        this._lastZ = p.z;
        this._lastAngle = p.angle;
    }
}
