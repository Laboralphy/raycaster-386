/**
 * Physical (collision / behaviour) codes stored in bits 12..15 of a cell.
 */
export const PHYS_NONE = 0x00;
export const PHYS_WALL = 0x01;
export const PHYS_FIRST_DOOR = 0x02;
export const PHYS_DOOR_UP = 0x02;
export const PHYS_CURT_UP = 0x03;
export const PHYS_DOOR_DOWN = 0x04;
export const PHYS_CURT_DOWN = 0x05;
export const PHYS_DOOR_LEFT = 0x06;
export const PHYS_DOOR_RIGHT = 0x07;
export const PHYS_DOOR_DOUBLE = 0x08;
export const PHYS_LAST_DOOR = 0x08;
export const PHYS_SECRET_BLOCK = 0x09;
export const PHYS_TRANSPARENT_BLOCK = 0x0a;
export const PHYS_INVISIBLE_BLOCK = 0x0b;
export const PHYS_OFFSET_BLOCK = 0x0c;

export const DEFAULT_PHYS_CODE = PHYS_NONE;

/** Every value a 4-bit phys code can legally hold. */
export type PhysCode =
    0x00 | 0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x06 | 0x07 | 0x08 | 0x09 | 0x0a | 0x0b | 0x0c;

/**
 * Surface (face) indices. 0..3 are walls in west/south/east/north order;
 * 4 and 5 are the flats. Cell surface arrays are indexed by these.
 */
export const FACE_WEST = 0;
export const FACE_SOUTH = 1;
export const FACE_EAST = 2;
export const FACE_NORTH = 3;
export const FACE_FLOOR = 4;
export const FACE_CEILING = 5;

/** All six surfaces of a cell. */
export type Face = 0 | 1 | 2 | 3 | 4 | 5;
/** Only the four vertical surfaces. */
export type WallFace = 0 | 1 | 2 | 3;

/** Number of surfaces stored per cell. */
export const FACE_COUNT = 6;

/** Animation loop modes. */
export const ANIM_LOOP_NONE = 0;
export const ANIM_LOOP_FORWARD = 1;
export const ANIM_LOOP_YOYO = 2;

export type AnimLoop = 0 | 1 | 2;

/** No effect assigned to the sprite. */
export const FX_NONE = 0;
/** Translucent, drawn with the "lighter" composite operation. */
export const FX_LIGHT_ADD = 1;
/** The sprite is a light source: it is not dimmed with distance. */
export const FX_LIGHT_SOURCE = 2;
/** Sprite opacity 75%. */
export const FX_ALPHA_75 = 1 << 2;
/** Sprite opacity 50%. */
export const FX_ALPHA_50 = 2 << 2;
/** Sprite opacity 25%, hardly visible. */
export const FX_ALPHA_25 = 3 << 2;
/** Internal: marks an x-axed (dimmed) wall slice. */
export const FX_DIM0 = 0x10;

/** Opacity lookup indexed by `flags >> 2`. */
export const FX_ALPHA: readonly number[] = [1, 0.75, 0.5, 0.25, 0];

/**
 * Lightmap cells per map cell, in the LightMap's own (fine) resolution.
 */
export const METRIC_LIGHTMAP_SCALE = 8;

/**
 * The LightMap traces at METRIC_LIGHTMAP_SCALE, but CellSurfaceManager stores
 * the result at half that resolution: LightMap.filter() averages each 2x2
 * fine block into one surface cell. In the original code this factor of 2 was
 * an unexplained `>> 1` in LightMap.filter with nothing in any signature
 * mentioning it, while CellSurfaceManager independently hard-coded 4.
 */
export const LIGHTMAP_TO_SURFACE_SHIFT = 1;

/** Lightmap cells per map cell as stored on cell surfaces. Derived, = 4. */
export const SURFACE_LIGHTMAP_SCALE = METRIC_LIGHTMAP_SCALE >> LIGHTMAP_TO_SURFACE_SHIFT;

/**
 * Wall z (`t * spacing`) and sprite z (the projected distance `f`) are on
 * different scales; this reconciles them so a single sort can interleave
 * walls and sprites correctly.
 *
 * Do not try to normalise this away: wall shading (`z / shadingFactor`) and
 * slice height (`yscr * ytex / z`) both read the *unscaled* wall distance, so
 * changing the scale shifts the rendered look. It is a sort key correction
 * only. (Original name: MAGIC_DIST_RATIO.)
 */
export const SPRITE_Z_SCALE = 1.14734748441786;

/** Cell bit layout: offset(8) | phys(4) | material(12). */
export const CELL_MATERIAL_MASK = 0xfff;
export const CELL_PHYS_SHIFT = 12;
export const CELL_PHYS_MASK = 0xf;
export const CELL_OFFSET_SHIFT = 16;
export const CELL_OFFSET_MASK = 0xff;
