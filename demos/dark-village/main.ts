import { Canvas } from '../../src';
import type { RceLevel } from '../../src';
import { LEVEL_URL, TICK_MS } from './level';
import { World } from './world';
import { InputManager } from './input';

/** Internal render resolution. The canvas is scaled up by CSS. */
const WIDTH = 320;
const HEIGHT = 200;
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
    status.textContent = '';

    const target = canvas.getContext('2d') as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = false;

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
