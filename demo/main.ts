import { Canvas } from '../src/index.js';
import { TEXTURES } from './level.js';
import { emptyInput, World, type Input } from './world.js';

/** Internal render resolution. The canvas is scaled up by CSS. */
const WIDTH = 320;
const HEIGHT = 200;
/** Simulation rate. Doors are written in ticks, so this must be fixed. */
const TICK_MS = 1000 / 60;
/** Mouse sensitivity, radians per pixel of movement. */
const MOUSE_SENSITIVITY = 0.0025;

const held = new Set<string>();
let mouseTurn = 0;
let usePressed = false;

function readInput(): Input {
    const input = emptyInput();
    if (held.has('w') || held.has('arrowup')) input.forward += 1;
    if (held.has('s') || held.has('arrowdown')) input.forward -= 1;
    if (held.has('a')) input.strafe -= 1;
    if (held.has('d')) input.strafe += 1;
    if (held.has('arrowleft')) input.turn -= 1;
    if (held.has('arrowright')) input.turn += 1;
    // Mouse look is applied as a one-off rotation, not a rate.
    input.turn += mouseTurn / 0.045;
    mouseTurn = 0;
    input.use = usePressed;
    usePressed = false;
    return input;
}

function hud(world: World, fps: number): string {
    const c = world.cell;
    const door = world.aimedDoor();
    return [
        `${fps.toFixed(0)} fps`,
        `cell ${c.x},${c.y}`,
        `doors ${world.doors.doors.length}`,
        door ? `[E] open door at ${door.x},${door.y}` : ''
    ]
        .filter(Boolean)
        .join('   ');
}

async function main(): Promise<void> {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const status = document.getElementById('status') as HTMLElement;
    const readout = document.getElementById('readout') as HTMLElement;

    const world = new World();
    world.setScreen(WIDTH, HEIGHT);

    status.textContent = 'loading textures...';
    // The renderer performs no I/O: images are decoded here and handed in.
    const [walls, flats] = await Canvas.loadCanvases([TEXTURES.walls, TEXTURES.flats]);
    world.build(walls, flats);
    status.textContent = '';

    const target = canvas.getContext('2d') as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = false;

    window.addEventListener('keydown', e => {
        const key = e.key.toLowerCase();
        held.add(key);
        if (key === 'e' || key === ' ') {
            usePressed = true;
            e.preventDefault();
        }
        if (key.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => held.clear());

    canvas.addEventListener('click', () => {
        if (document.pointerLockElement !== canvas) {
            void canvas.requestPointerLock();
        } else {
            usePressed = true;
        }
    });
    document.addEventListener('mousemove', e => {
        if (document.pointerLockElement === canvas) {
            mouseTurn += e.movementX * MOUSE_SENSITIVITY;
        }
    });

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
            world.update(readInput());
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
