import { Grid } from '../core/Grid.js';
import type { Vector } from '../core/Vector.js';

/**
 * One bucket of the coarse grid, holding whatever currently stands in it.
 *
 * Entries are opaque: the registry never looks inside them.
 */
export class Sector<T> {
    x = -1;
    y = -1;
    private _objects: T[] = [];

    get objects(): readonly T[] {
        return this._objects;
    }

    add(o: T): void {
        this._objects.push(o);
    }

    remove(o: T): void {
        const i = this._objects.indexOf(o);
        if (i >= 0) {
            this._objects.splice(i, 1);
        }
    }

    count(): number {
        return this._objects.length;
    }

    get(i: number): T | null {
        return this._objects[i] ?? null;
    }
}

/**
 * Buckets objects into a coarse grid, so collision only compares things that
 * are near each other.
 *
 * Sectors are much larger than map cells: their size is chosen so that a
 * mobile can overlap at most the nine sectors around its own.
 */
export class SectorRegistry<T> {
    private _cellWidth = 0;
    private _cellHeight = 0;
    private readonly _grid = new Grid<Sector<T>>();

    get grid(): Grid<Sector<T>> {
        return this._grid;
    }

    getCellWidth(): number {
        return this._cellWidth;
    }

    getCellHeight(): number {
        return this._cellHeight;
    }

    setCellWidth(w: number): this {
        this._cellWidth = w;
        return this;
    }

    setCellHeight(h: number): this {
        this._cellHeight = h;
        return this;
    }

    /**
     * Resizes the grid, discarding everything filed in it.
     *
     * Upstream this happened through a `rebuild` event on the external grid
     * package; the ported {@link Grid} takes a factory instead.
     */
    setSize(width: number, height: number): void {
        this._grid.setSize(width, height, (x, y) => {
            const sector = new Sector<T>();
            sector.x = x;
            sector.y = y;
            return sector;
        });
    }

    /** The sector at grid coordinates, or null if there is none there. */
    sector(x: number, y: number): Sector<T> | null {
        if (x < 0 || y < 0 || x >= this._grid.width || y >= this._grid.height) {
            return null;
        }
        return this._grid.cell(x, y);
    }

    /** The sector containing a world position, or null if it is off-grid. */
    sectorFromVector(v: Vector): Sector<T> | null {
        return this.sector((v.x / this._cellWidth) | 0, (v.y / this._cellHeight) | 0);
    }
}
