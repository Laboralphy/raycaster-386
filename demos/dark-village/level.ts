/**
 * Where this demo's level and its tuning live.
 *
 * Unlike `demos/simple`, the map is not written here: it is a real MapEdit
 * level, converted to RCE-100 by `scripts/convert-mapedit-level.mjs` and read
 * at runtime by `loadLevel`. Everything below is what the *game* adds on top.
 */

/** The converted level. The editor's own save file is under `assets/levels/`. */
export const LEVEL_URL = 'assets/level-1.rce.json';

/**
 * Simulation rate. Doors are written in ticks, so this must be fixed — and it
 * is also the animation clock, since `Renderer.computeAnimations` takes the
 * same unit the level's `duration` fields are in.
 */
export const TICK_MS = 1000 / 60;

/** How close the player must be to a door to open it, in world units. */
export const REACH = 96;
/** Keeps the player off the walls, in world units. */
export const PLAYER_RADIUS = 12;
/** How long an opened door waits before closing itself, in ticks. */
export const DOOR_MAINTAIN = 180;
