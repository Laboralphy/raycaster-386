import { FX_ALPHA } from '../consts.js';
import type { Scene } from '../raycast/Scene.js';
import type { ZSlice } from '../raycast/ZBuffer.js';

/** Bit 0 of the fx flags: draw with the "lighter" composite operation. */
const FX_MASK_LIGHTER = 1;
/** Bit 1: the surface emits light, so its shading level is forced to 0. */
const FX_MASK_LIGHT_SOURCE = 2;
/** Bits 2-3: opacity index into FX_ALPHA. */
const FX_MASK_ALPHA = 12;

/**
 * Draws one slice: a strip of a shaded tileset, scaled into place.
 */
export function renderScreenSlice(slice: ZSlice, rc: CanvasRenderingContext2D): void {
    const tileset = slice[0];
    if (tileset === null) {
        return;
    }
    const fx = slice[10];
    const useAlpha = (fx & FX_MASK_ALPHA) !== 0;
    const useLighter = (fx & FX_MASK_LIGHTER) !== 0;

    let savedComposite: GlobalCompositeOperation | null = null;
    if (useLighter) {
        savedComposite = rc.globalCompositeOperation;
        rc.globalCompositeOperation = 'lighter';
    }
    let savedAlpha = 0;
    if (useAlpha) {
        savedAlpha = rc.globalAlpha;
        rc.globalAlpha = FX_ALPHA[fx >> 2];
    }

    // A light source is drawn from shading layer 0 whatever its distance.
    const sourceFactor = 1 - ((fx & FX_MASK_LIGHT_SOURCE) >> 1);
    const sx = slice[1] | 0;
    const sw = slice[3] | 0;
    const sh = slice[4] | 0;

    if (sx >= 0 && sh > 0 && sw > 0) {
        tileset.drawTile(
            rc,
            sx,
            (slice[2] * sourceFactor) | 0,
            sw,
            sh,
            slice[5] | 0,
            slice[6] | 0,
            slice[7] | 0,
            slice[8] | 0
        );
    }

    if (savedComposite !== null) {
        rc.globalCompositeOperation = savedComposite;
    }
    if (useAlpha) {
        rc.globalAlpha = savedAlpha;
    }
}

/** Draws every slice of a scene, in buffer order. */
export function renderScreenSliceBuffer(scene: Scene, rc: CanvasRenderingContext2D): void {
    const zbuffer = scene.zbuffer;
    for (let i = 0, l = zbuffer.length; i < l; ++i) {
        renderScreenSlice(zbuffer[i], rc);
    }
}
