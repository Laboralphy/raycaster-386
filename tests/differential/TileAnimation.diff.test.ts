import { describe, expect, it } from 'vitest';
import { TileAnimation } from '../../src/texture/TileAnimation.js';
import { hasLegacy, importLegacy } from '../harness/legacy.js';

interface LegacyAnim {
    base: number;
    count: number;
    duration: number;
    loop: number;
    iterations: number;
    frozen: boolean;
    animate(t: number): void;
    frame(): number;
}
type AnimCtor = new () => LegacyAnim;

/**
 * Differential test: the port must be observationally identical to the
 * original for every loop mode, frame count and time step.
 *
 * Skipped when the original engine is not checked out alongside this project.
 */
describe.skipIf(!hasLegacy)('TileAnimation vs original', () => {
    function sample(Ctor: AnimCtor, loop: number, count: number, step: number, iterations?: number): string[] {
        const a = new Ctor();
        a.base = 100;
        a.count = count;
        a.duration = 10;
        a.loop = loop;
        if (iterations !== undefined) {
            a.iterations = iterations;
        }
        const out: string[] = [];
        for (let i = 0; i < 15; ++i) {
            a.animate(step);
            out.push(`${a.frame()}${a.frozen ? 'F' : ''}`);
        }
        return out;
    }

    it('matches for every loop mode, count and time step', async () => {
        const mod = await importLegacy<{ default: AnimCtor }>('libs/raycaster/TileAnimation.js');
        const Legacy = mod.default;
        const Port = TileAnimation as unknown as AnimCtor;

        for (const loop of [0, 1, 2]) {
            for (const count of [1, 2, 3, 5, 8]) {
                for (const step of [1, 3, 10, 35]) {
                    expect(
                        sample(Port, loop, count, step),
                        `loop=${loop} count=${count} step=${step}`
                    ).toEqual(sample(Legacy, loop, count, step));
                }
            }
        }
    });

    it('matches when iterations run out', async () => {
        const mod = await importLegacy<{ default: AnimCtor }>('libs/raycaster/TileAnimation.js');
        const Legacy = mod.default;
        const Port = TileAnimation as unknown as AnimCtor;

        for (const loop of [1, 2]) {
            for (const iterations of [1, 2, 3]) {
                expect(
                    sample(Port, loop, 3, 10, iterations),
                    `loop=${loop} iterations=${iterations}`
                ).toEqual(sample(Legacy, loop, 3, 10, iterations));
            }
        }
    });
});
