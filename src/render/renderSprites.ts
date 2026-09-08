import { SPRITE_Z_SCALE } from '../consts.js';
import { distance } from '../core/geometry.js';
import type { RenderContext } from '../raycast/context.js';
import type { Scene } from '../raycast/Scene.js';
import type { Sprite } from '../Sprite.js';

/**
 * Projects a sprite into the z-buffer as a billboard.
 *
 * Sprites outside 1.5x the field of view are skipped: the margin keeps a wide
 * sprite whose centre is just off screen from popping in at its edge.
 */
export function renderSprite(ctx: RenderContext, scene: Scene, sprite: Sprite): void {
    if (!sprite.visible) {
        return;
    }
    const tileset = sprite.getTileSet();
    if (tileset === null) {
        return;
    }
    const camera = scene.camera;
    const dx = sprite.x - camera.x;
    const dy = sprite.y - camera.y;
    const fov = camera.fov;

    let alpha = Math.atan2(dy, dx) - camera.direction;
    if (alpha >= Math.PI) {
        alpha = -(Math.PI * 2 - alpha);
    }
    if (alpha < -Math.PI) {
        alpha = Math.PI * 2 + alpha;
    }
    if (Math.abs(alpha) > fov * 1.5) {
        return;
    }

    const scale = sprite.scale;
    const wspr = tileset.tileWidth;
    const hspr = tileset.tileHeight;
    const xscr2 = ctx.screenWidth >> 1;
    const yscr2 = ctx.screenWidth >> 1;

    const z = distance(sprite.x, sprite.y, camera.x, camera.y);
    const x = Math.sin(alpha) * z;
    // Distance along the view axis, which is what the projection divides by.
    const f = Math.cos(alpha) * z;
    const factor = camera.focal / f;

    const dw = (wspr * factor) / scale;
    const dh = (hspr * factor) / scale;
    const dxScreen = xscr2 + x * factor - (dw >> 1);
    const dhHorizon = (ctx.wallHeight >> 1) * (1 - camera.height) * factor;
    const altitude = sprite.h * factor;
    const dyScreen = yscr2 + dhHorizon - altitude - (dh >> 1) - ctx.offsetTop;

    const light = ctx.csm.getLightMap(sprite.x, sprite.y, ctx.spacing);
    const shade = Math.max(0, Math.min(ctx.shades - 1, (z / ctx.shadingFactor - light) | 0));

    const dx0 = dxScreen | 0;
    const dy0 = dyScreen | 0;
    const dw0 = dw | 0;
    const dh0 = dh | 0;
    const sx = wspr * sprite.getCurrentFrame();
    const sy = shade * hspr;

    scene.zbuffer.push([
        tileset,
        sx,
        sy,
        wspr,
        hspr,
        dx0,
        dy0,
        dw0,
        dh0,
        f * SPRITE_Z_SCALE,
        sprite.flags
    ]);

    const lr = sprite.lastRendered;
    lr.tileset = tileset;
    lr.sx = sx;
    // A light-source sprite is drawn from layer 0 whatever its distance.
    lr.sy = (sprite.flags & 2) > 0 ? 0 : sy;
    lr.sw = wspr;
    lr.sh = hspr;
    lr.dx = dx0;
    lr.dy = dy0;
    lr.dw = dw0;
    lr.dh = dh0;
}

/** Projects every sprite standing in a cell the rays reached. */
export function renderSprites(
    ctx: RenderContext,
    scene: Scene,
    sprites: readonly Sprite[],
    isCellVisible: (x: number, y: number) => boolean
): void {
    const ps = ctx.spacing;
    for (let i = 0, l = sprites.length; i < l; ++i) {
        const sprite = sprites[i];
        if (isCellVisible((sprite.x / ps) | 0, (sprite.y / ps) | 0)) {
            renderSprite(ctx, scene, sprite);
        }
    }
}
