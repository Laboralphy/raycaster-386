import { ANIM_LOOP_FORWARD, ANIM_LOOP_NONE, ANIM_LOOP_YOYO, type AnimLoop } from '../consts.js';

export interface TileAnimationDef {
    /** First tile index in the tileset. */
    start?: number;
    /** Number of frames. */
    length?: number;
    /** Duration of one frame, in the same unit passed to {@link TileAnimation.animate}. */
    duration?: number;
    loop?: AnimLoop;
    /** Number of loop iterations; null and Infinity both mean "forever". */
    iterations?: number | null;
}

/**
 * A cursor over a run of consecutive tiles in a tileset.
 */
export class TileAnimation {
    /** Number of frames. */
    count = 1;
    /** Duration of one frame. */
    duration = 100;
    /** Loop mode. */
    loop: AnimLoop = ANIM_LOOP_NONE;
    /** Index of the first frame within the tileset. */
    base = 0;
    /** Index of the current frame, relative to `base`. */
    index = 0;
    /** Time accumulated within the current frame. */
    time = 0;
    /** +1 while playing forward, -1 while playing back (yoyo mode). */
    loopDir: 1 | -1 = 1;
    /** While frozen, {@link animate} is a no-op. */
    frozen = false;

    private _iterations = Infinity;
    private _baseIterations = Infinity;

    /** Remaining loop iterations. Setting it also sets the value `reset` restores. */
    get iterations(): number {
        return this._iterations;
    }

    set iterations(value: number) {
        this._baseIterations = value;
        this._iterations = value;
    }

    reset(): void {
        this.index = 0;
        this.time = 0;
        this._iterations = this._baseIterations;
        this.frozen = false;
    }

    /**
     * Advances the animation by `timeInc`.
     */
    animate(timeInc: number): void {
        if (this.frozen) {
            return;
        }
        const t = this.time + timeInc;
        const d = this.duration;
        const steps = (t / d) | 0;
        this.time = t % d;
        for (let i = 0; i < steps; ++i) {
            switch (this.loop) {
                case ANIM_LOOP_NONE:
                    break;

                case ANIM_LOOP_FORWARD:
                    ++this.index;
                    if (this.index >= this.count) {
                        if (--this._iterations > 0) {
                            this.index = 0;
                        }
                    }
                    break;

                case ANIM_LOOP_YOYO:
                    this.index += this.loopDir;
                    if (
                        (this.loopDir > 0 && this.index >= this.count) ||
                        (this.loopDir < 0 && this.index <= 0)
                    ) {
                        this.index = Math.min(this.count - 1, Math.max(0, this.index));
                        this.loopDir = this.loopDir > 0 ? -1 : 1;
                        --this._iterations;
                    }
                    break;
            }
        }
        if (this._iterations <= 0) {
            this.frozen = true;
        }
    }

    /** The tileset index of the frame currently shown. */
    frame(): number {
        return this.base + this.index;
    }
}

/**
 * Builds a TileAnimation from a partial definition, applying the defaults
 * the original `buildSurfaceAnimation` / `buildAnimation` used.
 */
export function createTileAnimation({
    start = 0,
    length = 1,
    duration = 100,
    loop = ANIM_LOOP_NONE,
    iterations = Infinity
}: TileAnimationDef = {}): TileAnimation {
    const a = new TileAnimation();
    a.base = start;
    a.count = length;
    a.duration = duration;
    a.loop = loop;
    a.iterations = iterations === null ? Infinity : iterations;
    return a;
}
