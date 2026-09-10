import { describe, expect, it } from 'vitest';
import { CellMap } from '../../src/core/CellMap.js';
import { alterBlock, cellCenter, worldToCell } from '../../src/core/cells.js';
import {
    CELL_NEIGHBOR_CORNER, CELL_NEIGHBOR_SELF, CELL_NEIGHBOR_SIDE,
    DoorPolicy, forEachNeighbor
} from '../../src/simulation/index.js';
import {
    PHYS_DOOR_DOUBLE, PHYS_DOOR_UP, PHYS_NONE, PHYS_SECRET_BLOCK, PHYS_WALL
} from '../../src/consts.js';

const METRICS = { spacing: 64, height: 96 };

/** A map of `size` cells with the given phys codes placed on it. */
function mapWith(size: number, cells: [number, number, number][]): CellMap {
    const map = new CellMap();
    map.setSize(size);
    for (const [x, y, phys] of cells) {
        map.setPhys(x, y, phys);
    }
    return map;
}

function policy(map: CellMap, occupied?: (x: number, y: number) => boolean): DoorPolicy {
    return new DoorPolicy({ map, metrics: METRICS, isCellOccupied: occupied });
}

describe('cell arithmetic', () => {
    it('converts a world position to the cell holding it', () => {
        expect(worldToCell(0, 0, 64)).toEqual({ x: 0, y: 0 });
        expect(worldToCell(63, 64, 64)).toEqual({ x: 0, y: 1 });
        expect(worldToCell(130, 5, 64)).toEqual({ x: 2, y: 0 });
    });

    it('puts a cell centre half a cell in from its corner', () => {
        expect(cellCenter(0, 0, 64)).toEqual({ x: 32, y: 32 });
        expect(cellCenter(2, 3, 64)).toEqual({ x: 160, y: 224 });
    });

    it('reports a block swap as the three writes it implies', () => {
        expect(alterBlock(4, 5, 7, { phys: PHYS_WALL, offset: 12 }))
            .toEqual({ x: 4, y: 5, material: 7, phys: PHYS_WALL, offset: 12 });
        expect(alterBlock(1, 1, 0, {})).toEqual({ x: 1, y: 1, material: 0, phys: 0, offset: 0 });
    });
});

describe('forEachNeighbor', () => {
    const map = mapWith(4, []);
    const visited = (types: number, x = 1, y = 1) => {
        const seen: string[] = [];
        forEachNeighbor(map, x, y, (cx, cy) => seen.push(`${cx},${cy}`), types);
        return seen.sort();
    };

    it('selects sides, corners and self independently', () => {
        expect(visited(CELL_NEIGHBOR_SIDE)).toEqual(['0,1', '1,0', '1,2', '2,1']);
        expect(visited(CELL_NEIGHBOR_CORNER)).toEqual(['0,0', '0,2', '2,0', '2,2']);
        expect(visited(CELL_NEIGHBOR_SELF)).toEqual(['1,1']);
        expect(visited(CELL_NEIGHBOR_SIDE | CELL_NEIGHBOR_CORNER | CELL_NEIGHBOR_SELF).length).toBe(9);
    });

    it('skips cells outside the map instead of wrapping into another row', () => {
        // (-1, 1) indexes the flat array at row 0's last cell, which upstream
        // reported as a neighbour of (0, 1).
        expect(visited(CELL_NEIGHBOR_SIDE, 0, 1)).toEqual(['0,0', '0,2', '1,1']);
        expect(visited(CELL_NEIGHBOR_SIDE, 3, 3)).toEqual(['2,3', '3,2']);
    });
});

