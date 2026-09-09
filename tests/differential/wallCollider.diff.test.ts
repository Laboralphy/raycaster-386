import { describe, expect, it } from 'vitest';
import { computeWallCollisions } from '../../src/simulation/wallCollider.js';
import { hasLegacy, importLegacy } from '../harness/legacy.js';

type LegacyCollide = (
    x: number, y: number, dx: number, dy: number,
    size: number, spacing: number, crash: boolean,
    solid: (x: number, y: number) => boolean
) => { pos: { x: number; y: number }; speed: { x: number; y: number }; wcf: { x: number; y: number; c: boolean } };

const SPACING = 64;
const SIZE = 12;

/**
 * A fixed 8x8 map: a solid border, a pillar, and a one-cell doorway — the
 * cases that exercise sliding, corners and the trailing-probe rule.
 */
const GRID = [
    '########',
    '#      #',
    '#  ##  #',
    '#  ##  #',
    '#      #',
    '##   ###',
    '#      #',
    '########'
];

function solid(x: number, y: number): boolean {
    const cx = (x / SPACING) | 0;
    const cy = (y / SPACING) | 0;
    if (x < 0 || y < 0 || cx > 7 || cy > 7) {
        return true;
    }
    return GRID[cy][cx] === '#';
}

/** A deterministic spread of starts and deltas across the map. */
function* cases(): Generator<[number, number, number, number, boolean]> {
    for (let i = 0; i < 900; ++i) {
        // Positions land on cell centres, faces and awkward fractions alike.
        const x = 40 + ((i * 37) % 420) + (i % 3) * 0.5;
        const y = 40 + ((i * 53) % 420) + (i % 5) * 0.25;
        const dx = (((i * 7) % 15) - 7) * 0.9;
        const dy = (((i * 11) % 15) - 7) * 0.9;
        yield [x, y, dx, dy, i % 7 === 0];
    }
}

describe.skipIf(!hasLegacy)('wall collider vs original', () => {
    it('returns the same position, speed and flags for every case', async () => {
        const legacy = (await importLegacy<{ computeWallCollisions: LegacyCollide }>(
            'libs/wall-collider/index.js'
        )).computeWallCollisions;

        let compared = 0;
        const mismatches: string[] = [];
        for (const [x, y, dx, dy, crash] of cases()) {
            const mine = computeWallCollisions(x, y, dx, dy, SIZE, SPACING, crash, solid);
            const theirs = legacy(x, y, dx, dy, SIZE, SPACING, crash, solid);
            ++compared;
            if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
                mismatches.push(
                    `(${x}, ${y}) + (${dx}, ${dy}) crash=${crash}: ` +
                    `${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`
                );
            }
        }
        expect(mismatches.slice(0, 3)).toEqual([]);
        expect(compared).toBe(900);
    });

    it('agrees on a mobile walking the full length of a corridor', async () => {
        const legacy = (await importLegacy<{ computeWallCollisions: LegacyCollide }>(
            'libs/wall-collider/index.js'
        )).computeWallCollisions;

        // Walking diagonally into the north wall: the slide is what has to match
        // step by step, since each step feeds the next.
        let a = { x: 100, y: 100 };
        let b = { x: 100, y: 100 };
        for (let i = 0; i < 200; ++i) {
            a = computeWallCollisions(a.x, a.y, 3, -3, SIZE, SPACING, false, solid).pos;
            b = legacy(b.x, b.y, 3, -3, SIZE, SPACING, false, solid).pos;
            expect(a, `step ${i}`).toEqual(b);
        }
    });
});
