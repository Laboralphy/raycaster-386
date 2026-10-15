import { Canvas, PHYS_NONE, PHYS_WALL } from '../../src';
import type { LevelMap } from '../../src';

/**
 * A daylit colonnade, at a resolution the other demos do not use.
 *
 * The three older demos all render 320x200 — the resolution the engine this
 * was ported from was written for. This one runs at 800x512 to show what the
 * renderer looks like when it is not squinting, and the R key drops it back
 * down so the two can be compared on the same scene.
 *
 * Bright on purpose, too. A raycaster is easy to make atmospheric by turning
 * the lights off; a pale stone hall under a warm haze has nowhere to hide a
 * seam, a mis-sampled column or a sprite whose shading does not match the
 * wall behind it.
 */

export const METRICS = { spacing: 64, height: 96 };
export const TICK_MS = 1000 / 60;

/** Internal resolutions the R key cycles through. */
export const RESOLUTIONS = [
    { width: 800, height: 512, label: 'high' },
    { width: 640, height: 400, label: 'medium' },
    { width: 320, height: 200, label: 'classic' },
] as const;

/**
 * Daylight rather than dungeon: a warm haze to fade into instead of black, and
 * a high floor under it so nothing near the camera is dim.
 */
export const SHADING = {
    shades: 16,
    color: '#6f6452',
    filter: null,
    brightness: 0.1,
};

export const MAP_SIZE = 40;
export const START = { x: 6.5, y: 20.5, angle: 0 };

export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 96;
/** Column, palm, urn, brazier: one tile each, one facing, no animation. */
export const SCENERY_KINDS = 4;

const VOID = ' ';
const WALL = '#';

/**
 * A walled hall with a colonnade down the middle and alcoves along the sides.
 *
 * Long sight lines on purpose: at 800 wide the far end of the hall is where
 * the shading ramp and the texture filtering are easiest to judge.
 */
export function buildMap(): LevelMap {
    const rows: string[][] = [];
    for (let y = 0; y < MAP_SIZE; ++y) {
        const row: string[] = [];
        for (let x = 0; x < MAP_SIZE; ++x) {
            const edge = x === 0 || y === 0 || x === MAP_SIZE - 1 || y === MAP_SIZE - 1;
            // Two rows of pillars, four cells apart, framing a central aisle.
            const colonnade = x % 4 === 2 && (y === 14 || y === 26) && x > 4 && x < MAP_SIZE - 4;
            // Alcoves: stub walls reaching in from the north and south walls.
            const alcove = (y === 6 || y === 34) && x % 8 === 4 && x > 4 && x < MAP_SIZE - 4;
            const alcoveSide = (y === 5 || y === 7 || y === 33 || y === 35) && x % 8 === 4;
            row.push(edge || colonnade || alcove || alcoveSide ? WALL : VOID);
        }
        rows.push(row);
    }
    return {
        legend: [
            { code: VOID, phys: PHYS_NONE, faces: { f: 0, c: 1 } },
            { code: WALL, phys: PHYS_WALL, faces: { n: 0, e: 1, w: 2, s: 3 } },
        ],
        map: rows.map((row) => row.join('')),
    };
}

/** Pale plaster over a stone dado, one shade per face. */
export function buildWallAtlas(): HTMLCanvasElement {
    const w = METRICS.spacing;
    const h = METRICS.height;
    const canvas = Canvas.createCanvas(w * 4, h);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    for (let i = 0; i < 4; ++i) {
        const x = i * w;
        // A little lighter per face, so the four sides of a pillar read apart
        // even where the light map is flat.
        const light = 74 + i * 3;
        ctx.fillStyle = `hsl(38, 34%, ${light}%)`;
        ctx.fillRect(x, 0, w, h);

        // Plaster mottling, so a flat wall is not a flat colour.
        ctx.fillStyle = `hsl(38, 30%, ${light - 4}%)`;
        for (let n = 0; n < 90; ++n) {
            const px = (n * 23 + i * 7) % w;
            const py = (n * 37 + i * 13) % h;
            ctx.fillRect(x + px, py, 2, 2);
        }

        // Stone dado along the bottom third, with courses.
        ctx.fillStyle = `hsl(30, 20%, ${light - 18}%)`;
        ctx.fillRect(x, h - 30, w, 30);
        ctx.fillStyle = `hsl(30, 18%, ${light - 26}%)`;
        for (let y = h - 30; y < h; y += 10) {
            ctx.fillRect(x, y, w, 1);
            ctx.fillRect(x + (((y / 10) & 1) === 0 ? 20 : 44), y, 1, 10);
        }
        // A painted band where the plaster meets the stone.
        ctx.fillStyle = 'hsl(196, 42%, 52%)';
        ctx.fillRect(x, h - 34, w, 3);
    }
    return canvas;
}

