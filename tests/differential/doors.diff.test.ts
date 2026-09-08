import { describe, expect, it } from 'vitest';
import { DoorContext, DoorManager } from '../../src/engine/index.js';
import { PHYS_DOOR_UP } from '../../src/consts.js';
import { hasLegacy, importLegacy } from '../harness/legacy.js';

interface LegacyDoorContext {
    data: Record<string, unknown>;
    offset: number;
    events: { on(e: string, f: (arg: { cancel: boolean }) => void): void };
    process(): void;
    getPhase(): number;
    isOpen(): boolean;
    isDone(): boolean;
    close(): void;
}

/**
 * The port must tick identically to the original: same offset, same phase,
 * every tick, for every combination of durations and curves. Door motion is
 * the kind of thing where "looks about right" hides a one-tick difference.
 */
describe.skipIf(!hasLegacy)('DoorContext vs original', () => {
    async function legacyCtor(): Promise<new (o: Record<string, unknown>) => LegacyDoorContext> {
        return (await importLegacy<{ default: new (o: Record<string, unknown>) => LegacyDoorContext }>(
            'libs/engine/DoorContext.js'
        )).default;
    }

    /** Old option names map onto the port's readable ones. */
    const CURVES = ['_linear', '_smoothstep', '_squareAccel', '_cubeDeccel'] as const;
    const PORT_CURVES = { _linear: 'linear', _smoothstep: 'smoothstep', _squareAccel: 'squareAccel', _cubeDeccel: 'cubeDeccel' } as const;

    it('produces the same offset and phase on every tick', async () => {
        const Legacy = await legacyCtor();

        for (const sdur of [1, 4, 10, 24]) {
            for (const mdur of [0, 5, 30]) {
                for (const ddur of [0, 3]) {
                    for (const curve of CURVES) {
                        const a = new Legacy({ sdur, mdur, ddur, ofsmax: 96, sfunc: curve });
                        const b = new DoorContext({
                            slidingDuration: sdur,
                            maintainDuration: mdur,
                            delayDuration: ddur,
                            offsetMax: 96,
                            openFunction: PORT_CURVES[curve]
                        });
                        const label = `sdur=${sdur} mdur=${mdur} ddur=${ddur} ${curve}`;
                        for (let t = 0; t < 120; ++t) {
                            a.process();
                            b.process();
                            expect(b.offset, `${label} tick ${t} offset`).toBeCloseTo(a.offset, 12);
                            expect(b.getPhase(), `${label} tick ${t} phase`).toBe(a.getPhase());
                            expect(b.isDone(), `${label} tick ${t} done`).toBe(a.isDone());
                        }
                    }
                }
            }
        }
    }, 60_000);

    it('matches when opening and closing use different curves', async () => {
        const Legacy = await legacyCtor();
        const a = new Legacy({ sdur: 12, mdur: 8, ofsmax: 64, sfunc: '_squareAccel', cfunc: '_cubeDeccel' });
        const b = new DoorContext({
            slidingDuration: 12, maintainDuration: 8, offsetMax: 64,
            openFunction: 'squareAccel', closeFunction: 'cubeDeccel'
        });
        for (let t = 0; t < 80; ++t) {
            a.process();
            b.process();
            expect(b.offset, `tick ${t}`).toBeCloseTo(a.offset, 12);
            expect(b.getPhase(), `tick ${t}`).toBe(a.getPhase());
        }
    }, 30_000);

    it('matches when a check listener cancels the close', async () => {
        const Legacy = await legacyCtor();
        const a = new Legacy({ sdur: 6, mdur: 4, ofsmax: 96, sfunc: '_linear' });
        const b = new DoorContext({
            slidingDuration: 6, maintainDuration: 4, offsetMax: 96, openFunction: 'linear'
        });
        let block = true;
        a.events.on('check', e => { if (block) e.cancel = true; });
        b.events.on('check', e => { if (block) e.cancel = true; });

        for (let t = 0; t < 60; ++t) {
            if (t === 40) block = false;
            a.process();
            b.process();
            expect(b.offset, `tick ${t}`).toBeCloseTo(a.offset, 12);
            expect(b.getPhase(), `tick ${t}`).toBe(a.getPhase());
        }
        expect(b.isDone()).toBe(true);
    }, 30_000);

    it('matches an explicit close() on a never-autoclosing door', async () => {
        const Legacy = await legacyCtor();
        const a = new Legacy({ sdur: 8, mdur: Infinity, ofsmax: 96, sfunc: '_smoothstep' });
        const b = new DoorContext({
            slidingDuration: 8, maintainDuration: Infinity, offsetMax: 96, openFunction: 'smoothstep'
        });
        for (let t = 0; t < 30; ++t) { a.process(); b.process(); }
        expect(a.isOpen()).toBe(true);
        expect(b.isOpen()).toBe(true);

        a.close();
        b.close();
        for (let t = 0; t < 30; ++t) {
            a.process();
            b.process();
            expect(b.offset, `tick ${t}`).toBeCloseTo(a.offset, 12);
        }
        expect(b.isDone()).toBe(a.isDone());
    }, 30_000);
});

describe.skipIf(!hasLegacy)('DoorManager vs original', () => {
    it('produces the same cell updates each tick', async () => {
        const LegacyDC = (await importLegacy<{ default: new (o: Record<string, unknown>) => LegacyDoorContext }>(
            'libs/engine/DoorContext.js'
        )).default;
        const LegacyDM = (await importLegacy<{
            default: new () => { linkDoorContext(d: unknown): void; process(): unknown[]; doors: unknown[] };
        }>('libs/engine/DoorManager.js')).default;

        const la = new LegacyDM();
        const pa = new DoorManager();
        for (const [x, y, sdur] of [[1, 2, 6], [3, 4, 10], [5, 6, 3]] as const) {
            const l = new LegacyDC({ sdur, mdur: 6, ofsmax: 96, sfunc: '_linear' });
            l.data.x = x; l.data.y = y; l.data.phys = PHYS_DOOR_UP;
            la.linkDoorContext(l);

            const p = new DoorContext({
                slidingDuration: sdur, maintainDuration: 6, offsetMax: 96, openFunction: 'linear'
            });
            p.data.x = x; p.data.y = y; p.data.phys = PHYS_DOOR_UP;
            pa.linkDoorContext(p);
        }

        for (let t = 0; t < 60; ++t) {
            expect(pa.process(), `tick ${t}`).toEqual(la.process());
        }
        expect(pa.doors.length).toBe(la.doors.length);
    }, 30_000);
});
