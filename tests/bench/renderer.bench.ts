import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { SCENES } from '../harness/scenes.js';
import { buildPortRenderer } from '../harness/portRenderer.js';
import { compare, report } from './harness.js';

/**
 * The renderer against its own recorded cost.
 *
 * This used to time the port against the original engine, which answered "is
 * the port fast enough to replace it" — a migration question, now settled and
 * gone along with `_OLD_PROJECT_`. The question that outlives it is "did this
 * change make something slower", and answering it needs a record of the last
 * measurement rather than a second implementation.
 *
 * Absolute milliseconds are machine-specific and say nothing on their own, so
 * the baseline is compared two ways:
 *
 *  - **Relative cost**, each scene as a multiple of `room`. Machine and load
 *    cancel out of a ratio, so drift here is a real change in what a scene
 *    costs — the number worth failing a review over.
 *  - **Absolute ms**, reported for context and never compared across machines.
 *
 * Informational, never pass/fail: a benchmark that fails CI on a noisy runner
 * teaches people to ignore it. Rewrite the record with `UPDATE_BENCH=1`.
 */
const BASELINE = resolve(import.meta.dirname, 'baseline.json');

/** The scene every other is measured against. Arbitrary, but stable. */
const REFERENCE = 'room';

/**
 * Relative-cost drift past this is called out.
 *
 * Set from the measured noise floor, not a guess: with the scenes interleaved,
 * consecutive runs on an idle machine agreed to within 5% for nine of eleven
 * scenes and 12% for the worst. 20% leaves headroom over that while still
 * catching the size of regression worth a second look.
 */
const DRIFT = 0.20;

interface Record_ {
    measuredOn: string;
    platform: string;
    node: string;
    /** Scene name to ms/frame, for context only. */
    absolute: Record<string, number>;
    /** Scene name to cost as a multiple of REFERENCE. Comparable anywhere. */
    relative: Record<string, number>;
}

describe('renderer', () => {
    it('cost per scene, against the recorded baseline', () => {
        // Every scene is timed in ONE interleaved `compare`, not one call
        // each. The harness alternates repeats of its variants so thermal
        // drift and GC pauses land on all of them equally; timing scenes in
        // separate calls puts each at a different moment instead, and the
        // noise then survives into the ratios. Measured: consecutive runs of
        // the per-scene version disagreed by up to 36%, the interleaved one by
        // a few per cent.
        const variants = SCENES.map(spec => {
            const cam = spec.cameras[0];
            const rc = buildPortRenderer(spec);
            rc.render(cam.x, cam.y, cam.angle, cam.height);
            return { name: spec.name, run: () => rc.render(cam.x, cam.y, cam.angle, cam.height) };
        });
        const measured = compare(variants);
        const absolute: Record<string, number> = {};
        for (const spec of SCENES) {
            absolute[spec.name] = measured.get(spec.name)!;
        }

        const reference = absolute[REFERENCE];
        const relative: Record<string, number> = {};
        for (const [name, ms] of Object.entries(absolute)) {
            relative[name] = ms / reference;
        }

        const current: Record_ = {
            measuredOn: new Date().toISOString().slice(0, 10),
            platform: `${process.platform} ${process.arch}`,
            node: process.version,
            absolute,
            relative
        };

        if (process.env.UPDATE_BENCH === '1' || !existsSync(BASELINE)) {
            writeFileSync(BASELINE, `${JSON.stringify(current, null, 4)}\n`);
            console.log(`\nwrote ${BASELINE}`);
            print(current, null);
            return;
        }

        const previous = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record_;
        print(current, previous);
    });

    it('phase breakdown: casting versus rasterising', () => {
        // Where the time goes inside one frame. Needs no second implementation
        // to be useful — the split between building the scene and drawing it
        // is what tells you which half a change touched.
        const spec = SCENES[0];
        const cam = spec.cameras[0];
        const rc = buildPortRenderer(spec);
        rc.render(cam.x, cam.y, cam.angle, cam.height);

        const full = compare([
            { name: 'render', run: () => rc.render(cam.x, cam.y, cam.angle, cam.height) }
        ]);
        const scene = compare([
            { name: 'computeScene', run: () => rc.computeScene(cam.x, cam.y, cam.angle, cam.height) }
        ]);
        const render = full.get('render')!;
        const cast = scene.get('computeScene')!;
        report(`phases (${spec.name} / ${cam.name})`, new Map([
            ['render', render],
            ['computeScene', cast],
            ['raster', render - cast]
        ]), 'render');
    });
});

/** Prints the table, with drift against the baseline when there is one. */
function print(current: Record_, previous: Record_ | null): void {
    console.log('\nrender(), per scene');
    if (previous !== null) {
        console.log(
            `  baseline recorded ${previous.measuredOn} on ${previous.platform}, ` +
            `node ${previous.node}`
        );
        if (previous.platform !== current.platform) {
            console.log('  (different platform — compare the relative column, not the ms)');
        }
    }
    const drifted: string[] = [];
    for (const [name, ms] of Object.entries(current.absolute)) {
        const rel = current.relative[name];
        const was = previous?.relative[name];
        let note = '';
        if (was !== undefined) {
            const change = (rel - was) / was;
            note = `  was x${was.toFixed(2)}  ${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
            if (Math.abs(change) > DRIFT) {
                note += '  <-- drift';
                drifted.push(`${name} ${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}%`);
            }
        }
        console.log(`  ${name.padEnd(16)} ${ms.toFixed(4)} ms  x${rel.toFixed(2)}${note}`);
    }
    if (drifted.length > 0) {
        console.log(
            `\n  ${drifted.length} scene(s) drifted more than ${(DRIFT * 100).toFixed(0)}% ` +
            `in relative cost: ${drifted.join(', ')}`
        );
        console.log('  If the change was intended, re-record with UPDATE_BENCH=1.');
    }
}
