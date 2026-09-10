/**
 * Interpolates a value along a curve over a fixed number of steps.
 *
 * Drives door sliding, and anything else that needs a value eased between two
 * bounds over time.
 */

/** The available curves. */
export type EasingName =
    | 'linear'
    | 'smoothstep'
    | 'smoothstepX2'
    | 'smoothstepX3'
    | 'squareAccel'
    | 'squareDeccel'
    | 'cubeAccel'
    | 'cubeDeccel'
    | 'cubeInOut'
    | 'sine'
    | 'cosine';

/** A curve maps progress 0..1 to output 0..1. */
export type EasingFunction = (v: number) => number;

const smoothstep: EasingFunction = (v) => v * v * (3 - 2 * v);

/**
 * The curves, by name.
 *
 * The original dispatched on strings that happened to be method names on the
 * class, via `this[name]`. These are plain functions in a lookup instead,
 * which is what makes {@link EasingName} a checkable union.
 */
export const EASING_FUNCTIONS: Readonly<Record<EasingName, EasingFunction>> = {
    linear: (v) => v,
    smoothstep,
    smoothstepX2: (v) => smoothstep(smoothstep(v)),
    smoothstepX3: (v) => smoothstep(smoothstep(smoothstep(v))),
    squareAccel: (v) => v * v,
    squareDeccel: (v) => 1 - (1 - v) * (1 - v),
    cubeAccel: (v) => v * v * v,
    cubeDeccel: (v) => 1 - (1 - v) * (1 - v) * (1 - v),
    cubeInOut: (v) => {
        if (v < 0.5) {
            const w = 2 * v;
            return w * w * w;
        }
        const w = (1 - v) * 2;
        return w * w * w;
    },
    sine: (v) => Math.sin((v * Math.PI) / 2),
    cosine: (v) => 0.5 - Math.cos(-v * Math.PI) * 0.5,
};

export interface EasingOptions {
    /** Output at step 0. */
    from?: number;
    /** Output at the final step. */
    to?: number;
    /** Number of steps from `from` to `to`. */
    steps?: number;
    use?: EasingName | EasingFunction;
}

export class Easing {
    private _yFrom: number;
    private _yTo: number;
    private _y: number;
    private _x = 0;
    private _xMax: number;
    private _f: EasingFunction;

    constructor(options: EasingOptions = {}) {
        this._yFrom = options.from ?? 0;
        this._yTo = options.to ?? 1;
        this._y = this._yFrom;
        this._xMax = options.steps ?? 10;
        // The original defaulted this to the *name* 'linear' rather than a
        // function, so an Easing built without `use` threw on first compute().
        this._f = resolve(options.use ?? 'linear');
    }

    /** Current output value. */
    get y(): number {
        return this._y;
    }

    /** Current step. */
    get x(): number {
        return this._x;
    }

    set x(value: number) {
        this.compute(value);
    }

    from(y: number): this {
        this._y = this._yFrom = y;
        return this;
    }

    to(y: number): this {
        this._yTo = y;
        return this;
    }

    steps(x: number): this {
        this._xMax = x;
        return this;
    }

    use(f: EasingName | EasingFunction): this {
        this.setFunction(f);
        return this;
    }

    reset(): this {
        this._y = this._yFrom;
        this._x = 0;
        return this;
    }

    setOutputRange(y0: number, y1: number): void {
        this._yFrom = y0;
        this._yTo = y1;
    }

    setStepCount(v: number): void {
        this._xMax = v;
    }

    setFunction(f: EasingName | EasingFunction): void {
        this._f = resolve(f);
    }

    /**
     * Advances to step `x`, or by one step if omitted, and recomputes `y`.
     *
     * An explicit step is clamped to the range; the no-argument form is not,
     * matching the original — it is only used where the caller tracks its own
     * time and passes it in.
     */
    compute(x?: number): this {
        if (x === undefined) {
            x = ++this._x;
        } else {
            x = this._x = Math.max(0, Math.min(this._xMax, x));
        }
        const v = this._f(x / this._xMax);
        this._y = this._yTo * v + this._yFrom * (1 - v);
        return this;
    }

    /** True once the final step has been reached. */
    over(): boolean {
        return this._x >= this._xMax;
    }
}

function resolve(f: EasingName | EasingFunction): EasingFunction {
    if (typeof f === 'function') {
        return f;
    }
    const fn = EASING_FUNCTIONS[f];
    if (fn === undefined) {
        throw new Error(`Easing: unknown easing function "${f}"`);
    }
    return fn;
}
