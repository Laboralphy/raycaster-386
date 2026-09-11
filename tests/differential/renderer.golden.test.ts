import { describe, expect, it } from 'vitest';
import { hasLegacy } from '../harness/legacy.js';
import { allCases, SCENES } from '../harness/scenes.js';
import { buildLegacyRenderer, renderFrame, renderLegacy } from '../harness/legacyRenderer.js';
import { compareFrames, describeDiff, isClean, matchGolden, roundTripPng } from '../harness/compare.js';

/**
 * Phase 3: the golden-image harness.
 *
 * The port's Renderer does not exist yet, so these tests establish and guard
 * the baseline captured from the original engine, and prove the harness can
 * actually detect a difference. Phase 4 renders the same cases through the
 * port and compares against the same baselines.
 */
/**
 * Cases where the committed baseline deliberately does *not* match the
 * original, because the original is wrong. The baseline records the fixed
 * behaviour; each entry says why.
 */
const KNOWN_LEGACY_DIFFERENCES: Record<string, string> = {
    'storey--centre':
        'createStorey() copies no settings and the shading transmit in optionsReaction is ' +
        'commented out, so the original storey shades with the default 16 layers while ' +
        'sharing a tileset the ground floor built with 8, indexing past the end of the atlas',
    'storey--centre-diag': 'same as storey--centre',
    'animated-flats--frame-0':
        'the original reads an animated flat face straight out of the cell-code table and ' +
        'multiplies it by the cell size, so the TileAnimation becomes NaN and NaN | 0 ' +
        'collapses to 0 — it samples column 0 of the atlas for every pixel. The port ' +
        'resolves the animation to a frame',
    'animated-flats--frame-2': 'same as animated-flats--frame-0',
    'sprites--wound-two-turns':
        'a camera angle is accumulated and never wrapped, and the original reduced a ' +
        "sprite's bearing into (-PI, PI] by adding or subtracting 2*PI exactly once — " +
        'which cannot close a gap several revolutions wide. Past ~1.38 net turns its ' +
        'sprites fail the off-axis test and vanish, while the walls, cast with periodic ' +
        'cos/sin, render normally. The port reduces with a modulo. Found by playing ' +
        'demos/dark-village on 2026-09-11; see tests/spriteCulling.test.ts',
    'sprites--wound-negative': 'same as sprites--wound-two-turns, winding the other way',
    'room--crouched':
        'one pixel: the original computes a flat source row as ' +
        '((fy % ps) + layer * ps) | 0, and where fy %% ps lands just under the cell size ' +
        '(255.99999999999997) the addition rounds the deficit away to exactly 512, ' +
        'one row past the atlas — an out-of-bounds read yielding a transparent pixel. ' +
        'The port truncates before adding, so the texel is sampled correctly'
};

