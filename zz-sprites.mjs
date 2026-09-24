import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, createCanvas, Image, ImageData, loadImage } from '@napi-rs/canvas';
const g = globalThis;
g.HTMLCanvasElement = Canvas; g.HTMLImageElement = Image; g.Image = Image; g.ImageData = ImageData;
g.document = { createElement: () => createCanvas(1, 1) };
const { Renderer, loadLevel, buildObjects } = await import('./dist/index.js');
const ROOT = resolve('demos/dark-village');
const decode = async (src) => {
    const img = await loadImage(readFileSync(resolve(ROOT, src)));
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
};
const level = JSON.parse(readFileSync(resolve(ROOT, 'assets/level-1.rce.json'), 'utf8'));
const rc = new Renderer();
rc.setScreen({ width: 320, height: 200 });
const loaded = await loadLevel(rc, level, { loadImage: decode });
const placed = await buildObjects(rc, loaded, { loadImage: decode });
const sp = loaded.startpoint ?? { x: 4, y: 4 };
const x = (sp.x + 0.5) * 64, y = (sp.y + 0.5) * 64;
rc.render(x, y, 0, 1);

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const spriteSets = new Set(placed.map((p) => p.sprite.getTileSet()).filter(Boolean));
let spriteBytes = 0, frames = 0, shaded = 0;
for (const ts of spriteSets) {
    spriteBytes += ts.getMemoryUsage();
    const orig = ts.getOriginalImage();
    frames += Math.max(1, (orig.width / ts.tileWidth) | 0);
    if (ts.getShadingLayerCount() > 1) ++shaded;
}
console.log(`sprite tilesets ${spriteSets.size} (${shaded} shaded, ${spriteSets.size - shaded} light sources)`);
console.log(`sprite frames   ${frames}`);
console.log(`sprite memory   ${mb(spriteBytes)}  of ${mb(rc.getMemoryUsage().tilesets)} tilesets`);
console.log(`originals only  ${mb([...spriteSets].reduce((a, ts) => { const o = ts.getOriginalImage(); return a + o.width * o.height * 4; }, 0))}`);

let vis = 0, n = 36;
for (let i = 0; i < n; ++i) {
    const scene = rc.computeScene(x, y, (i / n) * Math.PI * 2, 1);
    // renderSprites runs during render(), so count placed sprites in view via a render pass
    rc.render(x, y, (i / n) * Math.PI * 2, 1);
    vis += scene.zbuffer.filter((s) => s[3] > 1).length;
}
console.log(`sprite draws/frame (during raycast pass): ${(vis / n).toFixed(1)}`);
