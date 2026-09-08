/**
 * Timing helpers shared by the benchmarks.
 *
 * Every measurement warms the JIT first, then interleaves repeats of the
 * variants being compared so thermal drift and GC pauses land on both rather
 * than on whichever ran second.
 */

export interface Variant {
    name: string;
    run: () => void;
}

function once(frames: number, fn: () => void): number {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < frames; ++i) {
        fn();
    }
    return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
}

/**
 * Times each variant, returning the best (least noisy) time per frame.
 *
 * The minimum across repeats is used rather than the mean: a run can only be
 * slowed by interference, never sped up, so the fastest observed time is the
 * closest estimate of the real cost.
 */
export function compare(variants: Variant[], frames = 250, repeats = 5): Map<string, number> {
    for (const v of variants) {
        for (let i = 0; i < 80; ++i) {
            v.run();
        }
    }
    const best = new Map<string, number>();
    for (let r = 0; r < repeats; ++r) {
        for (const v of variants) {
            const t = once(frames, v.run);
            const prev = best.get(v.name);
            if (prev === undefined || t < prev) {
                best.set(v.name, t);
            }
        }
    }
    return best;
}

/** Formats a comparison against a named baseline. */
export function report(title: string, results: Map<string, number>, baseline: string): void {
    const base = results.get(baseline);
    console.log(`\n${title}`);
    for (const [name, ms] of results) {
        const rel =
            base === undefined || name === baseline
                ? ''
                : `  ${(((base - ms) / base) * 100).toFixed(1).padStart(6)}% vs ${baseline}`;
        console.log(`  ${name.padEnd(28)} ${ms.toFixed(4)} ms/frame${rel}`);
    }
}
