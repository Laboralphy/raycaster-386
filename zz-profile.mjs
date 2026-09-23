import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, createCanvas, Image, ImageData, loadImage } from '@napi-rs/canvas';

const g = globalThis;
g.HTMLCanvasElement = Canvas;
g.HTMLImageElement = Image;
g.Image = Image;
g.ImageData = ImageData;
g.document = { createElement: (t) => createCanvas(1, 1) };

const { Renderer, loadLevel, buildObjects } = await import('./dist/index.js');
const ROOT = resolve('demos/dark-village');
const image = async (src) => {
    const img = await loadImage(readFileSync(resolve(ROOT, src)));
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
};

const data = JSON.parse(readFileSync(resolve(ROOT, 'assets/level-1.rce.json'), 'utf8'));
const rc = new Renderer();
rc.setScreen({ width: 320, height: 200 });
const loaded = await loadLevel(rc, data, { loadImage: image });
await buildObjects(rc, loaded, { loadImage: image });
const sp = loaded.startpoint ?? { x: 4, y: 4, angle: 0 };
const x = (sp.x + 0.5) * 64, y = (sp.y + 0.5) * 64;

// Walk a circle so the frames are not all identical.
const N = 600;
for (let i = 0; i < 50; ++i) rc.render(x, y, 0, 1);
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; ++i) rc.render(x, y, (i / N) * Math.PI * 2, 1);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
console.log(`${ms.toFixed(3)} ms/frame  (${(1000 / ms).toFixed(0)} fps)`);
