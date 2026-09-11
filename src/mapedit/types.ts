/**
 * The MapEdit save format — what the level editor writes.
 *
 * **Nothing in the library reads this.** The engine reads RCE-100, which is
 * the *build artifact* made from a save: atlases merged, animation frames
 * concatenated, phys and loop codes resolved to `@PHYS_*` strings. Keeping the
 * two apart is deliberate — an editor needs unmerged sources, per-tile
 * identity and room for undo, none of which the engine should ever see. See
 * documentation/MAPEDIT_ANALYSIS.md.
 *
 * That split is also what keeps this format free to change: a future editor
 * can save whatever it likes, so long as something compiles it to RCE-100.
 */

/** The only save version that has existed. A file with no `version` is this. */
export const MAPEDIT_1 = 'MAPEDIT-1';

/** Every save version this converter understands. */
export const MAPEDIT_VERSIONS = [MAPEDIT_1] as const;

export type MapEditVersion = (typeof MAPEDIT_VERSIONS)[number];

/**
 * A light attached to a block or a thing.
 *
 * The numbers arrive as either numbers or strings: the editor binds them to
 * text inputs and stores whatever the field held. Real saves contain both, so
 * every numeric field here is read through a coercion rather than trusted.
 */
export interface MapEditLight {
    enabled: boolean;
    value: number | string;
    inner: number | string;
    outer: number | string;
}

/** One source tile, before any merging. */
export interface MapEditTile {
    id: number | string;
    type: string;
    /** How the editor names the image. The appender resolves it. */
    content: string;
    width: number;
    height: number;
    /** `frames` and `duration` come out of text inputs, so they are strings. */
    animation: {
        frames: number | string;
        duration: number | string;
        loop: number | string;
    } | null;
}

/** A block: six faces, a phys code, an optional light. */
export interface MapEditBlock {
    id: number;
    ref: string;
    /** Index into the phys table, not a symbol. */
    phys: number | string;
    offs: number | string;
    light: MapEditLight;
    faces: {
        n: number | null;
        e: number | null;
        w: number | null;
        s: number | null;
        f: number | null;
        c: number | null;
    };
    /** Editor-only: a rendered thumbnail. Dropped. */
    preview?: string;
}

/** A thing template: what the editor calls a placeable sprite. */
export interface MapEditThing {
    id: number | string;
    ref: string;
    size: number | string;
    /** 0 = opaque, 1 = 75%, 2 = 50%, 3 = 25%. */
    opacity: number | string;
    ghost: boolean;
    tangible: boolean;
    light: MapEditLight;
    /** The tile id this thing draws with. */
    tile: number | string;
}

/** One thing placed in a cell, on a 3x3 sub-grid. */
export interface MapEditCellThing {
    id: number | string;
    /** 0, 1 or 2 — left/centre/right and top/middle/bottom. */
    x: number | string;
    y: number | string;
}

export interface MapEditCell {
    /** Null for an empty cell, which reads as block 0. */
    block: number | null;
    upperblock: number | null;
    tags: string[];
    things: MapEditCellThing[];
    /** Editor-only. Dropped. */
    mark?: { color: number; shape: number };
    /** Editor-only. Dropped. */
    modified?: boolean;
}

export interface MapEditStartpoint {
    x: number;
    y: number;
    /** In half-turns: the converter multiplies by PI. */
    angle: number;
    z?: number;
}

/**
 * A complete save.
 *
 * `version` did not exist in the editor that produced these, so a file without
 * one is read as {@link MAPEDIT_1}. Anything else is refused rather than
 * guessed at — see `convertMapEditLevel`.
 */
export interface MapEditLevel {
    version?: string;
    tiles: {
        walls: MapEditTile[];
        flats: MapEditTile[];
        sprites: MapEditTile[];
    };
    blocks: MapEditBlock[];
    things: MapEditThing[];
    grid: MapEditCell[][];
    metrics: { tileWidth: number | string; tileHeight: number | string };
    flags: { smooth: boolean; stretch: boolean; export?: boolean };
    ambiance: {
        sky: string;
        fog: { distance: number | string; color: string };
        filter: { enabled: boolean; color: string };
        brightness: number | string;
    };
    actor: { startpoint: number; thinker: string };
    startpoints: MapEditStartpoint[];
    /** A thumbnail the editor renders. Passed through untouched. */
    preview?: string;
    /** Editor-only: autosave interval. Dropped. */
    time?: { interval: number };
}

/**
 * Combines `count` tiles from `tilesets`, starting at `start`, into one sheet.
 *
 * Injected rather than implemented, because this is the only host-specific
 * part of the conversion: Node writes a file with @napi-rs/canvas, a browser
 * editor draws on a canvas and hands back a data URI. Keeping it a parameter
 * is what lets one converter serve a CLI and a client-side editor unchanged.
 *
 * Must report the **frame** width and height, not the sheet's — the renderer
 * slices a sheet by frame, so returning the full width makes every animation
 * one frame long.
 */
export type ImageAppender = (
    tilesets: readonly MapEditTile[],
    start: number,
    count: number
) => Promise<{ src: string; width: number; height: number }>;
