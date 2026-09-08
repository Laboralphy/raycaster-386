/**
 * Paints the scrolling backdrop seen past the walls.
 *
 * The image is drawn twice, offset by its own width, so it wraps seamlessly
 * as the camera turns.
 */
export function renderBackground(
    background: HTMLCanvasElement | null,
    context: CanvasRenderingContext2D,
    screenHeight: number,
    offset: number
): void {
    if (background === null) {
        return;
    }
    const w = background.width;
    let h = background.height;
    let x = offset % w | 0;
    while (x < 0) {
        x += w;
    }
    const y = (screenHeight >> 1) - (h >> 1);
    h = h + y;
    context.drawImage(background, 0, 0, w, h, w - x, y, w, h);
    context.drawImage(background, 0, 0, w, h, -x, y, w, h);
}
