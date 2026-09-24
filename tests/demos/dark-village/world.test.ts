import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PHYS_NONE } from '../../../src/index.js';
import type { RceLevel } from '../../../src/index.js';
import { World } from '../../../demos/dark-village/world.js';
import { emptyInput } from '../../../demos/dark-village/input.js';
import { installDom } from '../../harness/dom.js';

const ROOT = resolve(__dirname, '../../../demos/dark-village');

/** Decodes one of the demo's converted atlases. As the browser host does. */
async function image(src: string): Promise<HTMLCanvasElement> {
    const img = await loadImage(readFileSync(resolve(ROOT, src)));
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas as unknown as HTMLCanvasElement;
}

function levelData(): RceLevel {
    return JSON.parse(
        readFileSync(resolve(ROOT, 'assets/level-1.rce.json'), 'utf8')
    ) as RceLevel;
}

/**
 * End-to-end check of the second demo, against a real level built in the
 * MapEdit editor and published as RCE-100.
 *
 * Unlike `demos/simple`, nothing here is hand-written: the map, its materials,
 * its scenery and its start point all come out of the level file, so this also
 * covers the converter's output staying loadable.
 */
describe('dark-village world', () => {
    let data: RceLevel;

    beforeAll(() => {
        installDom();
        data = levelData();
    });

    async function world(): Promise<World> {
        const w = new World();
        w.setScreen(160, 100);
        await w.build(data, image);
        return w;
    }

    it('loads the converted level and renders it', async () => {
        const w = await world();
        expect(w.renderer.getMapSize()).toBe(59);
        // The start point the level declares, not one this demo chose.
        expect(w.cell).toEqual({ x: 9, y: 5 });
        expect(w.renderer.getCellPhys(w.cell.x, w.cell.y)).toBe(PHYS_NONE);

        w.render();
        const canvas = w.renderer.renderCanvas!;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const colours = new Set<number>();
        for (let i = 0; i < pixels.length; i += 4) {
            colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
        }
        expect(colours.size, 'rendered a flat fill').toBeGreaterThan(100);
    });

    it('places the level\'s scenery as sprites', async () => {
        const w = await world();
        const loaded = w.loaded!;
        expect(loaded.unhandled.objects.length).toBe(63);
        expect(loaded.unhandled.blueprints.length).toBe(43);
        // Every blueprint names a behaviour, which nothing in the library
        // resolves — see PROGRESS.md on the thinker registry.
        const named = loaded.unhandled.blueprints.filter(b => !!b.thinker);
        expect(named.length).toBe(43);
    });

    it('walks without leaving the map or entering a wall', async () => {
        const w = await world();
        const start = { ...w.player.position };
        const input = { ...emptyInput(), forward: 1 };
        for (let i = 0; i < 200; ++i) {
            w.update(input);
            w.render();
        }
        const c = w.cell;
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(59);
        expect(c.y).toBeLessThan(59);
        expect(w.renderer.getCellPhys(c.x, c.y)).toBe(PHYS_NONE);
        // It is a real level, so it may walk into a wall immediately; what
        // matters is that it never ends up inside one.
        expect(Number.isFinite(w.player.position.x)).toBe(true);
        expect(start).toBeDefined();
    });

    it('fires a tag when the player pushes against the cell carrying it', async () => {
        const w = await world();
        // The level tags (9, 4) with `goto mans-cabin 1`. It is a transparent
        // block — solid — so it is reached by pushing, not by walking in. The
        // player starts at (9, 5), one cell south, facing south.
        w.update(emptyInput());
        expect(w.firedTag, 'no tag fired on the first tick').toBeNull();

        // Turn to face it. The crosshair is no use here: the centre ray goes
        // straight through a transparent block, so it reports a wall far
        // beyond. What the player stands in front of is the right question.
        w.player.position.angle = -Math.PI / 2;
        expect(w.facedCell()).toEqual({ x: 9, y: 4 });

        w.use();
        expect(w.firedTag, 'pushing the tagged cell fired nothing').not.toBeNull();
        expect(w.firedTag!.command).toBe('goto');
        expect(w.firedTag!.parameters).toEqual(['mans-cabin', '1']);
    });

    it('advances the animated tilesets, so the torches burn', async () => {
        const w = await world();
        // Three tilesets in this level loop forward; the shortest frame lasts
        // 120ms, so a second of ticks must move every one of them.
        const animated = w.objects
            .map(o => o.sprite)
            .filter(sprite => sprite.animation !== null);
        expect(animated.length, 'no animated sprite was placed').toBeGreaterThan(0);

        const before = animated.map(s => s.animation!.index);
        for (let i = 0; i < 60; ++i) {
            w.update(emptyInput());
        }
        const after = animated.map(s => s.animation!.index);
        expect(after, 'the animations never advanced').not.toEqual(before);
    });

    it('reports the level\'s doors through DoorPolicy', async () => {
        const w = await world();
        // The level declares one double door in its legend; find it on the map.
        let found: { x: number; y: number } | null = null;
        for (let y = 0; y < 59 && found === null; ++y) {
            for (let x = 0; x < 59; ++x) {
                if (w.doors.isDoor(x, y)) {
                    found = { x, y };
                    break;
                }
            }
        }
        expect(found, 'the level has no door cell').not.toBeNull();
        expect(w.doors.openDoor(found!.x, found!.y, true)).not.toBeNull();
        for (let i = 0; i < 60; ++i) {
            w.update(emptyInput());
        }
        expect(w.doors.contexts.length).toBeGreaterThan(0);
    });
});
