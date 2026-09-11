import { describe, expect, it } from 'vitest';
import { CellMap } from '../../src/core/CellMap.js';
import { DoorPolicy } from '../../src/simulation/index.js';
import type { DoorPolicyOptions, DoorShapeOverride } from '../../src/simulation/index.js';
import {
    PHYS_CURT_DOWN, PHYS_CURT_UP, PHYS_DOOR_DOUBLE, PHYS_DOOR_DOWN, PHYS_DOOR_LEFT,
    PHYS_DOOR_RIGHT, PHYS_DOOR_UP, PHYS_SECRET_BLOCK
} from '../../src/consts.js';

const METRICS = { spacing: 64, height: 96 };

function mapWith(cells: [number, number, number][]): CellMap {
    const map = new CellMap();
    map.setSize(8);
    for (const [x, y, phys] of cells) {
        map.setPhys(x, y, phys);
    }
    return map;
}

/**
 * Opens a door and counts the ticks until it is fully open.
 *
 * Counting to `isOpen()` rather than watching the offset settle: the first
 * tick is spent leaving the CLOSED phase and moves nothing, so a door that has
 * not started looks identical to one that has finished.
 */
function slide(phys: number, autoclose = false): { ticks: number; offset: number } {
    const dp = new DoorPolicy({ map: mapWith([[2, 2, phys]]), metrics: METRICS });
    const dc = dp.openDoor(2, 2, autoclose);
    if (dc === null) {
        throw new Error(`phys ${phys} did not open`);
    }
    let ticks = 0;
    while (ticks < 500 && !dc.isOpen()) {
        dp.process();
        ++ticks;
    }
    return { ticks, offset: dc.offset };
}

/** The slide takes its duration plus the tick spent leaving CLOSED. */
const LEAVING_CLOSED = 1;

/**
 * The numbers a door's phys code implies, pinned.
 *
 * Every one of these comes from the original engine, which computed them in
 * `Engine._buildDoorContext` — `libs/engine/Engine.js:337-370` — as
 * `DOOR_SLIDING_DURATION * fSlidingDuration | 0` over a per-phys factor, with
 * `DOOR_SLIDING_DURATION = 24` and `DOOR_MAINTAIN_DURATION = 300`
 * (`libs/engine/consts/index.js:14`). Secret passages came from
 * `_buildSecretDoorContext` at line 252.
 *
 * This is a characterization test, not a differential one. A differential test
 * was considered and rejected on 2026-09-11: `_buildDoorContext` needs
 * `initializeRenderer()`, which stands up Renderer, DoorManager, TagManager,
 * Scheduler, Horde and a camera, and bundling `Engine.js` fails on five
 * unresolved imports including an npm package the legacy tree has no
 * `node_modules` for. Standing all that up to check a decision table was not
 * worth reinstating the retired harness for — so the table is pinned here
 * instead, with the provenance written down.
 *
 * What it guards: the rest of the suite pins `offsetMax` for two of the seven
 * door phys codes and no sliding duration at all, so the 1.5 and 1.8 factors
 * could be swapped and every other test would still pass.
 */
describe('door travel and speed, per phys code', () => {
    const BASE = 24;

    it.each([
        { door: 'double', phys: PHYS_DOOR_DOUBLE, travel: METRICS.spacing >> 1, factor: 0.5 },
        { door: 'left', phys: PHYS_DOOR_LEFT, travel: METRICS.height, factor: 1 },
        { door: 'right', phys: PHYS_DOOR_RIGHT, travel: METRICS.height, factor: 1 },
        { door: 'up', phys: PHYS_DOOR_UP, travel: METRICS.height, factor: 1.5 },
        { door: 'down', phys: PHYS_DOOR_DOWN, travel: METRICS.height, factor: 1.5 },
        { door: 'curtain up', phys: PHYS_CURT_UP, travel: METRICS.height, factor: 1.8 },
        { door: 'curtain down', phys: PHYS_CURT_DOWN, travel: METRICS.height, factor: 1.8 }
    ])('a $door door travels $travel at factor $factor', ({ phys, travel, factor }) => {
        const r = slide(phys);
        expect(r.offset, 'travel').toBe(travel);
        expect(r.ticks, 'ticks to fully open').toBe(((BASE * factor) | 0) + LEAVING_CLOSED);
    });

    it('pins the factors as distinct, so two cannot be swapped unnoticed', () => {
        // The guard the rest of the suite lacks: up/down and the curtains both
        // travel a wall height, and are told apart only by their speed.
        const up = slide(PHYS_DOOR_UP);
        const curtain = slide(PHYS_CURT_UP);
        const side = slide(PHYS_DOOR_LEFT);
        expect(up.offset).toBe(curtain.offset);
        expect(up.offset).toBe(side.offset);
        expect(new Set([side.ticks, up.ticks, curtain.ticks]).size, 'three speeds').toBe(3);
        expect(side.ticks).toBeLessThan(up.ticks);
        expect(up.ticks).toBeLessThan(curtain.ticks);
    });

    it('gives a secret passage a full cell of travel at a third of the speed', () => {
        // `_buildSecretDoorContext`: ofsmax is the cell size, not the wall
        // height, and sdur is DOOR_SLIDING_DURATION * 3 with no truncation.
        const map = mapWith([[2, 2, PHYS_SECRET_BLOCK], [3, 2, PHYS_SECRET_BLOCK]]);
        const dp = new DoorPolicy({ map, metrics: METRICS });
        const dc = dp.openDoor(2, 2, false);
        expect(dc, 'the secret passage did not open').not.toBeNull();

        let ticks = 0;
        while (ticks < 1000 && !dc!.isOpen()) {
            dp.process();
            ++ticks;
        }
        expect(dc!.offset, 'travel is a whole cell').toBe(METRICS.spacing);
        expect(ticks, 'three times the base duration').toBe(BASE * 3 + LEAVING_CLOSED);
    });
});

