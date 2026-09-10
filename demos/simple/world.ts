import { MapHelper, PHYS_NONE, Renderer, SpriteBinding, Vector, worldToCell } from '../../src/index.js';
import type { ActorFrame, ReadonlyCellMap } from '../../src/index.js';
import { Actor, ActorRegistry, DoorPolicy, computeWallCollisions, moveActor } from '../../src/simulation/index.js';
import { LEVEL, METRICS, SHADING, START } from './level.js';
import { SENTINEL_FACINGS, SENTINEL_TILE_HEIGHT, SENTINEL_TILE_WIDTH } from './spriteAtlas.js';

/** How close the player must be to a door to open it, in world units. */
const REACH = 96;
/** Player movement speed, in world units per tick. */
const WALK_SPEED = 3.2;
/** Turn speed, in radians per tick. */
const TURN_SPEED = 0.045;
/** Keeps the player off the walls, in world units. */
const PLAYER_RADIUS = 12;
/** How long an opened door waits before closing itself, in ticks. */
const DOOR_MAINTAIN = 180;
/** The sentinel's pacing speed, in world units per tick. */
const SENTINEL_SPEED = 1.1;

/** Everything the demo's own behaviour needs each tick. */
export interface DemoContext {
    map: ReadonlyCellMap;
    spacing: number;
    time: number;
}

/** What the player is asking for this tick. */
export interface Input {
    forward: number;
    strafe: number;
    turn: number;
    /** Set for one tick when the open-door key is pressed. */
    use: boolean;
}

export function emptyInput(): Input {
    return { forward: 0, strafe: 0, turn: 0, use: false };
}

/**
 * The demo world: a renderer, the simulation above it, and a player.
 *
 * Deliberately free of DOM and timers so the whole thing can be stepped and
 * rendered in a test. `main.ts` is the only part that knows about the browser.
 *
 * Everything here is composition. The library supplies wall sliding, door
 * policy, the actor registry and the sprite binding; this class decides only
 * what a *game* decides — how fast the player walks, how far they can reach,
 * that a door must not close on anyone, and how the sentinel paces.
 */
export class World {
    readonly renderer = new Renderer();
    readonly actors = new ActorRegistry<DemoContext>();
    readonly binding: SpriteBinding;
    readonly doors: DoorPolicy;
    /** The player is an actor like any other, so doors see them. */
    readonly player: Actor<DemoContext>;
    /** Eye height. Not the same as an actor's altitude. */
    readonly playerHeight = 1;

    private readonly _mapHelper = new MapHelper();
    private readonly _spacing: number;
    private _sentinel: Actor<DemoContext> | null = null;
    private _time = 0;

    constructor() {
        const rc = this.renderer;
        rc.setMetrics(METRICS);
        rc.setShading(SHADING);
        this._spacing = METRICS.spacing;
        this.binding = new SpriteBinding(rc);

        // One sector per cell, so "who is standing in this cell" is a lookup.
        this.actors.setSectors(LEVEL.map.length, METRICS.spacing);

        this.doors = new DoorPolicy({
            map: rc.cellMap,
            metrics: METRICS,
            maintainDuration: DOOR_MAINTAIN,
            // A door must not close on anyone — the player included, since the
            // player is an actor and files into the same sectors.
            isCellOccupied: (x, y) => this.actors.actorsAt(x, y).length > 0
        });

        this.player = this.actors.spawn({
            x: START.x * METRICS.spacing,
            y: START.y * METRICS.spacing,
            angle: START.angle,
            size: PLAYER_RADIUS,
            ref: 'player'
        });
    }

    /** Sizes the render surface. Call before the first frame. */
    setScreen(width: number, height: number): void {
        this.renderer.setScreen({ width, height });
    }

    /**
     * Installs textures, builds the map, and places the sentinel.
     *
     * Textures come in already decoded: the renderer performs no I/O.
     */
    build(walls: HTMLCanvasElement, flats: HTMLCanvasElement, sprites: HTMLCanvasElement): void {
        const rc = this.renderer;
        rc.setWallTextures(walls);
        rc.setFlatTextures(flats);
        this._mapHelper.build(rc, LEVEL);

        // A sprite is bound to an actor id once; after that the binding keeps
        // the two together, and the world never touches the sprite again.
        const sentinel = this.actors.spawn({
            x: 6.5 * this._spacing,
            y: 3.5 * this._spacing,
            size: 10,
            ref: 'sentinel',
            data: { direction: 1 }
        });
        const tileset = rc.buildTileSet(sprites, SENTINEL_TILE_WIDTH, SENTINEL_TILE_HEIGHT);
        const sprite = rc.buildSprite(tileset);
        sprite.buildAnimation(
            {
                starts: Array.from({ length: SENTINEL_FACINGS }, (_, i) => i),
                length: 1,
                duration: 100,
                loop: 0
            },
            'idle'
        );
        sprite.setCurrentAnimation('idle');
        this.binding.bind(sentinel.id, sprite, {
            light: rc.addLightSource(sentinel.position.x, sentinel.position.y, 24, 110, 0.6)
        });
        this._sentinel = sentinel;
    }

