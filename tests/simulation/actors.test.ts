import { describe, expect, it } from 'vitest';
import { Actor, ActorRegistry } from '../../src/simulation/index.js';
import type { ActorFrame } from '../../src/index.js';

/** A registry with one sector per cell, as a game sizes it. */
function registry(): ActorRegistry {
    const r = new ActorRegistry();
    r.setSectors(16, 64);
    return r;
}

describe('ActorRegistry', () => {
    it('reports a new actor as moved, then says nothing while it sits still', () => {
        const r = registry();
        r.spawn({ x: 100, y: 100 });
        expect(r.process(null).moved.length, 'a new actor must be reported once').toBe(1);
        expect(r.process(null).moved.length, 'a still actor should cost nothing').toBe(0);
        expect(r.process(null).moved.length).toBe(0);
    });

    it('reports a move in any of the four components', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });
        r.process(null);

        for (const change of [
            () => { a.position.x += 1; },
            () => { a.position.y += 1; },
            () => { a.position.z += 1; },
            () => { a.position.angle += 0.1; }
        ]) {
            change();
            expect(r.process(null).moved.length).toBe(1);
            expect(r.process(null).moved.length).toBe(0);
        }
    });

    it('keeps the collision body in step with the actor', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 200, size: 12 });
        expect(a.dummy.radius).toBe(12);
        expect([a.dummy.position.x, a.dummy.position.y]).toEqual([100, 200]);

        a.position.x = 500;
        r.process(null);
        expect(a.dummy.position.x).toBe(500);
    });

    it('files actors by sector so occupancy is a lookup', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });   // cell (1, 1)
        expect(r.actorsAt(1, 1)).toEqual([a]);
        expect(r.actorsAt(5, 5)).toEqual([]);

        a.position.x = 5 * 64 + 10;
        r.process(null);
        expect(r.actorsAt(1, 1), 'left the old sector').toEqual([]);
        expect(r.actorsAt(5, 1)).toEqual([a]);
    });

    it('sweeps an actor the game marks dead, and reports it once', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });
        r.process(null);

        a.dead = true;
        const frame = r.process(null);
        expect(frame.removed).toEqual([a.id]);
        expect(r.actors.length).toBe(0);
        expect(r.get(a.id)).toBeUndefined();

        // Drained, not accumulated.
        expect(r.process(null).removed).toEqual([]);
    });

    it('reports an actor that moved and then died in both lists', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });
        r.process(null);

        a.thinker = {
            think: actor => {
                actor.position.x += 10;
                actor.dead = true;
            }
        };
        const frame: ActorFrame = r.process(null);
        expect(frame.moved.map(m => m.id)).toEqual([a.id]);
        expect(frame.removed).toEqual([a.id]);
    });

    it('reports an explicit unlink too', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });
        r.process(null);
        r.unlink(a);
        expect(r.process(null).removed).toEqual([a.id]);
    });

    it('runs thinkers with the context it is given', () => {
        const r = new ActorRegistry<{ tick: number }>();
        r.setSectors(16, 64);
        const a = r.spawn({ x: 100, y: 100 });
        const seen: number[] = [];
        a.thinker = { think: (_actor, ctx) => seen.push(ctx.tick) };
        r.process({ tick: 7 });
        r.process({ tick: 8 });
        expect(seen).toEqual([7, 8]);
    });

    it('survives a thinker that spawns or removes actors mid-tick', () => {
        const r = registry();
        const a = r.spawn({ x: 100, y: 100 });
        a.thinker = {
            think: () => {
                r.spawn({ x: 200, y: 200 });
                a.dead = true;
            }
        };
        expect(() => r.process(null)).not.toThrow();
        expect(r.actors.length, 'the spawned actor should survive').toBe(1);
    });

    it('hands out ids per registry, so two rooms cannot interfere', () => {
        const a = registry();
        const b = registry();
        expect(a.spawn({ x: 0, y: 0 }).id).toBe(b.spawn({ x: 0, y: 0 }).id);
        expect(() => a.link(new Actor(1))).toThrow(/already linked/);
    });
});
