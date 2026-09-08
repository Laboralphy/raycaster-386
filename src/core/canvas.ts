/**
 * Canvas creation and pixel helpers.
 *
 * Note: nothing in the render path loads images any more. `loadCanvas` and
 * `loadCanvases` remain exported for caller convenience, but the Renderer
 * takes already-decoded images, which is what makes its whole option path
 * synchronous.
 */

/** An image the renderer can ingest as a texture source. */
export type ImageSource = HTMLCanvasElement | HTMLImageElement;

let defaultImageSmoothing = true;

export function setDefaultImageSmoothing(b: boolean): void {
    defaultImageSmoothing = b;
}

export function getDefaultImageSmoothing(): boolean {
    return defaultImageSmoothing;
}

/**
 * Returns a canvas' 2d context, or throws. Every call site in this library
 * treats a missing context as unrecoverable, so failing loudly here keeps
 * `CanvasRenderingContext2D | null` out of the rest of the codebase.
 */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
        throw new Error('canvas: could not acquire a 2d rendering context');
    }
    return ctx;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = context2d(c);
    ctx.imageSmoothingQuality = 'low';
    ctx.imageSmoothingEnabled = defaultImageSmoothing;
    return c;
}

export function setImageSmoothing(canvas: HTMLCanvasElement, b: boolean): void {
    context2d(canvas).imageSmoothingEnabled = b;
}

export function getImageSmoothing(canvas: HTMLCanvasElement): boolean {
    return context2d(canvas).imageSmoothingEnabled;
}

export function isCanvas(c: unknown): c is HTMLCanvasElement {
    return typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement;
}

export function isImage(c: unknown): c is HTMLImageElement {
    return typeof HTMLImageElement !== 'undefined' && c instanceof HTMLImageElement;
}

/**
 * Copies an image or canvas into a freshly created canvas.
 */
export function cloneCanvas(source: ImageSource): HTMLCanvasElement {
    let w: number;
    let h: number;
    let smoothing: boolean;
    if (isImage(source)) {
        w = source.naturalWidth;
        h = source.naturalHeight;
        smoothing = defaultImageSmoothing;
    } else {
        w = source.width;
        h = source.height;
        smoothing = getImageSmoothing(source);
    }
    const c = createCanvas(w, h);
    setImageSmoothing(c, smoothing);
    context2d(c).drawImage(source, 0, 0);
    return c;
}

/** A mutable colour passed to {@link applyFilter}, reused across pixels. */
export interface FilterColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

/**
 * Runs `f` over every pixel of the canvas, in place. `color` is a single
 * mutable object reused for every pixel; mutate it to change the pixel.
 *
 * This is slow, and is only used at shading-precomputation time.
 */
export function applyFilter(
    canvas: HTMLCanvasElement,
    f: (x: number, y: number, color: FilterColor) => void
): void {
    const ctx = context2d(canvas);
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const pix = imgData.data;
    const color: FilterColor = { r: 0, g: 0, b: 0, a: 0 };
    let x = 0;
    let y = 0;
    for (let i = 0, l = pix.length; i < l; i += 4) {
        color.r = pix[i];
        color.g = pix[i + 1];
        color.b = pix[i + 2];
        color.a = pix[i + 3];
        f(x, y, color);
        pix[i] = Math.min(255, Math.max(0, color.r | 0));
        pix[i + 1] = Math.min(255, Math.max(0, color.g | 0));
        pix[i + 2] = Math.min(255, Math.max(0, color.b | 0));
        pix[i + 3] = Math.min(255, Math.max(0, color.a | 0));
        if (++x >= w) {
            ++y;
            x = 0;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Rescales a canvas into a new one.
 */
export function resize(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
    const out = createCanvas(width, height);
    setImageSmoothing(out, getImageSmoothing(canvas));
    context2d(out).drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
    return out;
}

export function getData(canvas: HTMLCanvasElement, type = 'image/png'): string {
    return canvas.toDataURL(type);
}

/**
 * Loads an image URL into a canvas. Not used by the render path.
 */
export function loadCanvas(url: string): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(cloneCanvas(image)));
        image.addEventListener('error', () =>
            reject(new Error(`loadCanvas: error while loading this image: "${url}"`))
        );
        image.src = url;
    });
}

export function loadCanvases(urls: readonly string[]): Promise<HTMLCanvasElement[]> {
    return Promise.all(urls.map(loadCanvas));
}
