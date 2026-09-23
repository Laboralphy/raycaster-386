import {
    FACE_COUNT,
    METRIC_LIGHTMAP_SCALE,
    PHYS_INVISIBLE_BLOCK,
    PHYS_NONE,
    PHYS_TRANSPARENT_BLOCK,
    type Face,
} from './consts.js';
import {
    context2d,
    createCanvas,
    getData,
    resize,
    setImageSmoothing,
    type ImageSource,
} from './core/canvas.js';
import { MarkerRegistry } from './core/MarkerRegistry.js';
import { CellMap, type ReadonlyCellMap } from './core/CellMap.js';
import { CellSurfaceManager } from './map/CellSurfaceManager.js';
import { LightMap } from './light/LightMap.js';
import { LightSource } from './light/LightSource.js';
import { ShadedTileSet } from './texture/ShadedTileSet.js';
import {
    TileAnimation,
    createTileAnimation,
    type TileAnimationDef,
} from './texture/TileAnimation.js';
import { Sprite } from './Sprite.js';
import { DebugDisplay } from './DebugDisplay.js';
import {
    resolveTile,
    type CellCodes,
    type RenderContext,
    type SurfaceTile,
} from './raycast/context.js';
import { castRay } from './raycast/castRay.js';
import { createScene, type AimedCell, type Scene } from './raycast/Scene.js';
import { compareSlices, optimizeBuffer } from './raycast/ZBuffer.js';
import {
    createFlatContext,
    renderFlats,
    resetFlatContext,
    type FlatContext,
} from './render/renderFlats.js';
import { renderScreenSliceBuffer } from './render/renderScreenSlice.js';
import type { Profiler } from './render/Profiler.js';
import { renderSprites } from './render/renderSprites.js';
import { renderBackground } from './render/renderBackground.js';

/** What needs recomputing before the next frame. */
const enum Dirty {
    None = 0,
    /** Canvas size, focal length, vertical offset. */
    Screen = 1 << 0,
    /** Re-shade every tileset and painted surface. */
    Shading = 1 << 1,
    /** Drop the cached flat pixel data. */
    Flats = 1 << 2,
}

export interface ScreenSettings {
    width: number;
    height: number;
}

export interface MetricsSettings {
    /** Cell size in world units. */
    spacing: number;
    /** Wall height in texels. */
    height: number;
}

export interface ShadingSettings {
    /** Number of precomputed shading layers. More is smoother and larger. */
    shades: number;
    /** Fog colour. */
    color: string;
    /** Ambient colour filter, or null. */
    filter: string | null;
    /** Base brightness 0..1; higher means less fog at any distance. */
    brightness: number;
}

/** Faces of a material, as accepted by {@link Renderer.registerCellMaterial}. */
export interface CellMaterial {
    n?: SurfaceTile;
    e?: SurfaceTile;
    s?: SurfaceTile;
    w?: SurfaceTile;
    f?: SurfaceTile;
    c?: SurfaceTile;
}

/** A light source in world coordinates, with a live handle. */
export interface LightHandle {
    x: number;
    y: number;
    r0: number;
    r1: number;
    v: number;
    remove(): void;
}

/** Bytes held by a renderer, broken down by what holds them. */
export interface MemoryUsage {
    /** Wall, flat and sprite tilesets: their originals and shaded layers. */
    tilesets: number;
    /** Textures painted onto cell surfaces. */
    decals: number;
    /** The surface and cell light maps, which scale with the map size. */
    lightMaps: number;
    /** The backdrop, scaled to the screen. */
    background: number;
    /** The render canvas, plus the frame buffer the flat rasteriser reads. */
    screen: number;
    /** What upper storeys hold of their own. */
    storey: number;
    total: number;
}

/** Resources an upper storey shares with the floor below it. */
export interface SharedResources {
    walls: ShadedTileSet | null;
    flats: ShadedTileSet | null;
    animations: TileAnimation[];
    cellCodes: CellCodes;
    context: CanvasRenderingContext2D | null;
    canvas: HTMLCanvasElement | null;
    offsetTop: number;
}

