import { Renderer, SpriteBinding, buildObjects, loadLevel, worldToCell } from '../../src';
import type { ActorFrame, LoadedLevel, PlacedObject, ReadonlyCellMap, RceLevel } from '../../src';
import { Actor, ActorRegistry, DoorPolicy, TagTriggers } from '../../src/simulation';
import type { TagEvent } from '../../src/simulation';
import { DOOR_MAINTAIN, PLAYER_RADIUS, REACH, TICK_MS } from './level.js';
import { PlayerThinker } from './thinkers.js';
import { type Input } from './input';

/** Everything a thinker is handed each tick. See `demos/simple/world.ts`. */
export interface DemoContext {
    map: ReadonlyCellMap;
    spacing: number;
    time: number;
    input: Input;
}

/** Decodes one of the level's textures. Supplied by the host — see `main.ts`. */
export type LoadImage = (src: string) => Promise<HTMLCanvasElement>;

/** A tag the player has just set off, for the HUD to show. */
export interface FiredTag {
    command: string;
    parameters: string[];
    at: number;
}

/**
 * The dark-village world: a real level, the simulation above it, and a player.
 *
 * The same shape as `demos/simple/world.ts` — DOM-free, steppable in a test —
 * but where that one builds a hardcoded 10x10 map with `MapHelper`, this reads
 * a converted MapEdit level through `loadLevel`. That is the only structural
 * difference, and it is the point of the demo: 59x59 cells with an upper
 * storey, 53 materials, 63 decorative objects, a double door, a secret
 * passage, and two tagged cells.
 */
export class World {
    readonly renderer = new Renderer();
    readonly actors = new ActorRegistry<DemoContext>();
    readonly binding: SpriteBinding;
    readonly tags = new TagTriggers();
    /** Null until {@link build} has read the level. */
    private _doors: DoorPolicy | null = null;
    private _player: Actor<DemoContext> | null = null;
    private _loaded: LoadedLevel | null = null;
    private _objects: readonly PlacedObject[] = [];
    private _spacing = 64;
    private _time = 0;
    private _fired: FiredTag | null = null;

    /** Eye height, as the level's start point declares it. */
    playerHeight = 1;

    constructor() {
        this.binding = new SpriteBinding(this.renderer);
    }

    /** Sizes the render surface. Call before the first frame. */
    setScreen(width: number, height: number): void {
        this.renderer.setScreen({ width, height });
    }

    /**
     * Reads the level, places its scenery, and spawns the player.
     *
     * Async because `loadLevel` decodes textures, which is I/O the library
     * refuses to do itself: `loadImage` is handed in.
     */
    async build(data: RceLevel, loadImage: LoadImage): Promise<void> {
        const rc = this.renderer;
        const loaded = await loadLevel(rc, data, { loadImage });
        this._loaded = loaded;
        this._spacing = data.level.metrics.spacing;

        // Decorative objects: sprites at positions, with their animations and
        // lights. `buildObjects` builds no behaviour — see below. The handles
        // are kept because a game reaches its scenery through them; the
        // renderer's own sprite list is private.
        this._objects = await buildObjects(rc, loaded, { loadImage });

        // One sector per cell, so "who is standing here" is a lookup.
        this.actors.setSectors(rc.getMapSize(), this._spacing);

        this._doors = new DoorPolicy({
            map: rc.cellMap,
            metrics: data.level.metrics,
            maintainDuration: DOOR_MAINTAIN,
            isCellOccupied: (x, y) => this.actors.actorsAt(x, y).length > 0,
        });

        // The level's tagged cells, lifted into the trigger grid. The two here
        // read `goto mans-cabin 1` and `event mi_lightning_0`; this demo only
        // reports them, since where they lead is a game's business.
        this.tags.setMapSize(rc.getMapSize(), this._spacing);
        for (const tag of loaded.unhandled.tags) {
            for (const text of tag.tags) {
                this.tags.grid.addTag(tag.x, tag.y, text);
            }
        }
        const fired = (e: TagEvent): void => {
            this._fired = { command: e.command, parameters: e.parameters, at: this._time };
        };
        this.tags.events.on('enter', fired);
        this.tags.events.on('push', fired);

        const start = loaded.startpoint ?? { x: 1, y: 1, z: 1, angle: 0 };
        this.playerHeight = start.z;
        this._player = this.actors.spawn({
            x: (start.x + 0.5) * this._spacing,
            y: (start.y + 0.5) * this._spacing,
            angle: start.angle,
            size: PLAYER_RADIUS,
            ref: 'player',
        });
        this._player.thinker = new PlayerThinker();
    }