    /** The sentinel, once {@link build} has placed it. */
    get sentinel(): Actor<DemoContext> | null {
        return this._sentinel;
    }

    /** The cell the player is standing in. */
    get cell(): { x: number; y: number } {
        return worldToCell(this.player.position.x, this.player.position.y, this._spacing);
    }

    private get context(): DemoContext {
        return { map: this.renderer.cellMap, spacing: this._spacing, time: this._time };
    }

    /**
     * True if a point is inside a cell the player cannot enter.
     *
     * An opened door reports PHYS_NONE, which is what lets the player walk
     * through it once it has slid up. Anything off the map reads as solid, so
     * this needs no bounds check of its own.
     */
    private readonly isSolid = (x: number, y: number): boolean => {
        const c = worldToCell(x, y, this._spacing);
        return this.renderer.cellMap.getPhys(c.x, c.y) !== PHYS_NONE;
    };

    /**
     * The door cell the player is looking at and standing near, if any.
     *
     * Uses the cell the centre ray struck during the last frame, so what can
     * be opened is exactly what is under the crosshair.
     */
    aimedDoor(): { x: number; y: number } | null {
        const aimed = this.renderer.aimedCell;
        if (aimed === null || !this.doors.isDoor(aimed.xCell, aimed.yCell)) {
            return null;
        }
        const dx = aimed.x - this.player.position.x;
        const dy = aimed.y - this.player.position.y;
        if (dx * dx + dy * dy > REACH * REACH) {
            return null;
        }
        return { x: aimed.xCell, y: aimed.yCell };
    }

    /**
     * Starts opening the door under the crosshair.
     *
     * @returns true if a door was opened.
     */
    openAimedDoor(): boolean {
        const door = this.aimedDoor();
        return door !== null && this.doors.openDoor(door.x, door.y, true) !== null;
    }

    /** Paces the sentinel between the walls, turning where it is blocked. */
    private moveSentinel(context: DemoContext): void {
        const s = this._sentinel;
        if (s === null) {
            return;
        }
        const direction = s.data.direction as number;
        const travelled = moveActor(s, context, new Vector(0, direction * SENTINEL_SPEED));
        if (travelled.y === 0) {
            s.data.direction = -direction;
        }
        // Face the way it is walking, so the billboard picks the right frame.
        s.position.angle = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    /**
     * Advances the world one tick.
     *
     * Both handoffs are here, in the caller, rather than inside either layer:
     * the simulation never imports the renderer and the renderer never
     * advances time.
     */
    update(input: Input): void {
        ++this._time;
        const context = this.context;
        const p = this.player.position;
        p.angle += input.turn * TURN_SPEED;

        if (input.forward !== 0 || input.strafe !== 0) {
            const cos = Math.cos(p.angle);
            const sin = Math.sin(p.angle);
            const dx = (cos * input.forward - sin * input.strafe) * WALK_SPEED;
            const dy = (sin * input.forward + cos * input.strafe) * WALK_SPEED;
            const moved = computeWallCollisions(
                p.x, p.y, dx, dy, PLAYER_RADIUS, this._spacing, false, this.isSolid
            );
            p.x = moved.pos.x;
            p.y = moved.pos.y;
        }

        if (input.use) {
            this.openAimedDoor();
        }

        this.moveSentinel(context);

        // Doors: cell updates applied to the renderer.
        for (const { x, y, offset, phys } of this.doors.process()) {
            this.renderer.setCellOffset(x, y, offset | 0);
            this.renderer.setCellPhys(x, y, phys);
        }

        // Actors: one call moves every bound sprite, its light, and its facing.
        const frame: ActorFrame = this.actors.process(context);
        this.binding.apply(frame, p);
    }

    /** Draws the current state. */
    render(): void {
        const p = this.player.position;
        this.renderer.render(p.x, p.y, p.angle, this.playerHeight);
    }
}
