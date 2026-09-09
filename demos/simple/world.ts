import { MapHelper, PHYS_NONE, Renderer, worldToCell } from '../../src/index.js';
import { computeWallCollisions, DoorPolicy } from '../../src/simulation/index.js';
import { LEVEL, METRICS, SHADING, START } from './level.js';

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

export interface Player {
    x: number;
    y: number;
    angle: number;
    height: number;
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
 * Everything here is composition. The library supplies wall sliding and door
 * policy; this class decides only what the *game* decides — how fast the player
 * walks, how far they can reach, and that a door must not close on them.
 */
export class World {
    readonly renderer = new Renderer();
    readonly doors: DoorPolicy;
    readonly player: Player;
    private readonly _mapHelper = new MapHelper();
    private readonly _spacing: number;

    constructor() {
        const rc = this.renderer;
        rc.setMetrics(METRICS);
        rc.setShading(SHADING);
        this._spacing = METRICS.spacing;
        this.doors = new DoorPolicy({
            map: rc.cellMap,
            metrics: METRICS,
            maintainDuration: DOOR_MAINTAIN,
            // Refuse to close on the player's head.
            isCellOccupied: (x, y) => {
                const c = this.cell;
                return c.x === x && c.y === y;
            }
        });
        this.player = {
            x: START.x * METRICS.spacing,
            y: START.y * METRICS.spacing,
            angle: START.angle,
            height: 1
        };
    }

    /** Sizes the render surface. Call before the first frame. */
    setScreen(width: number, height: number): void {
        this.renderer.setScreen({ width, height });
    }

    /**
     * Installs textures and builds the map. Textures come in already decoded:
     * the renderer performs no I/O.
     */
    build(walls: HTMLCanvasElement, flats: HTMLCanvasElement): void {
        this.renderer.setWallTextures(walls);
        this.renderer.setFlatTextures(flats);
        this._mapHelper.build(this.renderer, LEVEL);
    }

    /** The cell the player is standing in. */
    get cell(): { x: number; y: number } {
        return worldToCell(this.player.x, this.player.y, this._spacing);
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
        const dx = aimed.x - this.player.x;
        const dy = aimed.y - this.player.y;
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

    /**
     * Advances the world one tick.
     *
     * The door-to-renderer handoff is here, in the caller, rather than inside
     * either layer: the simulation never imports the renderer and the renderer
     * never advances time.
     */
    update(input: Input): void {
        const p = this.player;
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

        for (const { x, y, offset, phys } of this.doors.process()) {
            this.renderer.setCellOffset(x, y, offset | 0);
            this.renderer.setCellPhys(x, y, phys);
        }
    }

    /** Draws the current state. */
    render(): void {
        const p = this.player;
        this.renderer.render(p.x, p.y, p.angle, p.height);
    }
}
