import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { World, emptyInput } from '../../../demos/simple/world.js';
import { PHYS_NONE } from '../../../src/index.js';
import { installDom } from '../../harness/dom.js';
import { compareFrames, isClean } from '../../harness/compare.js';
import type { Frame } from '../../harness/legacyRenderer.js';

/** Decodes one of the demo's real PNG assets into a canvas. */
async function asset(name: string): Promise<HTMLCanvasElement> {
    const image = await loadImage(readFileSync(resolve(__dirname, '../../../demos/simple/assets', name)));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas as unknown as HTMLCanvasElement;
}

function grab(world: World): Frame {
    const canvas = world.renderer.renderCanvas!;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(img.data) };
}

/**
 * End-to-end check of the demo against the original engine's real assets: its
 * `tagged-level` map and its actual wall and flat PNGs, rather than the
 * generated atlases the golden scenes use.
 */
describe('demo world', () => {
    let walls: HTMLCanvasElement;
    let flats: HTMLCanvasElement;

    beforeAll(async () => {
        installDom();
        [walls, flats] = await Promise.all([asset('walls.png'), asset('flats.png')]);
    });

    function world(): World {
        const w = new World();
        w.setScreen(160, 100);
        w.build(walls, flats);
        return w;
    }

    it('builds the level from the real assets and renders something', () => {
        const w = world();
        expect(w.renderer.getMapSize()).toBe(10);
        // The door from the upstream level, at (2, 2).
        expect(w.renderer.getCellPhys(2, 2)).toBe(2);
        expect(w.renderer.getCellPhys(0, 0)).toBe(1);
        expect(w.renderer.getCellPhys(2, 6)).toBe(PHYS_NONE);

        w.render();
        const frame = grab(w);
        const colours = new Set<number>();
        for (let i = 0; i < frame.data.length; i += 4) {
            colours.add((frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2]);
        }
        expect(colours.size, 'rendered a flat fill').toBeGreaterThan(100);
    });

    it('walks forward and stops at a wall instead of leaving the map', () => {
        const w = world();
        const start = { ...w.player };
        const input = { ...emptyInput(), forward: 1 };
        for (let i = 0; i < 400; ++i) {
            w.update(input);
            w.render();
        }
        // It moved...
        expect(Math.hypot(w.player.x - start.x, w.player.y - start.y)).toBeGreaterThan(64);
        // ...and is still somewhere legal, not inside a wall or outside.
        const c = w.cell;
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(w.renderer.getCellPhys(c.x, c.y)).toBe(PHYS_NONE);
    });

    it('slides along a wall rather than sticking to it', () => {
        // Walking diagonally into a wall should keep the free component.
        const w = world();
        w.player.x = 1.5 * 64;
        w.player.y = 6.5 * 64;
        w.player.angle = Math.PI; // facing west, into the wall at x=0
        const before = w.player.y;
        const input = { ...emptyInput(), forward: 1, strafe: 1 };
        for (let i = 0; i < 30; ++i) {
            w.update(input);
        }
        expect(Math.abs(w.player.y - before)).toBeGreaterThan(8);
        expect(w.renderer.getCellPhys(w.cell.x, w.cell.y)).toBe(PHYS_NONE);
    });

    /** Puts the player in the corridor, one cell south of the door, facing it. */
    function atDoor(): World {
        const w = world();
        w.player.x = 2.5 * 64;
        w.player.y = 3.5 * 64;
        w.player.angle = -Math.PI / 2;
        w.render();
        return w;
    }

    it('sees the door from the start position after walking up the corridor', () => {
        const w = world();
        const forward = { ...emptyInput(), forward: 1 };
        let door = null;
        for (let i = 0; i < 200 && door === null; ++i) {
            w.update(forward);
            w.render();
            door = w.aimedDoor();
        }
        expect(door, 'never came within reach of the door').toEqual({ x: 2, y: 2 });
    });

    it('opens the aimed door, animates it, and lets the player through', () => {
        const w = atDoor();
        expect(w.aimedDoor()).toEqual({ x: 2, y: 2 });

        const shut = grab(w);
        expect(w.openAimedDoor()).toBe(true);
        expect(w.doors.contexts.length).toBe(1);

        // Let it slide, holding still. The first tick is spent leaving the
        // CLOSED phase, so the door is open one tick after the slide ends.
        const idle = emptyInput();
        let changed = 0;
        let previous = shut;
        const dc = w.doors.contexts[0];
        for (let i = 0; i < 60 && !dc.isOpen(); ++i) {
            w.update(idle);
            w.render();
            const frame = grab(w);
            if (!isClean(compareFrames(previous, frame))) ++changed;
            previous = frame;
        }
        expect(dc.isOpen(), 'the door never finished opening').toBe(true);
        expect(changed, 'the door never visibly moved').toBeGreaterThan(10);

        // Fully open: the cell is passable and the picture has changed.
        expect(w.renderer.getCellPhys(2, 2)).toBe(PHYS_NONE);
        expect(isClean(compareFrames(shut, grab(w)))).toBe(false);

        // And the player can now walk into the doorway.
        const forward = { ...emptyInput(), forward: 1 };
        for (let i = 0; i < 60; ++i) {
            w.update(forward);
            w.render();
        }
        expect(w.player.y, 'did not get through the open door').toBeLessThan(2.9 * 64);
    });

    it('refuses to open the same door twice', () => {
        const w = atDoor();
        expect(w.openAimedDoor()).toBe(true);
        expect(w.openAimedDoor()).toBe(false);
        expect(w.doors.contexts.length).toBe(1);
    });

    it('will not close a door on the player standing in it', () => {
        const w = atDoor();
        w.openAimedDoor();
        const idle = emptyInput();
        for (let i = 0; i < 40; ++i) w.update(idle);

        // Stand in the doorway and run well past the maintain duration.
        w.player.x = 2.5 * 64;
        w.player.y = 2.5 * 64;
        for (let i = 0; i < 400; ++i) w.update(idle);
        expect(w.doors.contexts.length, 'the door retired while occupied').toBe(1);
        expect(w.renderer.getCellPhys(2, 2)).toBe(PHYS_NONE);
    });
});
