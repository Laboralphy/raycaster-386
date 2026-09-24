import {
    MapHelper,
    PHYS_NONE,
    Profiler,
    Renderer,
    faceCamera,
    shadeCache,
    wrapAngle,
} from '../../src';
import type { Sprite } from '../../src';
import {
    METRICS,
    SHADING,
    SPRITE_FACINGS,
    SPRITE_FRAMES,
    SPRITE_HEIGHT,
    SPRITE_STARTS,
    SPRITE_WIDTH,
    START,
    TICK_MS,
    buildFlatAtlas,
    buildMap,
    buildSpriteAtlas,
    buildWallAtlas,
    openCells,
} from './level';
import { InputManager } from './input';

const WIDTH = 320;
const HEIGHT = 200;

/** How many sprites the D key cycles through. */
const COUNTS = [200, 800, 2000, 50];
/** Cache budgets the B key cycles through, in bytes. */
const BUDGETS = [4 << 20, 1 << 20, 128 << 10, 32 << 20];

/** One sprite, plus the facing it is pointing and how fast it turns. */
interface Walker {
    sprite: Sprite;
    facing: number;
    spin: number;
}

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(2)} MB`;

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

async function main(): Promise<void> {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const readout = document.getElementById('readout') as HTMLElement;
    const status = document.getElementById('status') as HTMLElement;
    const panel = document.getElementById('profile') as HTMLElement;

    status.textContent = 'building level...';
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const rc = new Renderer();
    rc.setScreen({ width: WIDTH, height: HEIGHT });
    rc.setMetrics(METRICS);
    rc.setShading(SHADING);
    rc.setTextureSmoothing(false);
    rc.setWallTextures(buildWallAtlas());
    rc.setFlatTextures(buildFlatAtlas());

    const map = buildMap();
    new MapHelper().build(rc, map);

    // Every sprite shares one tileset, as a real game's crowd of one enemy
    // kind would: the cache is keyed per tileset and per frame, so a thousand
    // of them ask for the same few entries.
    const atlas = buildSpriteAtlas();
    const tileset = rc.buildTileSet(atlas, SPRITE_WIDTH, SPRITE_HEIGHT);

    // Somewhere to stand that is not a wall, shuffled deterministically so
    // raising the count adds sprites everywhere rather than in one corner.
    const cells = openCells(map).filter(
        (c) => Math.hypot(c.x - START.x * METRICS.spacing, c.y - START.y * METRICS.spacing) > 128
    );
    for (let i = cells.length - 1; i > 0; --i) {
        const j = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const k = Math.abs(Math.floor(j * (i + 1)));
        [cells[i], cells[k]] = [cells[k], cells[i]];
    }

    const walkers: Walker[] = [];
    const setCount = (count: number): void => {
        while (walkers.length > count) {
            const walker = walkers.pop();
            if (walker !== undefined) {
                walker.sprite.visible = false;
                rc.disposeSprite(walker.sprite);
            }
        }
        while (walkers.length < count && walkers.length < cells.length) {
            const cell = cells[walkers.length];
            const sprite = rc.buildSprite(tileset);
            sprite.x = cell.x;
            sprite.y = cell.y;
            sprite.buildAnimation(
                { starts: SPRITE_STARTS, length: SPRITE_FRAMES, duration: 160, loop: 1 },
                'walk'
            );
            sprite.setCurrentAnimation('walk');
            walkers.push({
                sprite,
                facing: (walkers.length % SPRITE_FACINGS) * (Math.PI / 4),
                spin: ((walkers.length % 7) - 3) * 0.004,
            });
        }
    };

    let count = COUNTS[0];
    let budget = BUDGETS[0];
    setCount(count);
    shadeCache.setBudget(budget);

    status.textContent = 'warming textures...';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    rc.warmUpTextures();
    status.textContent = '';

    // Taken here, and again only when a key changes what is loaded. Watching
    // it every frame would show the shade cache filling and say nothing about
    // what the level costs.
    const memoryPanel = document.getElementById('memory') as HTMLElement;
    const snapshot = (): void => {
        memoryPanel.textContent = memorySnapshot(rc);
    };
    snapshot();

    const target = canvas.getContext('2d') as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = false;

    const im = new InputManager();
    im.plugListeners(canvas);

    const profiler = new Profiler();
    let profiling = false;
    let reportAt = 0;
    let shades = SHADING.shades;

    const camera = { x: START.x * METRICS.spacing, y: START.y * METRICS.spacing, a: START.angle };

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === 'p') {
            profiling = !profiling;
            rc.profiler = profiling ? profiler : null;
            profiler.reset();
            shadeCache.resetStats();
            reportAt = performance.now() + 1000;
            panel.style.display = profiling ? 'block' : 'none';
            panel.textContent = 'measuring...';
        } else if (key === 'o' && profiling) {
            profiler.flushProbe = !profiler.flushProbe;
            profiler.reset();
        } else if (key === 'd') {
            count = COUNTS[(COUNTS.indexOf(count) + 1) % COUNTS.length];
            setCount(count);
            snapshot();
        } else if (key === 'b') {
            budget = BUDGETS[(BUDGETS.indexOf(budget) + 1) % BUDGETS.length];
            shadeCache.setBudget(budget);
            shadeCache.resetStats();
            snapshot();
        } else if (key === 'm') {
            const order = [16, 8, 4, 32];
            shades = order[(order.indexOf(shades) + 1) % order.length];
            rc.setShading({ ...SHADING, shades });
            snapshot();
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
            camera.a += input.turn * 0.05;
            const speed = input.forward * 4;
            const strafe = input.strafe * 4;
            const nx =
                camera.x + Math.cos(camera.a) * speed + Math.cos(camera.a + Math.PI / 2) * strafe;
            const ny =
                camera.y + Math.sin(camera.a) * speed + Math.sin(camera.a + Math.PI / 2) * strafe;
            // No collision worth the name: stay out of anything solid.
            const cx = (nx / METRICS.spacing) | 0;
            const cy = (ny / METRICS.spacing) | 0;
            if (rc.getCellPhys(cx, cy) === PHYS_NONE) {
                camera.x = nx;
                camera.y = ny;
            }
            rc.computeAnimations(TICK_MS);
            carry -= TICK_MS;
            ++steps;
        }

        // Turn each sprite to show the side the camera can see. A real game
        // does this through SpriteBinding; here the walkers spin on the spot,
        // which keeps every facing in play and the cache busy.
        for (const walker of walkers) {
            // Kept inside one revolution. Not for precision — a double holds
            // an angle far more finely than a facing sector or a screen pixel
            // needs, however long this runs — but because a heading is easier
            // to read, log and save when it means what it says. faceCamera
            // reduces whatever it is given either way.
            walker.facing = wrapAngle(walker.facing + walker.spin);
            faceCamera(walker.sprite, walker.facing, camera.x, camera.y);
        }

        rc.render(camera.x, camera.y, camera.a, 1);
        const source = rc.renderCanvas;
        if (source !== null) {
            target.drawImage(source, 0, 0, canvas.width, canvas.height);
        }

        const memory = rc.getMemoryUsage();
        readout.textContent = `${fps.toFixed(0)} fps   ${walkers.length} sprites   ${mb(memory.total)}`;

        if (profiling && now >= reportAt) {
            const cache = shadeCache.stats();
            const asked = cache.hits + cache.misses;
            panel.textContent = [
                `${WIDTH}x${HEIGHT}   ${fps.toFixed(0)} fps   stalls ${profiler.flushProbe ? 'on' : 'off'} (O)`,
                `${walkers.length} sprites (D)   ${shades} shades (M)   textures ${mb(memory.total)}`,
                `cache ${mb(cache.bytes)} of ${mb(cache.budget)} (B)   ${cache.entries} entries   ` +
                    `${asked === 0 ? 0 : ((100 * cache.hits) / asked).toFixed(1)}% hit   ` +
                    `${cache.misses} misses, ${cache.evictions} evictions per second`,
                '',
                profiler.format(),
            ].join('\n');
            profiler.reset();
            shadeCache.resetStats();
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
