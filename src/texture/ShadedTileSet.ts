import { cloneCanvas, context2d, createCanvas, isImage, applyFilter, type ImageSource } from '../core/canvas.js';
import { parse, rgba } from '../core/Rainbow.js';

const DEFAULT_SHADING_LAYERS = 16;

/** Shading parameters a tileset was last computed with. */
export interface ShadingParams {
    /** Fog colour. */
    color: string;
    /** Ambient colour filter, or null for none. */
    filter: string | null;
    /** Base brightness, 0..1. Higher means less fog at any distance. */
    brightness: number;
}

/**
 * A tileset that pre-computes its own distance shading.
 *
 * The computed image stacks every shading layer vertically: layer `n` of a
 * tile lives at `y = n * tileHeight`, so a draw picks its shade by offsetting
 * the source y. That is why rendering a shaded slice costs a plain drawImage.
 */
export class ShadedTileSet {
    private _shadingLayers = DEFAULT_SHADING_LAYERS;
    private _shading = true;
    private _image: HTMLCanvasElement | null = null;
    private _originalImage: HTMLCanvasElement | null = null;
    private _tileWidth = 0;
    private _tileHeight = 0;
    private _fogStyles: string[] = [];
    private _lastParams: ShadingParams | null = null;

    get tileWidth(): number {
        return this._tileWidth;
    }

    get tileHeight(): number {
        return this._tileHeight;
    }

    /** When false, the tileset computes a single unshaded layer. */
    get shading(): boolean {
        return this._shading;
    }

    set shading(value: boolean) {
        this._shading = value;
    }

    /**
     * Number of shading layers. More layers means smoother distance shading
     * and proportionally more texture memory.
     */
    setShadingLayerCount(n: number): void {
        this._shadingLayers = n;
    }

    getShadingLayerCount(): number {
        return this._shading ? this._shadingLayers : 1;
    }

    /**
     * Sets the source tileset. The original is kept unmodified so shading can
     * be recomputed with different settings later.
     */
    setImage(image: ImageSource, tileWidth: number, tileHeight: number): void {
        this._originalImage = isImage(image) ? cloneCanvas(image) : image;
        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;
    }

    getOriginalImage(): HTMLCanvasElement | null {
        return this._originalImage;
    }

    /** The shaded tileset, or null if {@link compute} has not run yet. */
    getImage(): HTMLCanvasElement | null {
        return this._image;
    }

    /** Re-runs {@link compute} with the parameters last used. */
    recompute(): void {
        if (this._image === null || this._lastParams === null) {
            return;
        }
        const p = this._lastParams;
        this.compute(p.color, p.filter, p.brightness);
    }

    /**
     * Builds the shaded tileset. {@link setImage} must have run first.
     */
    compute(color: string, filter: string | null, brightness: number): void {
        const original = this._originalImage;
        if (original === null) {
            throw new Error('ShadedTileSet.compute: setImage() must be called first');
        }
        this._lastParams = { color, filter, brightness };

        const layers = this.getShadingLayerCount();
        const h = original.height;
        const out = createCanvas(original.width, h * layers);
        const ctx = context2d(out);

        this._fogStyles = [];
        for (let i = 0; i < layers; ++i) {
            // Layer 0 is unfogged; the last layer is fully fogged, less the
            // ambient brightness floor. With a single layer there is no fog
            // ramp at all. (The original relied on i / (layers - 1) yielding
            // NaN here and NaN | 0 collapsing to 0; this states it outright.)
            const factor = layers === 1 ? 0 : Math.min(i / (layers - 1), 1) * (1 - brightness);
            this._fogStyles[i] = computeFogStyle(color, factor);
        }
        for (let i = 0; i < layers; ++i) {
            ctx.drawImage(this.shadeImage(original, i, filter), 0, i * h);
        }
        this._image = out;
    }

    /**
     * Draws a region of the shaded tileset into a context.
     */
    drawTile(
        ctx: CanvasRenderingContext2D,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number
    ): void {
        const image = this._image;
        if (image === null) {
            return;
        }
        ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    /**
     * Copies one tile at one shading level into its own canvas.
     *
     * @param target an existing canvas to draw into, instead of a new one
     */
    extractTile(tile: number, level: number, target: HTMLCanvasElement | null = null): HTMLCanvasElement {
        const w = this._tileWidth;
        const h = this._tileHeight;
        const fragment = target ?? createCanvas(w, h);
        const ctx = context2d(fragment);
        ctx.clearRect(0, 0, w, h);
        // Falls back to the original when shading has not been computed yet.
        const image = this._image ?? this._originalImage;
        if (image === null) {
            throw new Error('ShadedTileSet.extractTile: setImage() must be called first');
        }
        ctx.drawImage(image, tile * w, h * level, w, h, 0, 0, w, h);
        return fragment;
    }

    /** Applies the fog wash for one shading level, in place. */
    applyFogShading(shaded: HTMLCanvasElement, level: number): HTMLCanvasElement {
        const ctx = context2d(shaded);
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = this._fogStyles[level];
        ctx.fillRect(0, 0, shaded.width, shaded.height);
        ctx.restore();
        return shaded;
    }

    /**
     * Produces one shading layer: the original, optionally colour-filtered,
     * then fogged to `level`.
     */
    private shadeImage(image: HTMLCanvasElement, level: number, filter: string | null): HTMLCanvasElement {
        const shaded = cloneCanvas(image);
        if (filter) {
            const f = parse(filter);
            // 128 is neutral: a channel at 128 leaves that channel unchanged.
            applyColorFilter(shaded, f.r / 128, f.g / 128, f.b / 128);
        }
        this.applyFogShading(shaded, level);
        return shaded;
    }

    /** Approximate bytes held by this tileset's canvases. */
    getMemoryUsage(): number {
        const a = this._image;
        const b = this._originalImage;
        return (
            (a === null ? 0 : a.width * a.height * 4) +
            (b === null ? 0 : b.width * b.height * 4)
        );
    }
}

/** Builds the CSS fill style for one fog level. */
function computeFogStyle(color: string, factor: number): string {
    const c = parse(color);
    c.a = (factor * 255) | 0;
    return rgba(c);
}

/**
 * Multiplies each channel of the image by a float factor. (1, 1, 1) is
 * neutral; (1, 0.5, 0.5) dims green and blue, making the texture redder.
 */
function applyColorFilter(image: HTMLCanvasElement, r: number, g: number, b: number): void {
    applyFilter(image, (_x, _y, color) => {
        color.r *= r;
        color.g *= g;
        color.b *= b;
    });
}
