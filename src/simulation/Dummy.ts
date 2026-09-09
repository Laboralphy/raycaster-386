import { angle as angleBetween, squareDistance } from '../core/geometry.js';
import { Vector } from '../core/Vector.js';
import { ForceField } from './ForceField.js';

/**
 * What a mobile collides with, as two bitmasks.
 *
 * `self` is what this mobile *is*; `hitmask` is what it collides *with*. A
 * mobile with `self: 0` is intangible and takes part in no collision at all.
 */
export interface Tangibility {
    self: number;
    hitmask: number;
}

/** A sector a dummy has been filed under. */
export interface DummySector {
    add(entity: unknown): void;
    remove(entity: unknown): void;
}

/**
 * The collision body of one actor: a circle with a position, a radius and a
 * force field.
 *
 * It holds no sprite and no behaviour — only what the collision solver needs,
 * plus an opaque `entity` id so a caller can map it back to whatever it owns.
 */
export class Dummy {
    /** Opaque handle back to the caller's actor. Never interpreted here. */
    entity: string | number = 0;
    dead = false;
    radius = 0;
    mass = 1;
    readonly tangibility: Tangibility = { self: 1, hitmask: 1 };
    readonly forceField = new ForceField();

    private readonly _position = new Vector();
    private readonly _force = new Vector();
    private _colliderSector: DummySector | null = null;
    private _smashers: unknown[] = [];

    get position(): Vector {
        return this._position;
    }

    set position(value: Vector) {
        this._position.set(value);
    }

    /** The resultant of this tick's forces. Written by the solver. */
    get force(): Vector {
        return this._force;
    }

    get colliderSector(): DummySector | null {
        return this._colliderSector;
    }

    set colliderSector(value: DummySector | null) {
        this._colliderSector = value;
    }

    /** Whatever is currently overlapping this dummy. */
    get smashers(): readonly unknown[] {
        return this._smashers;
    }

    setSmashers(a: readonly unknown[]): void {
        this._smashers = [...a];
    }

    clearSmashers(): void {
        this._smashers = [];
    }

    /** True if this dummy's hitmask accepts the other's type. */
    tangibleWith(other: Dummy): boolean {
        return (other.tangibility.self & this.tangibility.hitmask) !== 0;
    }

    nearerThan(other: Dummy, d: number): boolean {
        const p1 = this._position;
        const p2 = other.position;
        return squareDistance(p1.x, p1.y, p2.x, p2.y) < d * d;
    }

    distanceTo(other: Dummy): number {
        const p1 = this._position;
        const p2 = other.position;
        return Math.sqrt(squareDistance(p1.x, p1.y, p2.x, p2.y));
    }

    angleTo(other: Dummy): number {
        const p1 = this._position;
        const p2 = other.position;
        return angleBetween(p1.x, p1.y, p2.x, p2.y);
    }

    /** True if the two circles overlap and are tangible to each other. */
    hits(other: Dummy): boolean {
        return this.tangibleWith(other) && this.nearerThan(other, this.radius + other.radius);
    }
}
