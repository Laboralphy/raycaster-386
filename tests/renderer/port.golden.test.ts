import { describe, expect, it } from 'vitest';
import { allCases, SCENES } from '../harness/scenes.js';
import { buildPortRenderer, renderPort, renderPortFrame } from '../harness/portRenderer.js';
import { compareFrames, describeDiff, isClean, matchGolden } from '../harness/compare.js';
import { Renderer } from '../../src/Renderer.js';

/**
 * Phase 4: the port rendered against the baselines captured from the original.
 *
 * The baselines were taken with the harness compensating for two ordering
 * bugs (see "Original-engine behaviour the harness pins" in
 * documentation/PORT_NOTES.md), so they already describe
 * what a correct renderer produces. The port fixes both internally, which is
 * why it is compared here with no compensation at all.
 */
describe('ported renderer vs original baselines', () => {
    it('matches the baseline for every scene and camera', async () => {
        const failures: string[] = [];
        for (const { spec, camera } of allCases()) {
            const name = `${spec.name}--${camera.name}`;
            const result = await matchGolden(name, renderPort(spec, camera));
            if (result.created) {
                failures.push(`${name}: no committed baseline (one was just written)`);
                continue;
            }
            if (!isClean(result.diff!)) {
                failures.push(
                    `${name}: ${describeDiff(result.diff!)}\n    artefacts: ${result.artifacts.join('\n               ')}`
                );
            }
        }
        expect(failures, `\n  ${failures.join('\n  ')}\n`).toEqual([]);
    }, 90_000);
});

describe('ported renderer determinism', () => {
    it('does not depend on the previous frame', () => {
        // The port clears its canvas, so visiting another camera and coming
        // back must reproduce the frame exactly. The original failed this on
        // the doors scene, where a half-open door leaves an unwritten gap.
        for (const spec of SCENES) {
            const rc = buildPortRenderer(spec);
            const first = renderPortFrame(rc, spec.cameras[0]);
            for (const camera of spec.cameras) {
                renderPortFrame(rc, camera);
            }
            const again = renderPortFrame(rc, spec.cameras[0]);
            const diff = compareFrames(first, again);
            expect(isClean(diff), `${spec.name}: ${describeDiff(diff)}`).toBe(true);
        }
    }, 60_000);

    it('needs no warm-up frame even with light sources', () => {
        // The port traces the light map before casting, so frame 1 is already
        // correct. The original needed a discarded frame for the lit scene.
        for (const spec of SCENES) {
            const rc = buildPortRenderer(spec);
            const first = renderPortFrame(rc, spec.cameras[0]);
            const second = renderPortFrame(rc, spec.cameras[0]);
            const diff = compareFrames(first, second);
            expect(isClean(diff), `${spec.name}: frame 1 differs from frame 2: ${describeDiff(diff)}`).toBe(true);
        }
    }, 60_000);

    it('is deterministic across instances', () => {
        for (const { spec, camera } of allCases()) {
            const diff = compareFrames(renderPort(spec, camera), renderPort(spec, camera));
            expect(isClean(diff), `${spec.name}/${camera.name}: ${describeDiff(diff)}`).toBe(true);
        }
    }, 90_000);
});

/**
 * A baseline match proves the port agrees with the original. It does not
 * prove the feature under test does anything: if both silently no-opped, the
 * images would agree perfectly. These check the features have visible effect.
 */
