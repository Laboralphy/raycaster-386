import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import * as esbuild from 'esbuild';

/**
 * Builds every demo in demos/ and serves each at its own route.
 *
 *     npm run demo               # http://localhost:8080/
 *     npm run demo -- --watch    # rebuild on change
 *
 * Each demo is a directory with index.html and main.ts; nothing else about
 * them is shared, so one can be rewritten without disturbing the others. That
 * independence is why they are served side by side rather than one per run:
 * comparing `simple` against `dark-village` is the quickest way to see what
 * loading a real level actually changes.
 */
const DEMOS = resolve('demos');
const PORT = Number(process.env.PORT ?? 8080);
const watch = process.argv.includes('--watch');

/** Every directory under demos/ that is actually a demo. */
const names = readdirSync(DEMOS, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(DEMOS, d.name, 'main.ts')))
    .map(d => d.name)
    .sort();

if (names.length === 0) {
    console.error('no demos in demos/: each needs an index.html and a main.ts');
    process.exit(1);
}

const options = name => ({
    entryPoints: { demo: `demos/${name}/main.ts` },
    outdir: `demos/${name}/dist`,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    tsconfig: 'tsconfig.json'
});

for (const name of names) {
    if (watch) {
        const ctx = await esbuild.context(options(name));
        await ctx.watch();
    } else {
        await esbuild.build(options(name));
    }
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml'
};

/** The root page: one link per demo. */
function index() {
    const links = names
        .map(n => `<li><a href="/${n}/">${n}</a></li>`)
        .join('\n            ');
    return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>raycaster-386 demos</title>
        <style>
            :root { color-scheme: dark; }
            body {
                margin: 0; min-height: 100vh; display: flex;
                flex-direction: column; align-items: center; justify-content: center;
                gap: 12px; background: #14161a; color: #c8ccd4;
                font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            }
            ul { list-style: none; padding: 0; }
            li { margin: 6px 0; }
            a { color: #d8a657; }
        </style>
    </head>
    <body>
        <h1>raycaster-386</h1>
        <ul>
            ${links}
        </ul>
    </body>
</html>
`;
}

createServer(async (req, res) => {
    // Strip the query string, then split the demo name off the front.
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (path === '/') {
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        res.end(index());
        return;
    }

    const [, name, ...rest] = path.split('/');
    if (!names.includes(name)) {
        res.writeHead(404).end('not found');
        return;
    }
    // A demo's own pages fetch their assets relatively, so the trailing slash
    // is load-bearing: without it `assets/x.png` would resolve one level up.
    if (rest.length === 0) {
        res.writeHead(302, { location: `/${name}/` }).end();
        return;
    }

    const root = join(DEMOS, name);
    const file = resolve(join(root, rest.join('/') || 'index.html'));
    if (!file.startsWith(root)) {
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
    console.log(`\n  http://localhost:${PORT}/`);
    for (const name of names) {
        console.log(`    /${name}/`);
    }
    console.log();
});