/** Drops readonly so the reused render context can be rewritten in place. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DEFAULT_SCREEN: ScreenSettings = { width: 256, height: 256 };
const DEFAULT_METRICS: MetricsSettings = { spacing: 64, height: 96 };
const DEFAULT_SHADING: ShadingSettings = {
    shades: 16,
    color: 'black',
    filter: null,
    brightness: 0,
};

/**
 * Renders a raycast world into a canvas.
 *
 * Configuration goes through the typed setters below. Each records what it
 * invalidated and returns immediately; the work happens once at the top of
 * {@link render}. That keeps several settings changed in a row from
 * re-shading every tileset several times, without observing the option object
 * at runtime.
 *
 * The renderer performs no I/O: textures are handed in already decoded, which
 * is what makes every method here synchronous.
 */
export class Renderer {
    /**
     * World distance over which shading deepens by one layer.
     *
     * Read fresh every frame and needing no recomputation, so it is a plain
     * field rather than a setter. This is the one option the original engine
     * actually changed at runtime.
     */
    shadingFactor = 50;

    /**
     * Collects per-phase frame timings while set. Null, the default, costs a
     * null check per phase. See {@link Profiler}: a profiled frame is slower
     * than a real one, deliberately.
     */
    profiler: Profiler | null = null;

    /** Smaller values dim the whole scene faster with distance. */
    private _screen: ScreenSettings = { ...DEFAULT_SCREEN };
    private _metrics: MetricsSettings = { ...DEFAULT_METRICS };
    private _shading: ShadingSettings = { ...DEFAULT_SHADING };
    private _smooth = false;
    private _stretch = false;

    private _map: CellMap;
    private _csm = new CellSurfaceManager();
    private _lightMap = new LightMap();
    private _cellCodes: CellCodes = [];

    private _walls: ShadedTileSet | null = null;
    private _flats: ShadedTileSet | null = null;
    private _background: HTMLCanvasElement | null = null;
    private _tilesets: ShadedTileSet[] = [];
    private _animations: TileAnimation[] = [];
    private _sprites: Sprite[] = [];

    private _renderCanvas: HTMLCanvasElement | null = null;
    private _renderContext: CanvasRenderingContext2D | null = null;
    private _flatContext: FlatContext = createFlatContext();
    private _debugDisplay = new DebugDisplay();

    private _focal = (DEFAULT_SCREEN.width >> 1) * (16 / 9);
    private _offsetTop = 0;
    private _bgOffset = 0;
    private _bgCameraOffset = 0;

    private _storey: Renderer | null = null;
    private _firstFloor = true;

    private _scanCells: MarkerRegistry | null = null;
    private _scanFrontCells: MarkerRegistry | null = null;
    private _aimedCell: AimedCell | null = null;

    /** Reused every ray instead of allocating a Set per screen column. */
    private _exclusionRegistry = new MarkerRegistry();
    /** Reused every frame; see {@link context}. */
    private _context: RenderContext | null = null;
    private _dirty: number = Dirty.Screen | Dirty.Shading;

    /**
     * @param map the cell map to render. Pass one to share it with the
     * simulation layer, which reads cell phys to decide what blocks movement;
     * omit it and this renderer owns a private one.
     */
    constructor(map: CellMap = new CellMap()) {
        this._map = map;
        this._offsetTop = (DEFAULT_SCREEN.width - DEFAULT_SCREEN.height) >>> 1;
    }

    // ---------------------------------------------------------------- state

    get debug(): DebugDisplay {
        return this._debugDisplay;
    }

    /** The canvas frames are drawn into. Null until the first render. */
    get renderCanvas(): HTMLCanvasElement | null {
        return this._renderCanvas;
    }

    /**
     * Projection focal length. Derived from the screen width; the original
     * exposed it as a setting but overwrote it on every resize.
     */
    get focal(): number {
        return this._focal;
    }

    get screen(): Readonly<ScreenSettings> {
        return this._screen;
    }

    get metrics(): Readonly<MetricsSettings> {
        return this._metrics;
    }

    get shading(): Readonly<ShadingSettings> {
        return this._shading;
    }

    /** Cells any ray reached during the last frame. */
    get visibleCells(): MarkerRegistry | null {
        return this._scanCells;
    }

    /** Cells the centre ray reached during the last frame. */
    get visibleFrontCells(): MarkerRegistry | null {
        return this._scanFrontCells;
    }

    /** The cell the centre ray struck during the last frame. */
    get aimedCell(): AimedCell | null {
        return this._aimedCell;
    }

    /** Horizontal backdrop offset, in pixels. */
    get backgroundOffset(): number {
        return this._bgOffset;
    }