describe('DoorPolicy', () => {
    it('opens a door and gives it the travel its phys code implies', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        const dc = dp.openDoor(2, 2, false);
        expect(dc, 'door did not open').not.toBeNull();

        // A sliding door travels a wall height; a double door, half a cell.
        for (let i = 0; i < 200; ++i) {
            dp.process();
        }
        expect(dc!.offset).toBe(METRICS.height);

        const dp2 = policy(mapWith(8, [[2, 2, PHYS_DOOR_DOUBLE]]));
        const dc2 = dp2.openDoor(2, 2, false)!;
        for (let i = 0; i < 200; ++i) {
            dp2.process();
        }
        expect(dc2.offset).toBe(METRICS.spacing >> 1);
    });

    it('refuses cells that are not doors', () => {
        const dp = policy(mapWith(8, [[1, 1, PHYS_WALL]]));
        expect(dp.openDoor(1, 1)).toBeNull();
        expect(dp.openDoor(5, 5)).toBeNull();
        expect(dp.isDoor(1, 1)).toBe(false);
    });

    it('reports a door open only once it is fully open', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        expect(dp.isDoorClosed(2, 2)).toBe(true);
        expect(dp.isDoorOpen(2, 2)).toBe(false);

        dp.openDoor(2, 2, false);
        dp.process();
        // Sliding: neither shut nor open.
        expect(dp.isDoorOpen(2, 2)).toBe(false);
        expect(dp.isDoorClosed(2, 2)).toBe(false);

        for (let i = 0; i < 200; ++i) {
            dp.process();
        }
        // Upstream this threw: Engine.isDoorOpen called a method DoorContext
        // does not define, for every cell that had a context.
        expect(dp.isDoorOpen(2, 2)).toBe(true);
    });

    it('reports the shut phys code while the door stands open', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        dp.openDoor(2, 2, false);
        let last = dp.process();
        for (let i = 0; i < 200; ++i) {
            last = dp.process();
        }
        // The cell stops blocking movement...
        expect(last[0].phys).toBe(PHYS_NONE);
        // ...but the policy still knows it is a door.
        expect(dp.isDoor(2, 2)).toBe(true);
    });

    it('will not open a locked door, and says so', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        const locked: unknown[] = [];
        dp.events.on('locked', e => locked.push(e));

        dp.lockDoor(2, 2, true);
        expect(dp.isDoorLocked(2, 2)).toBe(true);
        expect(dp.openDoor(2, 2)).toBeNull();
        expect(locked).toEqual([{ x: 2, y: 2 }]);

        dp.lockDoor(2, 2, false);
        expect(dp.openDoor(2, 2)).not.toBeNull();
    });

    it('ignores a lock aimed at something that is not a door', () => {
        const dp = policy(mapWith(8, [[1, 1, PHYS_WALL]]));
        dp.lockDoor(1, 1, true);
        expect(dp.isDoorLocked(1, 1)).toBe(false);
    });

    it('autocloses, and reports opened then closing then closed', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        const seen: string[] = [];
        dp.events.on('opened', () => seen.push('opened'));
        dp.events.on('closing', () => seen.push('closing'));
        dp.events.on('closed', () => seen.push('closed'));

        dp.openDoor(2, 2, true);
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(seen).toEqual(['opened', 'closing', 'closed']);
        // A retired door is dropped once shut.
        expect(dp.doors.doors.length).toBe(0);
    });

    it('holds a non-autoclosing door open until told to close', () => {
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]));
        dp.openDoor(2, 2, false);
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(dp.isDoorOpen(2, 2)).toBe(true);

        dp.closeDoor(2, 2);
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(dp.doors.doors.length).toBe(0);
    });

    it('keeps a door open while something stands in the doorway', () => {
        let blocked = true;
        const dp = policy(mapWith(8, [[2, 2, PHYS_DOOR_UP]]), () => blocked);
        dp.openDoor(2, 2, true);
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(dp.isDoorOpen(2, 2), 'closed on top of an occupant').toBe(true);

        blocked = false;
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(dp.doors.doors.length).toBe(0);
    });
});

describe('DoorPolicy secret passages', () => {
    /** Two adjacent secret blocks at (2,2) and (3,2). */
    const secretMap = () => mapWith(8, [[2, 2, PHYS_SECRET_BLOCK], [3, 2, PHYS_SECRET_BLOCK]]);

    it('builds both halves, the second trailing the first', () => {
        const dp = policy(secretMap());
        const dc1 = dp.openDoor(2, 2)!;
        expect(dc1).not.toBeNull();
        expect(dp.doors.doors.length, 'both halves should be live').toBe(2);

        const dc2 = dc1.data.child;
        expect(dc2, 'no second half linked').toBeDefined();
        expect(dc1.data.secret).toBe(true);
        expect(dc2!.data.secret).toBe(true);
        expect([dc2!.data.x, dc2!.data.y]).toEqual([3, 2]);

        // The pushed block waits a full slide before it starts moving.
        for (let i = 0; i < 10; ++i) {
            dp.process();
        }
        expect(dc1.offset).toBeGreaterThan(0);
        expect(dc2!.offset).toBe(0);

        for (let i = 0; i < 400; ++i) {
            dp.process();
        }
        expect(dc1.offset).toBe(METRICS.spacing);
        expect(dc2!.offset).toBe(METRICS.spacing);
    });

    it('never autocloses, whatever the caller asks for', () => {
        const dp = policy(secretMap());
        dp.openDoor(2, 2, true);
        for (let i = 0; i < 2000; ++i) {
            dp.process();
        }
        expect(dp.doors.doors.length).toBe(2);
    });

    it('is not treated as a door', () => {
        const dp = policy(secretMap());
        expect(dp.isSecretBlock(2, 2)).toBe(true);
        expect(dp.isDoor(2, 2)).toBe(false);
        // ...but it is still something a closed-cell check must see.
        expect(dp.isDoorClosed(2, 2)).toBe(true);
    });

    it('rejects a block with more than one secret neighbour', () => {
        const dp = policy(mapWith(8, [
            [2, 2, PHYS_SECRET_BLOCK], [3, 2, PHYS_SECRET_BLOCK], [2, 3, PHYS_SECRET_BLOCK]
        ]));
        expect(() => dp.openDoor(2, 2)).toThrow(/more than one secret neighbour/);
    });

    it('does not pair with a block that only wraps around a map edge', () => {
        // (0,1) and (7,0) are adjacent in the flat array, not on the map.
        const dp = policy(mapWith(8, [[0, 1, PHYS_SECRET_BLOCK], [7, 0, PHYS_SECRET_BLOCK]]));
        const dc = dp.openDoor(0, 1)!;
        expect(dc.data.child, 'paired across the map edge').toBeUndefined();
        expect(dp.doors.doors.length).toBe(1);
    });
});

