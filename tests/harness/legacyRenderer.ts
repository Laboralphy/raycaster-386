import { installDom } from './dom.js';
import { importLegacy } from './legacy.js';
import {
    buildBackground, buildFlatAtlas, buildSpriteAtlas, buildWallAtlas, cells, isFaceAnimation,
    mapSizeOf, storeyCells, SPRITE_TILE_HEIGHT, SPRITE_TILE_WIDTH,
    type CameraPose, type FaceAnimation, type FaceDef, type MaterialFaces, type SceneSpec
} from './fixtures.js';

/** The parts of the original Renderer this harness drives. */
interface LegacySprite {
    x: number;
    y: number;
    h: number;
    scale: number;
    flags: number;
    buildAnimation(def: unknown, ref?: string): void;
}

interface LegacyRenderer {
    options: unknown;
    buildTileSet(img: HTMLCanvasElement, w: number, h: number, noShading?: boolean): unknown;
    buildSprite(tileset: unknown): LegacySprite;
    createStorey(): LegacyRenderer;
    paintSurface(
        x: number, y: number, face: number,
        draw: (x: number, y: number, face: number, canvas: HTMLCanvasElement) => void
    ): void;
    renderCanvas: HTMLCanvasElement;
    setWallTextures(img: HTMLCanvasElement): void;
    setFlatTextures(img: HTMLCanvasElement): void;
    setShadingSettings(shades: number, fog: string, filter: string | false, brightness: number): void;
    setMapSize(n: number): void;
    setBackground(img: HTMLCanvasElement): void;
    buildSurfaceAnimation(def: unknown): unknown;
    computeAnimations(t: number): void;
    registerCellMaterial(code: number, faces: unknown): void;
    setCellMaterial(x: number, y: number, code: number): void;
    setCellPhys(x: number, y: number, code: number): void;
    setCellOffset(x: number, y: number, code: number): void;
    addLightSource(x: number, y: number, r0: number, r1: number, v: number): unknown;
    render(x: number, y: number, angle: number, height: number): void;
    computeScene(x: number, y: number, angle: number, height: number): unknown;
}

let ctor: (new () => LegacyRenderer) | null = null;

async function legacyCtor(): Promise<new () => LegacyRenderer> {
    if (ctor === null) {
        installDom();
        const mod = await importLegacy<{ default: new () => LegacyRenderer }>(
            'libs/raycaster/Renderer.js'
        );
        ctor = mod.default;
    }
    return ctor;
}

/**
 * Builds an original-engine Renderer configured from a scene spec.
 *
 * Setup order matters and mirrors what the original expects: options first
 * (so metrics are known), then the atlases (which are cut into tiles using
 * those metrics), then shading, then the map.
 */
export async function buildLegacyRenderer(spec: SceneSpec): Promise<LegacyRenderer> {
    const Renderer = await legacyCtor();
    const rc = new Renderer();

    rc.options = {
        screen: { width: spec.screen.width, height: spec.screen.height },
        metrics: { spacing: spec.metrics.spacing, height: spec.metrics.height },
        shading: {
            shades: spec.shading.shades,
            color: spec.shading.color,
            // The original's own default is `false`, not null.
            filter: spec.shading.filter ?? false,
            brightness: spec.shading.brightness
        }
    };

    rc.setWallTextures(buildWallAtlas(spec));
    rc.setFlatTextures(buildFlatAtlas(spec));
    rc.setShadingSettings(
        spec.shading.shades,
        spec.shading.color,
        spec.shading.filter ?? false,
        spec.shading.brightness
    );

    if (spec.background !== undefined) {
        rc.setBackground(buildBackground(spec));
    }

    rc.setMapSize(mapSizeOf(spec));
    const animations = new Map<string, unknown>();
    for (const [code, faces] of Object.entries(spec.materials)) {
        rc.registerCellMaterial(
            Number(code),
            resolveFaces(faces, a => rc.buildSurfaceAnimation(
                { start: a[0], length: a[1], duration: a[2], loop: a[3] }
            ), animations)
        );
    }
    for (const { x, y, entry } of cells(spec)) {
        rc.setCellMaterial(x, y, entry.material);
        rc.setCellPhys(x, y, entry.phys ?? 0);
        if (entry.offset) {
            rc.setCellOffset(x, y, entry.offset);
        }
    }
    for (const l of spec.lights ?? []) {
        rc.addLightSource(l.x, l.y, l.r0, l.r1, l.v);
    }

    if (spec.storey !== undefined) {
        const storey = rc.createStorey();
        for (const { x, y, entry } of storeyCells(spec)) {
            storey.setCellMaterial(x, y, entry.material);
            storey.setCellPhys(x, y, entry.phys ?? 0);
            if (entry.offset) {
                storey.setCellOffset(x, y, entry.offset);
            }
        }
    }

    for (const d of spec.decals ?? []) {
        rc.paintSurface(d.x, d.y, d.face, (_x, _y, _face, canvas) => paintDecal(canvas, d.fill));
    }

    if (spec.sprites !== undefined && spec.sprites.length > 0) {
        const tileset = rc.buildTileSet(buildSpriteAtlas(), SPRITE_TILE_WIDTH, SPRITE_TILE_HEIGHT);
        for (const s of spec.sprites) {
            const sprite = rc.buildSprite(tileset);
            sprite.x = s.x;
            sprite.y = s.y;
            sprite.h = s.h ?? 0;
            sprite.scale = s.scale ?? 1;
            sprite.flags = s.flags ?? 0;
            // A non-looping animation pins the frame without advancing.
            sprite.buildAnimation({ start: s.tile ?? 0, length: 1, duration: 100, loop: 0 });
        }
    }
    return rc;
}
/** Paints a deterministic decal: a solid fill plus a corner marker. */
function paintDecal(canvas: HTMLCanvasElement, fill: string): void {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = fill;
    ctx.fillRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 8, 8);
}


