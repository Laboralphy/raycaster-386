import {
    cloneCanvas,
    context2d,
    createCanvas,
    isImage,
    applyFilter,
    type ImageSource,
} from '../core/canvas.js';
import { Rainbow } from '@laboralphy/rainbow';

const DEFAULT_SHADING_LAYERS = 16;

/**
 * Converts a [0, 1] channel into the colour-filter factor the pipeline wants,
 * where an 8-bit channel of 128 means "leave this channel alone".
 */
const NEUTRAL = 255 / 128;

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
    private _opaqueTiles: Uint8Array | null = null;
    private _pixelStorage = false;
    private _pixels: ImageData | null = null;
    private _pixels32: Uint32Array | null = null;

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
        this._opaqueTiles = null;
        this._originalImage = isImage(image) ? cloneCanvas(image) : image;
        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;
    }

    getOriginalImage(): HTMLCanvasElement | null {
        return this._originalImage;
    }

    /**
     * The shaded tileset, or null if {@link compute} has not run yet. Under
     * {@link setPixelStorage} this holds layer 0 alone.
     */
    getImage(): HTMLCanvasElement | null {
        return this._image;
    }

    /**
     * Keeps the shaded layers as pixels instead of as a canvas.
     *
     * Flats — the floor and ceiling atlas, and any decal painted on one — are
     * never drawn: the rasteriser samples them per pixel. Holding every layer
     * as a canvas *and* as the pixels read back from it stored each of them
     * twice, which for sixteen layers is most of a level's texture memory.
     * Under this mode {@link compute} keeps the pixels, and of the canvas only
     * layer 0, which {@link extractTile} still needs to seed a painted decal.
     *
     * Set it before {@link compute}. {@link drawTile} on such a tileset can
     * only draw layer 0; nothing shaded this way is ever drawn.
     */
    setPixelStorage(value: boolean): void {
        this._pixelStorage = value;
    }

    /** The shaded layers as pixels, under {@link setPixelStorage}. */
    getPixels(): ImageData | null {
        return this._pixels;
    }

    /** A 32-bit view of {@link getPixels}, for the flat rasteriser. */
    getPixels32(): Uint32Array | null {
        return this._pixels32;
    }

    /**
     * Whether every pixel of a tile is opaque.
     *
     * What it is for: a slice drawn from an opaque tile hides whatever is
     * under its destination rectangle, so the floor and ceiling rasteriser can
     * leave those pixels alone. A tile with one translucent pixel hides
     * nothing, since the floor shows through it.
     *
     * Scanned once, on the first ask, and thrown away by {@link setImage}.
     * Shading never changes it: the fog wash is composited source-atop, which
     * leaves alpha as it found it.
     */
    isTileOpaque(tile: number): boolean {
        let flags = this._opaqueTiles;
        if (flags === null) {
            flags = this._opaqueTiles = scanTileOpacity(this._originalImage, this._tileWidth);
        }
        return tile >= 0 && tile < flags.length && flags[tile] === 1;
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
        let layer0: HTMLCanvasElement | null = null;
        for (let i = 0; i < layers; ++i) {
            const layer = this.shadeImage(original, i, filter);
            if (i === 0) {
                layer0 = layer;
            }
            ctx.drawImage(layer, 0, i * h);
        }
        if (this._pixelStorage) {
            // `out` is dropped here: read once, then left to the collector.
            const pixels = ctx.getImageData(0, 0, out.width, out.height);
            this._pixels = pixels;
            this._pixels32 = new Uint32Array(pixels.data.buffer);
            this._image = layer0;
        } else {
            this._pixels = null;
            this._pixels32 = null;
            this._image = out;
        }
    }

    /**
     * Draws a region of the shaded tileset into a context.
     */
    drawTile(
        ctx: CanvasRenderingContext2D,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number
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
    extractTile(
        tile: number,
        level: number,
        target: HTMLCanvasElement | null = null
    ): HTMLCanvasElement {
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
    private shadeImage(
        image: HTMLCanvasElement,
        level: number,
        filter: string | null
    ): HTMLCanvasElement {
        const shaded = cloneCanvas(image);
        if (filter) {
            const f = Rainbow.convertToRGBA(Rainbow.parse(filter));
            // 128 of 255 is neutral: a channel there leaves that channel
            // unchanged. Rainbow reports channels in [0, 1], so the factor is
            // scaled back up rather than divided by 128 directly.
            applyColorFilter(shaded, f.r * NEUTRAL, f.g * NEUTRAL, f.b * NEUTRAL);
        }
        this.applyFogShading(shaded, level);
        return shaded;
    }

    /** Approximate bytes held by this tileset's canvases and pixel data. */
    getMemoryUsage(): number {
        const a = this._image;
        const b = this._originalImage;
        return (
            (a === null ? 0 : a.width * a.height * 4) +
            (b === null ? 0 : b.width * b.height * 4) +
            (this._pixels === null ? 0 : this._pixels.data.byteLength)
        );
    }
}

/**
 * Flags the tiles of an atlas whose every pixel is opaque.
 *
 * One pass over the whole atlas rather than one per tile: the alpha channel is
 * read once and each translucent pixel disqualifies the tile it falls in.
 */
function scanTileOpacity(image: HTMLCanvasElement | null, tileWidth: number): Uint8Array {
    if (image === null || tileWidth <= 0) {
        return new Uint8Array(0);
    }
    const w = image.width;
    const h = image.height;
    const count = Math.max(1, (w / tileWidth) | 0);
    const flags = new Uint8Array(count).fill(1);
    const data = context2d(image).getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; ++y) {
        const row = y * w;
        for (let x = 0; x < w; ++x) {
            if (data[(row + x) * 4 + 3] !== 255) {
                const tile = (x / tileWidth) | 0;
                if (tile < count) {
                    flags[tile] = 0;
                }
            }
        }
    }
    return flags;
}

/** Builds the CSS fill style for one fog level. */
function computeFogStyle(color: string, factor: number): string {
    const c = Rainbow.convertToRGBA(Rainbow.parse(color));
    // Deliberately not Rainbow.renderRGBA: it rounds alpha to three decimals,
    // and the fog factor is quantised to a 255th (0.2980392… for level 76).
    // Rounding it to 0.298 shifts the composite by one unit on nearly half the
    // pixels in a scene — eleven golden baselines caught exactly that.
    const a = (factor * 255) | 0;
    return `rgba(${c.r * 255}, ${c.g * 255}, ${c.b * 255}, ${a / 255})`;
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
