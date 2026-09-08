import { line } from '../core/bresenham.js';
import { circleInRect, distance, linear } from '../core/geometry.js';
import { Grid } from '../core/Grid.js';
import { MarkerRegistry } from '../core/MarkerRegistry.js';
import { LightSource } from './LightSource.js';

const PIXEL_STATE_DEAD = 0;
const PIXEL_STATE_LIVE = 1;
const PIXEL_STATE_NEW = 2;

/** One source's contribution to one lightmap cell. */
interface LightPixel {
    /** Intensity contributed by this source, 0..1. */
    v: number;
    /** Id of the contributing source. */
    id: number;
    /** PIXEL_STATE_*. */
    s: number;
}

/**
 * Traced static lighting over a grid of lightmap cells.
 *
 * Each cell accumulates one entry per source that reaches it; the final
 * intensity is the alpha-composite of all live entries. Sources are traced
 * with Bresenham rays that stop at light-blocking cells, so walls cast
 * shadows.
 */
export class LightMap {
    private _blocking = new MarkerRegistry();
    /** Cells whose value changed since the last {@link filter}. */
    private _updated = new MarkerRegistry();
    private _grid = new Grid<LightPixel[]>();
    private _sources: LightSource[] = [];
    private _invalid = true;

    get width(): number {
        return this._grid.width;
    }

    get height(): number {
        return this._grid.height;
    }

    invalidate(): void {
        this._invalid = true;
    }

    isInvalid(): boolean {
        return this._invalid;
    }

    clearInvalidFlag(): void {
        this._invalid = false;
    }

    /**
     * Resizes the map, in lightmap cells. All traced light is discarded.
     */
    setSize(w: number, h: number): void {
        this._grid.setSize(w, h, () => []);
        this._updated.clear();
        this._sources.forEach(s => s.invalidate());
        this.invalidate();
    }

    /**
     * Marks a rectangular region as blocking or not blocking light, and
     * invalidates every source whose reach overlaps it.
     */
    setLightBlocking(x: number, y: number, w: number, h: number, blocking: boolean): void {
        for (let yi = 0; yi < h; ++yi) {
            for (let xi = 0; xi < w; ++xi) {
                if (blocking) {
                    this._blocking.mark(x + xi, y + yi);
                } else {
                    this._blocking.unmark(x + xi, y + yi);
                }
            }
        }
        for (let i = 0, l = this._sources.length; i < l; ++i) {
            const s = this._sources[i];
            if (circleInRect(s.x, s.y, s.r1, x, y, w, h)) {
                this.invalidate();
                s.invalidate();
            }
        }
    }

    /**
     * Composites two alpha values.
     */
    static alphaSum(a: number, b: number): number {
        return Math.max(0, Math.min(1, a + b * (1 - a)));
    }

    private updatePixel(x: number, y: number, value: number, id: number): void {
        const cell = this._grid.cell(x, y);
        const p = cell.find(gp => gp.id === id);
        if (p) {
            if (value !== p.v) {
                p.v = value;
                this._updated.mark(x & ~1, y & ~1);
            }
            p.s = PIXEL_STATE_LIVE;
        } else {
            cell.push({ v: value, id, s: PIXEL_STATE_NEW });
            this._updated.mark(x & ~1, y & ~1);
        }
    }

    private removePixel(x: number, y: number, id: number): void {
        const p = this._grid.cell(x, y).find(gp => gp.id === id);
        if (p) {
            p.v = 0;
            p.s = PIXEL_STATE_DEAD;
            this._updated.mark(x & ~1, y & ~1);
        }
    }

    /**
     * Traces one ray from a source's centre out to (x1, y1), stopping at the
     * first light-blocking cell.
     */
    private traceLineOfLight(x1: number, y1: number, source: LightSource): void {
        const x0 = source.x;
        const y0 = source.y;
        const id = source.id;
        const computed = source.computed;
        const blocking = this._blocking;
        const intensity = source.v;
        const r0 = source.r0;
        const r1 = source.r1;
        const xMax = this._grid.width;
        const yMax = this._grid.height;

        line(x0, y0, x1, y1, (x, y) => {
            if (x < 0 || y < 0 || x >= xMax || y >= yMax) {
                return;
            }
            if (computed.isMarked(x, y)) {
                // Another ray already reached this cell; keep going.
                return true;
            }
            if (blocking.isMarked(x, y)) {
                return false;
            }
            const dist = distance(x0, y0, x, y);
            let result: number;
            if (dist <= r0) {
                result = intensity;
            } else if (dist > r1) {
                result = 0;
            } else {
                result = linear(dist, r0, intensity, r1, 0);
            }
            computed.mark(x, y);
            source.lightPixel(x, y);
            this.updatePixel(x, y, result, id);
        });
    }

