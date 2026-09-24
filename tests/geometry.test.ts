import { describe, expect, it } from 'vitest';
import { wrapAngle, wrapAngleSigned } from '../src/core/geometry.js';

const TURN = Math.PI * 2;

describe('wrapAngle', () => {
    it('reduces into [0, 2*PI)', () => {
        for (const a of [0, 0.3, Math.PI, -0.3, -Math.PI, 12.9, -48213.9, 1e6, -1e6]) {
            const w = wrapAngle(a);
            expect(w).toBeGreaterThanOrEqual(0);
            expect(w).toBeLessThan(TURN);
        }
    });

    it('keeps the angle it was given, a whole number of turns apart', () => {
        for (const a of [0.3, 2.5, 4.9, 6.1]) {
            for (const turns of [-9, -1, 0, 1, 7]) {
                expect(wrapAngle(a + turns * TURN)).toBeCloseTo(a, 9);
            }
        }
    });

    it('does not leave a negative angle negative, as % would', () => {
        // The reason this exists rather than a bare modulo.
        expect(-0.3 % TURN).toBeCloseTo(-0.3, 12);
        expect(wrapAngle(-0.3)).toBeCloseTo(TURN - 0.3, 12);
    });

    it('never returns a full turn, however small the negative', () => {
        // floor() of -1e-18 / TURN is -1, which without the guard lands the
        // result exactly on 2*PI — outside the range promised.
        for (const a of [-1e-18, -1e-15, -Number.MIN_VALUE]) {
            expect(wrapAngle(a)).toBeLessThan(TURN);
        }
    });
});

describe('wrapAngleSigned', () => {
    it('reduces into (-PI, PI]', () => {
        for (const a of [0, 0.3, -0.3, Math.PI, -Math.PI, 12.9, -48213.9, 1e6]) {
            const w = wrapAngleSigned(a);
            expect(w).toBeGreaterThan(-Math.PI);
            expect(w).toBeLessThanOrEqual(Math.PI);
        }
    });

    it('gives the shorter way round as a signed difference', () => {
        // Turning from 0.1 rad to 6.1 rad is a tenth of a turn backwards, not
        // most of one forwards.
        expect(wrapAngleSigned(6.1 - 0.1)).toBeCloseTo(6 - TURN, 12);
        expect(wrapAngleSigned(0.1 - 6.1)).toBeCloseTo(TURN - 6, 12);
    });

    it('puts a half turn at +PI rather than -PI', () => {
        expect(wrapAngleSigned(Math.PI)).toBe(Math.PI);
        expect(wrapAngleSigned(-Math.PI)).toBe(Math.PI);
    });
});
