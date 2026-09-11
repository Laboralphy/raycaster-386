import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { loadLevel, resolveConstant, resolveConstants } from '../../src/index.js';
import type { RceLevel } from '../../src/index.js';
import { Renderer } from '../../src/Renderer.js';
import { installDom } from '../harness/dom.js';

/**
 * Real levels, vendored into the repo rather than read out of the legacy tree.
 *
 * These are RCE-100 build artifacts whose MapEdit sources no longer exist
 * anywhere, so they are input fixtures only — see the README beside them.
 * Vendoring is what lets this file run in full on a fresh clone; it used to
 * skip most of itself while still reporting as a passed file.
 */
const MANSION = resolve(__dirname, '../fixtures/mansion');
const LEVELS = ['mans-test-ai', 'mans-cabin', 'mans-level-1', 'mans-test1'];

/** Loads a texture from the mansion game's asset tree. */
async function mansionImage(src: string): Promise<HTMLCanvasElement> {
    const image = await loadImage(readFileSync(resolve(MANSION, src)));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas as unknown as HTMLCanvasElement;
}

function level(name: string): RceLevel {
    return JSON.parse(readFileSync(resolve(MANSION, 'assets/levels', `${name}.json`), 'utf8')) as RceLevel;
}

describe('level constants', () => {
    it('resolves every symbol a real level uses', () => {
        // The set actually present across the shipped mansion levels.
        for (const name of [
            '@PHYS_WALL', '@PHYS_NONE', '@PHYS_TRANSPARENT_BLOCK', '@PHYS_DOOR_DOUBLE',
            '@PHYS_SECRET_BLOCK', '@PHYS_OFFSET_BLOCK', '@PHYS_INVISIBLE_BLOCK',
            '@PHYS_DOOR_UP', '@PHYS_DOOR_RIGHT',
            '@LOOP_FORWARD', '@LOOP_YOYO', '@LOOP_NONE',
            '@FX_LIGHT_SOURCE', '@FX_LIGHT_ADD',
            '@DECAL_ALIGN_CENTER', '@DECAL_ALIGN_LEFT', '@DECAL_ALIGN_RIGHT'
        ]) {
            expect(typeof resolveConstant(name), name).toBe('number');
        }
    });

    it('rejects an unknown constant rather than passing it through', () => {
        // The original's translator was non-strict: a typo stayed a string and
        // produced a level that loaded and then behaved wrongly.
        expect(() => resolveConstant('@PHYS_WALLL')).toThrow(/unknown constant/);
    });

    it('resolves nested structures without touching the original', () => {
        const source = {
            phys: '@PHYS_WALL',
            faces: { n: [19, 4, 120, '@LOOP_FORWARD'], e: null },
            ref: 'plain string',
            n: 7
        };
        const out = resolveConstants(source);
        expect(out).toEqual({
            phys: 1,
            faces: { n: [19, 4, 120, 1], e: null },
            ref: 'plain string',
            n: 7
        });
        expect(source.phys).toBe('@PHYS_WALL');
    });
});

describe('loadLevel against the shipped mansion levels', () => {
    it.each(LEVELS)('loads %s with its real textures', async name => {
        installDom();
        const data = level(name);
        const rc = new Renderer();
        rc.setScreen({ width: 160, height: 100 });

        const loaded = await loadLevel(rc, data, { loadImage: mansionImage });

        expect(rc.getMapSize()).toBe(data.level.map.length);
        expect(loaded.materials.length).toBe(data.level.legend.length);
        expect(loaded.lightsources.length).toBe(data.lightsources?.length ?? 0);
        // Only tilesets a decal actually refers to get built.
        expect(loaded.tilesets.size).toBeLessThanOrEqual(data.tilesets?.length ?? 0);
        // Entity-tier sections are reported, not silently dropped.
        expect(loaded.unhandled.objects.length).toBe(data.objects?.length ?? 0);
        expect(loaded.unhandled.tags.length).toBe(data.tags?.length ?? 0);

        // And it renders from the level's own start point.
        const sp = loaded.startpoint;
        expect(sp, 'no start point').not.toBeNull();
        const ps = data.level.metrics.spacing;
        rc.render(sp!.x * ps, sp!.y * ps, sp!.angle, sp!.z);

        const canvas = rc.renderCanvas!;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const colours = new Set<number>();
        for (let i = 0; i < px.length; i += 4) {
            colours.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        }
        expect(colours.size, `${name} rendered a flat fill`).toBeGreaterThan(200);
    }, 120_000);

    it('leaves the level object reusable after loading', async () => {
        installDom();
        const data = level('mans-test-ai');
        const before = JSON.stringify(data);
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        await loadLevel(rc, data, { loadImage: mansionImage });
        expect(JSON.stringify(data), 'loadLevel mutated its input').toBe(before);
    }, 60_000);

    it('rejects an unexpected version unless told not to', async () => {
        installDom();
        const data = { ...level('mans-test-ai'), version: 'RCE-999' };
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        await expect(loadLevel(rc, data, { loadImage: mansionImage })).rejects.toThrow(/RCE-100/);
        await expect(
            loadLevel(rc, data, { loadImage: mansionImage, ignoreVersion: true })
        ).resolves.toBeDefined();
    }, 60_000);
});

describe('the validate hook', () => {
    it('runs before the renderer is touched, on the level as written', async () => {
        installDom();
        const data = level('mans-test-ai');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });

        const seen: unknown[] = [];
        await loadLevel(rc, data, {
            loadImage: mansionImage,
            validate: d => {
                seen.push(d);
                // Validation sees the file as saved: symbols unresolved, so a
                // schema written against the format still applies.
                const legend = (d as RceLevel).level.legend[0];
                expect(typeof legend.phys).toBe('string');
                // And nothing has been built yet.
                expect(rc.getMapSize()).toBe(0);
            }
        });
        expect(seen.length).toBe(1);
    }, 60_000);

    it('aborts the load, leaving the renderer unconfigured', async () => {
        installDom();
        const data = level('mans-test-ai');
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });

        await expect(
            loadLevel(rc, data, {
                loadImage: mansionImage,
                validate: () => {
                    throw new Error('level.legend[0].phys is not a string');
                }
            })
        ).rejects.toThrow(/not a string/);
        expect(rc.getMapSize()).toBe(0);
    }, 60_000);

    it('runs ahead of the version gate, so its message is the one that surfaces', async () => {
        installDom();
        const data = { ...level('mans-test-ai'), version: 'RCE-999' };
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });

        await expect(
            loadLevel(rc, data, {
                loadImage: mansionImage,
                validate: () => {
                    throw new Error('schema says no');
                }
            })
        ).rejects.toThrow(/schema says no/);
    }, 60_000);
});

describe('the shipped RCE-100 schema', () => {
    it('is exported unmodified, on its own entry point', async () => {
        const { RCE_100_SCHEMA } = await import('../../src/level/schema.js');
        const schema = RCE_100_SCHEMA as { $schema?: string; required?: string[] };
        expect(schema.$schema).toBeDefined();
        // Left as upstream wrote it, entity-tier sections and all.
        expect(schema.required).toContain('level');
        expect(schema.required).toContain('blueprints');
    });

    it('is not pulled into the renderer bundle', async () => {
        const index = await import('../../src/index.js');
        expect('RCE_100_SCHEMA' in index).toBe(false);
    });
});