    get player(): Actor<DemoContext> {
        if (this._player === null) {
            throw new Error('World: build() has not run yet');
        }
        return this._player;
    }

    get doors(): DoorPolicy {
        if (this._doors === null) {
            throw new Error('World: build() has not run yet');
        }
        return this._doors;
    }

    /** The scenery this level placed, as `buildObjects` returned it. */
    get objects(): readonly PlacedObject[] {
        return this._objects;
    }

    /** The level as loaded, for a caller that wants its blueprints or lights. */
    get loaded(): LoadedLevel | null {
        return this._loaded;
    }

    /** The most recent tag the player walked into, if any. */
    get firedTag(): FiredTag | null {
        return this._fired;
    }

    /** The cell the player is standing in. */
    get cell(): { x: number; y: number } {
        const p = this.player.position;
        return worldToCell(p.x, p.y, this._spacing);
    }

    private context(input: Input): DemoContext {
        return {
            map: this.renderer.cellMap,
            spacing: this._spacing,
            time: this._time,
            input,
        };
    }

    /**
     * The cell directly in front of the player.
     *
     * Probed from the player's own position and facing rather than read off
     * the crosshair, because the two do not agree on everything: the centre
     * ray passes *through* a transparent block and reports whatever opaque
     * wall stands behind it, so a tag sitting on one — as this level's
     * `goto` does — can never be under the crosshair. What you are standing
     * in front of is the honest question for a use key.
     */
    facedCell(): { x: number; y: number } {
        const p = this.player.position;
        const probe = this._spacing * 0.75;
        return worldToCell(
            p.x + Math.cos(p.angle) * probe,
            p.y + Math.sin(p.angle) * probe,
            this._spacing
        );
    }

    /**
     * The door the player is looking at and standing near, if any.
     *
     * This one *does* use the crosshair: a door is opaque, so the ray stops on
     * it, and a door you can see is a door you can ask to open.
     */
    aimedDoor(): { x: number; y: number } | null {
        const aimed = this.renderer.aimedCell;
        if (aimed === null || !this.doors.isDoor(aimed.xCell, aimed.yCell)) {
            return null;
        }
        const p = this.player.position;
        const dx = aimed.x - p.x;
        const dy = aimed.y - p.y;
        if (dx * dx + dy * dy > REACH * REACH) {
            return null;
        }
        return { x: aimed.xCell, y: aimed.yCell };
    }

    /**
     * Acts on what the player is facing: opens an aimed door, and tells
     * whatever is tagged in front that it was tried.
     *
     * Both of this level's tags sit on solid cells — one a transparent block,
     * one a wall — so neither is ever walked into. `TagTriggers.push` is the
     * path for those, and it fires whether or not anything opened.
     *
     * @returns true if a door was opened.
     */
    use(): boolean {
        const faced = this.facedCell();
        this.tags.push(this.player.id, faced.x, faced.y);
        const door = this.aimedDoor();
        return door !== null && this.doors.openDoor(door.x, door.y, true) !== null;
    }

    /**
     * Advances the world one tick.
     *
     * The same four steps as `demos/simple`, plus the tag grid — which reads
     * the very same `ActorFrame` the sprite binding does, so walking over a
     * trigger costs nothing extra per tick.
     */
    update(input: Input): void {
        ++this._time;

        const frame: ActorFrame = this.actors.process(this.context(input));

        if (input.use) {
            this.use();
        }

        for (const { x, y, offset, phys } of this.doors.process()) {
            this.renderer.setCellOffset(x, y, offset | 0);
            this.renderer.setCellPhys(x, y, phys);
        }

        this.tags.process(frame);
        this.binding.apply(frame, this.player.position);

        // Torches and the other animated tilesets. The renderer holds the
        // frames but advances nothing on its own, so the clock is the
        // simulation's — which keeps an animation reproducible across a pause
        // or a replay, as door timing already is.
        this.renderer.computeAnimations(TICK_MS);
    }

    /** Draws the current state. */
    render(): void {
        const p = this.player.position;
        this.renderer.render(p.x, p.y, p.angle, this.playerHeight);
    }
}
