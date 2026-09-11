/**
 * Converts a MapEdit save file into RCE-100, which is what `loadLevel` reads.
 *
 *     node scripts/convert-mapedit-level.mjs demos/dark-village
 *
 * The editor saves its own shape — unmerged tiles, per-tile identity, room for
 * undo — and RCE-100 is the *build artifact* made from it: atlases merged,
 * animation frames concatenated, phys and loop codes resolved to `@PHYS_*`
 * strings. See documentation/MAPEDIT_ANALYSIS.md.
 *
 * The conversion itself is the original engine's `libs/generate`, used
 * unmodified so the output is known-good. That lives in `_OLD_PROJECT_`, which
 * is gitignored, so **this script only runs where the legacy tree is present**
 * — which is why its output is committed rather than generated at build time.
 *
 * Note that `demos/dark-village` no longer carries its sources: only the
 * conversion's output is committed, so that demo cannot be re-converted
 * without re-importing the MapEdit save and its tiles.
 *
 * `generate` performs no image work itself: it asks an appender to combine
 * tiles, and this supplies one over @napi-rs/canvas. The browser editor's own
 * appender (`apps/mapedit/src/libs/append-images`) lays frames out left to
 * right and reports the *frame* size rather than the sheet size; this matches
 * it exactly, and returns a written file path instead of a data URI so the
 * level JSON stays small.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const LEGACY = resolve('_OLD_PROJECT_/libs/generate/index.js');

const demoDir = process.argv[2];
if (!demoDir) {
    console.error('usage: node scripts/convert-mapedit-level.mjs <demo-dir> [level.json]');
    process.exit(1);
}
const assets = resolve(demoDir, 'assets');
const source = resolve(process.argv[3] ?? join(assets, 'levels/level-1.json'));
const tilesDir = join(assets, 'tiles');
const outDir = join(assets, 'textures');
const outFile = join(assets, basename(source).replace(/\.json$/, '.rce.json'));

/**
 * Loads `generate` as CommonJS.
 *
 * It predates this package's `"type": "module"`, so Node reads its `.js` as
 * ESM and chokes on `module.exports`. Copying it to a `.cjs` outside the tree
 * is the least invasive fix: the legacy checkout is a read-only reference.
 */
function loadGenerate() {
    let src;
    try {
        src = readFileSync(LEGACY, 'utf8');
    } catch {
        console.error(
            `no legacy converter at ${LEGACY}\n` +
            'This script needs _OLD_PROJECT_, which is gitignored. Its output is ' +
            'committed, so you only need this to re-convert a changed level.'
        );
        process.exit(1);
    }
    const shim = join(tmpdir(), `rc386-generate-${process.pid}.cjs`);
    writeFileSync(shim, src);
    return createRequire(import.meta.url)(shim);
}

mkdirSync(outDir, { recursive: true });

/** Tracks what was written, so an atlas shared by two tilesets is built once. */
const written = new Map();

/**
 * Combines `count` tiles into one sheet, left to right.
 *
 * Returns the *frame* width and height rather than the sheet's — the renderer
 * slices the sheet by frame, so reporting the full width would make every
 * animation one frame long.
 */
async function appendImages(tilesets, start, count) {
    const names = [];
    for (let i = 0; i < count; ++i) {
        names.push(tilesets[start + i].content);
    }
    const key = names.join('|');
    const hit = written.get(key);
    if (hit) {
        return hit;
    }

    const canvases = await Promise.all(
        names.map(name => loadImage(readFileSync(join(tilesDir, name))))
    );
    if (canvases.length === 0) {
        throw new Error('no tile defined');
    }
    const w = canvases[0].width;
    const h = canvases[0].height;
    const sheet = createCanvas(w * count, h);
    const ctx = sheet.getContext('2d');
    for (let i = 0; i < count; ++i) {
        ctx.drawImage(canvases[i], i * w, 0);
    }

    const png = sheet.toBuffer('image/png');
    const name = `${createHash('sha1').update(png).digest('hex').slice(0, 32)}.png`;
    writeFileSync(join(outDir, name), png);
    const result = { src: `assets/textures/${name}`, width: w | 0, height: h | 0 };
    written.set(key, result);
    return result;
}

const generate = loadGenerate();
const input = JSON.parse(readFileSync(source, 'utf8'));

const data = await generate(input, appendImages);

// The sky is passed through by name rather than combined, so it is copied
// beside the atlases and repointed.
if (data.level.textures.sky) {
    const sky = data.level.textures.sky;
    copyFileSync(join(tilesDir, sky), join(outDir, sky));
    data.level.textures.sky = `assets/textures/${sky}`;
}

writeFileSync(outFile, JSON.stringify(data));

const sheets = new Set([...written.values()].map(v => v.src));
console.log(`${basename(source)} -> ${basename(outFile)}`);
console.log(`  ${data.level.map.length}x${data.level.map[0].length} cells, ` +
    `${data.level.legend.length} legend, ${data.tilesets.length} tilesets, ` +
    `${data.blueprints.length} blueprints`);
console.log(`  ${data.objects.length} objects, ${data.decals.length} decals, ` +
    `${data.tags.length} tags, ${data.lightsources.length} lightsources`);
console.log(`  ${sheets.size} atlases written to ${outDir}`);
