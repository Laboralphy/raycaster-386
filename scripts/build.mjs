import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const outdirArg = process.argv.find(arg => arg.startsWith('--outdir='));
const outdir = outdirArg ? outdirArg.slice('--outdir='.length) : 'dist';

/**
 * esbuild strips types only; it does NOT type-check.
 * Run `npm run typecheck` (tsc --noEmit) as a separate step.
 * `target: es2022` keeps ?./??/class fields native instead of downleveled.
 *
 * Rendering, simulation and the level schema are separate entry points: a
 * project that only needs rendering should not pull in door simulation, and
 * one that does not validate levels at load time should not pay for 22 kB of
 * schema. The split also keeps the dependency direction visible.
 *
 * `splitting` is a correctness setting, not an optimisation. Without it every
 * entry point carries its own copy of src/core, a `Vector` imported from the
 * root is not the `Vector` the simulation tests with `instanceof`, and
 * `dummy.position = v` stores the vector object itself in `x`.
 * tests/build/bundles.test.ts pins this.
 *
 * No minified build: bundlers minify, and the exports map never exposed one.
 *
 * The output directory is emptied first, so hashed chunks from an earlier
 * build cannot end up in the package. `npm run types` writes declarations
 * into dist/ afterwards, which is the order `prepublishOnly` runs them in.
 */
const options = {
    entryPoints: {
        index: 'src/index.ts',
        simulation: 'src/simulation/index.ts',
        schema: 'src/level/schema.ts'
    },
    outdir,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    tsconfig: 'tsconfig.json'
};

rmSync(outdir, { recursive: true, force: true });

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('watching...');
} else {
    await esbuild.build(options);
}
