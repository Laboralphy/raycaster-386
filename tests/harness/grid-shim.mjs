/**
 * Stands in for `@laboralphy/grid`, which the original LightMap imports and
 * which is not installed in the engine checkout.
 *
 * The surface below is everything LightMap and SectorRegistry actually touch:
 * the `width` and `height` setters, `iterate` (whose return value initialises a
 * cell), `cell`, and `on('rebuild')`. Reconstructed from those call sites, not
 * from the real package.
 *
 * `rebuild` fires once per cell whenever the grid is reallocated, with
 * `{x, y, cell}`; whatever the handler assigns to `data.cell` becomes that
 * cell. SectorRegistry uses it to fill the grid with Sector instances.
 */
class Grid {
    constructor() {
        this._cells = [];
        this._width = 0;
        this._height = 0;
        this._handlers = {};
    }

    on(event, handler) {
        (this._handlers[event] ??= []).push(handler);
        return this;
    }

    _emitRebuild() {
        const handlers = this._handlers.rebuild;
        if (handlers === undefined) {
            return;
        }
        for (let y = 0; y < this._height; ++y) {
            for (let x = 0; x < this._width; ++x) {
                const data = { x, y, cell: undefined };
                for (const h of handlers) {
                    h(data);
                }
                this._cells[y * this._width + x] = data.cell;
            }
        }
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
        this._emitRebuild();
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
