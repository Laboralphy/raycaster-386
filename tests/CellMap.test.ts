import { describe, expect, it } from 'vitest';
import { CellMap, materialOf, offsetOf, physOf } from '../src/core/CellMap.js';
import { PHYS_DOOR_DOUBLE, PHYS_TRANSPARENT_BLOCK, PHYS_WALL } from '../src/consts.js';

describe('CellMap', () => {
    it('packs material, phys and offset into one cell without collision', () => {
        const m = new CellMap();
        m.setSize(8);
        m.setMaterial(3, 4, 0xabc);
        m.setPhys(3, 4, PHYS_DOOR_DOUBLE);
        m.setOffset(3, 4, 0xde);

        expect(m.getMaterial(3, 4)).toBe(0xabc);
        expect(m.getPhys(3, 4)).toBe(PHYS_DOOR_DOUBLE);
        expect(m.getOffset(3, 4)).toBe(0xde);
    });

    it('rewrites one field without disturbing the others', () => {
        const m = new CellMap();
        m.setSize(4);
        m.setMaterial(1, 1, 0xfff);
        m.setPhys(1, 1, PHYS_TRANSPARENT_BLOCK);
        m.setOffset(1, 1, 0xff);

        m.setMaterial(1, 1, 0x001);
        expect(m.getPhys(1, 1)).toBe(PHYS_TRANSPARENT_BLOCK);
        expect(m.getOffset(1, 1)).toBe(0xff);

        m.setPhys(1, 1, 0);
        expect(m.getMaterial(1, 1)).toBe(0x001);
        expect(m.getOffset(1, 1)).toBe(0xff);

        m.setOffset(1, 1, 0);
        expect(m.getMaterial(1, 1)).toBe(0x001);
        expect(m.getPhys(1, 1)).toBe(0);
    });

    it('matches the original bit layout exactly', () => {
        // Original: my[x] = my[x] & 0xFFFFF000 | (code & 0xFFF)
        //           my[x] = my[x] & 0xFFFF0FFF | (code << 12)
        //           my[x] = my[x] & 0xFF00FFFF | (code << 16)
        let legacy = 0;
        legacy = (legacy & 0xfffff000) | (0x123 & 0xfff);
        legacy = (legacy & 0xffff0fff) | (0x9 << 12);
        legacy = (legacy & 0xff00ffff) | (0x42 << 16);

        const m = new CellMap();
        m.setSize(2);
        m.setMaterial(0, 0, 0x123);
        m.setPhys(0, 0, 0x9);
        m.setOffset(0, 0, 0x42);

        expect(m.get(0, 0)).toBe(legacy >>> 0);
        expect(materialOf(legacy)).toBe(0x123);
        expect(physOf(legacy)).toBe(0x9);
        expect(offsetOf(legacy)).toBe(0x42);
    });

    it('reports whether setPhys actually changed anything', () => {
        const m = new CellMap();
        m.setSize(2);
        expect(m.setPhys(0, 0, 5)).toBe(true);
        expect(m.setPhys(0, 0, 5)).toBe(false);
        expect(m.setPhys(0, 0, 6)).toBe(true);
    });

    it('preserves the content that still fits when resized', () => {
        const m = new CellMap();
        m.setSize(4);
        m.setMaterial(0, 0, 11);
        m.setMaterial(3, 3, 22);
        m.setSize(8);
        expect(m.getMaterial(0, 0)).toBe(11);
        expect(m.getMaterial(3, 3)).toBe(22);
        m.setSize(2);
        expect(m.getMaterial(0, 0)).toBe(11);
        expect(m.size).toBe(2);
    });

    it('bounds-checks with isInside', () => {
        const m = new CellMap();
        m.setSize(4);
        expect(m.isInside(0, 0)).toBe(true);
        expect(m.isInside(3, 3)).toBe(true);
        expect(m.isInside(4, 0)).toBe(false);
        expect(m.isInside(-1, 2)).toBe(false);
    });

    it('reads outside the map as solid, not as open floor', () => {
        const m = new CellMap();
        m.setSize(10);
        // Phys 0 would tell a caller it may walk off the edge of the world.
        expect(m.getPhys(-1, -1)).toBe(PHYS_WALL);
        expect(m.getPhys(10, 0)).toBe(PHYS_WALL);
        expect(m.getPhys(0, -1)).toBe(PHYS_WALL);
        expect(physOf(m.get(-1, -1)), 'get() must agree with getPhys()').toBe(PHYS_WALL);
        expect(m.getMaterial(50, 50)).toBe(0);
        expect(m.getOffset(50, 50)).toBe(0);
    });

    it('does not let a negative x read the row above', () => {
        const m = new CellMap();
        m.setSize(10);
        m.setMaterial(9, 0, 111);
        m.setOffset(9, 0, 77);
        // (-1, 1) computes to index 1*10-1 = 9, which is cell (9, 0).
        expect(m.getMaterial(-1, 1)).toBe(0);
        expect(m.getOffset(-1, 1)).toBe(0);
        expect(m.getPhys(-1, 1)).toBe(PHYS_WALL);
    });

    it('drops writes outside the map instead of wrapping them into a real cell', () => {
        const m = new CellMap();
        m.setSize(10);
        m.setMaterial(9, 0, 111);
        m.setPhys(9, 0, PHYS_DOOR_DOUBLE);
        m.setOffset(9, 0, 77);

        m.setOffset(-1, 1, 200);
        m.setMaterial(-1, 1, 222);
        m.set(-1, 1, 0xffff);
        expect(m.getOffset(9, 0), 'offset clobbered through a wrapped index').toBe(77);
        expect(m.getMaterial(9, 0)).toBe(111);
        expect(m.getPhys(9, 0)).toBe(PHYS_DOOR_DOUBLE);

        // And a write with no valid index at all is simply dropped.
        m.setOffset(-1, -1, 200);
        expect(m.getOffset(-1, -1)).toBe(0);
    });

    it('reports an out-of-range setPhys as no change, so no light is re-traced', () => {
        const m = new CellMap();
        m.setSize(10);
        expect(m.setPhys(-1, 1, PHYS_WALL)).toBe(false);
        expect(m.setPhys(2, 2, PHYS_WALL)).toBe(true);
        expect(m.setPhys(2, 2, PHYS_WALL), 'unchanged value').toBe(false);
    });
});
