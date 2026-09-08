/**
 * Stands in for `@laboralphy/grid`, which the original LightMap imports and
 * which is not installed in the engine checkout.
 *
 * The surface below is everything LightMap actually touches: the `width` and
 * `height` setters, `iterate` (whose return value initialises a cell), and
 * `cell`. Reconstructed from those call sites, not from the real package.
 *
 * It is only reachable for fixtures that declare light sources; with no
 * sources the grid is allocated and never read.
 */
class Grid {
    constructor() {
        this._cells = [];
        this._width = 0;
        this._height = 0;
    }

    get width() {
        return this._width;
    }

    set width(value) {
        this._width = value;
        this._realloc();
    }

    get height() {
        return this._height;
    }

    set height(value) {
        this._height = value;
        this._realloc();
    }

    _realloc() {
        this._cells = new Array(this._width * this._height).fill(undefined);
    }

    cell(x, y, value) {
        const i = y * this._width + x;
        if (value !== undefined) {
            this._cells[i] = value;
            return value;
        }
        return this._cells[i];
    }

    iterate(f) {
        for (let y = 0; y < this._height; ++y) {
            for (let x = 0; x < this._width; ++x) {
                const i = y * this._width + x;
                const r = f(x, y, this._cells[i]);
                if (r !== undefined) {
                    this._cells[i] = r;
                }
            }
        }
    }
}

export default Grid;