describe('ported renderer feature coverage', () => {
    it('sprites change the image', () => {
        const spec = SCENES.find(s => s.name === 'sprites')!;
        const camera = spec.cameras[0];
        const withSprites = renderPort(spec, camera);
        const without = renderPort({ ...spec, sprites: [] }, camera);
        const diff = compareFrames(withSprites, without);
        expect(isClean(diff), 'sprites had no visible effect').toBe(false);
        expect(diff.differing).toBeGreaterThan(200);
    }, 30_000);

    it('decals change the image', () => {
        const spec = SCENES.find(s => s.name === 'decals')!;
        for (const camera of spec.cameras) {
            const withDecals = renderPort(spec, camera);
            const without = renderPort({ ...spec, decals: [] }, camera);
            const diff = compareFrames(withDecals, without);
            expect(isClean(diff), `${camera.name}: decals had no visible effect`).toBe(false);
            expect(diff.differing).toBeGreaterThan(200);
        }
    }, 30_000);

    it('the storey changes the image', () => {
        const spec = SCENES.find(s => s.name === 'storey')!;
        for (const camera of spec.cameras) {
            const withStorey = renderPort(spec, camera);
            const without = renderPort({ ...spec, storey: undefined }, camera);
            const diff = compareFrames(withStorey, without);
            expect(isClean(diff), `${camera.name}: the storey had no visible effect`).toBe(false);
            expect(diff.differing).toBeGreaterThan(200);
        }
    }, 30_000);

    it('the backdrop changes the image, and scrolls with the view', () => {
        const spec = SCENES.find(s => s.name === 'sky')!;
        const withSky = renderPort(spec, spec.cameras[0]);
        const without = renderPort({ ...spec, background: undefined }, spec.cameras[0]);
        expect(isClean(compareFrames(withSky, without)), 'the backdrop had no visible effect').toBe(false);

        // Sky is only visible through the open-ceiling cells, so it should
        // occupy the upper part of the frame and move as the camera turns.
        const skyPixels = (f: typeof withSky): number => {
            let n = 0;
            for (let i = 0; i < f.data.length; i += 4) {
                if (f.data[i + 2] > f.data[i] + 30 && f.data[i + 2] > 80) {
                    ++n;
                }
            }
            return n;
        };
        expect(skyPixels(withSky)).toBeGreaterThan(200);
        expect(skyPixels(without)).toBe(0);

        const turned = renderPort(spec, spec.cameras[1]);
        expect(isClean(compareFrames(withSky, turned)), 'the backdrop did not scroll').toBe(false);
    }, 30_000);

    it('animated surfaces show a different frame at a different time', () => {
        const spec = SCENES.find(s => s.name === 'animated')!;
        const [t0, t1, t2] = spec.cameras;
        const a = renderPort(spec, t0);
        const b = renderPort(spec, t1);
        const c = renderPort(spec, t2);
        expect(isClean(compareFrames(a, b)), 'animation did not advance by t=10').toBe(false);
        expect(isClean(compareFrames(b, c)), 'animation did not advance by t=20').toBe(false);
    }, 30_000);

    it('animation time is absolute, not cumulative', () => {
        // Rendering other poses first must not shift where a pose lands.
        const spec = SCENES.find(s => s.name === 'animated')!;
        const rc = buildPortRenderer(spec);
        const direct = renderPortFrame(rc, spec.cameras[1]);
        for (const camera of spec.cameras) {
            renderPortFrame(rc, camera);
        }
        const again = renderPortFrame(rc, spec.cameras[1]);
        expect(isClean(compareFrames(direct, again)), describeDiff(compareFrames(direct, again))).toBe(true);
    }, 30_000);

    it('light sources change the image', () => {
        const spec = SCENES.find(s => s.name === 'lit')!;
        const camera = spec.cameras[0];
        const diff = compareFrames(renderPort(spec, camera), renderPort({ ...spec, lights: [] }, camera));
        expect(isClean(diff), 'light sources had no visible effect').toBe(false);
        expect(diff.differing).toBeGreaterThan(200);
    }, 30_000);
});

