import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, createCanvas, Image, ImageData, loadImage } from '@napi-rs/canvas';

/**
 * Per-phase frame timings for the dark-village level, under Node.
 *
 *     npm run build && npm run profile
 *
 * The companion to the demo's P key, which measures the same phases in a
 * browser. Run both: this rasterises on the CPU through skia, a browser hands
 * the drawing to the GPU, and they do not agree about what a frame costs. The
 * phases are described in src/render/Profiler.ts, including why measuring them
 * at all takes two deliberate stalls.
 */
const ROOT = resolve('demos/dark-village');
const WIDTH = Number(process.env.WIDTH ?? 320);
const HEIGHT = Number(process.env.HEIGHT ?? 200);
const FRAMES = Number(process.env.FRAMES ?? 300);

const g = globalThis;
g.HTMLCanvasElement = Canvas;
g.HTMLImageElement = Image;
g.Image = Image;
g.ImageData = ImageData;
g.document = { createElement: () => createCanvas(1, 1) };

const { Renderer, Profiler, buildObjects, loadLevel } = await import('../dist/index.js');

const decode = async (src) => {
    const image = await loadImage(readFileSync(resolve(ROOT, src)));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
};

const level = JSON.parse(readFileSync(resolve(ROOT, 'assets/level-1.rce.json'), 'utf8'));
const rc = new Renderer();
rc.setScreen({ width: WIDTH, height: HEIGHT });
const loaded = await loadLevel(rc, level, { loadImage: decode });
await buildObjects(rc, loaded, { loadImage: decode });

const start = loaded.startpoint ?? { x: 4, y: 4 };
const x = (start.x + 0.5) * 64;
const y = (start.y + 0.5) * 64;
// A slow turn on the spot, so the frames differ without the walk mattering.
const pose = (i) => [x, y, (i / FRAMES) * Math.PI * 2, 1];

for (let i = 0; i < 50; ++i) {rc.render(...pose(i));}

const t0 = process.hrtime.bigint();
for (let i = 0; i < FRAMES; ++i) {rc.render(...pose(i));}
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / FRAMES;

const profiler = new Profiler();
rc.profiler = profiler;
for (let i = 0; i < FRAMES; ++i) {rc.render(...pose(i));}

const memory = rc.getMemoryUsage();
console.log(`${WIDTH}x${HEIGHT}  ${ms.toFixed(3)} ms/frame unprofiled (${(1000 / ms).toFixed(0)} fps)`);
console.log(`textures ${(memory.total / 1048576).toFixed(1)} MB\n`);
console.log(profiler.format());
