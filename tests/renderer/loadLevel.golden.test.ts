import { describe, expect, it } from 'vitest';
import { loadLevel } from '../../src/index.js';
import type { RceLevel } from '../../src/index.js';
import { Renderer } from '../../src/Renderer.js';
import { compareFrames, describeDiff, isClean } from '../harness/compare.js';
import { buildBackground, buildFlatAtlas, buildWallAtlas, mapSizeOf } from '../harness/fixtures.js';
import type { SceneSpec } from '../harness/fixtures.js';
import { buildPortRenderer, renderPortFrame } from '../harness/portRenderer.js';
import { SCENES } from '../harness/scenes.js';
import { installDom } from '../harness/dom.js';

/**
 * The golden images verify the renderer, but they are built by calling
 * `registerCellMaterial` and `setCellMaterial` directly - they never go through
 * `loadLevel`. So the whole loading path is pinned only by structural
 * assertions: counts, and "the frame is not a flat fill". A decal eight pixels
 * out, a light with the wrong radius, or a transposed face would all pass.
 *
 * This closes that. The same scene is built twice: once through the harness
 * path already verified pixel-for-pixel against the original, and once through
 * `loadLevel` from an equivalent RCE-100 document. Any difference is a
 * difference in the loader.
 */

/** Scenes whose fixtures have a faithful RCE-100 expression. */
const BRIDGED = ['room', 'doors', 'lit', 'tinted', 'odd-spacing', 'sky', 'animated'];

/**
 * Expresses a scene fixture as an RCE-100 level.
 *
 * One legend entry per grid symbol, which is how RCE-100 states a level and
 * what makes it strictly more expressive than the fixture's split of
 * "materials" (faces) from "legend" (phys and offset): the `doors` scene has
 * two symbols sharing one material with different phys and offset, so a
 * legend keyed by material would collapse them.
 *
 * The legend is padded at index 0 because `MapHelper` treats that index as the
 * void; no grid symbol resolves to it. Cell codes therefore differ between the
 * two builds, which is harmless — a cell code is only a key into the face
 * table, and it is the faces that have to match.
 */
function toRceLevel(spec: SceneSpec): RceLevel {
    const symbols = Object.keys(spec.legend);
    const legend = [
        {
            code: 'void',
            phys: 0,
            offset: 0,
            ref: '',
            faces: { n: null, e: null, s: null, w: null, f: null, c: null }
        },
        ...symbols.map(symbol => {
            const entry = spec.legend[symbol];
            const faces = spec.materials[entry.material];
            return {
                code: symbol,
                phys: entry.phys ?? 0,
                offset: entry.offset ?? 0,
                ref: '',
                faces: {
                    n: faces?.n ?? null, e: faces?.e ?? null, s: faces?.s ?? null,
                    w: faces?.w ?? null, f: faces?.f ?? null, c: faces?.c ?? null
                }
            };
        })
    ];

    return {
        version: 'RCE-100',
        level: {
            map: spec.map.map(row => row.split('')),
            legend,
            metrics: spec.metrics,
            textures: {
                walls: 'walls',
                flats: 'flats',
                sky: spec.background === undefined ? '' : 'sky',
                smooth: false,
                stretch: false
            }
        },
        shading: {
            color: spec.shading.color,
            filter: spec.shading.filter,
            brightness: spec.shading.brightness,
            shades: spec.shading.shades,
            // The renderer's own default; no fixture changes it.
            factor: 50
        },
        lightsources: (spec.lights ?? []).map(l => ({ x: l.x, y: l.y, r0: l.r0, r1: l.r1, v: l.v })),
        startpoints: [],
        tilesets: [],
        blueprints: [],
        objects: [],
        decals: [],
        tags: []
    } as RceLevel;
}

/** Builds the same scene through loadLevel, with the fixtures' own atlases. */
async function buildViaLoadLevel(spec: SceneSpec): Promise<Renderer> {
    installDom();
    const rc = new Renderer();
    rc.setScreen({ width: spec.screen.width, height: spec.screen.height });
    const atlases: Record<string, () => HTMLCanvasElement> = {
        walls: () => buildWallAtlas(spec),
        flats: () => buildFlatAtlas(spec),
        sky: () => buildBackground(spec)
    };
    await loadLevel(rc, toRceLevel(spec), {
        loadImage: src => Promise.resolve(atlases[src]())
    });
    return rc;
}

describe('loadLevel against the golden-verified build path', () => {
    const bridged = SCENES.filter(s => BRIDGED.includes(s.name));

    it('covers the scenes it claims to', () => {
        expect(bridged.map(s => s.name).sort()).toEqual([...BRIDGED].sort());
    });

    for (const spec of bridged) {
        it(`renders ${spec.name} identically to the direct build`, async () => {
            const direct = buildPortRenderer(spec);
            const loaded = await buildViaLoadLevel(spec);

            expect(loaded.getMapSize(), 'map size').toBe(mapSizeOf(spec));

            for (const camera of spec.cameras) {
                const a = renderPortFrame(direct, camera);
                const b = renderPortFrame(loaded, camera);
                const diff = compareFrames(a, b);
                expect(
                    isClean(diff),
                    `${spec.name}/${camera.name}: ${describeDiff(diff)}`
                ).toBe(true);
            }
        }, 60_000);
    }
});
