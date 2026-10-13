import { describe, expect, it } from 'vitest';
import { PHYS_CURT_DOWN, PHYS_CURT_UP, PHYS_DOOR_DOWN, PHYS_DOOR_UP, PHYS_NONE } from '../../src/consts.js';
import { SCENES } from '../harness/scenes.js';
import type { CameraPose, SceneSpec } from '../harness/fixtures.js';
import type { Frame } from '../harness/compare.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';

/**
 * Flats seen through the gap of a door sliding up or down.
 *
 * The renderer skips floor and ceiling pixels a wall will cover, keeping one
 * covered band per screen column. A panel sliding vertically spans only part
 * of the opening, so letting it widen the band hid everything seen through the
 * gap: the ceiling of the room behind a rising door stayed black until the
 * door was fully open and the cell stopped being a door.
 *
 * The oracle is the same view with the door cell emptied. Nothing behind the
 * door moves, so wherever that frame shows something, the half-open frame may
 * show the panel instead, but never the black the canvas is cleared to.
 */
const base = SCENES.find(s => s.name === 'doors')!;

const DOOR = { x: 4, y: 3 };

function specWith(phys: number): SceneSpec {
    return {
        ...base,
        name: 'door-gap',
        legend: {
            '#': { material: 1, phys: 1 },
            '.': { material: 2, phys: 0 },
            D: { material: 3, phys, offset: 0 }
        },
        // A door in a wall, a room with floor and ceiling on either side.
        map: [
            '########',
            '#......#',
            '#......#',
            '####D###',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ],
        cameras: []
    };
}

// Two cells back from the door, looking through it.
const camera: CameraPose = { name: 'facing-door', x: 4.5 * 64, y: 5.5 * 64, angle: -Math.PI / 2, height: 1 };

function isBlack(f: Frame, i: number): boolean {
    return f.data[i] === 0 && f.data[i + 1] === 0 && f.data[i + 2] === 0;
}

/** Pixels black in `frame` but drawn in `open`: flats wrongly culled. */
function blackHoles(frame: Frame, open: Frame): number {
    let n = 0;
    for (let i = 0; i < frame.data.length; i += 4) {
        if (isBlack(frame, i) && !isBlack(open, i)) {
            ++n;
        }
    }
    return n;
}

describe('flats seen through a vertically sliding door', () => {
    const kinds: [string, number][] = [
        ['door up', PHYS_DOOR_UP],
        ['curtain up', PHYS_CURT_UP],
        ['door down', PHYS_DOOR_DOWN],
        ['curtain down', PHYS_CURT_DOWN]
    ];

    for (const [label, phys] of kinds) {
        it(`${label}: the gap shows what the open doorway shows`, () => {
            const rc = buildPortRenderer(specWith(phys));
            rc.setCellPhys(DOOR.x, DOOR.y, PHYS_NONE);
            const open = renderPortFrame(rc, camera);
            rc.setCellPhys(DOOR.x, DOOR.y, phys);

            for (const offset of [24, 48, 72, 95]) {
                rc.setCellOffset(DOOR.x, DOOR.y, offset);
                const frame = renderPortFrame(rc, camera);
                expect(blackHoles(frame, open), `offset ${offset}`).toBe(0);
            }
        }, 30_000);
    }
});