/** Raw RGBA pixels of one rendered frame. */
export interface Frame {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export interface RenderOptions {
    /**
     * Reset the render canvas to opaque black first. Default true.
     *
     * `Renderer.render()` never clears: it paints the background, overwrites
     * the flat area with putImageData, then draws wall slices on top. Any
     * pixel none of those three covers keeps whatever the previous frame left
     * there. A half-open door leaves exactly such a gap, so without clearing,
     * a frame depends on the frame before it. See the pinning tests in
     * renderer.golden.test.ts.
     */
    clear?: boolean;
    /**
     * Frames to render and discard first. Default 1.
     *
     * `render()` calls `updateStaticLightMap()` *after* `computeScene()`, so
     * on the very first frame the wall slices are shaded against an empty
     * light map while the flats already use the freshly traced one. One
     * discarded frame settles it.
     */
    warmUp?: number;
}

function grab(rc: LegacyRenderer): Frame {
    const canvas = rc.renderCanvas;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
        width: canvas.width,
        height: canvas.height,
        // Detach from the canvas so a later render cannot mutate it.
        data: new Uint8ClampedArray(img.data)
    };
}

/**
 * Resets the canvas to opaque black before a capture.
 *
 * Opaque rather than clearRect's transparent: with no background image set,
 * the flat rasteriser does not reach every row, and a transparent pixel's RGB
 * is destroyed by premultiplication the moment the frame round-trips through
 * a PNG. Filling with opaque black makes every captured pixel meaningful and
 * the baseline files exact.
 */
function clearCanvas(rc: LegacyRenderer): void {
    // The render canvas is created lazily, inside the option reaction that
    // render() triggers, so before the first frame there is nothing to clear.
    const canvas = rc.renderCanvas as HTMLCanvasElement | null;
    if (canvas === null) {
        return;
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

/**
 * Renders one camera pose and returns its pixels.
 *
 * Defaults are chosen so a capture depends only on the scene and the pose,
 * never on what was rendered before it. Pass `{ clear: false, warmUp: 0 }` to
 * observe the raw behaviour instead.
 */
export function renderFrame(rc: LegacyRenderer, camera: CameraPose, options: RenderOptions = {}): Frame {
    const { clear = true, warmUp = 1 } = options;
    if (camera.animationTime !== undefined) {
        // Absolute, not cumulative. The original has no reset-all, so its
        // animation list is rewound directly; the port exposes
        // resetAnimations() for the same job.
        const anims = (rc as unknown as { _animations: { reset(): void }[] })._animations;
        anims.forEach(a => a.reset());
        rc.computeAnimations(camera.animationTime);
    }
    for (let i = 0; i < warmUp; ++i) {
        if (clear) {
            clearCanvas(rc);
        }
        rc.render(camera.x, camera.y, camera.angle, camera.height);
    }
    if (clear) {
        clearCanvas(rc);
    }
    rc.render(camera.x, camera.y, camera.angle, camera.height);
    return grab(rc);
}

/** Builds a renderer for `spec` and renders one pose. */
export async function renderLegacy(
    spec: SceneSpec,
    camera: CameraPose,
    options: RenderOptions = {}
): Promise<Frame> {
    const rc = await buildLegacyRenderer(spec);
    return renderFrame(rc, camera, options);
}

/**
 * Turns a spec's faces into what registerCellMaterial wants, building a
 * TileAnimation for any animated face. Identical specs share one animation,
 * so faces declared alike stay in step — the same rule MapHelper follows.
 */
function resolveFaces(
    faces: MaterialFaces,
    buildAnimation: (a: FaceAnimation) => unknown,
    cache: Map<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(faces)) {
        if (isFaceAnimation(def as FaceDef)) {
            const a = def as FaceAnimation;
            const k = a.join(';');
            let anim = cache.get(k);
            if (anim === undefined) {
                anim = buildAnimation(a);
                cache.set(k, anim);
            }
            out[key] = anim;
        } else {
            out[key] = def;
        }
    }
    return out;
}