describe.skipIf(!hasLegacy)('renderer golden images', () => {
    it('renders every scene and camera without throwing', async () => {
        const cases = allCases();
        expect(cases.length).toBeGreaterThan(10);
        for (const { spec, camera } of cases) {
            const frame = await renderLegacy(spec, camera);
            expect(frame.width, `${spec.name}/${camera.name}`).toBe(spec.screen.width);
            expect(frame.height).toBe(spec.screen.height);
            expect(frame.data.length).toBe(spec.screen.width * spec.screen.height * 4);
        }
    }, 60_000);

    it('produces a non-trivial image for every case, not a flat fill', async () => {
        // A comparator is worthless if a baseline is a blank canvas, so every
        // case has to carry real structure, not just the first of each scene.
        for (const { spec, camera } of allCases()) {
            const frame = await renderLegacy(spec, camera);
            const seen = new Set<number>();
            let opaque = 0;
            let untouched = 0;
            for (let i = 0; i < frame.data.length; i += 4) {
                seen.add((frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2]);
                const a = frame.data[i + 3];
                if (a === 255) {
                    ++opaque;
                } else if (a === 0 && frame.data[i] === 0 && frame.data[i + 1] === 0 && frame.data[i + 2] === 0) {
                    ++untouched;
                }
            }
            const where = `${spec.name}/${camera.name}`;
            expect(seen.size, `${where}: too few distinct colours`).toBeGreaterThan(200);
            // Any pixel the renderer leaves untouched must be fully
            // transparent black, which survives the PNG round trip exactly.
            // A partially transparent pixel would lose its colour to
            // premultiplication and make the baseline unreproducible.
            //
            // room/crouched legitimately has one: see the "leaves one ceiling
            // pixel unwritten" test below.
            const pixels = frame.width * frame.height;
            expect(opaque + untouched, `${where}: ${pixels - opaque - untouched} partly transparent pixels`)
                .toBe(pixels);
        }
    }, 60_000);

    it('is deterministic across renderer instances', async () => {
        for (const { spec, camera } of allCases()) {
            const a = await renderLegacy(spec, camera);
            const b = await renderLegacy(spec, camera);
            const diff = compareFrames(a, b);
            expect(isClean(diff), `${spec.name}/${camera.name}: ${describeDiff(diff)}`).toBe(true);
        }
    }, 90_000);

    it('is deterministic across repeated renders of one instance', async () => {
        // Catches state that leaks from one frame into the next.
        for (const spec of SCENES) {
            const rc = await buildLegacyRenderer(spec);
            const first = renderFrame(rc, spec.cameras[0]);
            for (const camera of spec.cameras) {
                renderFrame(rc, camera);
            }
            const again = renderFrame(rc, spec.cameras[0]);
            const diff = compareFrames(first, again);
            expect(isClean(diff), `${spec.name}: re-render differs: ${describeDiff(diff)}`).toBe(true);
        }
    }, 90_000);

    it('matches the committed baseline everywhere it is not known to be wrong', async () => {
        const created: string[] = [];
        const unexpected: string[] = [];
        for (const { spec, camera } of allCases()) {
            const name = `${spec.name}--${camera.name}`;
            const frame = await renderLegacy(spec, camera);
            const result = await matchGolden(name, frame);
            if (result.created) {
                created.push(name);
                continue;
            }
            const known = KNOWN_LEGACY_DIFFERENCES[name];
            const clean = isClean(result.diff!);
            if (known === undefined && !clean) {
                unexpected.push(`${name}: ${describeDiff(result.diff!)}`);
            } else if (known !== undefined && clean) {
                // The allowance is stale: either the original changed, or the
                // difference was never real.
                unexpected.push(`${name}: expected to differ (${known}) but matched`);
            }
        }
        expect(unexpected, `\n  ${unexpected.join('\n  ')}\n`).toEqual([]);
        if (created.length > 0) {
            console.info(`golden: wrote ${created.length} new baseline(s): ${created.join(', ')}`);
        }
    }, 90_000);
});

/**
 * The comparator is the thing every later phase trusts. If it cannot tell two
 * genuinely different renders apart, every Phase 4 test passes vacuously.
 */
describe.skipIf(!hasLegacy)('golden harness sensitivity', () => {
    it('detects a one-degree camera rotation', async () => {
        const spec = SCENES[0];
        const base = spec.cameras[0];
        const a = await renderLegacy(spec, base);
        const b = await renderLegacy(spec, { ...base, angle: base.angle + Math.PI / 180 });
        const diff = compareFrames(a, b);
        expect(isClean(diff)).toBe(false);
        expect(diff.differing).toBeGreaterThan(100);
    }, 30_000);

    it('detects a sub-pixel camera translation', async () => {
        const spec = SCENES[0];
        const base = spec.cameras[0];
        const a = await renderLegacy(spec, base);
        const b = await renderLegacy(spec, { ...base, x: base.x + 0.5 });
        expect(isClean(compareFrames(a, b))).toBe(false);
    }, 30_000);

    it('detects a single altered texel', async () => {
        const spec = SCENES[0];
        const frame = await renderLegacy(spec, spec.cameras[0]);
        const tampered = { ...frame, data: new Uint8ClampedArray(frame.data) };
        // Nudge one channel of one pixel by the smallest possible amount.
        tampered.data[4 * (frame.width * 40 + 40)] ^= 1;
        const diff = compareFrames(frame, tampered);
        expect(diff.differing).toBe(1);
        expect(diff.maxDelta).toBe(1);
        expect(diff.firstDiffAt).toEqual({ x: 40, y: 40 });
    }, 30_000);

    it('detects a changed shading setting', async () => {
        const spec = SCENES[0];
        const dimmer = { ...spec, shading: { ...spec.shading, brightness: 0.8 } };
        const a = await renderLegacy(spec, spec.cameras[0]);
        const b = await renderLegacy(dimmer, spec.cameras[0]);
        expect(isClean(compareFrames(a, b))).toBe(false);
    }, 30_000);

    it('round-trips a frame through PNG without losing a single channel', async () => {
        // Every baseline comparison goes through this path. If it is lossy,
        // Phase 4 is comparing against something that is not what was captured.
        for (const { spec, camera } of allCases()) {
            const frame = await renderLegacy(spec, camera);
            const diff = compareFrames(frame, await roundTripPng(frame));
            expect(isClean(diff), `${spec.name}/${camera.name}: ${describeDiff(diff)}`).toBe(true);
        }
    }, 60_000);

    it('reports a clean diff for a frame against itself', async () => {
        const frame = await renderLegacy(SCENES[0], SCENES[0].cameras[0]);
        const diff = compareFrames(frame, { ...frame, data: new Uint8ClampedArray(frame.data) });
        expect(isClean(diff)).toBe(true);
        expect(describeDiff(diff)).toBe('identical');
    }, 30_000);
});

