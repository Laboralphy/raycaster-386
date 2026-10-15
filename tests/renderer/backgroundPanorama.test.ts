import { describe, expect, it } from 'vitest';
import { backgroundScroll } from '../../src/render/renderBackground.js';
import { SCENES } from '../harness/scenes.js';
import { buildBackground } from '../harness/fixtures.js';
import type { CameraPose } from '../harness/fixtures.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';

/**
 * A panorama backdrop covers a full turn, where the default one repeats every
 * quarter turn.
 *
 * The scroll is checked as a formula, then through the renderer: a panorama
 * frame must match a default frame whose backgroundOffset makes up the
 * difference, and differ from a default frame left alone.
 */
const QUARTER = Math.PI / 2;

describe('backgroundScroll', () => {
    it('scrolls one image width per quarter turn by default', () => {
        expect(backgroundScroll(QUARTER, 384, false)).toBeCloseTo(384);
        expect(backgroundScroll(4 * QUARTER, 384, false)).toBeCloseTo(4 * 384);
    });

    it('scrolls one image width per full turn for a panorama', () => {
        expect(backgroundScroll(QUARTER, 3200, true)).toBeCloseTo(800);
        expect(backgroundScroll(4 * QUARTER, 3200, true)).toBeCloseTo(3200);
    });
});

describe('Renderer panorama backdrop', () => {
    const spec = SCENES.find(s => s.name === 'sky')!;
    const camera: CameraPose = { ...spec.cameras[0], angle: 1 };

    function render(panorama: boolean, offset = 0) {
        const rc = buildPortRenderer(spec);
        rc.setBackground(buildBackground(spec), { panorama });
        rc.backgroundOffset = offset;
        return { rc, frame: renderPortFrame(rc, camera) };
    }

    it('is off unless asked for', () => {
        const rc = buildPortRenderer(spec);
        expect(rc.backgroundPanorama).toBe(false);
        rc.setBackground(buildBackground(spec), { panorama: true });
        expect(rc.backgroundPanorama).toBe(true);
        rc.setBackground(buildBackground(spec));
        expect(rc.backgroundPanorama).toBe(false);
    });

    it('draws the backdrop at the panorama scroll', () => {
        const pano = render(true);
        // the backdrop as stored by the renderer: scaled to the screen height
        const scale = spec.screen.height / spec.background!.height;
        const w = spec.background!.width * scale;
        const compensated = render(false, backgroundScroll(1, w, true) - backgroundScroll(1, w, false));
        const plain = render(false);
        expect(Buffer.from(pano.frame.data).equals(Buffer.from(compensated.frame.data))).toBe(true);
        expect(Buffer.from(pano.frame.data).equals(Buffer.from(plain.frame.data))).toBe(false);
    });
});