/** Tile 0 the flagstone floor, tile 1 a bright plaster ceiling. */
export function buildFlatAtlas(): HTMLCanvasElement {
    const s = METRICS.spacing;
    const canvas = Canvas.createCanvas(s * 2, s);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    ctx.fillStyle = 'hsl(36, 22%, 66%)';
    ctx.fillRect(0, 0, s, s);
    // Flagstones, two across, with a darker joint.
    ctx.fillStyle = 'hsl(34, 18%, 58%)';
    for (let i = 0; i <= s; i += s / 2) {
        ctx.fillRect(i === s ? s - 2 : i, 0, 2, s);
        ctx.fillRect(0, i === s ? s - 2 : i, s, 2);
    }
    ctx.fillStyle = 'hsl(36, 24%, 71%)';
    for (let n = 0; n < 120; ++n) {
        ctx.fillRect((n * 17) % s, (n * 29) % s, 2, 2);
    }

    ctx.fillStyle = 'hsl(44, 30%, 82%)';
    ctx.fillRect(s, 0, s, s);
    ctx.fillStyle = 'hsl(44, 26%, 78%)';
    for (let n = 0; n < 80; ++n) {
        ctx.fillRect(s + ((n * 13) % s), (n * 31) % s, 3, 2);
    }
    return canvas;
}

/**
 * Four pieces of scenery, one tile each: column, palm, urn, brazier.
 *
 * Static — one facing, no animation — which is the other half of what sprites
 * are for. They still shade with distance like anything else, and standing one
 * beside a pillar is the quickest way to see whether a sprite and the wall
 * behind it agree about how far away they are.
 */
export function buildSceneryAtlas(): HTMLCanvasElement {
    const w = SPRITE_WIDTH;
    const h = SPRITE_HEIGHT;
    const canvas = Canvas.createCanvas(w * SCENERY_KINDS, h);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string): void => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
    };

    // 0: a fluted column, floor to ceiling.
    let x = 0;
    ctx.fillStyle = 'hsl(40, 24%, 84%)';
    ctx.fillRect(x + 20, 6, 24, h - 12);
    ctx.fillStyle = 'hsl(40, 20%, 74%)';
    for (let i = 0; i < 4; ++i) {
        ctx.fillRect(x + 23 + i * 6, 10, 2, h - 20);
    }
    ctx.fillStyle = 'hsl(40, 26%, 90%)';
    ctx.fillRect(x + 15, 2, 34, 8);
    ctx.fillRect(x + 15, h - 10, 34, 8);

    // 1: a palm in a tub.
    x = w;
    ctx.fillStyle = 'hsl(24, 38%, 44%)';
    ctx.fillRect(x + 24, h - 26, 16, 24);
    ctx.fillStyle = 'hsl(24, 34%, 52%)';
    ctx.fillRect(x + 22, h - 28, 20, 5);
    ctx.fillStyle = 'hsl(96, 34%, 34%)';
    ctx.fillRect(x + 31, 34, 3, h - 58);
    for (const [dx, dy] of [
        [-16, -4],
        [16, -4],
        [-11, -14],
        [11, -14],
        [0, -20],
    ]) {
        ellipse(x + 32 + dx, 44 + dy, 12, 6, 'hsl(104, 38%, 40%)');
    }

    // 2: a glazed urn.
    x = 2 * w;
    ellipse(x + 32, h - 26, 17, 22, 'hsl(16, 46%, 52%)');
    ellipse(x + 26, h - 34, 5, 9, 'hsl(16, 50%, 64%)');
    ctx.fillStyle = 'hsl(16, 40%, 44%)';
    ctx.fillRect(x + 25, h - 50, 14, 6);

    // 3: a lit brazier. Drawn bright because it is a light source, and light
    // sources are never dimmed by distance.
    x = 3 * w;
    ctx.fillStyle = 'hsl(28, 24%, 36%)';
    ctx.fillRect(x + 28, h - 34, 8, 32);
    ctx.fillStyle = 'hsl(28, 20%, 44%)';
    ctx.fillRect(x + 18, h - 40, 28, 8);
    ellipse(x + 32, h - 46, 14, 8, 'hsl(30, 30%, 48%)');
    ellipse(x + 32, h - 54, 10, 12, 'hsl(36, 96%, 58%)');
    ellipse(x + 32, h - 58, 6, 9, 'hsl(52, 100%, 74%)');
    ellipse(x + 32, h - 60, 3, 5, 'hsl(58, 100%, 90%)');

    return canvas;
}

/** Where each piece of scenery stands, in cells. */
export interface Placement {
    kind: number;
    x: number;
    y: number;
}

/**
 * Scenery down both sides of the hall, and a brazier at every pillar.
 *
 * Deterministic: the same hall comes back every run, so a screenshot means
 * something the next time it is taken.
 */
export function placeScenery(): Placement[] {
    const out: Placement[] = [];
    for (let x = 6; x < MAP_SIZE - 6; x += 4) {
        out.push({ kind: 3, x: x + 0.5, y: 15.5 });
        out.push({ kind: 3, x: x + 0.5, y: 25.5 });
        out.push({ kind: 0, x: x + 0.5, y: 12.5 });
        out.push({ kind: 0, x: x + 0.5, y: 28.5 });
    }
    for (let x = 8; x < MAP_SIZE - 8; x += 6) {
        out.push({ kind: 1, x: x + 0.5, y: 18.5 });
        out.push({ kind: 2, x: x + 1.5, y: 22.5 });
        out.push({ kind: 1, x: x + 3.5, y: 22.5 });
        out.push({ kind: 2, x: x + 2.5, y: 18.5 });
    }
    for (let x = 4; x < MAP_SIZE - 4; x += 8) {
        out.push({ kind: 2, x: x + 1.5, y: 6.5 });
        out.push({ kind: 1, x: x + 1.5, y: 33.5 });
    }
    return out;
}
