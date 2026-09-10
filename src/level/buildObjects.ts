import { FX_LIGHT_SOURCE } from '../consts.js';
import type { LightHandle, Renderer } from '../Renderer.js';
import type { Sprite } from '../Sprite.js';
import type { ShadedTileSet } from '../texture/ShadedTileSet.js';
import type { LoadedLevel } from './loadLevel.js';
import type { RceBlueprint, RceObject, RceTileset } from './types.js';

/** One object placed in the world. */
export interface PlacedObject {
    sprite: Sprite;
    /** The template it was built from. */
    blueprint: RceBlueprint;
    /** The level entry that placed it. */
    object: RceObject;
    /**
     * The collision radius its blueprint declares, or 0.
     *
     * Reported rather than applied: what collides with what is the caller's,
     * and this library never moves an object once placed.
     */
    size: number;
    /** The light it carries, if its blueprint declares one. */
    light: LightHandle | null;
}

export interface BuildObjectsOptions {
    /** Decodes a tileset named by a blueprint. As {@link LoadLevelOptions.loadImage}. */
    loadImage: (src: string) => Promise<HTMLCanvasElement>;
}

/**
 * Places a level's objects as sprites.
 *
 * Separate from `loadLevel` rather than folded into it, because a game with its
 * own object handling should not pay for one it discards: the level's `objects`
 * and `blueprints` come back from `loadLevel` untouched, and this turns them
 * into sprites only if asked.
 *
 * What it builds is decoration — a sprite at a position, with its animations,
 * effect flags and any light it carries. Everything above that (behaviour,
 * collision, ownership) stays with the caller; `blueprint.thinker` and
 * `blueprint.size` are reported, never acted on.
 */
export async function buildObjects(
    renderer: Renderer, loaded: LoadedLevel, options: BuildObjectsOptions
): Promise<PlacedObject[]> {
    const { blueprints, objects } = loaded.unhandled;
    const byId = new Map<string | number, RceBlueprint>(blueprints.map(bp => [bp.id, bp]));
    const tilesets = new Map<string | number, ShadedTileSet>();

    /** Builds a blueprint's tileset once, shaded unless it is a light source. */
    const tilesetFor = async (bp: RceBlueprint): Promise<{ ts: ShadedTileSet; def: RceTileset }> => {
        const def = loaded.declaredTilesets.get(bp.tileset);
        if (def === undefined) {
            throw new Error(
                `buildObjects: blueprint "${String(bp.id)}" refers to tileset ` +
                `"${String(bp.tileset)}", which the level does not declare`
            );
        }
        let ts = tilesets.get(bp.tileset);
        if (ts === undefined) {
            // A light source is drawn at full brightness whatever its distance,
            // so shading layers for it would be built and never used.
            const noShading = (bp.fx ?? []).includes(FX_LIGHT_SOURCE);
            ts = renderer.buildTileSet(await options.loadImage(def.src), def.width, def.height, noShading);
            tilesets.set(bp.tileset, ts);
        }
        return { ts, def };
    };

    const placed: PlacedObject[] = [];
    for (const object of objects) {
        const bp = byId.get(object.blueprint);
        if (bp === undefined) {
            throw new Error(
                `buildObjects: an object at (${object.x}, ${object.y}) refers to blueprint ` +
                `"${String(object.blueprint)}", which was neither in the level nor supplied`
            );
        }
        const { ts, def } = await tilesetFor(bp);
        const sprite = renderer.buildSprite(ts);
        sprite.x = object.x;
        sprite.y = object.y;
        // An object's z is its altitude: negative sinks it into the floor.
        sprite.h = object.z ?? 0;
        sprite.scale = bp.scale ?? 1;
        for (const fx of bp.fx ?? []) {
            sprite.addFlag(fx as number);
        }

        // Animations are declared on the tileset, and named; an object picks one.
        // The file may write one start or an array of them, one per facing;
        // this is the only place that has to know about both shapes.
        for (const anim of def.animations ?? []) {
            const a = anim as {
                id: string; start: number | number[];
                length: number; duration: number; loop: number;
            };
            sprite.buildAnimation(
                {
                    starts: Array.isArray(a.start) ? a.start : [a.start],
                    length: a.length,
                    duration: a.duration,
                    loop: a.loop as 0 | 1 | 2
                },
                a.id
            );
        }
        if (object.animation !== undefined && object.animation !== null) {
            sprite.setCurrentAnimation(object.animation);
        }

        const ls = bp.lightsource;
        const light = ls ? renderer.addLightSource(object.x, object.y, ls.r0, ls.r1, ls.v) : null;

        placed.push({ sprite, blueprint: bp, object, size: bp.size ?? 0, light });
    }
    return placed;
}
