import { DEFAULT_PHYS_CODE, PHYS_NONE } from '../consts.js';
import type { Renderer, CellMaterial, LightHandle } from '../Renderer.js';
import type { TileAnimation } from '../texture/TileAnimation.js';
import type { SurfaceTile } from '../raycast/context.js';

/**
 * An animated face, as `[start, length, duration, loop]`.
 */
export type FaceAnimation = readonly [start: number, length: number, duration: number, loop: number];

/** A face is either a fixed tile index or an animation. */
export type FaceDef = number | FaceAnimation;

/** A light emitted by every cell of a material. */
export interface MaterialLight {
    /** Radius of full intensity, in world units. */
    r0: number;
    /** Radius at which intensity reaches zero. */
    r1: number;
    /** Intensity, 0..1. */
    v: number;
}

/** One entry of a level's legend. */
export interface MaterialDef {
    /** The character (or value) used for this material in the map grid. */
    code: string | number;
    /** PHYS_* code. Defaults to PHYS_NONE. */
    phys?: number;
    /** Door slide / block recess. Defaults to 0. */
    offset?: number;
    /** Free-form identifier carried through for the caller's use. */
    ref?: string;
    /** If set, every cell of this material becomes a light source. */
    light?: MaterialLight | null;
    faces: {
        n?: FaceDef;
        e?: FaceDef;
        s?: FaceDef;
        w?: FaceDef;
        f?: FaceDef;
        c?: FaceDef;
    };
}

/** A row of the grid: a string of legend characters, or explicit values. */
export type MapRow = string | readonly (string | number)[];

/** A level as it appears in a saved file. */
export interface LevelMap {
    map: readonly MapRow[];
    legend: readonly MaterialDef[];
    /** Optional upper floor, using the same legend. */
    uppermap?: readonly MapRow[] | null;
}

/** A material after resolution, with its faces bound to the renderer. */
export interface BuiltMaterial {
    code: string | number;
    phys: number;
    offset: number;
    ref: string;
    light: MaterialLight | null;
    faces: Required<CellMaterial>;
}

/** A light created because a cell's material declares one. */
export interface BlockLight {
    x: number;
    y: number;
    lightsource: LightHandle;
}

export interface BuildResult {
    blockLights: BlockLight[];
    materials: BuiltMaterial[];
}

/**
 * Turns a level description into a configured Renderer.
 *
 * A level is a legend of materials plus a grid that indexes it, which is the
 * shape the map editor saves. Faces may be animated, and identical animation
 * specs share one {@link TileAnimation} rather than each getting their own.
 */
export class MapHelper {
    private _materials: BuiltMaterial[] = [];
    private _animations = new Map<string, TileAnimation>();

    /** The materials from the last {@link build}, indexed by legend position. */
    get materials(): readonly BuiltMaterial[] {
        return this._materials;
    }

    /**
     * Returns the animation for a spec, creating it on first use so that two
     * faces declaring the same animation stay in step.
     */
    private getAnimation(renderer: Renderer, a: FaceAnimation): TileAnimation {
        const key = a.join(';');
        let anim = this._animations.get(key);
        if (anim === undefined) {
            anim = renderer.buildSurfaceAnimation({
                start: a[0],
                length: a[1],
                duration: a[2],
                loop: a[3] as 0 | 1 | 2
            });
            this._animations.set(key, anim);
        }
        return anim;
    }

    private buildFace(renderer: Renderer, f: FaceDef | undefined): SurfaceTile {
        if (f === undefined) {
            return null;
        }
        return Array.isArray(f) ? this.getAnimation(renderer, f as FaceAnimation) : (f as number);
    }

    private buildMaterial(renderer: Renderer, m: MaterialDef): BuiltMaterial {
        const f = m.faces;
        return {
            code: m.code,
            phys: m.phys ?? PHYS_NONE,
            offset: m.offset ?? 0,
            ref: m.ref ?? '',
            // The original dropped `light` when building the material, so the
            // block-light branch below could never fire and blockLights always
            // came back empty.
            light: m.light ?? null,
            faces: {
                n: this.buildFace(renderer, f.n),
                s: this.buildFace(renderer, f.s),
                w: this.buildFace(renderer, f.w),
                e: this.buildFace(renderer, f.e),
                f: this.buildFace(renderer, f.f),
                c: this.buildFace(renderer, f.c)
            }
        };
    }

    /** The empty cell: no faces, no physics. */
    private static nullMaterial(): BuiltMaterial {
        return {
            code: 0,
            phys: DEFAULT_PHYS_CODE,
            offset: 0,
            ref: '',
            light: null,
            faces: { n: null, e: null, w: null, s: null, f: null, c: null }
        };
    }

    private material(index: number): BuiltMaterial {
        const m = this._materials[index];
        if (m === undefined) {
            throw new Error(`MapHelper: this material index does not exist: "${index}"`);
        }
        return m;
    }

    /**
     * Registers a level's materials and fills the renderer's map.
     *
     * Legend index 0 is the void: cells resolving to it get no faces and no
     * physics, whatever that legend entry declares.
     */
    build(renderer: Renderer, level: LevelMap): BuildResult {
        this._materials = [];
        this._animations.clear();

        // The legend maps a grid symbol to its index; an unknown symbol is the
        // void rather than an error, matching the original's passthrough.
        const index = new Map<string, number>();
        level.legend.forEach((material, i) => {
            const built = this.buildMaterial(renderer, material);
            renderer.registerCellMaterial(i, built.faces);
            this._materials[i] = built;
            index.set(String(material.code), i);
        });

        const resolveRow = (row: MapRow): number[] =>
            (typeof row === 'string' ? row.split('') : row).map(cell => index.get(String(cell)) ?? 0);

        const grid = level.map.map(resolveRow);
        const ps = renderer.metrics.spacing;
        renderer.setMapSize(grid.length);

        const blockLights: BlockLight[] = [];
        grid.forEach((row, y) =>
            row.forEach((cell, x) => {
                const m = cell !== 0 ? this.material(cell) : MapHelper.nullMaterial();
                renderer.setCellMaterial(x, y, cell);
                renderer.setCellPhys(x, y, m.phys);
                renderer.setCellOffset(x, y, m.offset);
                if (m.light !== null) {
                    blockLights.push({
                        x,
                        y,
                        // Centred in the cell.
                        lightsource: renderer.addLightSource(
                            ps * x + (ps >> 1),
                            ps * y + (ps >> 1),
                            m.light.r0,
                            m.light.r1,
                            m.light.v
                        )
                    });
                }
            })
        );

        if (level.uppermap) {
            const storey = renderer.createStorey();
            level.uppermap.map(resolveRow).forEach((row, y) =>
                row.forEach((cell, x) => {
                    const m = cell !== 0 ? this.material(cell) : MapHelper.nullMaterial();
                    storey.setCellMaterial(x, y, cell);
                    storey.setCellPhys(x, y, m.phys);
                    storey.setCellOffset(x, y, m.offset);
                })
            );
        }

        return { blockLights, materials: this._materials };
    }
}
