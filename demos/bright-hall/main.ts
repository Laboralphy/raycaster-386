import { FX_LIGHT_SOURCE, MapHelper, PHYS_NONE, Profiler, Renderer } from '../../src';
import {
    METRICS,
    RESOLUTIONS,
    SHADING,
    SPRITE_HEIGHT,
    SPRITE_WIDTH,
    START,
    TICK_MS,
    buildFlatAtlas,
    buildMap,
    buildSceneryAtlas,
    buildWallAtlas,
    placeScenery,
} from './level';
import { InputManager } from './input';

/**
 * What the level costs to hold, taken once rather than watched.
 *
 * Split into what stays and what is recycled: only the first says anything
 * about whether a level is too big.
 */
function memorySnapshot(rc: Renderer): string {
    const m = rc.getMemoryUsage();
    const mb = (n: number): string => `${(n / 1048576).toFixed(2)} MB`.padStart(9);
    return [
        `RESIDENT   ${mb(m.resident)}   what this level costs while it is loaded`,
        `  textures ${mb(m.tilesets)}   walls, flats and scenery sheets`,
        `  lightmap ${mb(m.lightMaps)}   scales with the map, not the textures`,
        `  screen   ${mb(m.screen)}   the canvas frames are drawn into`,
        `WORKING    ${mb(m.working)}   fills as it draws, bounded, recycled`,
        `  shading  ${mb(m.shadeCache)}   sprite frames shaded on demand`,
        `  frame    ${mb(m.frameBuffer)}   pixels the flat rasteriser reads back`,
    ].join('\n');
}

async function main(): Promise<void> {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const readout = document.getElementById('readout') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;
    const panel = document.getElementById('profile') as HTMLElement;
    const memoryPanel = document.getElementById('memory') as HTMLElement;

    status.textContent = 'building the hall...';
    await new Promise((resolve) => requestAnimationFrame(resolve));

    let resolution = 0;
    const rc = new Renderer();
    rc.setScreen(RESOLUTIONS[resolution]);
    rc.setMetrics(METRICS);
    rc.setShading(SHADING);
    rc.setTextureSmoothing(false);
    rc.setWallTextures(buildWallAtlas());
    rc.setFlatTextures(buildFlatAtlas());
    new MapHelper().build(rc, buildMap());

    // One sheet for every piece of scenery, one tile per kind and one facing:
    // static scenery is the simplest thing a sprite can be.
    const scenery = rc.buildTileSet(buildSceneryAtlas(), SPRITE_WIDTH, SPRITE_HEIGHT);
    for (const piece of placeScenery()) {
        const sprite = rc.buildSprite(scenery);
        sprite.x = piece.x * METRICS.spacing;
        sprite.y = piece.y * METRICS.spacing;
        sprite.buildAnimation({ starts: [piece.kind], length: 1, duration: 100, loop: 0 }, 'still');
        sprite.setCurrentAnimation('still');
        if (piece.kind === 3) {
            // A brazier lights the hall around it, and is drawn at full
            // brightness however far away it is.
            sprite.addFlag(FX_LIGHT_SOURCE);
            rc.addLightSource(sprite.x, sprite.y, 40, 190, 0.55);
        }
    }

    status.textContent = 'warming textures...';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    rc.warmUpTextures();
    status.textContent = '';
    memoryPanel.textContent = memorySnapshot(rc);

    const target = canvas.getContext('2d') as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = false;

    const im = new InputManager();
    im.plugListeners(canvas);

    const profiler = new Profiler();
    let profiling = false;
    let reportAt = 0;

    const camera = { x: START.x * METRICS.spacing, y: START.y * METRICS.spacing, a: START.angle };

    /** Resizes the page canvas to match the renderer's internal resolution. */
    const applyResolution = (): void => {
        const { width, height } = RESOLUTIONS[resolution];
        rc.setScreen({ width, height });
        canvas.width = width;
        canvas.height = height;
        canvas.style.aspectRatio = `${width} / ${height}`;
        target.imageSmoothingEnabled = false;
        // A wider screen means a taller light map and re-shaded surfaces, so
        // the figures move with it.
        rc.render(camera.x, camera.y, camera.a, 1);
        memoryPanel.textContent = memorySnapshot(rc);
        profiler.reset();
    };
    applyResolution();

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'p') {
            profiling = !profiling;
            rc.profiler = profiling ? profiler : null;
            profiler.reset();
            reportAt = performance.now() + 1000;
            panel.style.display = profiling ? 'block' : 'none';
            panel.textContent = 'measuring...';
        } else if (key === 'o' && profiling) {
            profiler.flushProbe = !profiler.flushProbe;
            profiler.reset();
        } else if (key === 'r') {
            resolution = (resolution + 1) % RESOLUTIONS.length;
            applyResolution();
        }
    });

    let previous = performance.now();
    let carry = 0;
    let fps = 0;

    const frame = (now: number): void => {
        const elapsed = Math.min(now - previous, 250);
        previous = now;
        fps = fps * 0.9 + (1000 / Math.max(elapsed, 1)) * 0.1;

        carry += elapsed;
        let steps = 0;
        while (carry >= TICK_MS && steps < 8) {
            const input = im.readInput();
            camera.a += input.turn * 0.045;
            const forward = input.forward * 3.4;
            const strafe = input.strafe * 3.4;
            const nx =
                camera.x + Math.cos(camera.a) * forward + Math.cos(camera.a + Math.PI / 2) * strafe;
            const ny =
                camera.y + Math.sin(camera.a) * forward + Math.sin(camera.a + Math.PI / 2) * strafe;
            const cx = (nx / METRICS.spacing) | 0;
            const cy = (ny / METRICS.spacing) | 0;
            if (rc.getCellPhys(cx, cy) === PHYS_NONE) {
                camera.x = nx;
                camera.y = ny;
            }
            carry -= TICK_MS;
            ++steps;
        }

        rc.render(camera.x, camera.y, camera.a, 1);
        const source = rc.renderCanvas;
        if (source !== null) {
            target.drawImage(source, 0, 0, canvas.width, canvas.height);
        }

        const { width, height, label } = RESOLUTIONS[resolution];
        readout.textContent = `${fps.toFixed(0)} fps   ${width}x${height} ${label} (R)`;

        if (profiling && now >= reportAt) {
            panel.textContent = [
                `${width}x${height}   ${fps.toFixed(0)} fps   stalls ${profiler.flushProbe ? 'on' : 'off'} (O)`,
                '',
                profiler.format(),
            ].join('\n');
            profiler.reset();
            reportAt = now + 1000;
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

void main().catch((e: unknown) => {
    const status = document.getElementById('status');
    if (status) {
        status.textContent = `failed: ${String(e)}`;
    }
    console.error(e);
});
