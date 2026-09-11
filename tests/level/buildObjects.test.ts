import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildObjects, decalOffset, loadLevel } from '../../src/index.js';
import type { RceBlueprint, RceLevel } from '../../src/index.js';
import { Renderer } from '../../src/Renderer.js';
import { installDom } from '../harness/dom.js';

const MANSION = resolve(__dirname, '../fixtures/mansion');

async function mansionImage(src: string): Promise<HTMLCanvasElement> {
    const image = await loadImage(readFileSync(resolve(MANSION, src)));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas as unknown as HTMLCanvasElement;
}

function level(name: string): RceLevel {
    return JSON.parse(
        readFileSync(resolve(MANSION, 'assets/levels', `${name}.json`), 'utf8')
    ) as RceLevel;
}

describe('decal alignment', () => {
    // The original resolved this with a nine-case switch over the numpad codes.
    // The port computes column and row instead; this is the equivalence, with
    // the expected values read off that switch.
    const W = 100, H = 80, TW = 20, TH = 10;
    const xLeft = 0, xMid = 40, xRight = 80;
    const yTop = 0, yMid = 35, yBottom = 70;

    it.each([
        [7, xLeft, yTop], [8, xMid, yTop], [9, xRight, yTop],
        [4, xLeft, yMid], [5, xMid, yMid], [6, xRight, yMid],
        [1, xLeft, yBottom], [2, xMid, yBottom], [3, xRight, yBottom]
    ])('places align %i at (%i, %i)', (align, x, y) => {
        expect(decalOffset(align as 1, W, H, TW, TH)).toEqual({ x, y });
    });
});

describe('buildObjects', () => {
    it('places every object in a real level, with its lights', async () => {
        installDom();
        const data = level('mans-cabin');
        const rc = new Renderer();
        rc.setScreen({ width: 160, height: 100 });
        const loaded = await loadLevel(rc, data, { loadImage: mansionImage });

        const placed = await buildObjects(rc, loaded, { loadImage: mansionImage });
        expect(placed.length).toBe(data.objects!.length);
        expect(placed.length).toBeGreaterThan(80);

        // Positions come straight from the level, in world units.
        expect(placed[0].sprite.x).toBe(data.objects![0].x);
        expect(placed[0].sprite.y).toBe(data.objects![0].y);

        // Four of this level's blueprints carry a light.
        expect(placed.filter(p => p.light !== null).length).toBeGreaterThan(0);
        // The collision radius is reported, never applied.
        expect(placed.every(p => typeof p.size === 'number')).toBe(true);
    }, 120_000);

    it('starts an object in the animation it names', async () => {
        installDom();
        const data = level('mans-cabin');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const loaded = await loadLevel(rc, data, { loadImage: mansionImage });
        const placed = await buildObjects(rc, loaded, { loadImage: mansionImage });

        const animated = placed.filter(p => p.object.animation);
        expect(animated.length, 'no animated objects in the fixture').toBeGreaterThan(5);
        for (const p of animated) {
            expect(p.sprite.getCurrentAnimation(), `${String(p.blueprint.id)} has no animation`)
                .not.toBeNull();
        }
    }, 120_000);

    it('sinks an object with a negative z below the floor', async () => {
        installDom();
        const data = level('mans-test1');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const loaded = await loadLevel(rc, data, { loadImage: mansionImage });
        const placed = await buildObjects(rc, loaded, { loadImage: mansionImage });

        const sunk = placed.filter(p => p.sprite.h < 0);
        expect(sunk.length, 'this level should have objects below floor level').toBeGreaterThan(0);
        for (const p of sunk) {
            expect(p.sprite.h).toBe(p.object.z);
        }
    }, 120_000);

    it('rejects an object whose blueprint was never supplied', async () => {
        installDom();
        const data = level('mans-cabin');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const loaded = await loadLevel(rc, { ...data, blueprints: [] }, { loadImage: mansionImage });
        await expect(buildObjects(rc, loaded, { loadImage: mansionImage }))
            .rejects.toThrow(/neither in the level nor supplied/);
    }, 120_000);
});

describe('blueprints supplied from outside the level', () => {
    it('merges them with whatever the level declares', async () => {
        installDom();
        const data = level('mans-cabin');
        const own = data.blueprints!.length;
        const extra: RceBlueprint = {
            id: 'shared-lamp',
            tileset: data.tilesets![0].id,
            size: 4,
            fx: ['@FX_LIGHT_SOURCE']
        };

        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const loaded = await loadLevel(rc, data, {
            loadImage: mansionImage,
            blueprints: [extra]
        });

        expect(loaded.unhandled.blueprints.length).toBe(own + 1);
        const merged = loaded.unhandled.blueprints.find(b => b.id === 'shared-lamp');
        expect(merged, 'the supplied blueprint did not survive').toBeDefined();
        // Its symbols resolved like the level's own.
        expect(merged!.fx).toEqual([2]);
        // And the level object is untouched.
        expect(data.blueprints!.length).toBe(own);
    }, 120_000);

    it('lets an object built from a supplied blueprint be placed', async () => {
        installDom();
        const data = level('mans-cabin');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        const loaded = await loadLevel(
            rc,
            { ...data, objects: [{ x: 100, y: 200, z: 0, blueprint: 'shared' }] },
            {
                loadImage: mansionImage,
                blueprints: [{ id: 'shared', tileset: data.tilesets![0].id, size: 8 }]
            }
        );
        const placed = await buildObjects(rc, loaded, { loadImage: mansionImage });
        expect(placed.length).toBe(1);
        expect(placed[0].size).toBe(8);
        expect([placed[0].sprite.x, placed[0].sprite.y]).toEqual([100, 200]);
    }, 120_000);
});
