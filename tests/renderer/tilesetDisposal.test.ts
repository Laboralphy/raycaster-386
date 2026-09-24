import { describe, expect, it } from 'vitest';
import { installDom } from '../harness/dom.js';
import { buildAtlas } from '../harness/fixtures.js';
import { Renderer } from '../../src/Renderer.js';
import { shadeCache } from '../../src/texture/ShadeCache.js';
import { createCanvas } from '../../src/core/canvas.js';

const TILE = 16;

function renderer(): Renderer {
    installDom();
    const rc = new Renderer();
    rc.setScreen({ width: 64, height: 64 });
    rc.setWallTextures(buildAtlas(4, TILE, TILE));
    rc.setFlatTextures(buildAtlas(4, TILE, TILE));
    return rc;
}

describe('removeUnusedTileSets', () => {
    it('collects a sheet whose sprites have all gone', () => {
        const rc = renderer();
        const ts = rc.buildTileSet(buildAtlas(2, TILE, TILE), TILE, TILE);
        const sprite = rc.buildSprite(ts);

        expect(rc.removeUnusedTileSets()).toBe(0);
        rc.disposeSprite(sprite);
        expect(rc.removeUnusedTileSets()).toBe(1);
        expect(ts.disposed).toBe(true);
    });

    it('spares the wall and flat atlases', () => {
        // They belong to no sprite, so the original collected them, and the
        // renderer then reported a level holding no textures at all.
        const rc = renderer();
        const before = rc.getMemoryUsage().tilesets;
        expect(before).toBeGreaterThan(0);
        rc.removeUnusedTileSets();
        expect(rc.getMemoryUsage().tilesets).toBe(before);
    });

    it('spares a sheet loaded ahead of being used', () => {
        // The dangerous case: collected, it stops being re-shaded, and a later
        // change to `shades` leaves it indexing rows that are not there.
        const rc = renderer();
        const ts = rc.buildTileSet(buildAtlas(2, TILE, TILE), TILE, TILE);
        expect(rc.removeUnusedTileSets()).toBe(0);
        expect(ts.disposed).toBe(false);

        rc.setShading({ shades: 4, color: 'black', filter: null, brightness: 0 });
        rc.render(32, 32, 0, 1);
        expect(ts.getShadingLayerCount()).toBe(4);
    });
});

describe('disposeTileSet', () => {
    it('releases the images and the cache entries', () => {
        const rc = renderer();
        const ts = rc.buildTileSet(buildAtlas(2, TILE, TILE), TILE, TILE);
        ts.compute('black', null, 0);

        const ctx = createCanvas(TILE, TILE).getContext('2d') as CanvasRenderingContext2D;
        shadeCache.clear();
        ts.drawTile(ctx, 0, 2 * TILE, TILE, TILE, 0, 0, TILE, TILE);
        expect(ts.getCacheUsage()).toBeGreaterThan(0);

        rc.disposeTileSet(ts);
        expect(ts.disposed).toBe(true);
        expect(ts.getCacheUsage()).toBe(0);
        expect(ts.getMemoryUsage()).toBe(0);
    });

    it('leaves a sprite still holding it drawing nothing, not throwing', () => {
        // Retiring a sheet between levels must not depend on every sprite
        // having been unbound first, and must be safe mid-frame.
        const rc = renderer();
        const ts = rc.buildTileSet(buildAtlas(2, TILE, TILE), TILE, TILE);
        rc.buildSprite(ts);
        rc.disposeTileSet(ts);

        const ctx = createCanvas(TILE, TILE).getContext('2d') as CanvasRenderingContext2D;
        expect(() => ts.drawTile(ctx, 0, 0, TILE, TILE, 0, 0, TILE, TILE)).not.toThrow();
        expect(() => rc.render(32, 32, 0, 1)).not.toThrow();
    });

    it('is not re-shaded afterwards', () => {
        const rc = renderer();
        const ts = rc.buildTileSet(buildAtlas(2, TILE, TILE), TILE, TILE);
        rc.disposeTileSet(ts);
        // A disposed tileset has no image to compute from; re-shading every
        // registered tileset must not walk into it.
        rc.setShading({ shades: 8, color: '#101010', filter: null, brightness: 0 });
        expect(() => rc.render(32, 32, 0, 1)).not.toThrow();
    });
});

describe('replacing an atlas', () => {
    it('releases the one it replaces', () => {
        const rc = renderer();
        // Shaded, so the figure is the whole cost and not just the originals.
        rc.render(32, 32, 0, 1);
        const first = rc.getMemoryUsage().tilesets;

        // The same textures again: a leak shows as the total growing, which is
        // what the old code did — the replaced atlas stayed registered and
        // went on being re-shaded for the life of the renderer.
        rc.setWallTextures(buildAtlas(4, TILE, TILE));
        rc.setFlatTextures(buildAtlas(4, TILE, TILE));
        rc.render(32, 32, 0, 1);
        expect(rc.getMemoryUsage().tilesets).toBe(first);
    });
});
