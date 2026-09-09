import { describe, expect, it } from 'vitest';
import {
    DOOR_PHASE_CLOSED, DOOR_PHASE_CLOSING, DOOR_PHASE_OPEN, DOOR_PHASE_OPENING,
    DoorContext, DoorManager, Easing, EASING_FUNCTIONS,
    type DoorContextOptions
} from '../../src/simulation/index.js';
import { PHYS_DOOR_UP, PHYS_NONE } from '../../src/consts.js';

function door(over: DoorContextOptions = {}): DoorContext {
    const dc = new DoorContext({
        slidingDuration: 10,
        maintainDuration: 20,
        offsetMax: 96,
        openFunction: 'linear',
        ...over
    });
    dc.data.x = 3;
    dc.data.y = 4;
    dc.data.phys = PHYS_DOOR_UP;
    return dc;
}

/** Ticks a door, recording its offset and phase each tick. */
function run(dc: DoorContext, ticks: number): { offset: number; phase: number }[] {
    const out = [];
    for (let i = 0; i < ticks; ++i) {
        dc.process();
        out.push({ offset: dc.offset, phase: dc.getPhase() });
    }
    return out;
}

describe('Easing', () => {
    it('interpolates between the output bounds over the step count', () => {
        const e = new Easing({ from: 0, to: 100, steps: 10, use: 'linear' });
        expect(e.compute(0).y).toBe(0);
        expect(e.compute(5).y).toBe(50);
        expect(e.compute(10).y).toBe(100);
    });

    it('clamps an explicit step to the range', () => {
        const e = new Easing({ from: 0, to: 100, steps: 10, use: 'linear' });
        expect(e.compute(-5).y).toBe(0);
        expect(e.compute(999).y).toBe(100);
        expect(e.x).toBe(10);
    });

    it('reports when it is over', () => {
        const e = new Easing({ steps: 3, use: 'linear' });
        expect(e.compute(2).over()).toBe(false);
        expect(e.compute(3).over()).toBe(true);
    });

    it('works without an explicit function', () => {
        // The original defaulted to the *name* '_linear' rather than a
        // function, so this threw "easing function is not defined".
        expect(() => new Easing().compute(1)).not.toThrow();
    });

    it('every named curve starts at 0 and stays within range', () => {
        for (const [name, f] of Object.entries(EASING_FUNCTIONS)) {
            expect(f(0), `${name}(0)`).toBeCloseTo(0, 10);
            for (let t = 0; t <= 1; t += 0.05) {
                const v = f(t);
                expect(Number.isFinite(v), `${name}(${t})`).toBe(true);
                expect(v, `${name}(${t})`).toBeGreaterThanOrEqual(-0.001);
                expect(v, `${name}(${t})`).toBeLessThanOrEqual(1.001);
            }
        }
    });

    it('every curve but cubeInOut ends at 1', () => {
        for (const [name, f] of Object.entries(EASING_FUNCTIONS)) {
            if (name === 'cubeInOut') continue;
            expect(f(1), `${name}(1)`).toBeCloseTo(1, 10);
        }
    });

    it('cubeInOut is a pulse, not an ease-in-out', () => {
        // Ported faithfully from the original, where despite its name it
        // rises to 1 at the midpoint and returns to 0 — so it interpolates
        // *there and back*, never landing on the target value. No file
        // references it statically, but thinkers pick curves by name from
        // their data, so absence of a static reference is not proof it is
        // unused. Preserved rather than silently corrected.
        const f = EASING_FUNCTIONS.cubeInOut;
        expect(f(0)).toBeCloseTo(0, 10);
        expect(f(0.5)).toBeCloseTo(1, 10);
        expect(f(1)).toBeCloseTo(0, 10);
    });

    it('rejects an unknown curve by name', () => {
        expect(() => new Easing({ use: 'nope' as never })).toThrow(/unknown easing function/);
    });
});

