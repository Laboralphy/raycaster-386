import {
    MapHelper,
    PHYS_FIRST_DOOR,
    PHYS_LAST_DOOR,
    PHYS_NONE,
    Renderer
} from '../src/index.js';
import { DoorContext, DoorManager } from '../src/simulation/index.js';
import { LEVEL, METRICS, SHADING, START } from './level.js';

/** How close the player must be to a door to open it, in world units. */
const REACH = 96;
/** Player movement speed, in world units per tick. */
const WALK_SPEED = 3.2;
/** Turn speed, in radians per tick. */
const TURN_SPEED = 0.045;
/** Keeps the player off the walls, in world units. */
const PLAYER_RADIUS = 12;

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
 * The demo world: a renderer, the doors above it, and a player.
 *
 * Deliberately free of DOM and timers so the whole thing can be stepped and
 * rendered in a test. `main.ts` is the only part that knows about the browser.
 */
export class World {
    readonly renderer = new Renderer();
    readonly doors = new DoorManager();
    readonly player: Player;
    private readonly _mapHelper = new MapHelper();
    private readonly _spacing: number;

    constructor() {
        const rc = this.renderer;
        rc.setMetrics(METRICS);
        rc.setShading(SHADING);
        this._spacing = METRICS.spacing;
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
        return {
            x: (this.player.x / this._spacing) | 0,
            y: (this.player.y / this._spacing) | 0
        };
    }

    /**
     * True if a point is inside a cell the player cannot enter.
     *
     * An opened door reports PHYS_NONE, which is what lets the player walk
     * through it once it has slid up.
     */
    private blocked(x: number, y: number): boolean {
        const cx = (x / this._spacing) | 0;
        const cy = (y / this._spacing) | 0;
        const map = this.renderer;
        if (cx < 0 || cy < 0 || cx >= map.getMapSize() || cy >= map.getMapSize()) {
            return true;
        }
        return map.getCellPhys(cx, cy) !== PHYS_NONE;
    }

    /**
     * Moves the player, sliding along walls rather than stopping dead.
     *
     * Each axis is tested on its own, so running into a wall at an angle keeps
     * the component that is still free.
     */
    private move(dx: number, dy: number): void {
        const p = this.player;
        const rx = dx > 0 ? PLAYER_RADIUS : -PLAYER_RADIUS;
        const ry = dy > 0 ? PLAYER_RADIUS : -PLAYER_RADIUS;
        if (dx !== 0 && !this.blocked(p.x + dx + rx, p.y)) {
            p.x += dx;
        }
        if (dy !== 0 && !this.blocked(p.x, p.y + dy + ry)) {
            p.y += dy;
        }
    }

    /**
     * The door cell the player is looking at and standing near, if any.
     *
     * Uses the cell the centre ray struck during the last frame, so what can
     * be opened is exactly what is under the crosshair.
     */
    aimedDoor(): { x: number; y: number } | null {
        const aimed = this.renderer.aimedCell;
        if (aimed === null) {
            return null;
        }
        const phys = this.renderer.getCellPhys(aimed.xCell, aimed.yCell);
        if (phys < PHYS_FIRST_DOOR || phys > PHYS_LAST_DOOR) {
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
        if (door === null || this.doors.getDoorContext(door.x, door.y) !== undefined) {
            return false;
        }
        const dc = new DoorContext({
            slidingDuration: 24,
            maintainDuration: 180,
            offsetMax: METRICS.height,
            openFunction: 'smoothstep'
        });
        dc.data.x = door.x;
        dc.data.y = door.y;
        dc.data.phys = this.renderer.getCellPhys(door.x, door.y);
        dc.data.autoclose = true;
        // Refuse to close on the player's head.
        dc.events.on('check', event => {
            const c = this.cell;
            if (c.x === door.x && c.y === door.y) {
                event.cancel = true;
            }
        });
        this.doors.linkDoorContext(dc);
        return true;
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
            this.move(dx, dy);
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
