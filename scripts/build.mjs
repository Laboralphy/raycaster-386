import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * esbuild strips types only; it does NOT type-check.
 * Run `npm run typecheck` (tsc --noEmit) as a separate step.
 * `target: es2022` keeps ?./??/class fields native instead of downleveled.
 */
const common = {
    entryPoints: { index: 'src/index.ts', engine: 'src/engine/index.ts' },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    tsconfig: 'tsconfig.json'
};

/**
 * The renderer and the engine layer are separate bundles: a project that only
 * needs rendering should not pull in door simulation, and the split keeps the
 * dependency direction visible.
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
