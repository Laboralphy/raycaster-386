import { SURFACE_LIGHTMAP_SCALE } from '../consts.js';
import { MarkerRegistry } from '../core/MarkerRegistry.js';
import { resolveTile, type RenderContext } from './context.js';
import { createScreenSlice, materialCodeOf } from './createScreenSlice.js';
import { projectRay } from './projectRay.js';
import type { Scene } from './Scene.js';
import type { ZSlice } from './ZBuffer.js';

/** Guards against a ray looping forever through stacked transparent walls. */
const MAX_RESUMES = 6;

/**
 * Casts one screen column's ray, emitting a slice per surface it meets.
 *
 * A transparent wall does not end the ray: the surface is drawn, the cell is
 * excluded so the ray cannot re-hit it, and projection resumes from there.
 * That is what lets you see a wall through a window, and what makes one
 * column produce several interleaved slices.
 */
export function castRay(
    ctx: RenderContext,
    scene: Scene,
    x: number,
    y: number,
    dx: number,
    dy: number,
    xScreen: number,
    visibleRegistry: MarkerRegistry,
    zbuffer: ZSlice[],
    exclusionRegistry: MarkerRegistry
): void {
    // Only a transparent wall ever marks this, so it is usually already
    // empty; Set.prototype.clear() is not free enough to call per ray.
    if (exclusionRegistry.size > 0) {
        exclusionRegistry.clear();
    }
    const csm = ctx.csm;
    const lmc = SURFACE_LIGHTMAP_SCALE;
    const ps = ctx.spacing;
    let remaining = MAX_RESUMES;

    do {
        projectRay(ctx, scene, x, y, dx, dy, exclusionRegistry, visibleRegistry);
        if (!scene.exterior && scene.distance >= 0) {
            const surface = csm.getSurface(scene.xCell, scene.yCell, scene.cellSide);
            let tileset = surface?.tileset ?? null;
            let tile: number | null;
            if (tileset !== null) {
                // A painted decal replaces the material's own texture.
                tile = 0;
            } else {
                tileset = ctx.walls;
                tile = resolveTile(ctx.cellCodes, materialCodeOf(scene.cellCode), scene.cellSide);
            }
            if (tile !== null && tileset !== null) {
                const light =
                    surface === null ? 0 : surface.lightMap[((scene.wallColumn * lmc) / ps) | 0];
                zbuffer.push(createScreenSlice(ctx, scene, xScreen, tileset, tile, light));
            }
            if (scene.resume.active) {
                exclusionRegistry.mark(scene.xCell, scene.yCell);
            }
        }
        --remaining;
    } while (scene.resume.active && remaining > 0);
}
