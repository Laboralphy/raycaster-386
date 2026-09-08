import { describe, expect, it } from 'vitest';
import { DoorContext, DoorManager } from '../../src/engine/index.js';
import { PHYS_DOOR_UP, PHYS_NONE } from '../../src/consts.js';
import type { Renderer } from '../../src/Renderer.js';
import { SCENES } from '../harness/scenes.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';
import { compareFrames, isClean } from '../harness/compare.js';

/**
 * The whole interface between door simulation and rendering.
 *
 * This is what a game loop would call each tick, and it is deliberately the
 * caller's job rather than either layer's: the engine never imports the
 * renderer, and the renderer never advances time.
 */
function applyDoors(dm: DoorManager, rc: Renderer): void {
    for (const { x, y, offset, phys } of dm.process()) {
        rc.setCellOffset(x, y, offset | 0);
        rc.setCellPhys(x, y, phys);
    }
}

describe('doors driving the renderer', () => {
    const spec = SCENES.find(s => s.name === 'doors')!;
    // 'U' in the fixture: a PHYS_DOOR_UP at (1, 3), seen from down the corridor.
    const DOOR = { x: 1, y: 3 };
    const camera = { name: 'at-door', x: 3 * 64, y: 3.5 * 64, angle: Math.PI, height: 1 };

    function setup(): { rc: Renderer; dm: DoorManager; dc: DoorContext } {
        const rc = buildPortRenderer(spec);
        rc.setCellOffset(DOOR.x, DOOR.y, 0);
        const dm = new DoorManager();
        const dc = new DoorContext({
            slidingDuration: 12,
            maintainDuration: 10,
            offsetMax: 96,
            openFunction: 'smoothstep'
        });
        dc.data.x = DOOR.x;
        dc.data.y = DOOR.y;
        dc.data.phys = PHYS_DOOR_UP;
        dm.linkDoorContext(dc);
        return { rc, dm, dc };
    }

    it('animates a door through a full open-and-shut cycle on screen', () => {
        const { rc, dm, dc } = setup();
        const shut = renderPortFrame(rc, camera);

        const frames: { tick: number; offset: number; frame: ReturnType<typeof renderPortFrame> }[] = [];
        for (let tick = 0; tick < 40; ++tick) {
            applyDoors(dm, rc);
            frames.push({ tick, offset: dc.offset, frame: renderPortFrame(rc, camera) });
        }

        // It reached fully open, and the screen changed while it slid.
        const widest = frames.reduce((a, b) => (b.offset > a.offset ? b : a));
        expect(widest.offset).toBeCloseTo(96, 6);
        expect(isClean(compareFrames(shut, widest.frame)), 'open frame matches shut frame').toBe(false);

        // And it came back to exactly the shut frame it started from.
        expect(dc.isDone()).toBe(true);
        expect(rc.getCellOffset(DOOR.x, DOOR.y)).toBe(0);
        const shutAgain = renderPortFrame(rc, camera);
        expect(isClean(compareFrames(shut, shutAgain)), 'did not return to the shut frame').toBe(true);
    }, 60_000);

    it('changes the picture on most ticks while sliding', () => {
        // A door that renders the same for several ticks running would mean
        // the easing output is not reaching the renderer.
        const { rc, dm } = setup();
        let previous = renderPortFrame(rc, camera);
        let changed = 0;
        for (let tick = 0; tick < 12; ++tick) {
            applyDoors(dm, rc);
            const frame = renderPortFrame(rc, camera);
            if (!isClean(compareFrames(previous, frame))) ++changed;
            previous = frame;
        }
        expect(changed).toBeGreaterThanOrEqual(8);
    }, 60_000);

    it('frees the cell for movement only while the door is open', () => {
        const { rc, dm, dc } = setup();
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_DOOR_UP);

        while (!dc.isOpen()) {
            applyDoors(dm, rc);
        }
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_NONE);

        while (!dc.isDone()) {
            applyDoors(dm, rc);
        }
        // Retired doors are reported once more, restoring the solid cell.
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_DOOR_UP);
    }, 60_000);

    it('leaves the rest of the map untouched', () => {
        const { rc, dm } = setup();
        const before = {
            material: rc.getCellMaterial(DOOR.x, DOOR.y),
            neighbourPhys: rc.getCellPhys(DOOR.x + 1, DOOR.y),
            neighbourOffset: rc.getCellOffset(DOOR.x, DOOR.y + 1)
        };
        for (let tick = 0; tick < 40; ++tick) {
            applyDoors(dm, rc);
        }
        expect(rc.getCellMaterial(DOOR.x, DOOR.y)).toBe(before.material);
        expect(rc.getCellPhys(DOOR.x + 1, DOOR.y)).toBe(before.neighbourPhys);
        expect(rc.getCellOffset(DOOR.x, DOOR.y + 1)).toBe(before.neighbourOffset);
    }, 60_000);
});