/**
 * How long an opened door waits before closing itself.
 *
 * `mdur: bAutoclose ? CONSTS.DOOR_MAINTAIN_DURATION : Infinity`
 * (`Engine.js:370`). The distinction matters more than the number: a door
 * opened without autoclose must never shut on its own, and a test that only
 * ticks a few hundred times would not tell the two apart.
 */
describe('how long a door stays open', () => {
    it('closes an autoclosing door and leaves a held one open', () => {
        const held = new DoorPolicy({ map: mapWith([[2, 2, PHYS_DOOR_UP]]), metrics: METRICS });
        held.openDoor(2, 2, false);
        for (let i = 0; i < 2000; ++i) {
            held.process();
        }
        expect(held.contexts.length, 'a held door retired on its own').toBe(1);

        const auto = new DoorPolicy({ map: mapWith([[2, 2, PHYS_DOOR_UP]]), metrics: METRICS });
        auto.openDoor(2, 2, true);
        for (let i = 0; i < 2000; ++i) {
            auto.process();
        }
        expect(auto.contexts.length, 'an autoclosing door never retired').toBe(0);
    });

    it('honours a maintain duration the caller sets', () => {
        const dp = new DoorPolicy({
            map: mapWith([[2, 2, PHYS_DOOR_UP]]),
            metrics: METRICS,
            maintainDuration: 10
        });
        dp.openDoor(2, 2, true);
        // 36 sliding + 10 held + 36 closing, comfortably inside 200.
        for (let i = 0; i < 200; ++i) {
            dp.process();
        }
        expect(dp.contexts.length).toBe(0);
    });
});

/**
 * The easing a door slides with.
 *
 * `smoothstep` is what the original gave every door (`Engine.js:372`,
 * `sfunc: Easing.SMOOTHSTEP`) and remains the default. It is ease-in-out, so
 * the door is slowest at both ends of its travel and fastest in the middle —
 * which is the observable property worth pinning, rather than the name.
 */
describe('door easing', () => {
    /** Offset after each tick of one door's slide. */
    function trace(options: Partial<ConstructorParameters<typeof DoorPolicy>[0]> = {}): number[] {
        const dp = new DoorPolicy({
            map: mapWith([[2, 2, PHYS_DOOR_UP]]),
            metrics: METRICS,
            ...options
        });
        const dc = dp.openDoor(2, 2, false)!;
        const offsets: number[] = [];
        for (let i = 0; i < 40; ++i) {
            dp.process();
            offsets.push(dc.offset);
        }
        return offsets;
    }

    it('eases in and out by default, rather than moving at a constant rate', () => {
        const steps = trace();
        const moving = steps.slice(1).map((v, i) => v - steps[i]).filter(d => d > 0);
        expect(moving.length, 'the door never moved').toBeGreaterThan(4);
        const first = moving[0];
        const middle = moving[moving.length >> 1];
        const last = moving[moving.length - 1];
        expect(middle, 'not faster in the middle than at the start').toBeGreaterThan(first);
        expect(middle, 'not faster in the middle than at the end').toBeGreaterThan(last);
    });

    it('takes the easing the caller asks for', () => {
        const eased = trace();
        const linear = trace({ openFunction: 'linear' });
        expect(linear, 'linear slid identically to smoothstep').not.toEqual(eased);

        const steps = linear.slice(1).map((v, i) => v - linear[i]).filter(d => d > 0);
        // A constant rate: every step the same, give or take integer rounding.
        expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(1);
    });

    it('accepts a function as readily as a name', () => {
        const custom = trace({ openFunction: (v: number) => v * v });
        expect(custom.some(v => v > 0), 'a custom curve did not move the door').toBe(true);
        expect(custom).not.toEqual(trace({ openFunction: 'linear' }));
    });

    it('leaves a secret passage on its paired curves', () => {
        // The option covers ordinary doors only: a secret passage's two halves
        // accelerate and decelerate against each other, and one shared easing
        // would flatten that into two walls moving alike.
        const map = mapWith([[2, 2, PHYS_SECRET_BLOCK], [3, 2, PHYS_SECRET_BLOCK]]);
        const dp = new DoorPolicy({ map, metrics: METRICS, openFunction: 'linear' });
        const dc = dp.openDoor(2, 2, false)!;
        const offsets: number[] = [];
        for (let i = 0; i < 80; ++i) {
            dp.process();
            offsets.push(dc.offset);
        }
        const steps = offsets.slice(1).map((v, i) => v - offsets[i]).filter(d => d > 0);
        // squareAccel, so it starts slow and speeds up — not a constant rate.
        expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(1);
    });
});

