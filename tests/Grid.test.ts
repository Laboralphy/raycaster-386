import { describe, expect, it } from 'vitest';
import { Grid } from '../src/core/Grid.js';

describe('Grid', () => {
    it('initialises every cell independently', () => {
        const g = new Grid<number[]>();
        g.setSize(3, 2, () => []);
        expect(g.width).toBe(3);
        expect(g.height).toBe(2);
        g.cell(0, 0).push(1);
        expect(g.cell(0, 0)).toEqual([1]);
        expect(g.cell(1, 0)).toEqual([]);
        expect(g.cell(2, 1)).toEqual([]);
    });

    it('passes correct coordinates to init and iterate', () => {
        const g = new Grid<string>();
        g.setSize(3, 2, (x, y) => `${x},${y}`);
        const seen: string[] = [];
        g.iterate((x, y, cell) => {
            expect(cell).toBe(`${x},${y}`);
            seen.push(cell);
        });
        expect(seen).toEqual(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1']);
    });

    it('replaces a cell when iterate returns a value, and not otherwise', () => {
        const g = new Grid<number>();
        g.setSize(2, 1, () => 0);
        g.iterate((x) => (x === 0 ? 9 : undefined));
        expect(g.cell(0, 0)).toBe(9);
        expect(g.cell(1, 0)).toBe(0);
    });

    it('throws rather than returning undefined out of bounds', () => {
        const g = new Grid<number>();
        g.setSize(2, 2, () => 0);
        expect(() => g.cell(2, 0)).toThrow(RangeError);
        expect(() => g.cell(-1, 0)).toThrow(RangeError);
    });
});
