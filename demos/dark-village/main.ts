import { Canvas, PHASE_HELP, Profiler, Renderer } from '../../src';
import type { RceLevel } from '../../src';
import { LEVEL_URL, TICK_MS } from './level';
import { World } from './world';
import { InputManager } from './input';

/** Internal render resolution. The canvas is scaled up by CSS. */
const WIDTH = 320;
const HEIGHT = 200;

/**
 * What the level costs to hold, taken once rather than watched.
 *
 * Split into what stays and what is recycled: only the first says anything
 * about whether a level is too big. Watching either every frame would show the
 * shade cache filling and teach nothing.
 */
function memorySnapshot(rc: Renderer): string {
    const m = rc.getMemoryUsage();
    const mb = (n: number): string => `${(n / 1048576).toFixed(2)} MB`.padStart(9);
    return [
        `RESIDENT   ${mb(m.resident)}   what this level costs while it is loaded`,
        `  textures ${mb(m.tilesets)}   walls, flats and sprite sheets`,
        `  decals   ${mb(m.decals)}   painted onto cell surfaces`,
        `  lightmap ${mb(m.lightMaps)}   scales with the map, not the textures`,
        `  backdrop ${mb(m.background)}`,
        `  screen   ${mb(m.screen)}   the canvas frames are drawn into`,
        `  storey   ${mb(m.storey)}   what the floors above hold of their own`,
        ``,
        `WORKING    ${mb(m.working)}   fills as it draws, bounded, recycled`,
        `  shading  ${mb(m.shadeCache)}   sprite frames shaded on demand`,
        `  frame    ${mb(m.frameBuffer)}   pixels the flat rasteriser reads back`,
    ].join('\n');
}

function hud(world: World, fps: number): string {
    const c = world.cell;
    const door = world.aimedDoor();
    const tag = world.firedTag;
    return [
        `${fps.toFixed(0)} fps`,
        `cell ${c.x},${c.y}`,
        `doors ${world.doors.contexts.length}`,
        door ? `[E] open door at ${door.x},${door.y}` : '',
        tag ? `tag: ${[tag.command, ...tag.parameters].join(' ')}` : '',
    ]
        .filter(Boolean)
        .join('   ');
}

async function main(): Promise<void> {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const status = document.getElementById('status') as HTMLElement;
    const readout = document.getElementById('readout') as HTMLElement;

    const im = new InputManager();

    const world = new World();
    world.setScreen(WIDTH, HEIGHT);

    status.textContent = 'loading level...';
    const response = await fetch(LEVEL_URL);
    if (!response.ok) {
        throw new Error(`could not read ${LEVEL_URL}: ${response.status}`);
    }
    const data = (await response.json()) as RceLevel;

    // The library performs no I/O: every texture the level names is decoded
    // here and handed back in. 54 atlases for this one, so it is worth saying
    // what is happening while it runs.
    let decoded = 0;
    status.textContent = 'loading textures...';
    await world.build(data, async (src) => {
        const [image] = await Canvas.loadCanvases([src]);
        status.textContent = `loading textures... ${++decoded}`;
        return image;
    });
    // Textures reach the GPU when something first samples them, which without
    // this is the first few frames. Paying for it here costs a moment of the
    // loading screen instead of a stutter once the player has control.
    status.textContent = 'warming textures...';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    world.renderer.warmUpTextures();
    status.textContent = '';

    // Once, after loading. Not watched: the shade cache fills as sprites are
    // drawn, and that movement says nothing about what the level costs.
    const memoryPanel = document.getElementById('memory') as HTMLElement;
    memoryPanel.textContent = memorySnapshot(world.renderer);

    const target = canvas.getContext('2d') as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = false;

    // Profiling, on P. Off by default: it forces the canvas to rasterise at
    // two points in the frame, which is the only way to learn what the drawing
    // actually costs, and which makes the frame slower while it is on.
    const panel = document.getElementById('profile') as HTMLElement;
    const profiler = new Profiler();
    let profiling = false;
    let reportAt = 0;
    let shades = world.renderer.shading.shades;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'p') {
            profiling = !profiling;
            world.renderer.profiler = profiling ? profiler : null;
            profiler.reset();
            reportAt = performance.now() + 1000;
            panel.style.display = profiling ? 'block' : 'none';
            panel.textContent = 'measuring...';
        } else if (key === 'm') {
            // Fewer shading layers means a smaller texture atlas. If the cost
            // of drawing is the GPU re-uploading atlases it could not keep
            // resident, this moves the frame rate; if it is the number of draw
            // calls, it does nothing.
            const order = [16, 8, 4, 2];
            const s = world.renderer.shading;
            shades = order[(order.indexOf(shades) + 1) % order.length];
            world.renderer.setShading({ ...s, shades });
            memoryPanel.textContent = memorySnapshot(world.renderer);
            profiler.reset();
            reportAt = performance.now() + 1000;
        } else if (key === 'o' && profiling) {
            // Without the stalls the phases still add up to the frame, but the
            // drawing lands wherever the canvas got round to it.
            profiler.flushProbe = !profiler.flushProbe;
            profiler.reset();
            reportAt = performance.now() + 1000;
        }
    });

    const legend = (): string =>
        Object.entries(PHASE_HELP)
            .map(([phase, what]) => `  ${phase.padEnd(11)} ${what}`)
            .join('\n');

    im.plugListeners(canvas);

    let previous = performance.now();
    let carry = 0;
    let fps = 0;

    const frame = (now: number): void => {
        const elapsed = Math.min(now - previous, 250);
        previous = now;
        fps = fps * 0.9 + (1000 / Math.max(elapsed, 1)) * 0.1;

        // Fixed simulation step, so door timing does not depend on frame rate.
        carry += elapsed;
        let steps = 0;
        while (carry >= TICK_MS && steps < 8) {
            world.update(im.readInput());
            carry -= TICK_MS;
            ++steps;
        }

        world.render();
        const source = world.renderer.renderCanvas;
        if (source !== null) {
            target.drawImage(source, 0, 0, canvas.width, canvas.height);
        }
        readout.textContent = hud(world, fps);

        if (profiling && now >= reportAt) {
            panel.textContent = [
                `${WIDTH}x${HEIGHT}   ${fps.toFixed(0)} fps   stalls ${profiler.flushProbe ? 'on' : 'off'} (O)`,
                `${shades} shades   ${(world.renderer.getMemoryUsage().total / 1048576).toFixed(1)} MB of textures (M)`,
                '',
                profiler.format(),
                '',
                legend(),
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
