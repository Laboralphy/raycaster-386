import { describe, expect, it } from 'vitest';
import { installDom } from '../harness/dom.js';
import { buildAtlas } from '../harness/fixtures.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';
import { SCENES } from '../harness/scenes.js';
import { Renderer } from '../../src/Renderer.js';
import { ShadedTileSet } from '../../src/texture/ShadedTileSet.js';
import { shadeCache } from '../../src/texture/ShadeCache.js';
import { createCanvas } from '../../src/core/canvas.js';

const LAYERS = 16;
const TILE = 16;

function scene(name: string) {
    const spec = SCENES.find((s) => s.name === name);
    if (spec === undefined) {
        throw new Error(`no scene named "${name}"`);
    }
    return spec;
}

describe('pixel storage', () => {
    it('holds the same shaded pixels as the canvas it replaces', () => {
        installDom();
        const source = buildAtlas(4, TILE, TILE);

        const drawn = new ShadedTileSet();
        drawn.setShadingLayerCount(LAYERS);
        drawn.setImage(source, TILE, TILE);
        drawn.compute('black', null, 0);

        const sampled = new ShadedTileSet();
        sampled.setShadingLayerCount(LAYERS);
        sampled.setPixelStorage(true);
        sampled.setImage(source, TILE, TILE);
        sampled.compute('black', null, 0);

        const canvas = drawn.getImage()!;
        const expected = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = sampled.getPixels()!;
        expect(pixels.width).toBe(canvas.width);
        expect(pixels.height).toBe(canvas.height);
        expect(Array.from(pixels.data)).toEqual(Array.from(expected.data));
    });

    it('keeps layer 0 alone as a canvas, which is what a decal is seeded from', () => {
        installDom();
        const ts = new ShadedTileSet();
        ts.setShadingLayerCount(LAYERS);
        ts.setPixelStorage(true);
        ts.setImage(buildAtlas(4, TILE, TILE), TILE, TILE);
        ts.compute('black', null, 0);

        // One layer of canvas, sixteen of pixels: the saving this mode exists
        // for. extractTile(_, 0) still works, and nothing asks for more.
        expect(ts.getImage()!.height).toBe(TILE);
        expect(ts.getPixels()!.height).toBe(TILE * LAYERS);
        expect(ts.extractTile(1, 0).height).toBe(TILE);
    });
});

describe('memory usage', () => {
    it('reports a breakdown that adds up', () => {
        const spec = scene('decals');
        const rc = buildPortRenderer(spec);
        renderPortFrame(rc, spec.cameras[0]);

        const m = rc.getMemoryUsage();
        expect(m.tilesets).toBeGreaterThan(0);
        expect(m.decals).toBeGreaterThan(0);
        expect(m.lightMaps).toBeGreaterThan(0);
        expect(m.screen).toBeGreaterThan(0);
        expect(m.resident).toBe(
            m.tilesets + m.decals + m.lightMaps + m.background + m.screen + m.storey
        );
        expect(m.working).toBe(m.shadeCache + m.frameBuffer);
        expect(m.total).toBe(m.resident + m.working);
        // What a level costs to hold must not move as sprites are drawn.
        expect(m.frameBuffer).toBeGreaterThan(0);
    });

    it("counts a storey's adopted textures on the floor that owns them", () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setWallTextures(buildAtlas(4, TILE, TILE));
        rc.setFlatTextures(buildAtlas(4, TILE, TILE));
        const storey = rc.createStorey();

        // The storey draws with the ground floor's atlases and into its
        // canvas. Counting them again would report twice what a level costs.
        const m = storey.getMemoryUsage();
        expect(m.tilesets).toBe(0);
        expect(m.screen).toBe(0);
        expect(rc.getMemoryUsage().tilesets).toBeGreaterThan(0);
    });
});

describe('texture warm-up', () => {
    it('draws every drawn texture, and leaves the frame as it found it', () => {
        const spec = scene('decals');
        const rc = buildPortRenderer(spec);

        // Before any frame: it has to bring the canvas up itself rather than
        // wait for a render, or a game calling it on a loading screen — which
        // is the whole point — would warm nothing.
        rc.warmUpTextures();
        const canvas = rc.renderCanvas;
        expect(canvas).not.toBeNull();

        // Whatever it scribbled is gone: the frame is the cleared black the
        // renderer starts from.
        const px = canvas!.getContext('2d')!.getImageData(0, 0, 1, 1).data;
        expect(Array.from(px)).toEqual([0, 0, 0, 255]);

        // And a frame drawn after it still matches the baseline.
        const first = renderPortFrame(rc, spec.cameras[0]);
        const again = renderPortFrame(buildPortRenderer(spec), spec.cameras[0]);
        expect(Array.from(first.data)).toEqual(Array.from(again.data));
    });

    it('is safe before any texture is set', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 32, height: 32 });
        expect(() => rc.warmUpTextures()).not.toThrow();
    });
});

