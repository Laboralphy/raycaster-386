import { Canvas } from '../../src';

/** Sprite tile size for the demo's patrolling sentinel. */
export const SENTINEL_TILE_WIDTH = 24;
export const SENTINEL_TILE_HEIGHT = 48;
/** One tile per facing, so turning is visible. */
export const SENTINEL_FACINGS = 8;

/**
 * Draws the demo's sprite atlas: one tile per facing, each a different hue.
 *
 * Generated rather than shipped as a PNG, so the demo stays two asset files,
 * and so the facing that is showing is obvious at a glance while walking
 * around it.
 *
 * Lives here rather than in `world.ts` because it makes a canvas, and the
 * world deliberately knows nothing about one.
 */
export function buildSentinelAtlas(): HTMLCanvasElement {
    const canvas = Canvas.createCanvas(
        SENTINEL_TILE_WIDTH * SENTINEL_FACINGS,
        SENTINEL_TILE_HEIGHT
    );
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < SENTINEL_FACINGS; ++i) {
        const x = i * SENTINEL_TILE_WIDTH;
        const hue = (i * 360) / SENTINEL_FACINGS;
        ctx.fillStyle = `hsl(${hue}, 70%, 45%)`;
        ctx.fillRect(x + 3, 6, SENTINEL_TILE_WIDTH - 6, SENTINEL_TILE_HEIGHT - 10);
        // A bright band at the top, so height and altitude read clearly.
        ctx.fillStyle = `hsl(${hue}, 90%, 75%)`;
        ctx.fillRect(x + 3, 6, SENTINEL_TILE_WIDTH - 6, 6);
    }
    return canvas;
}