    set backgroundOffset(value: number) {
        this._bgOffset = value;
    }

    // -------------------------------------------------------------- setters

    setScreen({ width, height }: ScreenSettings): void {
        this._screen = { width, height };
        this._focal = (width >> 1) * (16 / 9);
        this._offsetTop = (width - height) >>> 1;
        this._dirty |= Dirty.Screen;
        this._storey?.setScreen({ width, height });
    }

    setMetrics({ spacing, height }: MetricsSettings): void {
        this._metrics = { spacing, height };
        this._dirty |= Dirty.Shading;
        this._storey?.setMetrics({ spacing, height });
    }

    setShading(settings: ShadingSettings): void {
        this._shading = { ...settings };
        this._dirty |= Dirty.Shading;
        // The storey shares this renderer's tilesets, so it must agree about
        // how many shading layers they hold. The original never pushed this
        // down — the transmit was commented out — so its storey indexed a
        // ground-floor tileset with the default layer count.
        this._storey?.setShading(settings);
    }

    /** Nearest-neighbour when false, which is what pixel-art textures want. */
    setTextureSmoothing(value: boolean): void {
        this._smooth = value;
        this._dirty |= Dirty.Screen;
        this._storey?.setTextureSmoothing(value);
    }

    /** Draw upper storeys at double height. */
    setStretch(value: boolean): void {
        this._stretch = value;
        this._storey?.setStretch(value);
    }

    // ------------------------------------------------------------- textures

    /**
     * Sets the wall texture atlas. Tiles are `metrics.spacing` wide and
     * `metrics.height` tall.
     */
    setWallTextures(image: ImageSource): void {
        this._walls = this.buildTileSet(image, this._metrics.spacing, this._metrics.height);
        this._dirty |= Dirty.Shading;
        this.shareWithStorey();
    }

    /** Sets the floor and ceiling atlas. Tiles are square. */
    setFlatTextures(image: ImageSource): void {
        const s = this._metrics.spacing;
        this._flats = this.buildTileSet(image, s, s);
        // Flats are sampled per pixel and never drawn, so the shaded layers
        // are kept as pixels rather than as a canvas as well.
        this._flats.setPixelStorage(true);
        this._dirty |= Dirty.Shading | Dirty.Flats;
        this.shareWithStorey();
    }

    /** Sets the backdrop, scaled to the screen height. */
    setBackground(image: HTMLCanvasElement): void {
        const h = this._screen.height;
        const r = h / image.height;
        this._background = r === 1 ? image : resize(image, image.width * r, h);
    }

    /**
     * Creates a tileset and registers it for shading.
     *
     * @param noShading a sprite that should not dim with distance
     */
    buildTileSet(
        image: ImageSource,
        width: number,
        height: number,
        noShading = false
    ): ShadedTileSet {
        const ts = new ShadedTileSet();
        ts.shading = !noShading;
        ts.setShadingLayerCount(this._shading.shades);
        ts.setImage(image, width, height);
        this._tilesets.push(ts);
        return ts;
    }

    /** Drops tilesets no sprite still references. */
    removeUnusedTileSets(): void {
        const used = new Set(this._sprites.map((s) => s.getTileSet()));
        this._tilesets = this._tilesets.filter((ts) => used.has(ts));
    }

    /**
     * Draws every texture once, so that the first frames need not.
     *
     * A browser does not hand a canvas to the GPU when it is decoded, but the
     * first time something samples it. For a level with fifty-odd atlases that
     * lands on the first frames as a stutter: measured on the demo level in
     * Firefox, a cold frame cost 33 ms against 8 ms warm, and the cost was
     * charged to whichever pass happened to touch each atlas first.
     *
     * Call it once, after the textures are in and before the first
     * {@link render} — while a loading screen is still up, which is the point.
     * Each texture is drawn whole into a single pixel: the sampling costs
     * nothing, and it is being sampled at all that makes it resident.
     *
     * Flats are left out on purpose. The flat rasteriser reads them as pixels
     * and never draws them, so they are never uploaded.
     */
    warmUpTextures(): void {
        this.revalidate();
        const ctx = this._renderContext;
        if (ctx === null) {
            return;
        }
        const touch = (image: HTMLCanvasElement | null): void => {
            if (image === null || image.width === 0 || image.height === 0) {
                return;
            }
            ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, 1, 1);
        };

