import { angle as angleBetween } from '../core/geometry.js';
import type { Sprite } from '../Sprite.js';

/**
 * The facing count the map editor writes, and the conventional default.
 *
 * {@link faceCamera} does not assume it: it quantises onto whatever the sprite
 * actually declares, so a sprite drawn from four sides works too.
 */
export const SPRITE_DIRECTION_COUNT = 8;

/**
 * Turns a directional sprite to show the side the camera can see.
 *
 * A billboard always faces the screen, so "facing" is a choice of frame: a
 * guard walking away from you must show its back. The frame follows from the
 * difference between where the sprite is pointing and where it is being viewed
 * from, quantised into {@link SPRITE_DIRECTION_COUNT} sectors, with a half
 * sector of offset so a facing changes at the boundary between two frames
 * rather than in the middle of one.
 *
 * A no-op when the frame would not change, so a walk cycle is never restarted
 * — {@link Sprite.setDirection} preserves the cursor, but only across a real
 * change.
 *
 * Upstream this lived in `Horde`, the entity registry, and cached the last
 * value on the entity. It is a sprite concern, so it lives here and reads the
 * cache off the sprite.
 *
 * @param facing where the sprite is pointing, in radians
 * @returns the direction index now showing
 */
export function faceCamera(
    sprite: Sprite, facing: number, cameraX: number, cameraY: number
): number {
    // Quantise onto the facings this sprite actually has. The original divided
    // the circle into a fixed eight and masked with `& 7`, which crashed on any
    // sprite declaring fewer — the mask can produce an index past the end.
    const sectors = sprite.facings;
    if (sectors <= 1) {
        return sprite.direction;
    }
    const toCamera = angleBetween(cameraX, cameraY, sprite.x, sprite.y);
    let a = facing + Math.PI / sectors - toCamera;
    if (a < 0) {
        a = 2 * Math.PI + a;
    }
    const direction = ((sectors * a) / (2 * Math.PI) | 0) % sectors;
    if (direction !== sprite.direction) {
        sprite.setDirection(direction);
    }
    return direction;
}