    /**
     * Retraces one source: rays from its centre to every cell on the border
     * of its bounding square.
     */
    private traceLightSource(source: LightSource): void {
        const { x, y, r1, id } = source;
        source.resetCache();
        const x0 = x - r1;
        const y0 = y - r1;
        const x9 = x + r1;
        const y9 = y + r1;

        for (let i = 0, l = (r1 << 1) + 1; i < l; ++i) {
            this.traceLineOfLight(x0 + i, y0, source);
            this.traceLineOfLight(x0, y0 + i, source);
            this.traceLineOfLight(x0 + i, y9, source);
            this.traceLineOfLight(x9, y0 + i, source);
        }
        // Anything lit last time but not this time goes dark.
        source.deadPixels.iterate((px, py) => {
            this.removePixel(px, py, id);
        });
    }

    /**
     * Retraces every invalidated source.
     */
    traceAllSources(): void {
        const sources = this._sources;
        for (let i = 0, l = sources.length; i < l; ++i) {
            const source = sources[i];
            if (source.isInvalid()) {
                this.traceLightSource(source);
                source.clearInvalidFlag();
            }
        }
        this.clearInvalidFlag();
    }

    /**
     * Adds a source. Coordinates and radii are in lightmap cells.
     */
    addSource(x: number, y: number, r0: number, r1: number, intensity: number): LightSource {
        const source = new LightSource();
        source.x = x;
        source.y = y;
        source.r0 = r0;
        source.r1 = r1;
        source.v = intensity;
        source.onInvalidate = () => this.invalidate();
        this._sources.push(source);
        this.invalidate();
        return source;
    }

    /**
     * Removes a source and unlights everything it lit.
     */
    removeSource(source: LightSource): void {
        source.resetCache();
        const id = source.id;
        source.deadPixels.iterate((x, y) => {
            this.removePixel(x, y, id);
        });
        const n = this._sources.indexOf(source);
        // The original tested `if (n)`, which silently failed to remove the
        // source at index 0.
        if (n >= 0) {
            this._sources.splice(n, 1);
        }
        source.onInvalidate = null;
        this.invalidate();
    }

    clearSources(): void {
        // Iterate a copy: removeSource splices the live array.
        this._sources.slice().forEach(source => this.removeSource(source));
    }

    /**
     * Pushes every changed cell's composited intensity to `f`, downsampled by
     * averaging each 2x2 block into one destination cell — which is why the
     * destination coordinates are halved. See LIGHTMAP_TO_SURFACE_SHIFT.
     *
     * The changed set is cleared afterwards, so each call reports only what
     * moved since the last one. (The original never cleared it, and so
     * re-pushed every cell ever touched on every invalidation.)
     */
    filter(f: (x: number, y: number, intensity: number) => void): void {
        const g = this._grid;
        this._updated.iterate((x, y) => {
            let n = 0;
            for (let yi = 0; yi < 2; ++yi) {
                for (let xi = 0; xi < 2; ++xi) {
                    const cell = g.cell(x + xi, y + yi);
                    let acc = 0;
                    for (let i = 0, l = cell.length; i < l; ++i) {
                        const p = cell[i];
                        if (p.s > PIXEL_STATE_DEAD) {
                            acc = LightMap.alphaSum(acc, p.v);
                        }
                    }
                    n += acc;
                }
            }
            f(x >> 1, y >> 1, n / 4);
        });
        this._updated.clear();
    }

    /** Total number of source contributions held across all cells. */
    getPixelCount(): number {
        let s = 0;
        this._grid.iterate((_x, _y, cell) => {
            s += cell.length;
        });
        return s;
    }
}
