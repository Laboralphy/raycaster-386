import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import * as esbuild from 'esbuild';

/**
 * Builds and serves one demo from demos/.
 *
 *     npm run demo            # the default, demos/simple
 *     npm run demo -- lights  # demos/lights
 *
 * Each demo is a directory with index.html and main.ts; nothing else about
 * them is shared, so one can be rewritten without disturbing the others.
 */
const DEMOS = resolve('demos');
const available = () => readdirSync(DEMOS, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

const named = process.argv.slice(2).find(a => !a.startsWith('--'));
const demo = named ?? 'simple';
if (!existsSync(join(DEMOS, demo, 'main.ts'))) {
    console.error(`no demo "${demo}" in demos/. Available: ${available().join(', ')}`);
    process.exit(1);
}

const ROOT = resolve('demos', demo);
const PORT = Number(process.env.PORT ?? 8080);
const watch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: { demo: `demos/${demo}/main.ts` },
    outdir: `demos/${demo}/dist`,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    tsconfig: 'tsconfig.json'
};

if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
} else {
    await esbuild.build(buildOptions);
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8'
};

createServer(async (req, res) => {
    // Strip the query string and refuse anything that climbs out of the demo.
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    const file = resolve(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404).end('not found');
    }
}).listen(PORT, () => {
    console.log(`\n  ${demo} demo running at http://localhost:${PORT}/\n`);
});