describe('DoorContext', () => {
    it('runs closed to done, sliding monotonically each way', () => {
        const dc = door();
        expect(dc.getPhase()).toBe(DOOR_PHASE_CLOSED);
        const log = run(dc, 60);

        const opening = log.filter(s => s.phase === DOOR_PHASE_OPENING).map(s => s.offset);
        const closing = log.filter(s => s.phase === DOOR_PHASE_CLOSING).map(s => s.offset);
        expect(opening.length).toBeGreaterThan(3);
        expect(closing.length).toBeGreaterThan(3);
        for (let i = 1; i < opening.length; ++i) {
            expect(opening[i]).toBeGreaterThanOrEqual(opening[i - 1]);
        }
        for (let i = 1; i < closing.length; ++i) {
            expect(closing[i]).toBeLessThanOrEqual(closing[i - 1]);
        }
        expect(Math.max(...opening)).toBeLessThanOrEqual(96);
        expect(dc.isDone()).toBe(true);
        expect(dc.offset).toBe(0);
    });

    it('holds fully open for the maintain duration', () => {
        const dc = door({ maintainDuration: 25 });
        const open = run(dc, 80).filter(s => s.phase === DOOR_PHASE_OPEN);
        expect(open.length).toBe(25);
        expect(open.every(s => s.offset === 96)).toBe(true);
    });

    it('never closes on its own when the maintain duration is Infinity', () => {
        const dc = door({ maintainDuration: Infinity });
        run(dc, 500);
        expect(dc.isOpen()).toBe(true);
        expect(dc.offset).toBe(96);

        dc.close();
        run(dc, 20);
        expect(dc.isDone()).toBe(true);
    });

    it('waits out the delay before opening', () => {
        const dc = door({ delayDuration: 15 });
        const log = run(dc, 14);
        expect(log.every(s => s.phase === DOOR_PHASE_CLOSED)).toBe(true);
        expect(dc.offset).toBe(0);
        dc.process();
        expect(dc.getPhase()).toBe(DOOR_PHASE_OPENING);
    });

    it('stays open while a check listener cancels the close, then shuts', () => {
        const dc = door({ maintainDuration: 5 });
        let block = true;
        dc.events.on('check', e => {
            if (block) e.cancel = true;
        });
        run(dc, 40);
        expect(dc.isOpen()).toBe(true);

        block = false;
        run(dc, 40);
        expect(dc.isDone()).toBe(true);
    });

    it('emits its lifecycle events in order', () => {
        const dc = door();
        const seen: string[] = [];
        for (const e of ['opening', 'open', 'closing', 'close'] as const) {
            dc.events.on(e, () => seen.push(e));
        }
        run(dc, 60);
        expect(seen).toEqual(['opening', 'open', 'closing', 'close']);
    });

    it('round-trips its state and continues identically', () => {
        const a = door();
        run(a, 14);
        const b = door();
        b.state = a.state;
        expect(b.getPhase()).toBe(a.getPhase());
        expect(b.offset).toBeCloseTo(a.offset, 10);
        expect(run(b, 30).map(s => s.offset)).toEqual(run(a, 30).map(s => s.offset));
    });

    it('close() is a no-op once already closing', () => {
        const dc = door({ maintainDuration: Infinity });
        run(dc, 15);
        dc.close();
        expect(dc.getPhase()).toBe(DOOR_PHASE_CLOSING);
        const time = dc.state.time;
        dc.close();
        expect(dc.state.time).toBe(time);
    });
});

describe('DoorManager', () => {
    it('reports a cell update per door and frees the cell while open', () => {
        const dm = new DoorManager();
        const dc = door({ maintainDuration: Infinity });
        dm.linkDoorContext(dc);

        let update = dm.process()[0];
        expect(update).toMatchObject({ x: 3, y: 4, phys: PHYS_DOOR_UP });

        for (let i = 0; i < 20; ++i) update = dm.process()[0];
        expect(dc.isOpen()).toBe(true);
        expect(update.phys).toBe(PHYS_NONE);
        expect(update.offset).toBe(96);
    });

    it('retires a door once shut, reporting it one last time', () => {
        const dm = new DoorManager();
        dm.linkDoorContext(door());
        let last;
        for (let i = 0; i < 60; ++i) {
            const r = dm.process();
            if (r.length > 0) last = r[0];
        }
        expect(dm.doors.length).toBe(0);
        // The final report restores the cell: shut, and solid again.
        expect(last).toMatchObject({ offset: 0, phys: PHYS_DOOR_UP });
    });

    it('replaces a door at an occupied cell instead of hanging', () => {
        // The original looped until getDoorContext came back empty while only
        // calling dispose(), which does not unregister — so this spun forever.
        const dm = new DoorManager();
        const first = door();
        const second = door();
        dm.linkDoorContext(first);
        dm.linkDoorContext(second);

        expect(dm.doors.length).toBe(1);
        expect(dm.getDoorContext(3, 4)).toBe(second);
        expect(first.isDone()).toBe(true);
    });

    it('finds and unlinks by position', () => {
        const dm = new DoorManager();
        const dc = door();
        dm.linkDoorContext(dc);
        expect(dm.getDoorContext(3, 4)).toBe(dc);
        expect(dm.getDoorContext(9, 9)).toBeUndefined();
        dm.unlinkDoorContext(dc);
        expect(dm.doors.length).toBe(0);
    });

    it('exposes serialisable state for every live door', () => {
        const dm = new DoorManager();
        const dc = door();
        dc.data.autoclose = true;
        dm.linkDoorContext(dc);
        dm.process();
        expect(dm.state).toEqual([
            { phase: dc.getPhase(), time: dc.state.time, x: 3, y: 4, autoclose: true }
        ]);
    });
});

