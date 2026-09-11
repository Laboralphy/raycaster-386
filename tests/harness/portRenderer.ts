import { Renderer } from '../../src/Renderer.js';
import type { Face } from '../../src/consts.js';
import type { CellMaterial } from '../../src/Renderer.js';
import { installDom } from './dom.js';
import {
    buildBackground, buildFlatAtlas, buildSpriteAtlas, buildWallAtlas, cells, isFaceAnimation,
    mapSizeOf, storeyCells, SPRITE_TILE_HEIGHT, SPRITE_TILE_WIDTH,
    type CameraPose, type FaceAnimation, type FaceDef, type MaterialFaces, type SceneSpec
} from './fixtures.js';
import type { Frame } from './compare.js';

/**
 * Builds a ported Renderer from the same spec that drives the original, so
 * any pixel difference is a difference in the renderer.
 */
export function buildPortRenderer(spec: SceneSpec): Renderer {
    installDom();
    const rc = new Renderer();

    rc.setScreen({ width: spec.screen.width, height: spec.screen.height });
    rc.setMetrics({ spacing: spec.metrics.spacing, height: spec.metrics.height });
    rc.setShading({
        shades: spec.shading.shades,
        color: spec.shading.color,
        filter: spec.shading.filter,
        brightness: spec.shading.brightness
    });

    rc.setWallTextures(buildWallAtlas(spec));
    rc.setFlatTextures(buildFlatAtlas(spec));

    if (spec.background !== undefined) {
        rc.setBackground(buildBackground(spec));
    }

    rc.setMapSize(mapSizeOf(spec));
    const animations = new Map<string, unknown>();
    for (const [code, faces] of Object.entries(spec.materials)) {
        rc.registerCellMaterial(
            Number(code),
            resolveFaces(faces, a => rc.buildSurfaceAnimation(
                { start: a[0], length: a[1], duration: a[2], loop: a[3] as 0 | 1 | 2 }
            ), animations) as CellMaterial
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
        rc.paintSurface(d.x, d.y, d.face as Face, (_x, _y, _face, canvas) => paintDecal(canvas, d.fill));
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
            sprite.buildAnimation({ starts: [s.tile ?? 0], length: 1, duration: 100, loop: 0 });
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


/**
 * Renders one pose through the port.
 *
 * No `clear` or `warmUp` knobs here: the port clears its own canvas and
 * updates the light map before casting, so a frame depends only on its
 * inputs. That the baselines still match is the point.
 */
export function renderPortFrame(rc: Renderer, camera: CameraPose): Frame {
    if (camera.animationTime !== undefined) {
        // Absolute, not cumulative: rewind first so a pose lands on the same
        // frame however many frames were rendered before it.
        rc.resetAnimations();
        rc.computeAnimations(camera.animationTime);
    }
    rc.render(camera.x, camera.y, camera.angle, camera.height);
    const canvas = rc.renderCanvas;
    if (canvas === null) {
        throw new Error('renderPortFrame: renderer produced no canvas');
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
        width: canvas.width,
        height: canvas.height,
        data: new Uint8ClampedArray(img.data)
    };
}

export function renderPort(spec: SceneSpec, camera: CameraPose): Frame {
    return renderPortFrame(buildPortRenderer(spec), camera);
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
