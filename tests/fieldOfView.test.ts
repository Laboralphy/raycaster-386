import { describe, expect, it } from 'vitest';
import { DEFAULT_FOV, SPRITE_Z_SCALE } from '../src/consts.js';
import { Renderer } from '../src/Renderer.js';
import type { Sprite } from '../src/Sprite.js';
import type { ZSlice } from '../src/raycast/ZBuffer.js';
import { installDom } from './harness/dom.js';
import { buildFlatAtlas, buildSpriteAtlas, buildWallAtlas, SPRITE_TILE_HEIGHT, SPRITE_TILE_WIDTH } from './harness/fixtures.js';
import { SCENES } from './harness/scenes.js';

const SPEC = SCENES.find(s => s.name === 'sprites')!;

/** Large enough for the projected sizes not to be dominated by rounding. */
const WIDTH = 800;
const HEIGHT = 500;

/** 16:10 (the default here), 4:3, 21:9, square and portrait. */
const SCREENS = [
    { width: 800, height: 500 },
    { width: 800, height: 600 },
    { width: 840, height: 360 },
    { width: 600, height: 600 },
    { width: 450, height: 800 },
];

/** Default, then a few others, in degrees. */
const FIELDS_OF_VIEW = [undefined, 60, 75, 90, 100];

const CAMERA = { x: 2 * 64 + 32, y: 4 * 64 + 32, angle: 0 };

/**
 * An empty 8x8 room, the camera in its west half looking east, and a sprite
 * standing against the east wall, straight ahead: the wall and the sprite are
 * at the same distance.
 */
function room(width = WIDTH, height = HEIGHT, degrees?: number): { rc: Renderer; sprite: Sprite } {
    installDom();
    const rc = new Renderer();
    rc.setScreen(
        degrees === undefined ? { width, height } : { width, height, fov: (degrees * Math.PI) / 180 }
    );
    rc.setMetrics(SPEC.metrics);
    rc.setShading(SPEC.shading);
    rc.setWallTextures(buildWallAtlas(SPEC));
    rc.setFlatTextures(buildFlatAtlas(SPEC));
    rc.setMapSize(8);
    rc.registerCellMaterial(1, { n: 0, e: 1, s: 2, w: 3, f: null, c: null });
    rc.registerCellMaterial(2, { n: null, e: null, s: null, w: null, f: 0, c: 1 });
    for (let y = 0; y < 8; ++y) {
        for (let x = 0; x < 8; ++x) {
            const wall = x === 0 || y === 0 || x === 7 || y === 7;
            rc.setCellMaterial(x, y, wall ? 1 : 2);
            rc.setCellPhys(x, y, wall ? 1 : 0);
        }
    }
    const tileset = rc.buildTileSet(buildSpriteAtlas(), SPRITE_TILE_WIDTH, SPRITE_TILE_HEIGHT);
    const sprite = rc.buildSprite(tileset);
    // the east wall's west face is at x = 7 * 64
    sprite.x = 7 * 64 - 0.5;
    sprite.y = CAMERA.y;
    sprite.buildAnimation({ starts: [0], length: 1, duration: 100, loop: 0 });
    return { rc, sprite };
}

/** The wall slice in the middle column, and the sprite's slice. */
function slices(rc: Renderer, sprite: Sprite): { wall: ZSlice; sprite: ZSlice } {
    const zbuffer = rc.computeScene(CAMERA.x, CAMERA.y, CAMERA.angle, 1).zbuffer;
    const middle = rc.screen.width >> 1;
    const wall = zbuffer.find(s => s[0] !== sprite.getTileSet() && s[5] <= middle && middle < s[5] + s[7]);
    const spriteSlice = zbuffer.find(s => s[0] === sprite.getTileSet());
    expect(wall).toBeDefined();
    expect(spriteSlice).toBeDefined();
    return { wall: wall!, sprite: spriteSlice! };
}

describe('field of view', () => {
    it('defaults to the original focal, (width / 2) * (16 / 9)', () => {
        const { rc } = room();
        expect(rc.focal).toBeCloseTo((WIDTH >> 1) * (16 / 9), 9);
        expect(rc.screen.fov).toBe(DEFAULT_FOV);
        expect(rc.computeScene(CAMERA.x, CAMERA.y, 0, 1).camera.fov).toBeCloseTo(Math.atan2(9, 16), 12);
    });

    it('derives the focal from a given field of view', () => {
        const { rc } = room(WIDTH, HEIGHT, 90);
        expect(rc.focal).toBeCloseTo(WIDTH >> 1, 9);
        expect(rc.screen.fov).toBeCloseTo(Math.PI / 2, 12);
        expect(rc.computeScene(CAMERA.x, CAMERA.y, 0, 1).camera.fov).toBeCloseTo(Math.PI / 4, 12);
    });

    it('rejects a field of view outside (0, PI)', () => {
        const rc = new Renderer();
        for (const fov of [0, -1, Math.PI, 4, Number.NaN]) {
            expect(() => rc.setScreen({ width: WIDTH, height: HEIGHT, fov }), String(fov)).toThrow(RangeError);
        }
    });

    it('passes the field of view down to the upper storey', () => {
        const rc = new Renderer();
        rc.setScreen({ width: WIDTH, height: HEIGHT, fov: Math.PI / 2 });
        const storey = rc.createStorey();
        expect(storey.focal).toBeCloseTo(rc.focal, 12);
        expect(storey.screen.fov).toBe(Math.PI / 2);
    });

    it('keeps SPRITE_Z_SCALE as 1 / cos(fov / 2) at the default, the original constant', () => {
        expect(SPRITE_Z_SCALE).toBe(1 / Math.cos(Math.atan2(9, 16)));
        // MAGIC_DIST_RATIO, the value found empirically in the original
        expect(SPRITE_Z_SCALE).toBeCloseTo(1.14734748441786, 13);
    });

    describe.each(SCREENS)('on a $width x $height screen', ({ width, height }) => {
        it.each(FIELDS_OF_VIEW)('draws square pixels at %s degrees (default if undefined)', degrees => {
            const { rc, sprite } = room(width, height, degrees);
            const s = slices(rc, sprite);
            // wall and sprite at the same distance: their heights on screen are
            // in the ratio of their texture heights. A wall slice is drawn 2
            // pixels taller than its projection, to close gaps between slices;
            // the sprite height is truncated, hence one sprite pixel of slack.
            const ratio = SPEC.metrics.height / SPRITE_TILE_HEIGHT;
            expect(Math.abs(s.wall[8] - 2 - ratio * s.sprite[8])).toBeLessThanOrEqual(ratio);
        });

        it.each(FIELDS_OF_VIEW)('sorts a sprite against a wall at the wall depth at %s degrees', degrees => {
            const { rc, sprite } = room(width, height, degrees);
            const s = slices(rc, sprite);
            expect(s.sprite[9] / s.wall[9]).toBeCloseTo(1, 2);
            expect(s.sprite[9]).toBeLessThan(s.wall[9]);
        });

        it('puts the horizon in the middle of the screen', () => {
            const { rc, sprite } = room(width, height);
            const wall = slices(rc, sprite).wall;
            // a wall seen from eye level is centred on the horizon
            expect(Math.abs(wall[6] + wall[8] / 2 - height / 2)).toBeLessThanOrEqual(2);
        });
    });
});
