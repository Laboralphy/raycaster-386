import { angle as angleBetween, distance } from './geometry.js';

/**
 * A 2D vector.
 *
 * **Mutability is mixed, deliberately** — this is the original's contract and
 * the collision code depends on both halves:
 *
 * - `add`, `sub`, `neg`, `mul`, `normalize` return a new vector
 * - `set`, `translate`, `scale` modify this one and return it
 *
 * The pairing that matters is `v.normalize().scale(n)`: normalize hands back a
 * fresh vector, which scale is then free to modify in place.
 */
export class Vector {
    x: number;
    y: number;

    constructor(x: number | Vector = 0, y = 0) {
        if (x instanceof Vector) {
            this.x = x.x;
            this.y = x.y;
        } else {
            this.x = x;
            this.y = y;
        }
    }

    static zero(): Vector {
        return new Vector(0, 0);
    }

    /** Mutable. */
    set(x: number | Vector, y = 0): this {
        if (x instanceof Vector) {
            this.x = x.x;
            this.y = x.y;
        } else {
            this.x = x;
            this.y = y;
        }
        return this;
    }

    /** Mutable: adds `v` to this vector. */
    translate(v: Vector): this {
        this.x += v.x;
        this.y += v.y;
        return this;
    }

    /** Mutable: multiplies both components by `f`. */
    scale(f: number): this {
        this.x *= f;
        this.y *= f;
        return this;
    }

    add(v: Vector): Vector {
        return new Vector(this.x + v.x, this.y + v.y);
    }

    sub(v: Vector): Vector {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    neg(): Vector {
        return new Vector(-this.x, -this.y);
    }

    /**
     * Scalar multiple, as a new vector.
     *
     * The original overloaded one `mul` to return either a vector or a dot
     * product depending on its argument's type. Split here, because a function
     * whose return type depends on its argument is a poor fit for TypeScript
     * and was a poor fit for readers either way. See {@link dot}.
     */
    mul(f: number): Vector {
        return new Vector(this.x * f, this.y * f);
    }

    /** Dot product. */
    dot(v: Vector): number {
        return this.x * v.x + this.y * v.y;
    }

    length(): number {
        return distance(0, 0, this.x, this.y);
    }

    /**
     * A unit vector in the same direction, as a new vector.
     *
     * A zero vector has no direction: this returns zero rather than the
     * `(NaN, NaN)` the original produced by dividing by zero length.
     */
    normalize(): Vector {
        const len = this.length();
        return len === 0 ? new Vector(0, 0) : this.mul(1 / len);
    }

    /** Angle from the +x axis. */
    angle(): number {
        return angleBetween(0, 0, this.x, this.y);
    }

    toString(): string {
        return `${this.x}:${this.y}`;
    }
}
