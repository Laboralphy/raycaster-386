import { describe, expect, it } from 'vitest';
import { CellMap } from '../../src/core/CellMap.js';
import { ActorRegistry, DoorPolicy, Scheduler, TagTriggers } from '../../src/simulation/index.js';
import { PHYS_DOOR_UP } from '../../src/consts.js';

const METRICS = { spacing: 64, height: 96 };

/** A small world: a door at (2,2), a lock at (5,5), tags, and two actors. */
function build(): {
    map: CellMap;
    doors: DoorPolicy;
    tags: TagTriggers;
    actors: ActorRegistry;
} {
    const map = new CellMap();
    map.setSize(8);
    map.setPhys(2, 2, PHYS_DOOR_UP);
    map.setPhys(5, 5, PHYS_DOOR_UP);

    const actors = new ActorRegistry();
    actors.setSectors(8, 64);
    const doors = new DoorPolicy({
        map,
        metrics: METRICS,
        isCellOccupied: (x, y) => actors.actorsAt(x, y).length > 0
    });
    const tags = new TagTriggers();
    tags.setMapSize(8, 64);
    return { map, doors, tags, actors };
}

/** Everything a save has to carry, as one JSON-round-tripped blob. */
function save(w: ReturnType<typeof build>): string {
    return JSON.stringify({
        doors: w.doors.state,
        tags: w.tags.grid.state,
        actors: w.actors.state
    });
}

function restore(w: ReturnType<typeof build>, blob: string): void {
    const s = JSON.parse(blob) as {
        doors: ReturnType<DoorPolicy['state']['valueOf']> & typeof w.doors.state;
        tags: typeof w.tags.grid.state;
        actors: typeof w.actors.state;
    };
    w.doors.setState(s.doors);
    w.tags.grid.state = s.tags;
    w.actors.setState(s.actors);
}

describe('a whole world round-trips through JSON', () => {
    it('restores doors mid-slide, locks, tags and actors together', () => {
        const a = build();

        // A door caught mid-slide, another locked, tags placed, actors spawned.
        a.doors.openDoor(2, 2, false);
        for (let i = 0; i < 6; ++i) {
            a.doors.process();
        }
        a.doors.lockDoor(5, 5, true);
        a.tags.grid.addTag(1, 1, 'welcome "the hall"');
        a.tags.grid.addTag(3, 3, 'trap');
        const hero = a.actors.spawn({ x: 96, y: 96, size: 12, ref: 'hero', data: { hp: 7 } });
        a.actors.spawn({ x: 300, y: 200, size: 8, ref: 'ghost' });
        a.actors.process(null);

        const blob = save(a);
        const offset = a.doors.contexts[0].offset;
        expect(offset, 'the door should be part way open').toBeGreaterThan(0);

        // A fresh world, restored from the blob alone.
        const b = build();
        restore(b, blob);

        expect(b.doors.contexts.length).toBe(1);
        expect(b.doors.contexts[0].offset, 'the door lost its position').toBe(offset);
        expect(b.doors.isDoorLocked(5, 5), 'the lock was not restored').toBe(true);

        expect(b.tags.grid.commandOf(b.tags.grid.idsAt(1, 1)[0]))
            .toEqual(['welcome', 'the hall']);
        expect(b.tags.grid.idsAt(3, 3).length).toBe(1);

        const restoredHero = b.actors.get(hero.id);
        expect(restoredHero, 'the hero is missing').toBeDefined();
        expect(restoredHero!.ref).toBe('hero');
        expect(restoredHero!.data).toEqual({ hp: 7 });
        expect([restoredHero!.position.x, restoredHero!.position.y]).toEqual([96, 96]);
        expect(b.actors.actorsAt(1, 1), 'restored actors must be filed').toEqual([restoredHero]);
    });

    it('keeps ticking identically after a restore', () => {
        const a = build();
        a.doors.openDoor(2, 2, true);
        a.actors.spawn({ x: 96, y: 96, size: 12 });
        a.actors.process(null);
        for (let i = 0; i < 5; ++i) {
            a.doors.process();
        }

        const b = build();
        restore(b, save(a));
        for (let i = 0; i < 300; ++i) {
            expect(b.doors.process(), `tick ${i}`).toEqual(a.doors.process());
        }
    });

    it('reports every restored actor as moved, so a view can catch up', () => {
        const a = build();
        a.actors.spawn({ x: 96, y: 96 });
        a.actors.spawn({ x: 300, y: 200 });
        a.actors.process(null);
        expect(a.actors.process(null).moved.length, 'settled').toBe(0);

        const b = build();
        restore(b, save(a));
        expect(b.actors.process(null).moved.length).toBe(2);
    });

    it('does not reuse an id that a restored actor already holds', () => {
        const a = build();
        a.actors.spawn({ x: 10, y: 10 });
        const second = a.actors.spawn({ x: 20, y: 20 });

        const b = build();
        restore(b, save(a));
        expect(b.actors.spawn({ x: 30, y: 30 }).id).not.toBe(second.id);
    });
});

describe('Scheduler and saved state', () => {
    it('is deliberately not serialisable, and says so by holding functions', () => {
        // A command is code. Nothing here pretends otherwise: a game that wants
        // a delayed effect to survive a save records its own intent and
        // re-schedules on load.
        const s = new Scheduler();
        s.delay(() => undefined, 10);
        expect(s.pending).toBe(1);
        expect('state' in s).toBe(false);
    });
});