describe('DoorManager save and restore', () => {
    /** Rebuilds a door for a state entry, as door policy eventually will. */
    const rebuild = (entry: { x: number; y: number; autoclose: boolean | undefined }) => {
        const dc = door();
        dc.data.x = entry.x;
        dc.data.y = entry.y;
        dc.data.autoclose = entry.autoclose;
        return dc;
    };

    it('round-trips a door mid-slide, and both copies then tick alike', () => {
        const dm = new DoorManager();
        const dc = door();
        dm.linkDoorContext(dc);
        for (let i = 0; i < 4; ++i) {
            dm.process();
        }
        expect(dc.getPhase()).toBe(DOOR_PHASE_OPENING);
        expect(dc.offset).toBeGreaterThan(0);

        const saved = JSON.parse(JSON.stringify(dm.state)) as typeof dm.state;
        const restored = new DoorManager();
        restored.setState(saved, rebuild);

        const back = restored.doors[0];
        expect(back, 'no door restored').toBeDefined();
        expect(back.getPhase()).toBe(dc.getPhase());
        expect(back.offset).toBe(dc.offset);
        expect(back.data.x).toBe(3);
        expect(back.data.y).toBe(4);

        // And the two run identically from here on.
        for (let i = 0; i < 30; ++i) {
            expect(restored.process()).toEqual(dm.process());
        }
    });

    it('restores several doors and drops whatever was live before', () => {
        const dm = new DoorManager();
        for (const [x, y] of [[1, 1], [2, 2], [5, 5]]) {
            const dc = door();
            dc.data.x = x;
            dc.data.y = y;
            dm.linkDoorContext(dc);
        }
        dm.process();
        const saved = dm.state;

        const other = new DoorManager();
        other.linkDoorContext(door());
        other.setState(saved, rebuild);

        expect(other.doors.length).toBe(3);
        expect(other.doors.map(d => [d.data.x, d.data.y])).toEqual([[1, 1], [2, 2], [5, 5]]);
        // The door that was live before the restore is gone, not merged in.
        expect(other.getDoorContext(3, 4)).toBeUndefined();
    });

    it('skips an entry the caller declines to rebuild', () => {
        const dm = new DoorManager();
        for (const [x, y] of [[1, 1], [2, 2]]) {
            const dc = door();
            dc.data.x = x;
            dc.data.y = y;
            dm.linkDoorContext(dc);
        }
        dm.process();

        const restored = new DoorManager();
        restored.setState(dm.state, e => (e.x === 1 ? null : rebuild(e)));
        expect(restored.doors.map(d => d.data.x)).toEqual([2]);
    });

    it('carries autoclose across the round trip', () => {
        const dm = new DoorManager();
        const dc = door({ maintainDuration: 5 });
        dc.data.autoclose = true;
        dm.linkDoorContext(dc);
        dm.process();

        const restored = new DoorManager();
        restored.setState(dm.state, rebuild);
        expect(restored.doors[0].data.autoclose).toBe(true);
    });

    it('restores a door mid-close, not just mid-open', () => {
        const dm = new DoorManager();
        const dc = door({ maintainDuration: 1 });
        dm.linkDoorContext(dc);
        // Open fully, wait out the maintain, and catch it on the way down.
        for (let i = 0; i < 14; ++i) {
            dm.process();
        }
        expect(dc.getPhase()).toBe(DOOR_PHASE_CLOSING);
        expect(dc.offset).toBeGreaterThan(0);
        expect(dc.offset).toBeLessThan(96);

        const restored = new DoorManager();
        restored.setState(dm.state, rebuild);
        expect(restored.doors[0].offset).toBe(dc.offset);
    });

    it('restores a fully open door at full travel', () => {
        const dm = new DoorManager();
        const dc = door({ maintainDuration: 50 });
        dm.linkDoorContext(dc);
        for (let i = 0; i < 12; ++i) {
            dm.process();
        }
        expect(dc.getPhase()).toBe(DOOR_PHASE_OPEN);

        const restored = new DoorManager();
        restored.setState(dm.state, rebuild);
        expect(restored.doors[0].offset).toBe(96);
    });
});