describe('DoorPolicy with a door next to a secret passage', () => {
    /** A normal door at (2,2), and a secret passage at (2,3)-(2,4) beside it. */
    const adjacent = () => mapWith(8, [
        [2, 2, PHYS_DOOR_UP],
        [2, 3, PHYS_SECRET_BLOCK],
        [2, 4, PHYS_SECRET_BLOCK]
    ]);

    it('reports the door closing, not its secret neighbour', () => {
        const dp = policy(adjacent());
        dp.openDoor(2, 3);              // the passage, which never autocloses
        const seen: string[] = [];
        dp.events.on('closing', e => seen.push(`closing ${e.x},${e.y}`));
        dp.events.on('closed', e => seen.push(`closed ${e.x},${e.y}`));

        dp.openDoor(2, 2, true);
        for (let i = 0; i < 1000; ++i) {
            dp.process();
        }
        expect(seen).toEqual(['closing 2,2', 'closed 2,2']);
    });

    it('closes the door itself rather than the passage beside it', () => {
        const dp = policy(adjacent());
        dp.openDoor(2, 3);
        dp.openDoor(2, 2, false);
        for (let i = 0; i < 200; ++i) {
            dp.process();
        }
        expect(dp.isDoorOpen(2, 2)).toBe(true);

        dp.closeDoor(2, 2);
        for (let i = 0; i < 200; ++i) {
            dp.process();
        }
        expect(dp.doors.getDoorContext(2, 2), 'the door did not close').toBeUndefined();
        // The passage is untouched: it was never asked to close.
        expect(dp.doors.getDoorContext(2, 3), 'the passage was closed instead').toBeDefined();
    });
});

describe('DoorPolicy save and restore', () => {
    it('round-trips a door mid-slide', () => {
        const map = mapWith(8, [[2, 2, PHYS_DOOR_UP]]);
        const dp = policy(map);
        dp.openDoor(2, 2, false);
        for (let i = 0; i < 6; ++i) {
            dp.process();
        }
        const live = dp.doors.doors[0];
        expect(live.offset).toBeGreaterThan(0);

        const restored = policy(map);
        restored.setState(JSON.parse(JSON.stringify(dp.state)) as ReturnType<() => typeof dp.state>);
        expect(restored.doors.doors.length).toBe(1);
        expect(restored.doors.doors[0].offset).toBe(live.offset);

        for (let i = 0; i < 50; ++i) {
            expect(restored.process()).toEqual(dp.process());
        }
    });

    it('round-trips a secret passage without rebuilding it twice', () => {
        const map = mapWith(8, [[2, 2, PHYS_SECRET_BLOCK], [3, 2, PHYS_SECRET_BLOCK]]);
        const dp = policy(map);
        dp.openDoor(2, 2);
        for (let i = 0; i < 40; ++i) {
            dp.process();
        }

        const leader = dp.doors.getDoorContext(2, 2)!;
        const trailer = dp.doors.getDoorContext(3, 2)!;
        expect(leader.data.child).toBe(trailer);

        // Restore from a state whose trailing half comes first, which is the
        // order DoorManager records it in.
        const saved = JSON.parse(JSON.stringify(dp.state)) as typeof dp.state;
        expect(saved.doors[0], 'expected the trailing half first').toMatchObject({ x: 3, y: 2 });

        const restored = policy(map);
        restored.setState(saved);
        // Two entries, two contexts — not four.
        expect(restored.doors.doors.length).toBe(2);

        // And the same block still leads: rebuilding from the trailing entry
        // would have made (3,2) the pusher and run the passage backwards.
        const back = restored.doors.getDoorContext(2, 2)!;
        expect(back.data.child, 'the passage was rebuilt backwards')
            .toBe(restored.doors.getDoorContext(3, 2));
        expect(back.offset).toBe(leader.offset);
        expect(restored.doors.getDoorContext(3, 2)!.offset).toBe(trailer.offset);

        // Both then advance in step with the originals.
        for (let i = 0; i < 60; ++i) {
            expect(restored.process()).toEqual(dp.process());
        }
    });
});