        touch(this._background);
        touch(this._walls?.getImage() ?? null);
        for (const ts of this._tilesets) {
            if (ts !== this._flats) {
                touch(ts.getImage());
            }
        }
        // Decals painted on walls are drawn like the walls they cover; the
        // ones on floors and ceilings are sampled, like the flats.
        const surfaces = this._csm.surfaces;
        for (let i = 0, l = surfaces.length; i < l; ++i) {
            if (i % FACE_COUNT < 4) {
                touch(surfaces[i].tileset?.getImage() ?? null);
            }
        }

        // The corner this scribbled in belongs to the next frame, which clears
        // before drawing anyway; leaving it dirty would still be untidy.
        this.clear(ctx);
        this._storey?.warmUpTextures();
    }

    /**
     * Approximate bytes held by everything this renderer keeps in memory.
     *
     * Every field is measured, not estimated, from the canvases and typed
     * arrays that exist. Nothing is counted twice: a tileset several sprites
     * share counts once, and an upper storey counts only what it owns, since
     * it draws with the textures and the canvas of the floor below.
     */
    getMemoryUsage(): MemoryUsage {
        // Walls and flats are added explicitly: they live in `_tilesets` only
        // until removeUnusedTileSets(), which keeps sprite tilesets alone.
        const counted = new Set<ShadedTileSet>(this._tilesets);
        const adopted = !this._firstFloor;
        if (adopted) {
            // Owned by the ground floor, which reports them.
            counted.delete(this._walls as ShadedTileSet);
            counted.delete(this._flats as ShadedTileSet);
        } else {
            if (this._walls !== null) {
                counted.add(this._walls);
            }
            if (this._flats !== null) {
                counted.add(this._flats);
            }
        }
        let tilesets = 0;
        for (const ts of counted) {
            tilesets += ts.getMemoryUsage();
        }

        const { decals, lightMaps } = this._csm.getMemoryUsage();
        const bg = this._background;
        const background = bg === null ? 0 : bg.width * bg.height * 4;
        const canvas = this._renderCanvas;
        const screen =
            (adopted || canvas === null ? 0 : canvas.width * canvas.height * 4) +
            (this._flatContext.renderSurface?.data.byteLength ?? 0);
        const storey = this._storey?.getMemoryUsage().total ?? 0;

        return {
            tilesets,
            decals,
            lightMaps,
            background,
            screen,
            storey,
            total: tilesets + decals + lightMaps + background + screen + storey,
        };
    }

    // ------------------------------------------------------------------ map

    /** Resizes the map. It is always square. */
    setMapSize(size: number): void {
        this._map.setSize(size);
        this._csm.setMapSize(size, size);
        this._lightMap.setSize(size * METRIC_LIGHTMAP_SCALE, size * METRIC_LIGHTMAP_SCALE);
        this._storey?.setMapSize(size);
    }

    getMapSize(): number {
        return this._map.size;
    }

    /**
     * The cell map, so that code with no interest in rendering can read it.
     *
     * Read-only by type: {@link setCellPhys} also re-traces the light map and
     * {@link setMapSize} resizes the surface and light buffers alongside the
     * map, so writes have to go through this renderer while one is attached.
     * Whoever constructed the map still holds a writable {@link CellMap} — a
     * headless caller with no renderer has neither buffer to keep in step and
     * can write to it freely.
     */
    get cellMap(): ReadonlyCellMap {
        return this._map;
    }

    /**
     * Assigns tiles to a material code, per face.
     *
     * A face may be a tileset index, a {@link TileAnimation}, or null to draw
     * nothing there.
     */
    registerCellMaterial(
        code: number,
        { n = null, e = null, s = null, w = null, f = null, c = null }: CellMaterial
    ): void {
        this._cellCodes[code] = [w, s, e, n, f, c];
        this.shareWithStorey();
    }

    setCellMaterial(x: number, y: number, code: number): void {
        this._map.setMaterial(x, y, code);
    }

    /**
     * Sets a cell's physical code, updating what it does to light.
     */
    setCellPhys(x: number, y: number, code: number): void {
        if (!this._map.setPhys(x, y, code)) {
            return;
        }
        const ms = METRIC_LIGHTMAP_SCALE;
        this._lightMap.setLightBlocking(
            x * ms,
            y * ms,
            ms,
            ms,
            code !== PHYS_NONE && code !== PHYS_TRANSPARENT_BLOCK && code !== PHYS_INVISIBLE_BLOCK
        );
    }

    setCellOffset(x: number, y: number, code: number): void {
        this._map.setOffset(x, y, code);
    }

    getCellMaterial(x: number, y: number): number {
        return this._map.getMaterial(x, y);
    }

    getCellPhys(x: number, y: number): number {
        return this._map.getPhys(x, y);
    }

    getCellOffset(x: number, y: number): number {
        return this._map.getOffset(x, y);
    }

    /** True if any ray reached this cell during the last frame. */
    isCellVisible(x: number, y: number): boolean {
        return this._scanCells !== null && this._scanCells.isMarked(x, y);
    }

    // --------------------------------------------------------------- storey

    /** The upper floor's renderer, if one was created. */
    get storey(): Renderer | null {
        return this._storey;
    }

    /**
     * Creates the renderer for the floor above this one.
     *
     * The storey is not independently configurable: this renderer owns every
     * setting and pushes them down. The original instead wrote directly into
     * the other instance's private fields.
     */
    createStorey(): Renderer {
        const storey = new Renderer();
        storey._firstFloor = false;
        this._storey = storey;
        storey.setScreen(this._screen);
        storey.setMetrics(this._metrics);
        storey.setShading(this._shading);
        storey.setStretch(this._stretch);
        storey.setMapSize(this.getMapSize());
        this.shareWithStorey();
        return storey;
    }

    /** Adopts resources owned by the floor below. */
    adoptShared(res: SharedResources): void {
        this._context = null;
        this._walls = res.walls;
        this._flats = res.flats;
        this._animations = res.animations;
        this._cellCodes = res.cellCodes;
        this._renderContext = res.context;
        this._renderCanvas = res.canvas;
        this._offsetTop = res.offsetTop;
        // Point at the ground floor's flat pixels rather than reading a copy
        // of our own. Reassigned outright: the previous code only refreshed
        // `image`, leaving a storey sampling the atlas it had cached before
        // the floor below replaced its flat textures.
        this.useFlatPixels();
    }

    /** Points the flat rasteriser at the current flat tileset's pixels. */
    private useFlatPixels(): void {
        const fc = this._flatContext;
        const flats = this._flats;
        fc.pixels32 = flats?.getPixels32() ?? null;
        fc.pixelsWidth = flats?.getPixels()?.width ?? 0;
    }

    private shareWithStorey(): void {
        this._storey?.adoptShared({
            walls: this._walls,
            flats: this._flats,
            animations: this._animations,
            cellCodes: this._cellCodes,
            context: this._renderContext,
            canvas: this._renderCanvas,
            offsetTop: this._offsetTop,
        });
    }

    // ---------------------------------------------------------------- light

    /**
     * Adds a light source, in world coordinates.
     *
     * The returned handle converts to lightmap units on write, so moving a
     * light is just `handle.x = ...`.
     */
    addLightSource(x: number, y: number, r0: number, r1: number, v: number): LightHandle {
        const r = METRIC_LIGHTMAP_SCALE / this._metrics.spacing;
        const lightMap = this._lightMap;
        const source: LightSource = lightMap.addSource(
            (x * r) | 0,
            (y * r) | 0,
            (r0 * r) | 0,
            (r1 * r) | 0,
            v
        );
        let wx = x;
        let wy = y;
        let wr0 = r0;
        let wr1 = r1;
        return {
            get x() {
                return wx;
            },
            set x(value: number) {
                wx = value;
                source.x = (value * r) | 0;
            },
            get y() {
                return wy;
            },
            set y(value: number) {
                wy = value;
                source.y = (value * r) | 0;
            },
            get r0() {
                return wr0;
            },
            set r0(value: number) {
                wr0 = value;
                source.r0 = (value * r) | 0;
            },
            get r1() {
                return wr1;
            },
            set r1(value: number) {
                wr1 = value;
                source.r1 = (value * r) | 0;
            },
            get v() {
                return source.v;
            },
            set v(value: number) {
                source.v = value;
            },
            remove: () => lightMap.removeSource(source),
        };
    }

    /** Retraces light sources whose geometry changed, if any did. */
    updateStaticLightMap(): void {
        const lm = this._lightMap;
        if (!lm.isInvalid()) {
            return;
        }
        const max = this._shading.shades;
        const csm = this._csm;
        lm.traceAllSources();
        lm.filter((x, y, n) => {
            csm.setLightMap(x, y, (n * max) | 0);
        });
    }

    // -------------------------------------------------------------- surface

    /**
     * Paints onto one surface of one cell.
     *
     * The callback receives a canvas holding a copy of the surface's current
     * texture; whatever it draws becomes that surface's new appearance.
     */
    paintSurface(
        x: number,
        y: number,
        face: Face,
        draw: (x: number, y: number, face: Face, canvas: HTMLCanvasElement) => void
    ): void {
        const surface = this._csm.getSurface(x, y, face);
        if (surface === null) {
            throw new RangeError(`Renderer.paintSurface: (${x}, ${y}) is outside the map`);
        }
        let canvas: HTMLCanvasElement;
        if (surface.tileset !== null) {
            // Already painted: keep drawing on what is there.
            const existing = surface.tileset.getOriginalImage();
            if (existing === null) {
                throw new Error('Renderer.paintSurface: existing decal has no image');
            }
            canvas = existing;
        } else {
            const source = face < 4 ? this._walls : this._flats;
            if (source === null) {
                throw new Error('Renderer.paintSurface: textures have not been set');
            }
            const tile = resolveTile(this._cellCodes, this.getCellMaterial(x, y), face);
            canvas = source.extractTile(tile ?? 0, 0);
        }
        setImageSmoothing(canvas, true);
        draw(x, y, face, canvas);
        setImageSmoothing(canvas, this._smooth);
        this._csm.setDecal(x, y, face, canvas);
        this.shadeSurface(x, y, face);
    }

    shadeSurface(x: number, y: number, face: Face): void {
        const s = this._shading;
        this._csm.shadeSurface(x, y, face, s.shades, s.color, s.filter, s.brightness);
    }

    // -------------------------------------------------------------- sprites

    buildSprite(tileset: ShadedTileSet): Sprite {
        const sprite = new Sprite();
        sprite.setTileSet(tileset);
        this._sprites.push(sprite);
        return sprite;
    }

    disposeSprite(sprite: Sprite): void {
        const i = this._sprites.indexOf(sprite);
        if (i >= 0) {
            this._sprites.splice(i, 1);
        }
    }

    // ----------------------------------------------------------- animations

    linkAnimation(animation: TileAnimation): TileAnimation {
        this._animations.push(animation);
        return animation;
    }

    buildSurfaceAnimation(def: TileAnimationDef): TileAnimation {
        return this.linkAnimation(createTileAnimation(def));
    }

    /**
     * Rewinds every surface and sprite animation to its first frame.
     *
     * Useful when restarting a level, and it makes a given animation time
     * reproducible: reset, then advance, lands on the same frame every time.
     */
    resetAnimations(): void {
        const anims = this._animations;
        for (let i = 0, l = anims.length; i < l; ++i) {
            anims[i].reset();
        }
        const sprites = this._sprites;
        for (let i = 0, l = sprites.length; i < l; ++i) {
            sprites[i].animation?.reset();
        }
    }

    /** Advances every surface animation and every sprite animation. */
    computeAnimations(timeInc: number): void {
        const anims = this._animations;
        for (let i = 0, l = anims.length; i < l; ++i) {
            anims[i].animate(timeInc);
        }
        const sprites = this._sprites;
        for (let i = 0, l = sprites.length; i < l; ++i) {
            sprites[i].animation?.animate(timeInc);
        }
    }

    // ------------------------------------------------------------ rendering

    /** Applies everything the setters invalidated. Idempotent. */
    private revalidate(): void {
        if (this._dirty === Dirty.None) {
            return;
        }
        const dirty = this._dirty;
        this._dirty = Dirty.None;

        if (dirty & Dirty.Screen) {
            const { width, height } = this._screen;
            if (this._renderCanvas === null) {
                this._renderCanvas = createCanvas(width, height);
            }
            this._renderCanvas.width = width;
            this._renderCanvas.height = height;
            this._renderContext = context2d(this._renderCanvas);
            setImageSmoothing(this._renderCanvas, this._smooth);
        }
        if (dirty & Dirty.Shading) {
            const s = this._shading;
            this._walls?.setShadingLayerCount(s.shades);
            this._walls?.compute(s.color, s.filter, s.brightness);
            if (this._flats !== null) {
                this._flats.setShadingLayerCount(s.shades);
                this._flats.compute(s.color, s.filter, s.brightness);
                resetFlatContext(this._flatContext);
                this.useFlatPixels();
            }
            this._csm.shadeAllSurfaces(s.shades, s.color, s.filter, s.brightness);
            for (const ts of this._tilesets) {
                if (ts !== this._walls && ts !== this._flats) {
                    ts.setShadingLayerCount(s.shades);
                    ts.compute(s.color, s.filter, s.brightness);
                }
            }
        } else if (dirty & Dirty.Flats) {
            resetFlatContext(this._flatContext);
            this.useFlatPixels();
        }
        this.shareWithStorey();
    }

    /**
     * The hot-path scalars, gathered for the raycasting functions.
     *
     * One object, rewritten in place each frame rather than reallocated: it
     * is read a few hundred thousand times per frame and a stable object
     * keeps those reads monomorphic.
     */
    private context(): RenderContext {
        let c = this._context;
        if (c === null) {
            c = this._context = {
                map: this._map,
                csm: this._csm,
                cellCodes: this._cellCodes,
                walls: this._walls,
                spacing: 0,
                wallHeight: 0,
                screenWidth: 0,
                screenHeight: 0,
                shades: 0,
                shadingFactor: 0,
                offsetTop: 0,
                stretch: false,
                firstFloor: this._firstFloor,
                coverTop: new Int32Array(0),
                coverBottom: new Int32Array(0),
                profiler: null,
            } as RenderContext;
        }
        const m = c as Mutable<RenderContext>;
        m.cellCodes = this._cellCodes;
        m.walls = this._walls;
        m.spacing = this._metrics.spacing;
        m.wallHeight = this._metrics.height;
        m.screenWidth = this._screen.width;
        m.screenHeight = this._screen.height;
        m.shades = this._shading.shades;
        m.shadingFactor = this.shadingFactor;
        m.offsetTop = this._offsetTop;
        m.stretch = this._stretch;
        m.profiler = this.profiler;
        if (m.coverTop.length !== m.screenWidth) {
            m.coverTop = new Int32Array(m.screenWidth);
            m.coverBottom = new Int32Array(m.screenWidth);
        }
        return c;
    }

    /** Builds a scene for this renderer and, recursively, for its storey. */
    private createSceneFor(x: number, y: number, angle: number, height: number): Scene {
        return createScene({
            x,
            y,
            direction: angle,
            height,
            focal: this._focal,
            screenWidth: this._screen.width,
            spacing: this._metrics.spacing,
            storeyScene: this._storey?.createSceneFor(x, y, angle, height + 2) ?? null,
        });
    }

    /**
     * Casts every screen column, filling the scene's z-buffer.
     */
    private computeScreenSliceBuffer(scene: Scene): void {
        const ctx = this.context();
        const camera = scene.camera;
        const xCamera = camera.x;
        const yCamera = camera.y;
        const width = ctx.screenWidth;
        const fov = camera.fov;
        const spacing = ctx.spacing;

        const angleLeft = camera.direction - fov;
        const angleRight = camera.direction + fov;
        const wx1 = Math.cos(angleLeft);
        const wy1 = Math.sin(angleLeft);
        const wx2 = Math.cos(angleRight);
        const wy2 = Math.sin(angleRight);
        const dx = (wx2 - wx1) / width;
        const dy = (wy2 - wy1) / width;

        let bx = wx1;
        let by = wy1;

        const scanCells = new MarkerRegistry();
        scanCells.mark((xCamera / spacing) | 0, (yCamera / spacing) | 0);
        this._scanCells = scanCells;

        if (this._background !== null) {
            this._bgCameraOffset = (2 * camera.direction * this._background.width) / Math.PI;
        }

        const zbuffer = scene.zbuffer;
        const middle = width >> 1;
        const exclusion = this._exclusionRegistry;

        // An empty band per column: createScreenSlice widens it for every
        // opaque wall it emits, and the flat rasteriser reads the result.
        ctx.coverTop.fill(ctx.screenHeight);
        ctx.coverBottom.fill(0);

        for (let i = 0; i < width; ++i) {
            scene.resume.active = false;
            if (i === middle) {
                const front = new MarkerRegistry();
                castRay(ctx, scene, xCamera, yCamera, bx, by, i, front, zbuffer, exclusion);
                this._scanFrontCells = front;
                scanCells.merge(front);
                this._aimedCell = {
                    xCell: scene.xCell,
                    yCell: scene.yCell,
                    x: scene.xint,
                    y: scene.yint,
                    side: scene.cellSide,
                };
            } else {
                castRay(ctx, scene, xCamera, yCamera, bx, by, i, scanCells, zbuffer, exclusion);
            }
            bx += dx;
            by += dy;
        }

        scene.zbuffer = optimizeBuffer(zbuffer);
        renderSprites(ctx, scene, this._sprites, (cx, cy) => this.isCellVisible(cx, cy));
        // Back to front, so translucent surfaces composite correctly.
        scene.zbuffer.sort(compareSlices);
        if (this._storey !== null && scene.storeyScene !== null) {
            this._storey.computeScreenSliceBuffer(scene.storeyScene);
        }
    }

    /** Builds a scene and casts it, without drawing anything. */
    computeScene(x: number, y: number, angle: number, height: number): Scene {
        this.revalidate();
        if (this._storey !== null) {
            // shadingFactor is a live field rather than a setter, so it is
            // pushed down here instead of at assignment time.
            this._storey.shadingFactor = this.shadingFactor;
        }
        const scene = this.createSceneFor(x, y, angle, height);
        this.computeScreenSliceBuffer(scene);
        return scene;
    }

    /**
     * Renders one frame.
     *
     * Two ordering fixes over the original. The light map is brought up to
     * date *before* the scene is cast, not after: the original traced it
     * between building the z-buffer and drawing the flats, so the first frame
     * after a light changed shaded its walls against a stale map while its
     * floor already used the new one. And the canvas is cleared first: the
     * original painted background, flats and slices without clearing, so any
     * pixel none of them covered — the gap left by a half-open door, for
     * instance — kept whatever the previous frame drew there.
     */
    render(x: number, y: number, angle: number, height: number): void {
        const prof = this.profiler;
        prof?.startFrame();
        this.revalidate();
        this.updateStaticLightMap();
        prof?.mark('setup');

        const scene = this.computeScene(x, y, angle, height);
        const renderContext = this._renderContext;
        if (renderContext === null) {
            return;
        }
        prof?.mark('raycast');

        this.clear(renderContext);
        prof?.mark('clear');
        renderBackground(
            this._background,
            renderContext,
            this._screen.height,
            this._bgOffset + this._bgCameraOffset
        );
        prof?.mark('background');
        if (scene.storeyScene !== null) {
            // The storey is drawn first, so anything an opaque ground-floor
            // wall will cover is skipped rather than drawn and painted over.
            const ctx = this.context();
            renderScreenSliceBuffer(scene.storeyScene, renderContext, {
                top: ctx.coverTop,
                bottom: ctx.coverBottom,
            });
        }
        prof?.mark('storey');
        // The flat rasteriser marks its own phases, the first of which is the
        // flush that everything above is really paying for.
        renderFlats(this.context(), scene, renderContext, this._flatContext);
        renderScreenSliceBuffer(scene, renderContext);
        prof?.mark('slices');
        if (prof !== null) {
            // Nothing else reads pixels after the slices, so without this they
            // would be rasterised in the next frame and charged to it.
            prof.probe(renderContext);
            prof.mark('present');
        }
        this._debugDisplay.display(renderContext, 0, this._offsetTop);
        prof?.endFrame();
    }

    /**
     * Resets the frame to opaque black.
     *
     * Opaque rather than transparent so that a pixel nothing draws over is
     * still a defined colour, and so a frame never depends on the one before
     * it.
     */
    private clear(context: CanvasRenderingContext2D): void {
        const canvas = this._renderCanvas;
        if (canvas === null) {
            return;
        }
        context.save();
        context.globalCompositeOperation = 'copy';
        context.fillStyle = '#000000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
    }

    /** Copies the last frame into another context. */
    flip(target: CanvasRenderingContext2D): void {
        if (this._renderCanvas !== null) {
            target.drawImage(this._renderCanvas, 0, 0);
        }
    }

    /** The last frame as a data URL, optionally rescaled. */
    screenshot(width?: number, height?: number, type = 'image/png'): string {
        const source = this._renderCanvas;
        if (source === null) {
            throw new Error('Renderer.screenshot: nothing has been rendered yet');
        }
        const w = width ?? source.width;
        const h = height ?? source.height;
        const canvas = createCanvas(w, h);
        context2d(canvas).drawImage(source, 0, 0, source.width, source.height, 0, 0, w, h);
        return getData(canvas, type);
    }
}
