import { Canvas, PHYS_NONE, PHYS_WALL } from '../../src';
import type { LevelMap } from '../../src';

/**
 * A big, deliberately dull level whose only job is to put a lot of sprites on
 * screen at once.
 *
 * Nothing here is loaded: the map is generated and the textures are drawn, so
 * the demo is four source files and no assets. That also makes the sprite
 * count a knob rather than a level edit, which is the point — this exists to
 * measure what sprites cost, against `Renderer.getMemoryUsage` and the frame
 * profiler.
 */

export const METRICS = { spacing: 64, height: 96 };
export const TICK_MS = 1000 / 60;

export const SHADING = {
    shades: 16,
    color: '#000000',
    filter: null,
    brightness: 0.08,
};

/** Cells across. Big enough that the far wall is never in view. */
export const MAP_SIZE = 96;

/** Sprite tile size, and one facing per tile. */
export const SPRITE_WIDTH = 48;
export const SPRITE_HEIGHT = 64;
export const SPRITE_FACINGS = 8;
/** Walk cycle frames per facing, so the cache is asked for more than one. */
export const SPRITE_FRAMES = 4;

export const WALL_TILES = 4;
export const FLAT_TILES = 2;

export const START = { x: 3.5, y: 3.5, angle: 0 };

/** Deterministic noise, so the same layout comes back every run. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const VOID = ' ';
const WALL = '#';

/**
 * A walled field with pillars and stub walls scattered through it.
 *
 * Open enough that plenty of sprites are in view at once — an enclosed maze
 * would hide them behind walls and measure nothing — but broken up enough that
 * the raycaster has work to do and the shading varies with distance.
 */
export function buildMap(): LevelMap {
    const random = rng(0x5eed);
    const rows: string[][] = [];
    for (let y = 0; y < MAP_SIZE; ++y) {
        const row: string[] = [];
        for (let x = 0; x < MAP_SIZE; ++x) {
            const edge = x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1;
            // A pillar every eight cells, and a stub wall beside some of them.
            const pillar = x % 8 === 4 && y % 8 === 4;
            const stub = x % 8 === 5 && y % 8 === 4 && random() < 0.5;
            row.push(edge || pillar || stub ? WALL : VOID);
        }
        rows.push(row);
    }
    // Keep the corner the player starts in clear.
    for (let y = 1; y <= 5; ++y) {
        for (let x = 1; x <= 5; ++x) {
            rows[y][x] = VOID;
        }
    }

    return {
        legend: [
            { code: VOID, phys: PHYS_NONE, faces: { f: 0, c: 1 } },
            { code: WALL, phys: PHYS_WALL, faces: { n: 0, e: 1, w: 2, s: 3 } },
        ],
        map: rows.map((row) => row.join('')),
    };
}

/** Every open cell, as world coordinates at its centre. */
export function openCells(map: LevelMap): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = 0; y < map.map.length; ++y) {
        const row = map.map[y];
        for (let x = 0; x < row.length; ++x) {
            if (row[x] === VOID) {
                out.push({ x: (x + 0.5) * METRICS.spacing, y: (y + 0.5) * METRICS.spacing });
            }
        }
    }
    return out;
}

/** Wall atlas: one flat-coloured tile per face, with a band to show depth. */
export function buildWallAtlas(): HTMLCanvasElement {
    const w = METRICS.spacing;
    const h = METRICS.height;
    const canvas = Canvas.createCanvas(w * WALL_TILES, h);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < WALL_TILES; ++i) {
        const hue = 200 + i * 12;
        ctx.fillStyle = `hsl(${hue}, 14%, ${26 + i * 4}%)`;
        ctx.fillRect(i * w, 0, w, h);
        // Courses of brick, so a wall is not a flat colour to look at.
        ctx.fillStyle = `hsl(${hue}, 16%, ${20 + i * 4}%)`;
        for (let y = 0; y < h; y += 16) {
            ctx.fillRect(i * w, y, w, 2);
            ctx.fillRect(i * w + (((y / 16) & 1) === 0 ? 16 : 40), y, 2, 16);
        }
    }
    return canvas;
}

/** Flat atlas: tile 0 is the floor, tile 1 the ceiling. */
export function buildFlatAtlas(): HTMLCanvasElement {
    const s = METRICS.spacing;
    const canvas = Canvas.createCanvas(s * FLAT_TILES, s);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < FLAT_TILES; ++i) {
        ctx.fillStyle = i === 0 ? '#3a3730' : '#22252c';
        ctx.fillRect(i * s, 0, s, s);
        ctx.fillStyle = i === 0 ? '#332f2a' : '#1d2026';
        for (let y = 0; y < s; y += 8) {
            for (let x = ((y / 8) & 1) === 0 ? 0 : 8; x < s; x += 16) {
                ctx.fillRect(i * s + x, y, 8, 8);
            }
        }
    }
    return canvas;
}

/**
 * Sprite atlas: a coloured ellipse per facing, four walk frames each.
 *
 * Laid out as the renderer wants it — one strip per facing, end to end, with
 * `starts` pointing at the first frame of each. The hue says which side you
 * are looking at and the pip says which frame, so both the facing logic and
 * the animation are readable while walking round one.
 *
 * An ellipse rather than a square on purpose. A square fills its tile, so it
 * shows nothing about how a sprite is drawn: a curve has transparent corners
 * (is the alpha of a shaded frame preserved?), an outline a pixel wide (does
 * scaling keep it, and does it stay put as the distance changes?), and edges
 * at every angle, where a nearest-neighbour step or an off-by-one column is
 * obvious rather than hidden along a straight edge.
 */
export function buildSpriteAtlas(): HTMLCanvasElement {
    const w = SPRITE_WIDTH;
    const h = SPRITE_HEIGHT;
    const canvas = Canvas.createCanvas(w * SPRITE_FACINGS * SPRITE_FRAMES, h);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    const rx = w / 2 - 4;
    const ry = h / 2 - 5;
    for (let facing = 0; facing < SPRITE_FACINGS; ++facing) {
        const hue = (facing * 360) / SPRITE_FACINGS;
        for (let frame = 0; frame < SPRITE_FRAMES; ++frame) {
            const x = (facing * SPRITE_FRAMES + frame) * w;
            const cx = x + w / 2;
            const cy = h / 2 + 1;

            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${hue}, 65%, ${40 + frame * 4}%)`;
            ctx.fill();
            // A one-pixel rim: the first thing to smear if a sprite is being
            // resampled rather than stepped.
            ctx.lineWidth = 1;
            ctx.strokeStyle = `hsl(${hue}, 80%, 78%)`;
            ctx.stroke();

            // A cap on the upper half, so which way is up reads at a glance
            // and altitude is visible when a sprite is raised or sunk.
            ctx.beginPath();
            ctx.ellipse(cx, cy - ry / 2, rx / 2, ry / 4, 0, 0, Math.PI * 2);
            ctx.fillStyle = `hsl(${hue}, 85%, 74%)`;
            ctx.fill();

            // The frame pip walks across the lower half.
            ctx.beginPath();
            ctx.ellipse(cx + (frame - 1.5) * 7, cy + ry / 2, 3, 3, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#10121a';
            ctx.fill();
        }
    }
    return canvas;
}

/** First tile of each facing's strip. */
export const SPRITE_STARTS = Array.from(
    { length: SPRITE_FACINGS },
    (_, facing) => facing * SPRITE_FRAMES
);
