/**
 * A dense 2D grid of cells, stored row-major in a flat array.
 *
 * Replaces the external `@laboralphy/grid` dependency; the LightMap is the
 * only consumer and uses a small part of its surface.
 */
export class Grid<T> {
    private _cells: T[] = [];
    private _width = 0;
    private _height = 0;

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    /**
     * Resizes the grid and fills every cell using `init`. Any previous
     * content is discarded.
     */
    setSize(width: number, height: number, init: (x: number, y: number) => T): void {
        this._width = width;
        this._height = height;
        const cells: T[] = new Array<T>(width * height);
        for (let y = 0, i = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x, ++i) {
                cells[i] = init(x, y);
            }
        }
        this._cells = cells;
    }

    cell(x: number, y: number): T {
        if (x < 0 || y < 0 || x >= this._width || y >= this._height) {
            throw new RangeError(
                `Grid.cell: (${x}, ${y}) is outside 0..${this._width - 1}, 0..${this._height - 1}`
            );
        }
        return this._cells[y * this._width + x];
    }

    /**
     * Calls back for every cell. Returning a value replaces the cell;
     * returning undefined leaves it alone.
     */
    iterate(f: (x: number, y: number, cell: T) => T | void): void {
        const w = this._width;
        const cells = this._cells;
        for (let i = 0, l = cells.length; i < l; ++i) {
            const r = f(i % w, (i / w) | 0, cells[i]);
            if (r !== undefined) {
                cells[i] = r;
            }
        }
    }
}
