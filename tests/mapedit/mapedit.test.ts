import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertMapEditLevel, MAPEDIT_1, mapEditVersionOf } from '../../src/mapedit/index.js';
import type { ImageAppender, MapEditLevel } from '../../src/mapedit/index.js';

/** A stub appender: reports what it was asked to combine, touches no image. */
const stub: ImageAppender = (tiles, start, count) =>
    Promise.resolve({
        src: `stub/${String(tiles[start].content)}+${count}`,
        width: tiles[start].width,
        height: tiles[start].height
    });

/** The smallest save that converts: one wall, one flat, one block, one cell. */
function minimal(): MapEditLevel {
    const light = { enabled: false, value: 0, inner: 0, outer: 0 };
    return {
        tiles: {
            walls: [{ id: 1, type: 'wall', content: 'w.png', width: 64, height: 96, animation: null }],
            flats: [{ id: 2, type: 'flat', content: 'f.png', width: 64, height: 64, animation: null }],
            sprites: []
        },
        blocks: [{
            id: 1, ref: '', phys: 1, offs: 0, light,
            faces: { n: 1, e: 1, w: 1, s: 1, f: 2, c: 2 }
        }],
        things: [],
        grid: [[{ block: 1, upperblock: 0, tags: [], things: [] }]],
        metrics: { tileWidth: 64, tileHeight: 96 },
        flags: { smooth: false, stretch: false },
        ambiance: {
            sky: 'sky.png',
            fog: { distance: 50, color: '#000000' },
            filter: { enabled: false, color: '' },
            brightness: 0
        },
        actor: { startpoint: 0, thinker: 'Thinker' },
        startpoints: [{ x: 0, y: 0, angle: 0.5 }]
    };
}

describe('MapEdit save versions', () => {
    it('reads a file with no version as MAPEDIT-1', () => {
        // The editor that produced every existing save wrote no version field,
        // so absent has to mean the original format rather than an error.
        expect(mapEditVersionOf(minimal())).toBe(MAPEDIT_1);
    });

    it('accepts the version written out explicitly', () => {
        expect(mapEditVersionOf({ ...minimal(), version: MAPEDIT_1 })).toBe(MAPEDIT_1);
    });

    it('refuses a version it does not know rather than guessing', async () => {
        // A future editor format must fail loudly here, not be half-converted
        // into a level that loads and then behaves wrongly.
        const level = { ...minimal(), version: 'MAPEDIT-2' };
        expect(() => mapEditVersionOf(level)).toThrow(/unknown save version/);
        await expect(convertMapEditLevel(level, stub)).rejects.toThrow(/unknown save version/);
    });
});

describe('convertMapEditLevel', () => {
    it('produces a document that declares RCE-100', async () => {
        const out = await convertMapEditLevel(minimal(), stub);
        expect(out.version).toBe('RCE-100');
        expect(out).toHaveProperty('level');
        expect(out).toHaveProperty('shading');
        expect(out).toHaveProperty('objects');
        expect(out).toHaveProperty('decals');
    });

    it('requires an image appender', async () => {
        await expect(
            convertMapEditLevel(minimal(), undefined as unknown as ImageAppender)
        ).rejects.toThrow(/image appender/);
    });

    it('resolves phys indexes to symbols and tile ids to atlas positions', async () => {
        const out = await convertMapEditLevel(minimal(), stub);
        const level = out.level as Record<string, unknown>;
        const legend = level.legend as Record<string, unknown>[];
        expect(legend[0].phys).toBe('@PHYS_WALL');
        // Position in the atlas, not the editor's tile id (which is 1 and 2).
        expect((legend[0].faces as Record<string, unknown>).n).toBe(0);
        expect((legend[0].faces as Record<string, unknown>).f).toBe(0);
    });

    it('omits the upper storey unless a cell declares one', async () => {
        const flat = await convertMapEditLevel(minimal(), stub);
        expect(flat.level).not.toHaveProperty('uppermap');

        const two = minimal();
        two.grid[0][0].upperblock = 1;
        const storeyed = await convertMapEditLevel(two, stub);
        expect(storeyed.level).toHaveProperty('uppermap');
    });

    it('turns a start point half-turn into radians', async () => {
        const out = await convertMapEditLevel(minimal(), stub);
        const [start] = out.startpoints as Record<string, unknown>[];
        expect(start.angle).toBeCloseTo(Math.PI / 2);
        expect(start.z).toBe(1);
    });

    it('refuses a level with no wall or no flat', async () => {
        // The legend is built before the textures — as upstream — so a block
        // that still references a missing tile is reported by the face check
        // first. These guards are reached only when nothing references them.
        const noWalls = minimal();
        noWalls.tiles.walls = [];
        noWalls.blocks[0].faces = { n: null, e: null, w: null, s: null, f: 2, c: 2 };
        await expect(convertMapEditLevel(noWalls, stub)).rejects.toThrow(/no wall tile/);

        const noFlats = minimal();
        noFlats.tiles.flats = [];
        noFlats.blocks[0].faces = { n: 1, e: 1, w: 1, s: 1, f: null, c: null };
        await expect(convertMapEditLevel(noFlats, stub)).rejects.toThrow(/no flat tile/);
    });

    it('names the dangling reference rather than failing obscurely', async () => {
        const bad = minimal();
        bad.blocks[0].faces.n = 99;
        await expect(convertMapEditLevel(bad, stub)).rejects.toThrow(/wall tile "99"/);
    });

    it('names the tileset whose animation runs past the end of the list', async () => {
        // The original let `undefined` reach the caller's image appender, which
        // then failed with a message naming neither the tileset nor the cause.
        const bad = minimal();
        bad.tiles.sprites = [{
            id: 5, type: 'sprite', content: 's.png', width: 32, height: 64,
            animation: { frames: 3, duration: 100, loop: 1 }
        }];
        await expect(convertMapEditLevel(bad, stub))
            .rejects.toThrow(/tileset "5" declares 3 animation frames, but only 1/);
    });

    it('keeps a configured sprite filter, which the original dropped', async () => {
        // `a.filter.enabled && a.filter.length > 0` tested `length` on an
        // object, so it was always false and the filter never reached RCE-100.
        const tinted = minimal();
        tinted.ambiance.filter = { enabled: true, color: '#ff8800' };
        const out = await convertMapEditLevel(tinted, stub);
        expect((out.shading as Record<string, unknown>).filter).toBe('#ff8800');
    });
});

describe('the library never imports the compiler', () => {
    it('keeps src/mapedit out of every other source file', () => {
        // The whole reason this lives in its own entry point: the engine reads
        // RCE-100 and must not learn the editor's shape, or the editor's
        // format could not change without changing the engine.
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = resolve(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'mapedit') {
                        walk(path);
                    }
                } else if (entry.name.endsWith('.ts')) {
                    if (/from\s+'[^']*mapedit/.test(readFileSync(path, 'utf8'))) {
                        offenders.push(path);
                    }
                }
            }
        };
        walk(resolve(__dirname, '../../src'));
        expect(offenders).toEqual([]);
    });
});
