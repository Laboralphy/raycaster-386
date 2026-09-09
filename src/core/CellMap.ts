import {
    CELL_MATERIAL_MASK,
    CELL_OFFSET_MASK,
    CELL_OFFSET_SHIFT,
    CELL_PHYS_MASK,
    CELL_PHYS_SHIFT,
    type PhysCode
} from '../consts.js';

/**
 * The square grid of cell codes.
 *
 * Each cell packs three fields into one 32-bit int:
 *
 * ```
 *   bits 31..24   unused
 *   bits 23..16   offset   (0..255)  door slide / block recess
 *   bits 15..12   phys     (0..15)   PhysCode
 *   bits 11..0    material (0..4095) index into the cell code table
 * ```
 *
 * Stored flat and row-major in a Uint32Array rather than the original array
 * of arrays: `projectRay` reads one cell per DDA step and `renderFlats` walks
 * the map essentially at random, so one indexed load beats two dependent ones.
 */
export class CellMap {
    private _data = new Uint32Array(0);
    private _size = 0;

    /** Map width and height, in cells. The map is always square. */
    get size(): number {
        return this._size;
    }

    /** The backing store. Read-only by convention; for hot loops only. */
    get data(): Uint32Array {
        return this._data;
    }

    /**
     * Resizes the map, preserving the content that still fits.
     */
    setSize(size: number): void {
        if (size === this._size) {
            return;
        }
        const next = new Uint32Array(size * size);
        const keep = Math.min(size, this._size);
        for (let y = 0; y < keep; ++y) {
            for (let x = 0; x < keep; ++x) {
                next[y * size + x] = this._data[y * this._size + x];
            }
        }
        this._data = next;
        this._size = size;
    }

    /** True if (x, y) is inside the map. */
    isInside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this._size && y < this._size;
    }

    /** The whole packed code of a cell. */
    get(x: number, y: number): number {
        return this._data[y * this._size + x];
    }

    set(x: number, y: number, code: number): void {
        this._data[y * this._size + x] = code;
    }

    getMaterial(x: number, y: number): number {
        return this._data[y * this._size + x] & CELL_MATERIAL_MASK;
    }

    setMaterial(x: number, y: number, code: number): void {
        const i = y * this._size + x;
        this._data[i] = (this._data[i] & ~CELL_MATERIAL_MASK) | (code & CELL_MATERIAL_MASK);
    }

    getPhys(x: number, y: number): PhysCode {
        return ((this._data[y * this._size + x] >>> CELL_PHYS_SHIFT) & CELL_PHYS_MASK) as PhysCode;
    }

    /**
     * Sets the phys code.
     *
     * @returns true if the value actually changed. The caller uses this to
     * decide whether the light map's blocking state needs updating, which is
     * expensive enough to be worth skipping on a no-op write.
     */
    setPhys(x: number, y: number, code: number): boolean {
        const i = y * this._size + x;
        const prev = this._data[i];
        const next =
            (prev & ~(CELL_PHYS_MASK << CELL_PHYS_SHIFT)) |
            ((code & CELL_PHYS_MASK) << CELL_PHYS_SHIFT);
        if (prev === next) {
            return false;
        }
        this._data[i] = next;
        return true;
    }

    getOffset(x: number, y: number): number {
        return (this._data[y * this._size + x] >>> CELL_OFFSET_SHIFT) & CELL_OFFSET_MASK;
    }

    setOffset(x: number, y: number, code: number): void {
        const i = y * this._size + x;
        this._data[i] =
            (this._data[i] & ~(CELL_OFFSET_MASK << CELL_OFFSET_SHIFT)) |
            ((code & CELL_OFFSET_MASK) << CELL_OFFSET_SHIFT);
    }
}

/** Extracts the material index from an already-loaded cell code. */
export function materialOf(code: number): number {
    return code & CELL_MATERIAL_MASK;
}

/** Extracts the phys code from an already-loaded cell code. */
export function physOf(code: number): PhysCode {
    return ((code >>> CELL_PHYS_SHIFT) & CELL_PHYS_MASK) as PhysCode;
}

/** Extracts the offset from an already-loaded cell code. */
export function offsetOf(code: number): number {
    return (code >>> CELL_OFFSET_SHIFT) & CELL_OFFSET_MASK;
}
