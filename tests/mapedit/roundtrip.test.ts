import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { Renderer, loadLevel } from '../../src/index.js';
import type { RceLevel } from '../../src/index.js';
import { convertMapEditLevel } from '../../src/mapedit/index.js';
import type { ImageAppender, MapEditLevel, MapEditTile } from '../../src/mapedit/index.js';
import { installDom } from '../harness/dom.js';

/** A solid tile of a given colour, as the editor's unmerged sources are. */
function tile(w: number, h: number, fill: string): HTMLCanvasElement {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    return c as unknown as HTMLCanvasElement;
}

const SOURCES: Record<string, HTMLCanvasElement> = {
    'w.png': tile(64, 96, '#c82828'),
    'f.png': tile(64, 64, '#28c828'),
    's0.png': tile(32, 64, '#2828c8'),
    's1.png': tile(32, 64, '#3c3cdc'),
    'sky.png': tile(64, 64, '#0a0a1e')
};

/**
 * The appender, over canvases held in memory.
 *
 * Same contract the CLI and a browser editor use — frames left to right,
 * *frame* dimensions reported — which is the point of it being injected.
 */
const sheets = new Map<string, HTMLCanvasElement>();
const append: ImageAppender = (tiles: readonly MapEditTile[], start, count) => {
    const names = Array.from({ length: count }, (_, i) => tiles[start + i].content);
    const first = SOURCES[names[0]];
    const sheet = createCanvas(first.width * count, first.height);
    const ctx = sheet.getContext('2d');
    names.forEach((name, i) => ctx.drawImage(SOURCES[name] as never, i * first.width, 0));
    const src = `mem/${names.join('+')}`;
    sheets.set(src, sheet as unknown as HTMLCanvasElement);
    return Promise.resolve({ src, width: first.width, height: first.height });
};

function save(): MapEditLevel {
    const dark = { enabled: false, value: 0, inner: 0, outer: 0 };
    const cell = (block: number, extra: Partial<MapEditLevel['grid'][0][0]> = {}) =>
        ({ block, upperblock: 0, tags: [], things: [], ...extra });
    return {
        tiles: {
            walls: [{ id: 1, type: 'wall', content: 'w.png', width: 64, height: 96, animation: null }],
            flats: [{ id: 2, type: 'flat', content: 'f.png', width: 64, height: 64, animation: null }],
            // An animated tileset's frames are the entries that follow it,
            // so a two-frame animation declares two tiles.
            sprites: [
                { id: 10, type: 'sprite', content: 's0.png', width: 32, height: 64,
                    animation: { frames: 2, duration: 120, loop: 1 } },
                { id: 11, type: 'sprite', content: 's1.png', width: 32, height: 64,
                    animation: null }
            ]
        },
        blocks: [
            { id: 1, ref: 'wall', phys: 1, offs: 0, light: dark,
                faces: { n: 1, e: 1, w: 1, s: 1, f: null, c: null } },
            { id: 2, ref: 'floor', phys: 0, offs: 0, light: dark,
                faces: { n: null, e: null, w: null, s: null, f: 2, c: 2 } }
        ],
        things: [{ id: 10, ref: 'torch', size: 8, opacity: 0, ghost: false, tangible: false,
            light: { enabled: true, value: 0.6, inner: 24, outer: 110 }, tile: 10 }],
        grid: [
            [cell(1), cell(1), cell(1), cell(1)],
            [cell(1), cell(2, { things: [{ id: 10, x: 1, y: 1 }] }), cell(2), cell(1)],
            [cell(1), cell(2), cell(2), cell(1)],
            [cell(1), cell(1), cell(1), cell(1)]
        ],
        metrics: { tileWidth: 64, tileHeight: 96 },
        flags: { smooth: false, stretch: false },
        ambiance: {
            sky: 'sky.png',
            fog: { distance: 50, color: '#000000' },
            filter: { enabled: false, color: '' },
            brightness: 0
        },
        actor: { startpoint: 0, thinker: 'IntroThinker' },
        startpoints: [{ x: 1, y: 1, angle: 0.5 }]
    };
}

/**
 * The converter's real contract: what it emits must load.
 *
 * Schema shape is not enough — `loadLevel` resolves every `@PHYS_*` and
 * `@LOOP_*` symbol, indexes each face into the atlas it was told about, and
 * builds the sprites. A converter that produced plausible-looking JSON with a
 * wrong tile index would pass a schema check and fail here.
 */
describe('a converted level loads into the renderer', () => {
    it('round-trips a save through the converter and into loadLevel', async () => {
        installDom();
        sheets.clear();
        const data = (await convertMapEditLevel(save(), append)) as unknown as RceLevel;

        const rc = new Renderer();
        rc.setScreen({ width: 160, height: 100 });
        const loaded = await loadLevel(rc, data, {
            loadImage: (src: string) => {
                const sheet = sheets.get(src) ?? SOURCES[src];
                if (sheet === undefined) {
                    throw new Error(`converted level names an unknown texture: ${src}`);
                }
                return Promise.resolve(sheet);
            }
        });

        expect(rc.getMapSize()).toBe(4);
        expect(loaded.materials.length).toBe(2);
        expect(loaded.startpoint).toEqual({ x: 1, y: 1, z: 1, angle: Math.PI / 2 });
        expect(loaded.unhandled.blueprints.length).toBe(1);
        expect(loaded.unhandled.objects.length).toBe(1);

        // And it renders, which proves the atlas indexes actually resolve.
        rc.render(1.5 * 64, 1.5 * 64, 0, 1);
        expect(rc.renderCanvas).not.toBeNull();
    });

    it('reads the sky the save names', async () => {
        installDom();
        sheets.clear();
        const data = (await convertMapEditLevel(save(), append)) as unknown as RceLevel;
        expect(data.level.textures.sky).toBe('sky.png');
    });
});
