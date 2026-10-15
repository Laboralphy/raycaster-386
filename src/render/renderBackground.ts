/**
 * Horizontal scroll of the backdrop, in pixels, for a camera direction.
 *
 * By default the image repeats every quarter turn: one image width per 90°,
 * which keeps pace with the walls when the image is one screen wide and the
 * field of view is 90°. A panorama covers a full turn instead, so it shows
 * once around the camera; it keeps pace with the walls when its width is the
 * screen width × 360 / fov (in degrees).
 *
 * @param direction camera angle, in radians
 * @param width backdrop width, once scaled to the screen height
 */
export function backgroundScroll(direction: number, width: number, panorama: boolean): number {
    return panorama ? (direction * width) / (2 * Math.PI) : (2 * direction * width) / Math.PI;
}

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
    let x = (offset % w) | 0;
    while (x < 0) {
        x += w;
    }
    const y = (screenHeight >> 1) - (h >> 1);
    h = h + y;
    context.drawImage(background, 0, 0, w, h, w - x, y, w, h);
    context.drawImage(background, 0, 0, w, h, -x, y, w, h);
}
