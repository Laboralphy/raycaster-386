import { describe, expect, it } from 'vitest';
import { installDom } from '../harness/dom.js';
import { buildAtlas } from '../harness/fixtures.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';
import { SCENES } from '../harness/scenes.js';
import { Renderer } from '../../src/Renderer.js';
import { ShadedTileSet } from '../../src/texture/ShadedTileSet.js';

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
        expect(m.total).toBe(
            m.tilesets + m.decals + m.lightMaps + m.background + m.screen + m.storey
        );
    });

    it('counts a storey\'s adopted textures on the floor that owns them', () => {
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
