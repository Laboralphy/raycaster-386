import { Canvas, createCanvas, Image, ImageData } from '@napi-rs/canvas';

/**
 * Installs just enough of the DOM for both the original engine and the port
 * to run under Node.
 *
 * The original calls `document.createElement('canvas')` and branches on
 * `instanceof Image` / `instanceof HTMLCanvasElement`; the port uses
 * `HTMLImageElement`. Pointing all of those at @napi-rs/canvas lets the same
 * rendering code run headless, which is what makes pixel-level differential
 * testing possible at all.
 */
export function installDom(): void {
    const g = globalThis as Record<string, unknown>;
    if (g.__raycasterDomInstalled) {
        return;
    }

    g.HTMLCanvasElement = Canvas;
    g.HTMLImageElement = Image;
    g.Image = Image;
    g.ImageData = ImageData;
    // Only referenced inside CanvasHelper.text(), which nothing here calls.
    g.CanvasGradient ??= class CanvasGradient {};

    g.document = {
        createElement(tag: string) {
            if (tag !== 'canvas') {
                throw new Error(`dom shim: only <canvas> is supported, got <${tag}>`);
            }
            // Size is assigned by the caller straight after.
            return createCanvas(1, 1);
        }
    };

    g.__raycasterDomInstalled = true;
}

/** A canvas as produced by the shim. Structurally an HTMLCanvasElement. */
export type ShimCanvas = ReturnType<typeof createCanvas>;

/** Creates a canvas through the shim, typed as the DOM type the code expects. */
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
    return createCanvas(width, height) as unknown as HTMLCanvasElement;
}
