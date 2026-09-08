import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, rgba } from '../../src/core/Rainbow.js';
import { hasLegacy, importLegacy, LEGACY_ROOT } from '../harness/legacy.js';

interface LegacyRainbow {
    parse(s: string): { r: number; g: number; b: number; a: number };
    rgba(s: string): string;
}

/** Every colour name declared in the original's table. */
function legacyColorNames(): string[] {
    const src = readFileSync(resolve(LEGACY_ROOT, 'libs/rainbow/Rainbow.js'), 'utf8');
    const table = src.slice(src.indexOf('const COLORS = {'), src.indexOf('};'));
    return [...table.matchAll(/^\s*([a-z]+)\s*:/gm)].map(m => m[1]);
}

/**
 * The 148-entry colour table was transcribed mechanically out of the original;
 * this proves the transcription entry by entry, plus the parser around it.
 */
describe.skipIf(!hasLegacy)('Rainbow vs original', () => {
    it('parses every named colour identically', async () => {
        const { default: Legacy } = await importLegacy<{ default: LegacyRainbow }>(
            'libs/rainbow/Rainbow.js'
        );
        const names = legacyColorNames();
        expect(names.length).toBe(148);
        for (const name of names) {
            expect(parse(name), name).toEqual(Legacy.parse(name));
        }
    });

    it('parses hex and functional notations identically', async () => {
        const { default: Legacy } = await importLegacy<{ default: LegacyRainbow }>(
            'libs/rainbow/Rainbow.js'
        );
        const samples = [
            '#000', '#fff', '#f80', '#123', 'abc',
            '#123456', 'abcdef', '#FFFFFF', '#00FF00',
            'rgb(0, 0, 0)', 'rgb(1, 2, 3)', 'rgb(255, 128, 64)',
            'rgba(10, 20, 30, 0.5)', 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 0)'
        ];
        for (const s of samples) {
            expect(parse(s), s).toEqual(Legacy.parse(s));
        }
    });

    it('renders rgba() strings identically', async () => {
        const { default: Legacy } = await importLegacy<{ default: LegacyRainbow }>(
            'libs/rainbow/Rainbow.js'
        );
        for (const s of ['black', 'white', '#804020', 'rgba(1, 2, 3, 0.25)', 'forestgreen']) {
            expect(rgba(s), s).toBe(Legacy.rgba(s));
        }
    });
});
