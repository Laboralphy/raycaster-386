import { describe, expect, it } from 'vitest';
import { Dummy } from '../../src/simulation/Dummy.js';
import { Smasher, type SmashingEntity } from '../../src/simulation/Smasher.js';
import { hasLegacy, importLegacyBundle } from '../harness/legacy.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface LegacyBundle {
    Smasher: new () => any;
    Dummy: new () => any;
}

const SECTOR = 128;
const GRID = 12;

/** A deterministic crowd: overlapping clusters plus a few loners. */
function positions(): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < 40; ++i) {
        out.push({
            // Clusters of three land within a radius of each other.
            x: 100 + ((i / 3) | 0) * 90 + (i % 3) * 7,
            y: 100 + ((i / 5) | 0) * 70 + (i % 3) * 5,
            r: 8 + (i % 4) * 3
        });
    }
    return out;
}

function buildPort(): { smasher: Smasher; entities: SmashingEntity[] } {
    const smasher = new Smasher();
    smasher.setCellWidth(SECTOR).setCellHeight(SECTOR);
    smasher.setSize(GRID, GRID);
    const entities = positions().map((p, i) => {
        const dummy = new Dummy();
        dummy.position.set(p.x, p.y);
        dummy.radius = p.r;
        const entity: SmashingEntity = { id: i, dummy };
        smasher.registerEntity(entity);
        return entity;
    });
    return { smasher, entities };
}

function buildLegacy(bundle: LegacyBundle): { smasher: any; entities: any[] } {
    const smasher = new bundle.Smasher();
    smasher.setCellWidth(SECTOR).setCellHeight(SECTOR);
    smasher.grid.width = GRID;
    smasher.grid.height = GRID;
    const entities = positions().map((p, i) => {
        const dummy = new bundle.Dummy();
        dummy.position.set(p.x, p.y);
        dummy.radius = p.r;
        const entity = { id: i, dummy };
        smasher.registerEntity(entity);
        return entity;
    });
    return { smasher, entities };
}

describe.skipIf(!hasLegacy)('Smasher vs original', () => {
    it('computes the same separating force for every actor in a crowd', async () => {
        const bundle = await importLegacyBundle<LegacyBundle>({
            Smasher: 'libs/smasher/Smasher.js',
            Dummy: 'libs/smasher/Dummy.js'
        });
        const mine = buildPort();
        const theirs = buildLegacy(bundle);

        mine.smasher.process();
        theirs.smasher.process();

        const mineForces = mine.entities.map(e => [e.dummy.force.x, e.dummy.force.y]);
        const theirForces = theirs.entities.map(e => [e.dummy.force.x, e.dummy.force.y]);
        expect(mineForces).toEqual(theirForces);

        // And the same actors are reported as overlapping each one.
        const mineHits = mine.entities.map(e => e.dummy.smashers.length);
        const theirHits = theirs.entities.map(e => e.dummy.smashers.length);
        expect(mineHits).toEqual(theirHits);
        expect(mineHits.reduce((a, b) => a + b, 0), 'no overlaps in the fixture').toBeGreaterThan(10);
    });

    it('stays in step while the crowd is pushed apart over many ticks', async () => {
        const bundle = await importLegacyBundle<LegacyBundle>({
            Smasher: 'libs/smasher/Smasher.js',
            Dummy: 'libs/smasher/Dummy.js'
        });
        const mine = buildPort();
        const theirs = buildLegacy(bundle);

        // Feeding each tick's force back into position is what makes this a
        // real test: any divergence compounds instead of cancelling.
        for (let tick = 0; tick < 25; ++tick) {
            mine.smasher.process();
            theirs.smasher.process();
            for (const e of mine.entities) {
                e.dummy.position.translate(e.dummy.force);
            }
            for (const e of theirs.entities) {
                e.dummy.position.translate(e.dummy.force);
            }
            const a = mine.entities.map(e => [e.dummy.position.x, e.dummy.position.y]);
            const b = theirs.entities.map(e => [e.dummy.position.x, e.dummy.position.y]);
            expect(a, `tick ${tick}`).toEqual(b);
        }
    });

    it('agrees on tangibility masks', async () => {
        const bundle = await importLegacyBundle<LegacyBundle>({
            Smasher: 'libs/smasher/Smasher.js',
            Dummy: 'libs/smasher/Dummy.js'
        });
        const mine = buildPort();
        const theirs = buildLegacy(bundle);
        // Make every third actor intangible, and every fourth blind to others.
        mine.entities.forEach((e, i) => {
            if (i % 3 === 0) e.dummy.tangibility.self = 0;
            if (i % 4 === 0) e.dummy.tangibility.hitmask = 0;
        });
        theirs.entities.forEach((e, i) => {
            if (i % 3 === 0) e.dummy.tangibility.self = 0;
            if (i % 4 === 0) e.dummy.tangibility.hitmask = 0;
        });

        mine.smasher.process();
        theirs.smasher.process();
        expect(mine.entities.map(e => [e.dummy.force.x, e.dummy.force.y]))
            .toEqual(theirs.entities.map(e => [e.dummy.force.x, e.dummy.force.y]));
    });
});
