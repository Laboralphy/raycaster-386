import { describe, expect, it } from 'vitest';
import { Vector } from '../../src/core/Vector.js';
import {
    computeWallCollisions, Dummy, ForceField, SectorRegistry, Smasher,
    type SmashingEntity
} from '../../src/simulation/index.js';

const SPACING = 64;

/** A 5x5 room with solid walls and a pillar at (2,2). */
function solid(x: number, y: number): boolean {
    const cx = (x / SPACING) | 0;
    const cy = (y / SPACING) | 0;
    if (x < 0 || y < 0 || cx > 4 || cy > 4) {
        return true;
    }
    return cx === 0 || cy === 0 || cx === 4 || cy === 4 || (cx === 2 && cy === 2);
}

describe('Vector', () => {
    it('separates the immutable operations from the mutable ones', () => {
        const v = new Vector(3, 4);
        expect(v.add(new Vector(1, 1))).toEqual(new Vector(4, 5));
        expect(v, 'add mutated its receiver').toEqual(new Vector(3, 4));

        v.translate(new Vector(1, 1));
        expect(v, 'translate should mutate').toEqual(new Vector(4, 5));
        v.scale(2);
        expect(v, 'scale should mutate').toEqual(new Vector(8, 10));
    });

    it('measures length and dot products', () => {
        expect(new Vector(3, 4).length()).toBe(5);
        expect(new Vector(2, 3).dot(new Vector(4, 5))).toBe(23);
    });

    it('normalises a zero vector to zero rather than NaN', () => {
        // The original divided by a zero length here.
        const n = new Vector(0, 0).normalize();
        expect(Number.isNaN(n.x) || Number.isNaN(n.y)).toBe(false);
        expect(n).toEqual(new Vector(0, 0));
        expect(new Vector(0, 5).normalize()).toEqual(new Vector(0, 1));
    });
});

describe('ForceField', () => {
    it('sums forces and decays them to nothing at factor zero', () => {
        const ff = new ForceField();
        ff.addForce(new Vector(1, 2), 0);
        ff.addForce(new Vector(3, 4), 0);
        expect(ff.computeForces()).toEqual(new Vector(4, 6));

        ff.reduceForces();
        expect(ff.forces.length, 'a one-tick push should not survive').toBe(0);
        expect(ff.computeForces()).toEqual(new Vector(0, 0));
    });

    it('keeps a force that decays slowly, until it is negligible', () => {
        const ff = new ForceField();
        ff.addForce(new Vector(10, 0), 0.5);
        let ticks = 0;
        while (ff.forces.length > 0 && ticks < 100) {
            ff.reduceForces();
            ++ticks;
        }
        expect(ticks).toBeGreaterThan(5);
        expect(ticks).toBeLessThan(20);
    });
});

describe('wall collisions', () => {
    // Open cells are (1..3, 1..3) minus the pillar at (2,2). Cell 1 spans
    // 64..127, cell 3 spans 192..255.
    it('moves freely with nothing in the way', () => {
        const r = computeWallCollisions(96, 96, 4, 4, 8, SPACING, false, solid);
        expect(r.pos).toEqual({ x: 100, y: 100 });
        expect(r.wcf.c).toBe(false);
    });

    it('slides along a wall instead of stopping dead', () => {
        // Heading north-west, already flush against the north wall.
        const r = computeWallCollisions(224, 72, -4, -4, 8, SPACING, false, solid);
        expect(r.wcf.c).toBe(true);
        // The northward component is cancelled, the westward one survives.
        expect(r.pos.x).toBeLessThan(224);
        expect(r.speed.y).toBe(0);
    });

    it('stops both axes when asked to crash instead of slide', () => {
        const r = computeWallCollisions(224, 72, -4, -4, 8, SPACING, true, solid);
        expect(r.wcf.c).toBe(true);
        expect(r.speed).toEqual({ x: 0, y: 0 });
    });

    it('snaps flush to the wall rather than leaving a sub-texel gap', () => {
        // Repeated pushes into the same wall must settle on one position.
        let pos = { x: 224, y: 224 };
        for (let i = 0; i < 20; ++i) {
            pos = computeWallCollisions(pos.x, pos.y, 0, -9, 8, SPACING, false, solid).pos;
        }
        const settled = pos.y;
        pos = computeWallCollisions(pos.x, pos.y, 0, -9, 8, SPACING, false, solid).pos;
        expect(pos.y).toBe(settled);
        // Flush against the inside face of the wall cell.
        expect(settled).toBe(SPACING + 8);
    });

    it('reports which side was hit', () => {
        const north = computeWallCollisions(224, 72, 0, -9, 8, SPACING, false, solid);
        expect(north.wcf.y).toBe(-1);
        const east = computeWallCollisions(240, 224, 9, 0, 8, SPACING, false, solid);
        expect(east.wcf.x).toBe(1);
    });
});

