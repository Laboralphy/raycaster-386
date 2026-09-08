import { MarkerRegistry } from '../core/MarkerRegistry.js';

let LAST_ID = 0;

/** A light source's geometry, in lightmap cell units. */
export interface LightSourceState {
    id: number;
    /** Centre. */
    x: number;
    y: number;
    /** Radius of full intensity. */
    r0: number;
    /** Radius at which intensity reaches zero. */
    r1: number;
    /** Intensity, 0..1. */
    v: number;
}

/**
 * A point light. All coordinates are in lightmap cells, not world units;
 * the Renderer's public light handle does that conversion.
 *
 * Mutating any geometry property invalidates the source, and through
 * `onInvalidate` the light map that owns it. This replaces the Reactor that
 * used to observe the metrics object.
 */
export class LightSource {
    private _x = 0;
    private _y = 0;
    private _r0 = 0;
    private _r1 = 0;
    private _v = 0;
    private _id = ++LAST_ID;
    private _invalid = true;

    /** Set by the owning LightMap so a change here invalidates the map too. */
    onInvalidate: (() => void) | null = null;

    /** Cells already computed during the current trace. */
    readonly computed = new MarkerRegistry();
    /** Cells lit during the current trace. */
    private _livePixels = new MarkerRegistry();
    /** Cells lit during the previous trace but not this one. */
    private _deadPixels = new MarkerRegistry();

    get id(): number {
        return this._id;
    }

    get x(): number {
        return this._x;
    }

    set x(value: number) {
        if (value !== this._x) {
            this._x = value;
            this.invalidate();
        }
    }

    get y(): number {
        return this._y;
    }

    set y(value: number) {
        if (value !== this._y) {
            this._y = value;
            this.invalidate();
        }
    }

    get r0(): number {
        return this._r0;
    }

    set r0(value: number) {
        if (value !== this._r0) {
            this._r0 = value;
            this.invalidate();
        }
    }

    get r1(): number {
        return this._r1;
    }

    set r1(value: number) {
        if (value !== this._r1) {
            this._r1 = value;
            this.invalidate();
        }
    }

    /** Intensity, 0..1. */
    get v(): number {
        return this._v;
    }

    set v(value: number) {
        if (value !== this._v) {
            this._v = value;
            this.invalidate();
        }
    }

    get deadPixels(): MarkerRegistry {
        return this._deadPixels;
    }

    get state(): LightSourceState {
        return { id: this._id, x: this._x, y: this._y, r0: this._r0, r1: this._r1, v: this._v };
    }

    set state({ id, x, y, r0, r1, v }: LightSourceState) {
        this._id = id;
        this._x = x;
        this._y = y;
        this._r0 = r0;
        this._r1 = r1;
        this._v = v;
        LAST_ID = Math.max(LAST_ID, id);
        this.invalidate();
    }

    invalidate(): void {
        this._invalid = true;
        this.onInvalidate?.();
    }

    isInvalid(): boolean {
        return this._invalid;
    }

    clearInvalidFlag(): void {
        this._invalid = false;
    }

    /**
     * Starts a new trace: everything lit last time is provisionally dead,
     * and whatever this trace lights is resurrected by {@link lightPixel}.
     */
    resetCache(): void {
        this.computed.clear();
        this._deadPixels = this._livePixels;
        this._livePixels = new MarkerRegistry();
    }

    lightPixel(x: number, y: number): void {
        this._deadPixels.unmark(x, y);
        this._livePixels.mark(x, y);
    }
}