describe('lazy sprite shading', () => {
    it('shades a tile on demand and reuses it', () => {
        installDom();
        const ts = new ShadedTileSet();
        ts.setShadingLayerCount(LAYERS);
        ts.setLazyShading(true);
        ts.setImage(buildAtlas(4, TILE, TILE), TILE, TILE);
        ts.compute('black', null, 0);

        // Only the base is stored: one tile row, not sixteen.
        expect(ts.getImage()!.height).toBe(TILE);

        const target = createCanvas(TILE, TILE);
        const ctx = target.getContext('2d') as CanvasRenderingContext2D;
        shadeCache.clear();
        shadeCache.resetStats();
        ts.drawTile(ctx, TILE, 3 * TILE, TILE, TILE, 0, 0, TILE, TILE);
        expect(shadeCache.stats().entries).toBe(1);
        ts.drawTile(ctx, TILE, 3 * TILE, TILE, TILE, 0, 0, TILE, TILE);
        expect(shadeCache.stats().hits).toBe(1);
    });

    it('draws what the stored layer would have held', () => {
        installDom();
        const source = buildAtlas(4, TILE, TILE);
        const eager = new ShadedTileSet();
        eager.setShadingLayerCount(LAYERS);
        eager.setImage(source, TILE, TILE);
        eager.compute('black', null, 0);

        const lazy = new ShadedTileSet();
        lazy.setShadingLayerCount(LAYERS);
        lazy.setLazyShading(true);
        lazy.setImage(source, TILE, TILE);
        lazy.compute('black', null, 0);

        // The tile itself is identical; what differs between the two, and only
        // once drawn scaled, is which texel a boundary row samples.
        for (const level of [0, 7, 15]) {
            const a = eager.extractTile(2, level);
            const b = lazy.extractTile(2, level);
            const pa = (a.getContext('2d') as CanvasRenderingContext2D).getImageData(
                0,
                0,
                TILE,
                TILE
            );
            const pb = (b.getContext('2d') as CanvasRenderingContext2D).getImageData(
                0,
                0,
                TILE,
                TILE
            );
            expect(Array.from(pb.data)).toEqual(Array.from(pa.data));
        }
    });

    it('keeps itself under the budget', () => {
        installDom();
        const ts = new ShadedTileSet();
        ts.setShadingLayerCount(LAYERS);
        ts.setLazyShading(true);
        ts.setImage(buildAtlas(8, TILE, TILE), TILE, TILE);
        ts.compute('black', null, 0);

        const target = createCanvas(TILE, TILE);
        const ctx = target.getContext('2d') as CanvasRenderingContext2D;
        shadeCache.clear();
        shadeCache.setBudget(TILE * TILE * 4 * 4);
        for (let tile = 0; tile < 8; ++tile) {
            for (let level = 0; level < LAYERS; ++level) {
                ts.drawTile(ctx, tile * TILE, level * TILE, TILE, TILE, 0, 0, TILE, TILE);
            }
        }
        const stats = shadeCache.stats();
        expect(stats.bytes).toBeLessThanOrEqual(stats.budget);
        expect(stats.evictions).toBeGreaterThan(0);
        shadeCache.setBudget(4 * 1024 * 1024);
    });

    it('drops what it cached when the shading changes', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const ts = rc.buildTileSet(buildAtlas(4, TILE, TILE), TILE, TILE);
        expect(ts.lazyShading).toBe(true);
        ts.compute('black', null, 0);

        const target = createCanvas(TILE, TILE);
        const ctx = target.getContext('2d') as CanvasRenderingContext2D;
        shadeCache.clear();
        ts.drawTile(ctx, 0, TILE, TILE, TILE, 0, 0, TILE, TILE);
        expect(shadeCache.stats().entries).toBe(1);

        // A re-shade makes every cached tile wrong, so none may survive it.
        ts.compute('#204060', null, 0.2);
        expect(shadeCache.stats().entries).toBe(0);
    });
});