describe('SectorRegistry', () => {
    it('files things by position and reports off-grid as null', () => {
        const reg = new SectorRegistry<string>();
        reg.setCellWidth(100).setCellHeight(100);
        reg.setSize(3, 3);

        const s = reg.sectorFromVector(new Vector(150, 250))!;
        expect([s.x, s.y]).toEqual([1, 2]);
        s.add('a');
        expect(reg.sector(1, 2)!.objects).toEqual(['a']);
        expect(reg.sector(1, 2)!.count()).toBe(1);

        s.remove('a');
        expect(reg.sector(1, 2)!.count()).toBe(0);
        expect(reg.sector(1, 2)!.get(0)).toBeNull();

        expect(reg.sectorFromVector(new Vector(400, 50)), 'off grid').toBeNull();
        expect(reg.sector(-1, 0)).toBeNull();
    });
});

describe('Smasher', () => {
    const actor = (id: number, x: number, y: number, r = 10): SmashingEntity => {
        const dummy = new Dummy();
        dummy.position.set(x, y);
        dummy.radius = r;
        return { id, dummy };
    };

    const smasherOf = (...entities: SmashingEntity[]): Smasher => {
        const s = new Smasher();
        s.setCellWidth(128).setCellHeight(128);
        s.setSize(8, 8);
        for (const e of entities) {
            s.registerEntity(e);
        }
        return s;
    };

    it('pushes overlapping actors apart, and leaves distant ones alone', () => {
        const a = actor(1, 200, 200);
        const b = actor(2, 205, 200);
        const far = actor(3, 600, 600);
        const s = smasherOf(a, b, far);
        s.process();

        // a is to the west of b, so a is pushed further west.
        expect(a.dummy.force.x).toBeLessThan(0);
        expect(b.dummy.force.x).toBeGreaterThan(0);
        expect(far.dummy.force).toEqual(new Vector(0, 0));
        expect(far.dummy.smashers.length).toBe(0);
    });

    it('does not produce a NaN force for exactly coincident actors', () => {
        // The original normalised a zero-length vector here, so the force came
        // back (NaN, NaN); adding it to a position made that position NaN for
        // the rest of the run.
        const a = actor(1, 300, 300);
        const b = actor(2, 300, 300);
        const s = smasherOf(a, b);
        s.process();

        for (const e of [a, b]) {
            expect(Number.isFinite(e.dummy.force.x), 'NaN force').toBe(true);
            expect(Number.isFinite(e.dummy.force.y), 'NaN force').toBe(true);
        }
        // And they are actually pushed apart rather than left stuck.
        expect(Math.abs(a.dummy.force.x)).toBeGreaterThan(0);
    });

    it('ignores actors whose tangibility says they should not collide', () => {
        const a = actor(1, 200, 200);
        const b = actor(2, 205, 200);
        b.dummy.tangibility.self = 0;
        const s = smasherOf(a, b);
        s.process();
        expect(a.dummy.force).toEqual(new Vector(0, 0));
    });

    it('refiles an actor that moves into another sector', () => {
        const a = actor(1, 100, 100);
        const s = smasherOf(a);
        const first = a.dummy.colliderSector;
        a.dummy.position.set(500, 500);
        s.process();
        expect(a.dummy.colliderSector).not.toBe(first);
    });

    it('drops an unregistered actor out of its sector', () => {
        const a = actor(1, 200, 200);
        const s = smasherOf(a);
        expect(s.sectorFromVector(a.dummy.position)!.count()).toBe(1);
        s.unregisterEntity(a);
        expect(a.dummy.colliderSector).toBeNull();
        expect(s.entities.length).toBe(0);
    });

    it('refuses to register the same actor twice', () => {
        const a = actor(1, 200, 200);
        const s = smasherOf(a);
        expect(() => s.registerEntity(a)).toThrow(/already registered/);
    });
});
