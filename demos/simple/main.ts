import { Canvas } from '../../src';
import { buildSentinelAtlas } from './spriteAtlas';
import { TEXTURES } from './level';
import { World } from './world';
import { InputManager } from './input';

/** Internal render resolution. The canvas is scaled up by CSS. */
const WIDTH = 320;
const HEIGHT = 200;
/** Simulation rate. Doors are written in ticks, so this must be fixed. */
const TICK_MS = 1000 / 60;

function hud(world: World, fps: number): string {
    const c = world.cell;
    const door = world.aimedDoor();
    return [
        `${fps.toFixed(0)} fps`,
        `cell ${c.x},${c.y}`,
        `doors ${world.doors.contexts.length}`,
        door ? `[E] open door at ${door.x},${door.y}` : '',
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

    status.textContent = 'loading textures...';
    // The renderer performs no I/O: images are decoded here and handed in.
    const [walls, flats] = await Canvas.loadCanvases([TEXTURES.walls, TEXTURES.flats]);
    // The sentinel's atlas is drawn rather than loaded, so the demo stays two
    // asset files.
    world.build(walls, flats, buildSentinelAtlas());
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
