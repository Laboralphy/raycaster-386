import {
    CELL_MATERIAL_MASK,
    CELL_OFFSET_MASK,
    CELL_OFFSET_SHIFT,
    CELL_PHYS_MASK,
    CELL_PHYS_SHIFT,
    PHYS_WALL,
    type PhysCode
} from '../consts.js';

/**
 * What a cell outside the map reads as: solid, with no material and no offset.
 *
 * The map is a flat array indexed `y * size + x`, so an out-of-range
 * coordinate is not merely absent — `(-1, 1)` computes to a valid index in the
 * row above. Reads outside therefore have to be answered explicitly rather
 * than left to the array, and answering "solid" is the safe direction: the
 * alternative, phys 0, tells a caller it may walk off the edge of the world.
 */
const OUTSIDE = PHYS_WALL << CELL_PHYS_SHIFT;

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
/**
 * Everything a {@link CellMap} can be asked, with nothing that can change it.
 *
 * A renderer hands this out rather than the map itself, because
 * `Renderer.setCellPhys` also re-traces every light overlapping the cell and
 * `setMapSize` resizes the surface and light buffers alongside the map —
 * writing to the map directly would skip both and leave them stale.
 *
 * The same object is returned; the interface is erased at build time, so this
 * costs nothing and copies nothing. It stops the accident, not the determined:
 * a cast defeats it, as it would any type-level guarantee.
 *
 * {@link CellMap.data} is deliberately absent — it is a writable
 * `Uint32Array`, and exposing it here would reopen the hole. The render path
 * reaches the full map through its own context, not through this view.
 */
export interface ReadonlyCellMap {
    readonly size: number;
    isInside(x: number, y: number): boolean;
    get(x: number, y: number): number;
    getMaterial(x: number, y: number): number;
    getPhys(x: number, y: number): PhysCode;
    getOffset(x: number, y: number): number;
}

export class CellMap implements ReadonlyCellMap {
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

    /**
     * The whole packed code of a cell, or {@link OUTSIDE} beyond the map.
     *
     * Every accessor below is bounds-checked. The hot loops do not go through
     * them — `projectRay` and `renderFlats` read {@link data} and extract the
     * bits themselves — so the check costs nothing where it would have mattered.
     */
    get(x: number, y: number): number {
        return this.isInside(x, y) ? this._data[y * this._size + x] : OUTSIDE;
    }

    /** Writes outside the map are dropped, never wrapped into another row. */
    set(x: number, y: number, code: number): void {
        if (this.isInside(x, y)) {
            this._data[y * this._size + x] = code;
        }
    }

    getMaterial(x: number, y: number): number {
        return this.isInside(x, y) ? this._data[y * this._size + x] & CELL_MATERIAL_MASK : 0;
    }

    setMaterial(x: number, y: number, code: number): void {
        if (!this.isInside(x, y)) {
            return;
        }
        const i = y * this._size + x;
        this._data[i] = (this._data[i] & ~CELL_MATERIAL_MASK) | (code & CELL_MATERIAL_MASK);
    }

    /** The phys code, or PHYS_WALL beyond the map. */
    getPhys(x: number, y: number): PhysCode {
        if (!this.isInside(x, y)) {
            return PHYS_WALL as PhysCode;
        }
        return ((this._data[y * this._size + x] >>> CELL_PHYS_SHIFT) & CELL_PHYS_MASK) as PhysCode;
    }

    /**
     * Sets the phys code.
     *
     * @returns true if the value actually changed. The caller uses this to
     * decide whether the light map's blocking state needs updating, which is
     * expensive enough to be worth skipping on a no-op write. A write outside
     * the map changes nothing and reports false.
     */
    setPhys(x: number, y: number, code: number): boolean {
        if (!this.isInside(x, y)) {
            return false;
        }
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
        if (!this.isInside(x, y)) {
            return 0;
        }
        return (this._data[y * this._size + x] >>> CELL_OFFSET_SHIFT) & CELL_OFFSET_MASK;
    }

    setOffset(x: number, y: number, code: number): void {
        if (!this.isInside(x, y)) {
            return;
        }
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
