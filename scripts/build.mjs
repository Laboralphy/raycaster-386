import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * esbuild strips types only; it does NOT type-check.
 * Run `npm run typecheck` (tsc --noEmit) as a separate step.
 * `target: es2022` keeps ?./??/class fields native instead of downleveled.
 */
const common = {
    entryPoints: {
        index: 'src/index.ts',
        engine: 'src/engine/index.ts',
        schema: 'src/level/schema.ts'
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    tsconfig: 'tsconfig.json'
};

/**
 * The renderer, the engine layer and the level schema are separate bundles: a
 * project that only needs rendering should not pull in door simulation, and
 * one that does not validate levels at load time should not pay for 22 kB of
 * schema. The split also keeps the dependency direction visible.
 */
const builds = [
    { ...common, outdir: 'dist', entryNames: '[name]' },
    { ...common, outdir: 'dist', entryNames: '[name].min', minify: true }
];

if (watch) {
    const ctxs = await Promise.all(builds.map(b => esbuild.context(b)));
    await Promise.all(ctxs.map(c => c.watch()));
    console.log('watching...');
} else {
    await Promise.all(builds.map(b => esbuild.build(b)));
}
