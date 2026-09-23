/**
 * Per-phase frame timings.
 *
 * Attach one to {@link Renderer.profiler} and it accumulates how long each
 * part of a frame takes; leave it null, which is the default, and the renderer
 * does a null check per phase and nothing else.
 *
 * Why this exists rather than a browser profile: a canvas does not draw when
 * told to. It records, and rasterises at the next moment something forces it
 * to — which for this renderer is the `getImageData` the flat rasteriser does.
 * A profile therefore bills the drawing of the background, the storey and the
 * walls to whatever happened to touch pixels next, and reading one at face
 * value sends you optimising the wrong function. Measured under Node, the flat
 * pixel loop took 0.18 ms of a 4 ms frame while the flush charged to it took
 * 2.6 ms.
 *
 * {@link flushProbe} is the answer to that: before its real work, the flat
 * rasteriser reads one pixel, which forces everything issued so far to
 * rasterise, and that cost lands on `flush` where it belongs. Ending a frame
 * the same way bills the wall slices to `present`. Both are deliberate
 * stalls — a profiled frame is slower than a real one, and the shares are what
 * to read, not the totals.
 */
export type Phase =
    | 'setup'
    | 'raycast'
    | 'clear'
    | 'background'
    | 'storey'
    | 'flush'
    | 'flatsRead'
    | 'flatsLoop'
    | 'flatsWrite'
    | 'slices'
    | 'present';

const PHASES: readonly Phase[] = [
    'setup',
    'raycast',
    'clear',
    'background',
    'storey',
    'flush',
    'flatsRead',
    'flatsLoop',
    'flatsWrite',
    'slices',
    'present',
];

/** What each phase covers, for a legend next to the numbers. */
export const PHASE_HELP: Readonly<Record<Phase, string>> = {
    setup: 're-shading and light map, when anything invalidated them',
    raycast: 'casting every column into the z-buffer',
    clear: 'clearing the frame',
    background: 'the sky',
    storey: 'issuing the upper storey slices',
    flush: 'rasterising everything issued above (a forced stall)',
    flatsRead: 'reading the frame back for the flat rasteriser',
    flatsLoop: 'the floor and ceiling pixel loop',
    flatsWrite: 'writing the flats back into the frame',
    slices: 'issuing the wall and sprite slices',
    present: 'rasterising those slices (a forced stall)',
};

/** Phase to slot in the totals, so a mark costs a property load. */
const INDEX: Readonly<Record<Phase, number>> = Object.fromEntries(
    PHASES.map((p, i) => [p, i])
) as Record<Phase, number>;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface ProfileReport {
    frames: number;
    /** Milliseconds per frame, per phase. */
    phases: Record<Phase, number>;
    /** Milliseconds per frame, summed over the phases. */
    total: number;
}

export class Profiler {
    /**
     * Whether to force a flush where the timeline needs one. Leave it on
     * unless the point is to measure a frame's cost without the stalls.
     */
    flushProbe = true;

    private _frames = 0;
    private _totals = new Float64Array(PHASES.length);
    private _t = 0;

    get frames(): number {
        return this._frames;
    }

    /** Opens a frame. Every {@link mark} after this one measures from here. */
    startFrame(): void {
        this._t = now();
    }

    /** Charges the time since the previous mark to `phase`. */
    mark(phase: Phase): void {
        const t = now();
        this._totals[INDEX[phase]] += t - this._t;
        this._t = t;
    }

    endFrame(): void {
        ++this._frames;
    }

    /**
     * Forces the canvas to rasterise what it has been told to draw.
     *
     * One pixel is enough: the cost is the drawing catching up, not the read.
     */
    probe(context: CanvasRenderingContext2D): void {
        if (this.flushProbe) {
            context.getImageData(0, 0, 1, 1);
        }
    }

    reset(): void {
        this._frames = 0;
        this._totals.fill(0);
    }

    /** Averages per frame. Returns zeros before the first frame. */
    report(): ProfileReport {
        const n = Math.max(1, this._frames);
        const phases = {} as Record<Phase, number>;
        let total = 0;
        for (let i = 0; i < PHASES.length; ++i) {
            const ms = this._totals[i] / n;
            phases[PHASES[i]] = ms;
            total += ms;
        }
        return { frames: this._frames, phases, total };
    }

    /** The report as lines of text, widest phase first. */
    format(): string {
        const { frames, phases, total } = this.report();
        const rows = PHASES.map((p) => [p, phases[p]] as const)
            .filter(([, ms]) => ms > 0)
            .sort((a, b) => b[1] - a[1])
            .map(
                ([p, ms]) =>
                    `${p.padEnd(11)} ${ms.toFixed(3)} ms ${((ms / Math.max(total, 1e-9)) * 100).toFixed(1).padStart(5)}%`
            );
        rows.push(`${'TOTAL'.padEnd(11)} ${total.toFixed(3)} ms  over ${frames} frames`);
        return rows.join('\n');
    }
}
