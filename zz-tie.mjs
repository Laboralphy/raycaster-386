import { createCanvas } from '@napi-rs/canvas';

// A sprite sheet the shape of a real one: 28 frames, 16 shading layers.
const W = 64, H = 96, FRAMES = 28, LAYERS = 16;
const frame = createCanvas(W, H);
const fx = frame.getContext('2d');
for (let y = 0; y < H; ++y) {
    for (let x = 0; x < W; ++x) {
        fx.fillStyle = `rgb(${(x * 4) % 256}, ${(y * 3) % 256}, ${(x + y) % 256})`;
        fx.fillRect(x, y, 1, 1);
    }
}
const atlas = createCanvas(W * FRAMES, H * LAYERS);
const ax = atlas.getContext('2d');
for (let l = 0; l < LAYERS; ++l) {
    for (let f = 0; f < FRAMES; ++f) ax.drawImage(frame, f * W, l * H);
}

// Same content, alone in its own canvas: what an on-demand shaded frame is.
const lone = createCanvas(W, H);
lone.getContext('2d').drawImage(frame, 0, 0);

let worst = 0, totalDiff = 0, totalPx = 0, cases = 0;
for (const f of [0, 7, 13, 27]) {
    for (const shade of [0, 5, 11, 15]) {
        for (const scale of [0.37, 0.75, 1, 1.6, 2.4, 3.3, 5.1]) {
            const dw = Math.max(1, Math.round(W * scale));
            const dh = Math.max(1, Math.round(H * scale));
            const a = createCanvas(dw, dh), b = createCanvas(dw, dh);
            const actx = a.getContext('2d'), bctx = b.getContext('2d');
            actx.imageSmoothingEnabled = false;
            bctx.imageSmoothingEnabled = false;
            actx.drawImage(atlas, f * W, shade * H, W, H, 0, 0, dw, dh);
            bctx.drawImage(lone, 0, 0, W, H, 0, 0, dw, dh);
            const pa = actx.getImageData(0, 0, dw, dh).data;
            const pb = bctx.getImageData(0, 0, dw, dh).data;
            let diff = 0;
            for (let i = 0; i < pa.length; i += 4) {
                if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) ++diff;
            }
            const px = dw * dh;
            totalDiff += diff; totalPx += px; ++cases;
            const pct = (100 * diff) / px;
            if (pct > worst) worst = pct;
        }
    }
}
console.log(`${cases} sprite-shaped draws compared`);
console.log(`differing pixels: ${totalDiff}/${totalPx} (${((100 * totalDiff) / totalPx).toFixed(4)}%), worst case ${worst.toFixed(3)}%`);
