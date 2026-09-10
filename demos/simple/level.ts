import { PHYS_DOOR_UP, PHYS_NONE, PHYS_WALL } from '../../src';
import type { LevelMap } from '../../src';

/** Map character for open floor. */
const VOID = ' ';
/** Map character for a solid wall. */
const WALL = '#';
/** Map character for the sliding door. */
const DOOR = '+';

/**
 * The map and textures from the original engine's `tagged-level` demo,
 * expressed in this port's level format.
 *
 * The upstream file writes phys codes as `"@PHYS_WALL"` strings, which the old
 * Engine resolved through a translator at load time. Nothing in this package
 * does that resolution, so the constants are referenced directly.
 */
export const LEVEL: LevelMap = {
    legend: [
        // Index 0 doubles as the void: MapHelper takes phys and offset from an
        // empty material there rather than from this entry. Harmless for open
        // floor, whose phys and offset are 0 anyway, which is why these faces
        // still render.
        { code: VOID, phys: PHYS_NONE, faces: { f: 0, c: 1 } },
        { code: WALL, phys: PHYS_WALL, faces: { n: 0, e: 0, w: 0, s: 0 } },
        { code: DOOR, phys: PHYS_DOOR_UP, faces: { n: 1, e: 1, w: 1, s: 1, f: 0, c: 1 } }
    ],
    map: [
        '##########',
        '#        #',
        '##+##    #',
        '#   #    #',
        '#   #    #',
        '#   #    #',
        '#   #    #',
        '#   #    #',
        '#   #    #',
        '##########'
    ]
};

export const METRICS = { spacing: 64, height: 96 };

export const SHADING = {
    shades: 16,
    color: '#000000',
    filter: null,
    brightness: 0.1
};

/**
 * Where the player starts, in cell coordinates.
 *
 * The upstream demo starts at the same spot but angled 0.4 rad off north,
 * which walks you into the corridor wall. Facing straight up it puts the door
 * in view from the start.
 */
export const START = { x: 2.5, y: 6.5, angle: -Math.PI / 2 };

export const TEXTURES = {
    walls: 'assets/walls.png',
    flats: 'assets/flats.png'
};