describe('storey settings', () => {
    it('inherits every setting from the floor below, before and after creation', () => {
        const rc = new Renderer();
        rc.setScreen({ width: 128, height: 128 });
        rc.setShading({ shades: 8, color: 'black', filter: null, brightness: 0 });
        rc.setMetrics({ spacing: 64, height: 96 });
        rc.setMapSize(8);

        const storey = rc.createStorey();
        expect(storey.shading.shades).toBe(8);
        expect(storey.screen).toEqual({ width: 128, height: 128 });
        expect(storey.metrics).toEqual({ spacing: 64, height: 96 });
        expect(storey.getMapSize()).toBe(8);

        // Settings changed after createStorey must reach it too.
        rc.setShading({ shades: 4, color: '#123456', filter: '#abcdef', brightness: 0.5 });
        rc.setMetrics({ spacing: 32, height: 48 });
        rc.setScreen({ width: 64, height: 64 });
        expect(storey.shading).toEqual({ shades: 4, color: '#123456', filter: '#abcdef', brightness: 0.5 });
        expect(storey.metrics).toEqual({ spacing: 32, height: 48 });
        expect(storey.screen).toEqual({ width: 64, height: 64 });
    });

    it('receives shadingFactor, which is a live field rather than a setter', () => {
        const spec = SCENES.find(s => s.name === 'storey')!;
        const rc = buildPortRenderer(spec);
        rc.shadingFactor = 17;
        renderPortFrame(rc, spec.cameras[0]);
        expect(rc.storey!.shadingFactor).toBe(17);
    });

    it('shadingFactor visibly reaches the storey', () => {
        const spec = SCENES.find(s => s.name === 'storey')!;
        const camera = spec.cameras[0];
        const a = buildPortRenderer(spec);
        const b = buildPortRenderer(spec);
        b.shadingFactor = 8;
        const diff = compareFrames(renderPortFrame(a, camera), renderPortFrame(b, camera));
        expect(isClean(diff), 'shadingFactor had no visible effect').toBe(false);
    });
});

describe('flat rasteriser', () => {
    it('writes every pixel, including the one the original dropped', () => {
        // The original computed a flat source row as ((fy % ps) + layer * ps) | 0.
        // Where fy % ps lands just under the cell size, adding the layer offset
        // rounds the deficit away and pushes the index one row past the atlas,
        // and the out-of-bounds read wrote a transparent pixel. The port
        // truncates before adding, so the texel is sampled correctly.
        for (const { spec, camera } of allCases()) {
            const frame = renderPort(spec, camera);
            let nonOpaque = 0;
            for (let i = 3; i < frame.data.length; i += 4) {
                if (frame.data[i] !== 255) {
                    ++nonOpaque;
                }
            }
            expect(nonOpaque, `${spec.name}/${camera.name}: ${nonOpaque} non-opaque pixels`).toBe(0);
        }
    }, 60_000);

    it('substitutes shifts for divisions without changing any result', () => {
        // renderFlats writes its inner loop out twice: shifts and masks when
        // the cell size is a power of two, divisions and moduli otherwise.
        // The two are only interchangeable because every operand is
        // non-negative there, which the surrounding bounds check guarantees.
        // This pins that equivalence so the duplicated loops cannot drift.
        //
        // Compared inline rather than through expect(): one assertion per
        // iteration is ~400k of them, which put this test within a whisker of
        // vitest's 5s default timeout and made it fail intermittently. The
        // coverage is identical; only mismatches reach the assertion.
        const mismatches: string[] = [];
        let compared = 0;
        for (const ps of [2, 4, 8, 16, 32, 64, 128, 256]) {
            const psh = Math.log2(ps) | 0;
            const psm = ps - 1;
            for (let i = 0; i < 5000; ++i) {
                // Spread across cell boundaries, including values that land
                // just under one, which is where the original went wrong.
                const v = i * 0.37 * ps * 0.05 + (i % 7) * ps - Number.EPSILON * i;
                if (v < 0) {
                    continue;
                }
                ++compared;
                if ((v >> psh) !== ((v / ps) | 0)) {
                    mismatches.push(`cell index, ps=${ps}, v=${v}`);
                }
                if ((v & psm) !== ((v % ps) | 0)) {
                    mismatches.push(`texel offset, ps=${ps}, v=${v}`);
                }
                for (let layer = 0; layer < 8; ++layer) {
                    if ((v & psm) + layer * ps !== ((v % ps) | 0) + layer * ps) {
                        mismatches.push(`layer ${layer}, ps=${ps}, v=${v}`);
                    }
                }
            }
        }
        expect(mismatches.slice(0, 5)).toEqual([]);
        // Guard against the loop silently skipping everything.
        expect(compared).toBeGreaterThan(30000);
    });
});
