import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The shipped bundles, imported the way a consumer imports them.
 *
 * Every other test imports src/, where each module exists exactly once. dist/
 * is different: esbuild bundles each entry point, and without code splitting
 * src/core is copied into every one of them. A `Vector` from the root entry
 * then fails the simulation's `instanceof Vector`, and `dummy.position = v`
 * quietly stores the vector object in `x`. Nothing that imports src/ can see
 * that, so this builds the real bundles into a temporary directory.
 */

const ROOT = resolve(import.meta.dirname, '../..');
let outdir: string;

beforeAll(() => {
    outdir = mkdtempSync(join(tmpdir(), 'raycaster-386-dist-'));
    execFileSync(process.execPath, ['scripts/build.mjs', `--outdir=${outdir}`], {
        cwd: ROOT,
        stdio: 'pipe',
    });
});

afterAll(() => {
    rmSync(outdir, { recursive: true, force: true });
});

function load(entry: string) {
    return import(/* @vite-ignore */ pathToFileURL(join(outdir, `${entry}.js`)).href);
}

describe('dist bundles', () => {
    it('share one copy of core between the root and simulation entry points', async () => {
        const root = await load('index');
        const simulation = await load('simulation');

        const dummy = new simulation.Dummy();
        expect(dummy.position.constructor).toBe(root.Vector);

        dummy.position = new root.Vector(3, 4);
        expect([dummy.position.x, dummy.position.y]).toEqual([3, 4]);
    });
});
