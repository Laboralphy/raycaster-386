import { describe, expect, it } from 'vitest';
import { MapHelper, type LevelMap } from '../../src/map/MapHelper.js';
import { Renderer } from '../../src/Renderer.js';
import { installDom } from '../harness/dom.js';
import { hasLegacy, importLegacy } from '../harness/legacy.js';
import { buildAtlas } from '../harness/fixtures.js';
import { compareFrames, describeDiff, isClean } from '../harness/compare.js';
import type { Frame } from '../harness/legacyRenderer.js';

const SPACING = 64;
const WALL_H = 96;
const SCREEN = 128;
const SHADING = { shades: 8, color: 'black', filter: null, brightness: 0 };

/** A level in the shape the map editor saves. */
function level(options: { lights?: boolean; upper?: boolean; animated?: boolean } = {}): LevelMap {
    return {
        legend: [
            // Index 0 is the void.
            { code: ' ', faces: {} },
            {
                code: '#',
                phys: 1,
                faces: options.animated
                    ? { n: [0, 3, 100, 1], e: [0, 3, 100, 1], s: 2, w: 3 }
                    : { n: 0, e: 1, s: 2, w: 3 }
            },
            {
                code: '.',
                faces: { f: 0, c: 1 },
                ...(options.lights ? { light: { r0: 32, r1: 180, v: 0.8 } } : {})
            }
        ],
        map: [
            '########',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '#......#',
            '########'
        ],
        ...(options.upper
            ? {
                  uppermap: [
                      '########',
                      '#      #',
                      '#      #',
                      '#      #',
                      '#      #',
                      '#      #',
                      '#      #',
                      '########'
                  ]
              }
            : {})
    };
}

function grab(canvas: HTMLCanvasElement): Frame {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(img.data) };
}

function buildPort(lvl: LevelMap): { rc: Renderer; result: ReturnType<MapHelper['build']> } {
    installDom();
    const rc = new Renderer();
    rc.setScreen({ width: SCREEN, height: SCREEN });
    rc.setMetrics({ spacing: SPACING, height: WALL_H });
    rc.setShading(SHADING);
    rc.setWallTextures(buildAtlas(4, SPACING, WALL_H));
    rc.setFlatTextures(buildAtlas(4, SPACING, SPACING));
    const result = new MapHelper().build(rc, lvl);
    return { rc, result };
}

describe('MapHelper', () => {
    it('treats legend index 0 as the void', () => {
        const { rc } = buildPort(level());
        // ' ' maps to index 0, which the grid never uses here; '#' is 1.
        expect(rc.getCellMaterial(0, 0)).toBe(1);
        expect(rc.getCellPhys(0, 0)).toBe(1);
        expect(rc.getCellMaterial(1, 1)).toBe(2);
        expect(rc.getCellPhys(1, 1)).toBe(0);
    });

    it('maps an unknown grid symbol to the void rather than throwing', () => {
        const lvl = level();
        const patched: LevelMap = { ...lvl, map: ['?#', '##'] };
        const { rc } = buildPort(patched);
        expect(rc.getCellMaterial(0, 0)).toBe(0);
        expect(rc.getCellPhys(0, 0)).toBe(0);
    });

    it('shares one animation between faces declaring the same spec', () => {
        const { rc } = buildPort(level({ animated: true }));
        const faces = (rc as unknown as { _cellCodes: unknown[][] })._cellCodes[1];
        // Registered as [w, s, e, n, f, c]; n and e share a spec.
        expect(faces[3]).toBe(faces[2]);
        expect(typeof faces[1]).toBe('number');
    });

    it('creates a storey when the level has an uppermap', () => {
        const withUpper = buildPort(level({ upper: true }));
        expect(withUpper.rc.storey).not.toBeNull();
        expect(withUpper.rc.storey!.getCellMaterial(0, 0)).toBe(1);
        expect(buildPort(level()).rc.storey).toBeNull();
    });

    it('creates a light per cell of a light-emitting material', () => {
        const { result } = buildPort(level({ lights: true }));
        // 6x6 interior of '.' cells.
        expect(result.blockLights.length).toBe(36);
        const first = result.blockLights[0];
        expect(first.lightsource.x).toBe(SPACING * first.x + (SPACING >> 1));
        expect(first.lightsource.y).toBe(SPACING * first.y + (SPACING >> 1));
        expect(buildPort(level()).result.blockLights.length).toBe(0);
    });

    it('exposes the built materials, resolved', () => {
        const { result } = buildPort(level({ lights: true }));
        expect(result.materials.length).toBe(3);
        expect(result.materials[1].phys).toBe(1);
        expect(result.materials[1].code).toBe('#');
        expect(result.materials[2].light).toEqual({ r0: 32, r1: 180, v: 0.8 });
        // Defaults fill in for anything the legend omits.
        expect(result.materials[0].phys).toBe(0);
        expect(result.materials[0].offset).toBe(0);
        expect(result.materials[0].ref).toBe('');
    });
});

interface LegacyRC {
    options: unknown;
    renderCanvas: HTMLCanvasElement;
    setWallTextures(i: HTMLCanvasElement): void;
    setFlatTextures(i: HTMLCanvasElement): void;
    setShadingSettings(n: number, c: string, f: string | false, b: number): void;
    render(x: number, y: number, a: number, h: number): void;
}
interface LegacyMapHelper {
    build(rc: LegacyRC, map: unknown): { blockLights: unknown[]; materials: unknown[] };
}

describe.skipIf(!hasLegacy)('MapHelper vs original', () => {
    async function buildLegacy(lvl: LevelMap): Promise<{ rc: LegacyRC; result: { blockLights: unknown[] } }> {
        installDom();
        const RC = (await importLegacy<{ default: new () => LegacyRC }>('libs/raycaster/Renderer.js')).default;
        const MH = (await importLegacy<{ default: new () => LegacyMapHelper }>('libs/raycaster/MapHelper.js'))
            .default;
        const rc = new RC();
        rc.options = {
            screen: { width: SCREEN, height: SCREEN },
            metrics: { spacing: SPACING, height: WALL_H },
            shading: { shades: SHADING.shades, color: SHADING.color, filter: false, brightness: 0 }
        };
        rc.setWallTextures(buildAtlas(4, SPACING, WALL_H));
        rc.setFlatTextures(buildAtlas(4, SPACING, SPACING));
        rc.setShadingSettings(SHADING.shades, SHADING.color, false, 0);
        const result = new MH().build(rc, lvl);
        return { rc, result };
    }

    it('produces a pixel-identical frame for a level without lights', async () => {
        const lvl = level();
        const { rc: legacy } = await buildLegacy(lvl);
        const { rc: port } = buildPort(lvl);
        const pose = [4 * SPACING, 4 * SPACING, 0.7, 1] as const;

        // The original needs a warm-up frame and a cleared canvas; the port
        // does not. See "legacy renderer quirks" in the README.
        legacy.render(...pose);
        legacy.render(...pose);
        port.render(...pose);

        const diff = compareFrames(grab(legacy.renderCanvas), grab(port.renderCanvas!));
        expect(isClean(diff), describeDiff(diff)).toBe(true);
    }, 60_000);

    it('creates the block lights the original silently dropped', async () => {
        // buildMaterialItem never copied `light` onto the built material, so
        // the original's block-light branch could not fire.
        const lvl = level({ lights: true });
        const { result: legacyResult } = await buildLegacy(lvl);
        const { result: portResult } = buildPort(lvl);
        expect(legacyResult.blockLights.length).toBe(0);
        expect(portResult.blockLights.length).toBe(36);
    }, 60_000);
});
