import {
    ANIM_LOOP_FORWARD, ANIM_LOOP_NONE, ANIM_LOOP_YOYO,
    FX_ALPHA_25, FX_ALPHA_50, FX_ALPHA_75, FX_LIGHT_ADD, FX_LIGHT_SOURCE, FX_NONE,
    PHYS_CURT_DOWN, PHYS_CURT_UP, PHYS_DOOR_DOUBLE, PHYS_DOOR_DOWN, PHYS_DOOR_LEFT,
    PHYS_DOOR_RIGHT, PHYS_DOOR_UP, PHYS_INVISIBLE_BLOCK, PHYS_NONE, PHYS_OFFSET_BLOCK,
    PHYS_SECRET_BLOCK, PHYS_TRANSPARENT_BLOCK, PHYS_WALL
} from '../consts.js';

/**
 * Where a decal sits on its face, in numpad layout.
 *
 * These belong to the level format rather than to the renderer, which knows
 * only that a surface has been painted, so they live here.
 */
export const DECAL_ALIGN_BOTTOM_LEFT = 1;
export const DECAL_ALIGN_BOTTOM = 2;
export const DECAL_ALIGN_BOTTOM_RIGHT = 3;
export const DECAL_ALIGN_LEFT = 4;
export const DECAL_ALIGN_CENTER = 5;
export const DECAL_ALIGN_RIGHT = 6;
export const DECAL_ALIGN_TOP_LEFT = 7;
export const DECAL_ALIGN_TOP = 8;
export const DECAL_ALIGN_TOP_RIGHT = 9;

/**
 * Every symbol a level file may use, and the value it stands for.
 *
 * A saved level writes `"@PHYS_WALL"` rather than 1, so that the file survives
 * a renumbering of the constants. Resolution happens once, at load.
 */
export const LEVEL_CONSTANTS: Readonly<Record<string, number>> = {
    '@LOOP_NONE': ANIM_LOOP_NONE,
    '@LOOP_FORWARD': ANIM_LOOP_FORWARD,
    '@LOOP_YOYO': ANIM_LOOP_YOYO,

    '@FX_NONE': FX_NONE,
    '@FX_LIGHT_SOURCE': FX_LIGHT_SOURCE,
    '@FX_LIGHT_ADD': FX_LIGHT_ADD,
    '@FX_ALPHA_75': FX_ALPHA_75,
    '@FX_ALPHA_50': FX_ALPHA_50,
    '@FX_ALPHA_25': FX_ALPHA_25,

    '@PHYS_NONE': PHYS_NONE,
    '@PHYS_WALL': PHYS_WALL,
    '@PHYS_DOOR_UP': PHYS_DOOR_UP,
    '@PHYS_CURT_UP': PHYS_CURT_UP,
    '@PHYS_DOOR_DOWN': PHYS_DOOR_DOWN,
    '@PHYS_CURT_DOWN': PHYS_CURT_DOWN,
    '@PHYS_DOOR_LEFT': PHYS_DOOR_LEFT,
    '@PHYS_DOOR_RIGHT': PHYS_DOOR_RIGHT,
    '@PHYS_DOOR_DOUBLE': PHYS_DOOR_DOUBLE,
    '@PHYS_SECRET_BLOCK': PHYS_SECRET_BLOCK,
    '@PHYS_TRANSPARENT_BLOCK': PHYS_TRANSPARENT_BLOCK,
    '@PHYS_INVISIBLE_BLOCK': PHYS_INVISIBLE_BLOCK,
    '@PHYS_OFFSET_BLOCK': PHYS_OFFSET_BLOCK,

    '@DECAL_ALIGN_TOP_LEFT': DECAL_ALIGN_TOP_LEFT,
    '@DECAL_ALIGN_TOP': DECAL_ALIGN_TOP,
    '@DECAL_ALIGN_TOP_RIGHT': DECAL_ALIGN_TOP_RIGHT,
    '@DECAL_ALIGN_LEFT': DECAL_ALIGN_LEFT,
    '@DECAL_ALIGN_CENTER': DECAL_ALIGN_CENTER,
    '@DECAL_ALIGN_RIGHT': DECAL_ALIGN_RIGHT,
    '@DECAL_ALIGN_BOTTOM_LEFT': DECAL_ALIGN_BOTTOM_LEFT,
    '@DECAL_ALIGN_BOTTOM': DECAL_ALIGN_BOTTOM,
    '@DECAL_ALIGN_BOTTOM_RIGHT': DECAL_ALIGN_BOTTOM_RIGHT
};

/**
 * Resolves one `@SYMBOL` to its value.
 *
 * Unknown symbols throw. The original's translator was non-strict — a typo
 * stayed a string, and the level loaded and then behaved wrongly, with a
 * `"@PHYS_WALLL"` cell silently becoming walkable. A schema cannot catch that
 * either: the typo is a perfectly good string.
 */
export function resolveConstant(name: string): number {
    const value = LEVEL_CONSTANTS[name];
    if (value === undefined) {
        throw new Error(`unknown constant "${name}"`);
    }
    return value;
}

/**
 * Deep-resolves every `@SYMBOL` in a structure, returning a new one.
 *
 * The input is never modified, so a level object can be loaded twice or kept
 * around as the source of truth. Only strings beginning with `@` are touched.
 */
export function resolveConstants<T>(value: T): T {
    if (typeof value === 'string') {
        return (value.startsWith('@') ? resolveConstant(value) : value) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => resolveConstants(item)) as T;
    }
    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = resolveConstants(item);
        }
        return out as T;
    }
    return value;
}
