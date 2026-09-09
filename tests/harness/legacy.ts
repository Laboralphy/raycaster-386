import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Root of the original JavaScript engine, used only by differential tests.
 * Defaults to the copy imported into `_OLD_PROJECT_/`, so the tests need
 * nothing outside this project. Override with
 * LEGACY_ENGINE=/path/to/o876-raycaster-engine.
 */
export const LEGACY_ROOT = resolve(
    process.env.LEGACY_ENGINE ?? resolve(here, '../../_OLD_PROJECT_')
);

/** True if the original engine is checked out next to this project. */
export const hasLegacy = existsSync(resolve(LEGACY_ROOT, 'libs/raycaster/Renderer.js'));

const outDir = resolve(here, '../../node_modules/.legacy');

/**
 * Bundles a module from the original engine and imports it, so a port can be
 * differentially tested against the code it replaces.
 *
 * The originals are ESM with `export default` and pull in dependencies from
 * across libs/, so they have to go through a bundler before Node can load them.
 * The engine checkout has no node_modules, so its one external runtime
 * dependency is aliased to a local shim; `events` resolves to the Node builtin
 * via `platform: 'node'`.
 */
export async function importLegacy<T = unknown>(relPath: string): Promise<T> {
    const entry = resolve(LEGACY_ROOT, relPath);
    const outfile = resolve(outDir, relPath.replace(/[\\/]/g, '_').replace(/\.js$/, '.mjs'));
    mkdirSync(dirname(outfile), { recursive: true });
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile,
        alias: {
            '@laboralphy/grid': resolve(here, 'grid-shim.mjs')
        },
        logLevel: 'silent'
    });
    return (await import(`${outfile}?t=${Date.now()}`)) as T;
}
