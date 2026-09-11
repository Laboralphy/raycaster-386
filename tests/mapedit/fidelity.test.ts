import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertMapEditLevel } from '../../src/mapedit/index.js';
import type { ImageAppender, MapEditLevel } from '../../src/mapedit/index.js';

const DEMO = resolve(__dirname, '../../demos/dark-village/assets');
const SOURCE = resolve(DEMO, 'levels/level-1.json');
const EXPECTED = resolve(DEMO, 'level-1.rce.json');

const hasSource = existsSync(SOURCE);

/**
 * Counts calls instead of touching an image.
 *
 * Everything this converter does but merging is pure data, and merging is the
 * injected part — so a stub covers the whole port and the comparison below
 * only has to mask the paths a real appender would have produced.
 */
const stub: ImageAppender = (tiles, start, count) =>
    Promise.resolve({ src: `<sheet:${count}>`, width: tiles[start].width, height: tiles[start].height });

/** Blanks what the appender produced, and the preview path repointed by hand. */
function mask(doc: Record<string, unknown>): Record<string, unknown> {
    const d = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    for (const ts of d.tilesets as Record<string, unknown>[]) {
        ts.src = '<src>';
    }
    const level = d.level as Record<string, unknown>;
    const textures = level.textures as Record<string, unknown>;
    textures.walls = '<src>';
    textures.flats = '<src>';
    textures.sky = String(textures.sky).replace(/^assets\/textures\//, '');
    d.preview = String(d.preview).replace(/^assets\/textures\//, '');
    return d;
}

/**
 * The port against the original, on a real level.
 *
 * `level-1.rce.json` was produced by the original engine's `libs/generate`
 * (CommonJS, 521 lines) from `levels/level-1.json`, before any of this was
 * ported. Converting the same save with `src/mapedit` has to reproduce it
 * exactly — 52 tilesets, 43 blueprints, 53 legend entries, 63 objects, 32
 * decals, a 59x59 grid with an upper storey.
 *
 * This is the one test that proves *fidelity* rather than plausibility, and it
 * is the reason to keep the save committed: once `_OLD_PROJECT_` is gone, this
 * pair is the only remaining evidence that the port matches what it replaced.
 *
 * If the save is missing this suite skips, and `tests/harness/announce.ts`
 * prints a banner saying so — a skipped suite is a number in the summary and
 * nothing else, which reads exactly like a full run.
 */
describe.skipIf(!hasSource)('the TypeScript converter matches the original', () => {
    it('reproduces the committed RCE-100 field for field', async () => {
        const input = JSON.parse(readFileSync(SOURCE, 'utf8')) as MapEditLevel;
        const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Record<string, unknown>;
        const actual = await convertMapEditLevel(input, stub);

        expect(mask(actual)).toEqual(mask(expected));
    });

    it('emits the same keys in the same order', async () => {
        // Order matters for a byte-identical artefact, and it is free to keep:
        // it only costs building the object in the order the original did.
        const input = JSON.parse(readFileSync(SOURCE, 'utf8')) as MapEditLevel;
        const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Record<string, unknown>;
        const actual = await convertMapEditLevel(input, stub);
        expect(Object.keys(actual)).toEqual(Object.keys(expected));
        expect(Object.keys(actual.level as object)).toEqual(Object.keys(expected.level as object));
    });

    it('reads the real save as MAPEDIT-1, which carries no version field', async () => {
        const input = JSON.parse(readFileSync(SOURCE, 'utf8')) as MapEditLevel;
        expect(input.version).toBeUndefined();
        await expect(convertMapEditLevel(input, stub)).resolves.toBeDefined();
    });
});
