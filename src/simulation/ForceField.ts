import { Vector } from '../core/Vector.js';

/** One force in a field, with the factor it decays by each tick. */
export interface Force {
    v: Vector;
    /** Multiplier applied on each {@link ForceField.reduceForces}. */
    f: number;
}

/**
 * The set of forces pushing on one mobile.
 *
 * Collision does not move anything itself: it accumulates forces here, the
 * caller reads the resultant and decides what to do with it. A force with a
 * decay factor of 0 lasts exactly one tick, which is what a collision push is.
 */
export class ForceField {
    private _forces: Force[] = [];

    get forces(): readonly Force[] {
        return this._forces;
    }

    addForce(v: Vector, f: number): Force {
        const force: Force = { v, f };
        this._forces.push(force);
        return force;
    }

    /** The sum of every force, as a new vector. */
    computeForces(): Vector {
        const sum = new Vector(0, 0);
        for (const force of this._forces) {
            sum.translate(force.v);
        }
        return sum;
    }

    /**
     * Decays every force and drops those that have become negligible.
     *
     * Decay is in place, so a force is weaker the next time it is summed.
     */
    reduceForces(): void {
        this._forces = this._forces.filter((force) => force.v.scale(force.f).length() > 0.01);
    }

    /** Drops every force. */
    clear(): void {
        this._forces = [];
    }
}