/**
 * Two behaviours of the original that the harness compensates for. They are
 * pinned here rather than left implicit, because Phase 4 has to make a
 * deliberate choice about each: reproduce it, or fix it and accept a
 * documented baseline change.
 */
describe.skipIf(!hasLegacy)('legacy renderer quirks', () => {
    it('render() does not clear the canvas, so a half-open door ghosts the previous frame', async () => {
        const spec = SCENES.find(s => s.name === 'doors')!;
        const rc = await buildLegacyRenderer(spec);
        const raw = { clear: false, warmUp: 0 } as const;

        // Settle, then capture the same pose twice with a different pose between.
        renderFrame(rc, spec.cameras[0], raw);
        const before = renderFrame(rc, spec.cameras[0], raw);
        renderFrame(rc, spec.cameras[1], raw);
        const after = renderFrame(rc, spec.cameras[0], raw);

        // Identical inputs, different output: the gap left by the open door
        // is never written, so it still holds the other camera's pixels.
        const ghosted = compareFrames(before, after);
        expect(isClean(ghosted)).toBe(false);
        expect(ghosted.differing).toBeGreaterThan(500);

        // Clearing first removes the dependency entirely.
        const cleared = { clear: true, warmUp: 0 } as const;
        const a = renderFrame(rc, spec.cameras[0], cleared);
        renderFrame(rc, spec.cameras[1], cleared);
        const b = renderFrame(rc, spec.cameras[0], cleared);
        expect(isClean(compareFrames(a, b)), describeDiff(compareFrames(a, b))).toBe(true);
    }, 30_000);

    it('shades the first frame\'s walls against a stale light map', async () => {
        // render() calls updateStaticLightMap() after computeScene(), so the
        // zbuffer for frame 1 is built before any light has been traced,
        // while renderFlats in that same frame uses the fresh light map.
        const spec = SCENES.find(s => s.name === 'lit')!;
        const rc = await buildLegacyRenderer(spec);
        const raw = { clear: true, warmUp: 0 } as const;

        const first = renderFrame(rc, spec.cameras[0], raw);
        const second = renderFrame(rc, spec.cameras[0], raw);
        const third = renderFrame(rc, spec.cameras[0], raw);

        expect(isClean(compareFrames(first, second))).toBe(false);
        // It settles after exactly one frame, which is why warmUp defaults to 1.
        expect(isClean(compareFrames(second, third)), describeDiff(compareFrames(second, third))).toBe(true);
    }, 30_000);

    it('leaves one ceiling pixel unwritten at screen centre when height !== 1', async () => {
        // In the general (height !== 1) branch of renderFlats, an
        // axis-aligned camera leaves the exact centre column of one ceiling
        // row unwritten. Cosmetic at one pixel in 16384, but pinned so the
        // port either reproduces it or fixes it deliberately.
        const spec = SCENES.find(s => s.name === 'room')!;
        const crouched = spec.cameras.find(c => c.name === 'crouched')!;
        const frame = await renderLegacy(spec, crouched);

        const unwritten: { x: number; y: number }[] = [];
        for (let i = 0, p = 0; p < frame.width * frame.height; ++p, i += 4) {
            if (frame.data[i + 3] !== 255) {
                unwritten.push({ x: p % frame.width, y: (p / frame.width) | 0 });
            }
        }
        expect(unwritten).toEqual([{ x: frame.width >> 1, y: 45 }]);

        // The eye-level fast path does not have it.
        const level = spec.cameras.find(c => c.name === 'centre-east')!;
        const levelFrame = await renderLegacy(spec, level);
        let nonOpaque = 0;
        for (let i = 3; i < levelFrame.data.length; i += 4) {
            if (levelFrame.data[i] !== 255) ++nonOpaque;
        }
        expect(nonOpaque).toBe(0);
    }, 30_000);

    it('needs no warm-up for a scene with no light sources', async () => {
        const spec = SCENES.find(s => s.name === 'room')!;
        const rc = await buildLegacyRenderer(spec);
        const raw = { clear: true, warmUp: 0 } as const;
        const first = renderFrame(rc, spec.cameras[0], raw);
        const second = renderFrame(rc, spec.cameras[0], raw);
        expect(isClean(compareFrames(first, second))).toBe(true);
    }, 30_000);
});