/**
 * Per-block overrides.
 *
 * A phys code says a cell is a door and how it opens. It does not say whether
 * this one is a light wooden door or a heavy stone slab — and a level already
 * draws that distinction, because they are different blocks. The callback is
 * handed the block code so a game can act on it, the same way
 * `isCellOccupied` is handed a cell so a game can answer from its own actors.
 */
describe('doorShape overrides', () => {
    /** A map whose door cell carries a chosen block code. */
    function mapWithBlock(code: number, phys: number): CellMap {
        const map = new CellMap();
        map.setSize(8);
        map.setPhys(2, 2, phys);
        map.setMaterial(2, 2, code);
        return map;
    }

    function openWith(
        code: number,
        doorShape: DoorPolicyOptions['doorShape']
    ): { ticks: number; offset: number } {
        const dp = new DoorPolicy({
            map: mapWithBlock(code, PHYS_DOOR_UP),
            metrics: METRICS,
            doorShape
        });
        const dc = dp.openDoor(2, 2, false)!;
        let ticks = 0;
        while (ticks < 500 && !dc.isOpen()) {
            dp.process();
            ++ticks;
        }
        return { ticks, offset: dc.offset };
    }

    it('is handed the cell block code and its phys code', () => {
        const seen: [number, number][] = [];
        openWith(37, (code, phys) => {
            seen.push([code, phys]);
            return null;
        });
        expect(seen).toEqual([[37, PHYS_DOOR_UP]]);
    });

    it('falls back to the phys defaults when it declines', () => {
        const plain = slide(PHYS_DOOR_UP);
        const declined = openWith(37, () => null);
        expect(declined).toEqual(plain);
    });

    it('overrides only the fields it names', () => {
        // Half speed, same travel: a heavy door on the same phys code.
        const heavy = openWith(37, () => ({ slideFactor: 3 }));
        expect(heavy.offset, 'travel should be untouched').toBe(METRICS.height);
        expect(heavy.ticks).toBe(((24 * 3) | 0) + LEAVING_CLOSED);

        // And travel alone, leaving the speed where the phys code put it.
        const shallow = openWith(37, () => ({ offsetMax: 32 }));
        expect(shallow.offset).toBe(32);
        expect(shallow.ticks).toBe(((24 * 1.5) | 0) + LEAVING_CLOSED);
    });

    it('gives two blocks on one phys code different character', () => {
        // The whole point: same @PHYS_DOOR_UP, different doors.
        const byCode = (code: number): DoorShapeOverride | null =>
            code === 7 ? { slideFactor: 0.5, openFunction: 'linear' } : null;
        const light = openWith(7, byCode);
        const ordinary = openWith(8, byCode);
        expect(light.ticks).toBeLessThan(ordinary.ticks);
        expect(light.offset).toBe(ordinary.offset);
    });

    it('is asked once per opening, not once per tick', () => {
        let calls = 0;
        const dp = new DoorPolicy({
            map: mapWithBlock(7, PHYS_DOOR_UP),
            metrics: METRICS,
            doorShape: () => {
                ++calls;
                return null;
            }
        });
        dp.openDoor(2, 2, false);
        for (let i = 0; i < 50; ++i) {
            dp.process();
        }
        expect(calls, 'travel and speed are fixed for the life of a door').toBe(1);
    });

    it('cannot turn a cell that is not a door into one', () => {
        // The phys code stays the single source of truth for `isDoor`, which
        // the lock registry and the renderer both rely on.
        const map = new CellMap();
        map.setSize(8);
        map.setMaterial(3, 3, 7);
        const dp = new DoorPolicy({
            map,
            metrics: METRICS,
            doorShape: () => ({ offsetMax: 64, slideFactor: 1 })
        });
        expect(dp.openDoor(3, 3, false)).toBeNull();
        expect(dp.isDoor(3, 3)).toBe(false);
    });

    it('leaves a secret passage alone', () => {
        const map = new CellMap();
        map.setSize(8);
        for (const x of [2, 3]) {
            map.setPhys(x, 2, PHYS_SECRET_BLOCK);
            map.setMaterial(x, 2, 9);
        }
        let asked = 0;
        const dp = new DoorPolicy({
            map,
            metrics: METRICS,
            doorShape: () => {
                ++asked;
                return { offsetMax: 8, slideFactor: 0.1 };
            }
        });
        const dc = dp.openDoor(2, 2, false)!;
        let ticks = 0;
        while (ticks < 1000 && !dc.isOpen()) {
            dp.process();
            ++ticks;
        }
        expect(asked, 'a secret passage consulted the override').toBe(0);
        expect(dc.offset, 'still a whole cell of travel').toBe(METRICS.spacing);
        expect(ticks).toBe(24 * 3 + LEAVING_CLOSED);
    });
});
