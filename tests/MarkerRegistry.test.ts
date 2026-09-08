import { describe, expect, it } from 'vitest';
import { MarkerRegistry } from '../src/core/MarkerRegistry.js';

describe('MarkerRegistry', () => {
    it('marks, tests and unmarks', () => {
        const m = new MarkerRegistry();
        expect(m.isMarked(3, 4)).toBe(false);
        m.mark(3, 4);
        expect(m.isMarked(3, 4)).toBe(true);
        expect(m.isMarked(4, 3)).toBe(false);
        m.unmark(3, 4);
        expect(m.isMarked(3, 4)).toBe(false);
    });

    it('round-trips coordinates through the packed key', () => {
        const m = new MarkerRegistry();
        const pts = [[0, 0], [1, 0], [0, 1], [255, 255], [1023, 511]];
        pts.forEach(([x, y]) => m.mark(x, y));
        const out = m.toArray().map(p => [p.x, p.y]);
        expect(out.sort()).toEqual(pts.sort());
    });

    it('merges another registry', () => {
        const a = new MarkerRegistry();
        const b = new MarkerRegistry();
        a.mark(1, 1);
        b.mark(2, 2);
        a.merge(b);
        expect(a.isMarked(1, 1)).toBe(true);
        expect(a.isMarked(2, 2)).toBe(true);
        expect(b.isMarked(1, 1)).toBe(false);
    });

    it('clears', () => {
        const m = new MarkerRegistry();
        m.mark(5, 5);
        m.clear();
        expect(m.size).toBe(0);
    });
});
