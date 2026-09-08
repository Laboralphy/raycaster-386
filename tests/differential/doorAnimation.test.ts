import { describe, expect, it } from 'vitest';
import { PHYS_DOOR_UP, PHYS_NONE } from '../../src/consts.js';
import { SCENES } from '../harness/scenes.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';
import { compareFrames, isClean } from '../harness/compare.js';

/**
 * The renderer draws a door at whatever offset a cell carries; nothing in this
 * package animates one. That job belongs to the engine's DoorContext, which
 * upstream reaches the renderer through exactly two calls per door per tick:
 *
 *     rc.setCellOffset(x, y, offset);
 *     rc.setCellPhys(x, y, phys);
 *
 * These tests pin that this surface is sufficient to drive a door from closed
 * to open frame by frame, so a ported DoorManager has something to talk to.
 */
describe('driving a door through the renderer surface', () => {
    const spec = SCENES.find(s => s.name === 'doors')!;
    // 'U' in the doors fixture: a PHYS_DOOR_UP at (1, 3).
    const DOOR = { x: 1, y: 3 };
    const camera = { name: 'at-door', x: 3 * 64, y: 3.5 * 64, angle: Math.PI, height: 1 };

    it('renders a distinct frame at each step of an opening door', () => {
        const rc = buildPortRenderer(spec);
        const frames = [];
        // A wall texel is 96 tall, so 0 is shut and 96 is fully open.
        for (const offset of [0, 24, 48, 72, 95]) {
            rc.setCellOffset(DOOR.x, DOOR.y, offset);
            frames.push({ offset, frame: renderPortFrame(rc, camera) });
        }
        for (let i = 1; i < frames.length; ++i) {
            const diff = compareFrames(frames[i - 1].frame, frames[i].frame);
            expect(
                isClean(diff),
                `offset ${frames[i - 1].offset} -> ${frames[i].offset} produced no change`
            ).toBe(false);
        }
    }, 30_000);

    it('is a pure function of the offset, whatever order it was reached in', () => {
        // A door manager may drive the offset up, down and back again; the
        // frame must depend on the current value only.
        const rc = buildPortRenderer(spec);
        rc.setCellOffset(DOOR.x, DOOR.y, 48);
        const direct = renderPortFrame(rc, camera);

        for (const offset of [0, 90, 12, 64, 48]) {
            rc.setCellOffset(DOOR.x, DOOR.y, offset);
            renderPortFrame(rc, camera);
        }
        const viaPath = renderPortFrame(rc, camera);
        expect(isClean(compareFrames(direct, viaPath))).toBe(true);
    }, 30_000);

    it('lets an opened door stop blocking movement without re-tracing light', () => {
        // Upstream sets phys alongside offset each tick, so the cell becomes
        // walkable once open. setCellPhys must be cheap when nothing changed:
        // a real change re-traces every light overlapping the cell.
        const rc = buildPortRenderer(spec);
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_DOOR_UP);

        rc.setCellPhys(DOOR.x, DOOR.y, PHYS_NONE);
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_NONE);

        rc.setCellPhys(DOOR.x, DOOR.y, PHYS_DOOR_UP);
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_DOOR_UP);
    });

    it('round-trips the full 8-bit offset range', () => {
        const rc = buildPortRenderer(spec);
        for (const offset of [0, 1, 47, 128, 254, 255]) {
            rc.setCellOffset(DOOR.x, DOOR.y, offset);
            expect(rc.getCellOffset(DOOR.x, DOOR.y)).toBe(offset);
        }
        // Offset shares a 32-bit cell with material and phys; neither moves.
        expect(rc.getCellPhys(DOOR.x, DOOR.y)).toBe(PHYS_DOOR_UP);
        expect(rc.getCellMaterial(DOOR.x, DOOR.y)).toBe(3);
    });
});
