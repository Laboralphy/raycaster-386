import {
    PHYS_CURT_DOWN,
    PHYS_CURT_UP,
    PHYS_DOOR_DOUBLE,
    PHYS_DOOR_DOWN,
    PHYS_DOOR_LEFT,
    PHYS_DOOR_RIGHT,
    PHYS_DOOR_UP,
    PHYS_FIRST_DOOR,
    PHYS_LAST_DOOR,
    PHYS_SECRET_BLOCK,
} from '../consts.js';
import type { ReadonlyCellMap } from '../core/CellMap.js';
import { MarkerRegistry } from '../core/MarkerRegistry.js';
import { DOOR_MAINTAIN_DURATION, DOOR_SLIDING_DURATION } from './consts.js';
import type { EasingFunction, EasingName } from './Easing.js';
import { DoorContext, type DoorCloseCheck } from './DoorContext.js';
import { DoorManager, type DoorCellUpdate, type DoorManagerStateEntry } from './DoorManager.js';
import { CELL_NEIGHBOR_SIDE, forEachNeighbor } from './neighbors.js';
import { TypedEmitter } from './TypedEmitter.js';

/** Cell size and wall height, in world units and texels. */
export interface DoorMetrics {
    spacing: number;
    height: number;
}

export interface DoorPolicyOptions {
    /** The map whose phys codes say which cells are doors. */
    map: ReadonlyCellMap;
    metrics: DoorMetrics;
    /**
     * True if something stands in this cell, which stops a door closing on it.
     *
     * Upstream this asked the entity registry directly. Here it is a callback,
     * so door policy needs no actor tier: a caller with entities supplies one,
     * and without it doors always close.
     */
    isCellOccupied?: (x: number, y: number) => boolean;
    /** Base sliding time in ticks, scaled per door kind. */
    slidingDuration?: number;
    /** How long an autoclosing door stays open, in ticks. */
    maintainDuration?: number;
    /**
     * How an ordinary door accelerates as it slides open. Defaults to
     * `smoothstep` — ease-in-out, and what the original used for every door.
     *
     * A secret passage is deliberately not covered: its two halves use paired
     * accelerating and decelerating curves so the effect reads as one wall
     * recessing and shoving its neighbour back, and a single shared easing
     * would flatten that into two walls moving alike.
     */
    openFunction?: EasingName | EasingFunction;
    /**
     * How it decelerates as it slides shut. Left out, the close replays
     * {@link openFunction} reversed, which is what a door usually wants.
     */
    closeFunction?: EasingName | EasingFunction | null;
    /**
     * The character of one kind of door, keyed however the game likes.
     *
     * A phys code says a cell *is* a door and how it opens; it does not say
     * whether this one is a light wooden door or a heavy stone slab. The level
     * already distinguishes them — they are different blocks — so this is
     * handed the cell's block code alongside its phys code, and returns
     * whatever it wants to change. `null` means "the usual".
     *
     * A callback rather than a table for the same reason as
     * {@link isCellOccupied}: door policy must not assume how a game
     * identifies things. Block codes are assigned per level, so a game with
     * several levels will want to key on something of its own — `ref` from
     * `loaded.materials`, say — and that is its business, not this layer's.
     *
     * Asked **once**, when the door is first opened: travel and speed are
     * fixed for the life of that door. Re-opening asks again.
     *
     * Secret passages do not consult it. Their two halves run paired
     * accelerating and decelerating curves against each other, and a single
     * override would flatten the effect into two walls moving alike.
     */
    doorShape?: (code: number, phys: number) => DoorShapeOverride | null;
}

export interface DoorPolicyEvents extends Record<string, unknown[]> {
    /** A locked door was asked to open. */
    locked: [{ x: number; y: number }];
    opened: [{ x: number; y: number; context: DoorContext }];
    closing: [{ x: number; y: number }];
    closed: [{ x: number; y: number }];
}

/**
 * Everything a door policy needs to be restored: which doors are live and how
 * far through their cycle, plus which cells are locked.
 *
 * Locks belong here rather than beside them because a lock outlives the door
 * context — a door that has closed and retired is still locked.
 */
export interface DoorPolicyState {
    doors: DoorManagerStateEntry[];
    locks: number[];
}

/** How far each kind of door travels, and how long it takes relative to the base. */
interface DoorShape {
    offsetMax: number;
    slideFactor: number;
}

/**
 * What a game may say about one kind of door, over and above its phys code.
 *
 * Every field is optional and falls back to the phys-derived default, so a
 * caller overriding only `openFunction` keeps the travel and speed it had.
 */
export interface DoorShapeOverride {
    /** How far it slides, in world units. */
    offsetMax?: number;
    /** Sliding time as a multiple of the policy's base duration. */
    slideFactor?: number;
    openFunction?: EasingName | EasingFunction;
    closeFunction?: EasingName | EasingFunction | null;
}

/**
 * Decides which cells are doors, and opens, closes and locks them.
 *
 * {@link DoorContext} animates one door; this is the layer that reads a cell's
 * phys code to know a door is there at all, gives it the travel and timing that
 * code implies, and keeps the register of what is locked.
 *
 * It holds a {@link DoorManager} and never touches a renderer: call
 * {@link process} once a tick and apply the updates it returns.
 */
export class DoorPolicy {
    readonly doors = new DoorManager();
    readonly events = new TypedEmitter<DoorPolicyEvents>();

    private readonly _map: ReadonlyCellMap;
    private readonly _metrics: DoorMetrics;
    private readonly _occupied: (x: number, y: number) => boolean;
    private readonly _slidingDuration: number;
    private readonly _maintainDuration: number;
    private readonly _openFunction: EasingName | EasingFunction;
    private readonly _closeFunction: EasingName | EasingFunction | null;
    private readonly _doorShape: (code: number, phys: number) => DoorShapeOverride | null;
    private readonly _locks = new MarkerRegistry();

    constructor({
        map,
        metrics,
        isCellOccupied = () => false,
        slidingDuration = DOOR_SLIDING_DURATION,
        maintainDuration = DOOR_MAINTAIN_DURATION,
        openFunction = 'smoothstep',
        closeFunction = null,
        doorShape = () => null,
    }: DoorPolicyOptions) {
        this._map = map;
        this._metrics = metrics;
        this._occupied = isCellOccupied;
        this._slidingDuration = slidingDuration;
        this._maintainDuration = maintainDuration;
        this._openFunction = openFunction;
        this._closeFunction = closeFunction;
        this._doorShape = doorShape;
    }

    /** Every door currently live, in registration order. */
    get contexts(): readonly DoorContext[] {
        return this.doors.doors;
    }

    /** Cells currently locked. Serialisable alongside {@link state}. */
    get locks(): MarkerRegistry {
        return this._locks;
    }

    // ------------------------------------------------------------- queries

    /**
     * The phys code that decides what this cell is.
     *
     * A live door reports the code it had when shut, because the map's own code
     * is set to PHYS_NONE while it stands open.
     */
    private physOf(x: number, y: number): number {
        const dc = this.doors.getDoorContext(x, y);
        return dc === undefined ? this._map.getPhys(x, y) : dc.data.phys;
    }

    /** True for any door or curtain. Secret blocks are not doors. */
    isDoor(x: number, y: number): boolean {
        const phys = this.physOf(x, y);
        return phys >= PHYS_FIRST_DOOR && phys <= PHYS_LAST_DOOR;
    }

    isSecretBlock(x: number, y: number): boolean {
        return this.physOf(x, y) === PHYS_SECRET_BLOCK;
    }

    /** True if this cell is a door or secret block that is not open. */
    isDoorClosed(x: number, y: number): boolean {
        const dc = this.doors.getDoorContext(x, y);
        if (dc !== undefined) {
            return dc.isClosed();
        }
        // With no context the cell has never been opened, so its own code is
        // enough — and must be read directly rather than through isDoor, which
        // would also accept a door standing open.
        const phys = this._map.getPhys(x, y);
        return (phys >= PHYS_FIRST_DOOR && phys <= PHYS_LAST_DOOR) || phys === PHYS_SECRET_BLOCK;
    }

    /** True if this cell holds a door standing fully open. */
    isDoorOpen(x: number, y: number): boolean {
        // Upstream called `oDoor.isDoorOpen(x, y)`, which DoorContext does not
        // define, so this threw a TypeError for every cell that had a context.
        const dc = this.doors.getDoorContext(x, y);
        return dc !== undefined && dc.isOpen();
    }

    isDoorLocked(x: number, y: number): boolean {
        return (this.isDoor(x, y) || this.isSecretBlock(x, y)) && this._locks.isMarked(x, y);
    }

    // ------------------------------------------------------------ commands

    /** Locks or unlocks a door or secret block. Other cells are ignored. */
    lockDoor(x: number, y: number, locked: boolean): void {
        if (!this.isDoor(x, y) && !this.isSecretBlock(x, y)) {
            return;
        }
        if (locked) {
            this._locks.mark(x, y);
        } else {
            this._locks.unmark(x, y);
        }
    }

    /**
     * Opens the door at a cell, building its context on first use.
     *
     * @returns the context, or null if the cell is not a door, is locked, or is
     * already open.
     */
    openDoor(x: number, y: number, autoclose = true): DoorContext | null {
        if (this.isDoorLocked(x, y)) {
            this.events.emit('locked', { x, y });
            return null;
        }
        if (this.doors.getDoorContext(x, y) !== undefined) {
            return null;
        }
        const dc = this.buildDoorContext(x, y, autoclose);
        if (dc === null) {
            return null;
        }
        this.events.emit('opened', { x, y, context: dc });
        // A secret passage reports closing from its trailing half, which is the
        // one still moving when the pair finishes.
        const child = this.secretNeighborContext(dc);
        (child ?? dc).events.once('closing', () => this.events.emit('closing', { x, y }));
        dc.events.once('close', () => this.events.emit('closed', { x, y }));
        return dc;
    }

    /**
     * Closes an open door.
     *
     * The only way to shut a door whose maintain duration is Infinity. A door
     * blocked by something in the doorway stays open and retries, so this
     * schedules a close rather than forcing one.
     */
    closeDoor(x: number, y: number): void {
        const dc = this.doors.getDoorContext(x, y);
        if (dc === undefined) {
            return;
        }
        const child = this.secretNeighborContext(dc);
        if (child !== null) {
            // The pair closes in reverse: the pushed block returns first.
            child.events.once('close', () => dc.close());
            child.close();
        } else {
            dc.close();
        }
    }

    /** Advances every live door. Apply the result to a renderer, if any. */
    process(): DoorCellUpdate[] {
        return this.doors.process();
    }

    // --------------------------------------------------------------- state

    get state(): DoorPolicyState {
        return { doors: this.doors.state, locks: this._locks.state };
    }

    /**
     * Restores saved doors, rebuilding each context from its cell.
     *
     * A secret passage's leading half is restored first: building it creates
     * both blocks with the right roles, and the trailing entry then only
     * supplies its phase. Rebuilding from the trailing half instead would run
     * the passage backwards.
     */
    setState(value: DoorPolicyState): void {
        this._locks.state = value.locks;
        const ordered = [...value.doors].sort(
            (a, b) => Number(b.child !== undefined) - Number(a.child !== undefined)
        );
        this.doors.setState(ordered, (entry) =>
            this.buildDoorContext(entry.x, entry.y, entry.autoclose ?? false)
        );
    }

    // ------------------------------------------------------------ building

    /** Travel and speed implied by a phys code, or null if it is not a door. */
    private shapeOf(phys: number): DoorShape | null {
        const { spacing, height } = this._metrics;
        switch (phys) {
            case PHYS_DOOR_DOUBLE:
                // Two panels, so each travels half a cell.
                return { offsetMax: spacing >> 1, slideFactor: 0.5 };
            case PHYS_DOOR_RIGHT:
            case PHYS_DOOR_LEFT:
                return { offsetMax: height, slideFactor: 1 };
            case PHYS_DOOR_UP:
            case PHYS_DOOR_DOWN:
                return { offsetMax: height, slideFactor: 1.5 };
            case PHYS_CURT_UP:
            case PHYS_CURT_DOWN:
                return { offsetMax: height, slideFactor: 1.8 };
            default:
                return null;
        }
    }

    /** Wires the closability check that keeps a door off whatever is standing under it. */
    private guard(dc: DoorContext, x: number, y: number): void {
        dc.events.on('check', (event: DoorCloseCheck) => {
            event.cancel = this._occupied(x, y);
        });
    }

    /**
     * Builds and registers the context for a cell, or returns null if the cell
     * is not a door. A secret block builds both halves of its passage.
     */
    buildDoorContext(x: number, y: number, autoclose: boolean): DoorContext | null {
        const phys = this._map.getPhys(x, y);
        if (phys === PHYS_SECRET_BLOCK) {
            return this.buildSecretDoorContext(x, y);
        }
        // The phys code still decides *whether* this is a door; the override
        // only refines one that already is. Keeping that split is what lets
        // `isDoor`, the lock registry and the renderer go on trusting phys.
        const shape = this.shapeOf(phys);
        if (shape === null) {
            return null;
        }
        const over = this._doorShape(this._map.getMaterial(x, y), phys) ?? {};
        const dc = new DoorContext({
            slidingDuration:
                (this._slidingDuration * (over.slideFactor ?? shape.slideFactor)) | 0,
            maintainDuration: autoclose ? this._maintainDuration : Infinity,
            offsetMax: over.offsetMax ?? shape.offsetMax,
            openFunction: over.openFunction ?? this._openFunction,
            closeFunction: over.closeFunction ?? this._closeFunction,
        });
        dc.data.x = x;
        dc.data.y = y;
        dc.data.phys = phys;
        dc.data.autoclose = autoclose;
        this.guard(dc, x, y);
        this.doors.linkDoorContext(dc);
        return dc;
    }

    /**
     * Builds a secret passage: the block that was pushed, and the one behind it.
     *
     * The second block starts a full slide late and swaps the easing curves, so
     * the pair reads as one wall recessing and then shoving its neighbour back.
     * Neither half ever autocloses.
     */
    private buildSecretDoorContext(x: number, y: number): DoorContext {
        const offsetMax = this._metrics.spacing;
        const slidingDuration = this._slidingDuration * 3;
        const phys = this._map.getPhys(x, y);

        const dc1 = new DoorContext({
            slidingDuration,
            maintainDuration: Infinity,
            offsetMax,
            openFunction: 'squareAccel',
            closeFunction: 'squareDeccel',
        });
        dc1.data.x = x;
        dc1.data.y = y;
        dc1.data.phys = phys;
        dc1.data.secret = true;
        this.guard(dc1, x, y);

        let found = 0;
        forEachNeighbor(
            this._map,
            x,
            y,
            (cx, cy, cphys) => {
                if (cphys !== PHYS_SECRET_BLOCK) {
                    return;
                }
                if (++found > 1) {
                    throw new Error(
                        `DoorPolicy: the secret block at (${x}, ${y}) has more than one secret neighbour`
                    );
                }
                const dc2 = new DoorContext({
                    slidingDuration,
                    maintainDuration: Infinity,
                    offsetMax,
                    openFunction: 'squareDeccel',
                    closeFunction: 'squareAccel',
                    delayDuration: slidingDuration,
                });
                dc2.data.x = cx;
                dc2.data.y = cy;
                dc2.data.phys = cphys;
                dc2.data.secret = true;
                dc2.events.on('check', (event: DoorCloseCheck) => {
                    // The pushed block must not close on anything standing in
                    // either cell: it would trap whoever is in the passage.
                    event.cancel = this._occupied(x, y) || this._occupied(cx, cy);
                });
                dc1.data.child = dc2;
                this.doors.linkDoorContext(dc2);
            },
            CELL_NEIGHBOR_SIDE
        );

        this.doors.linkDoorContext(dc1);
        return dc1;
    }

    /**
     * The other half of `dc`'s secret passage, if it has one.
     *
     * Only a secret block has one. The original asked this of every door and
     * accepted any adjacent secret context, so an ordinary door standing beside
     * an open secret passage adopted it: the door's `closing` event fired from
     * the passage — which never autocloses, so in practice never — and
     * `closeDoor` shut the passage instead of the door.
     */
    private secretNeighborContext(dc: DoorContext): DoorContext | null {
        if (dc.data.secret !== true) {
            return null;
        }
        const { x, y } = dc.data;
        let sibling: DoorContext | null = null;
        forEachNeighbor(
            this._map,
            x,
            y,
            (cx, cy) => {
                const neighbor = this.doors.getDoorContext(cx, cy);
                if (neighbor !== undefined && neighbor.data.secret === true) {
                    sibling = neighbor;
                }
            },
            CELL_NEIGHBOR_SIDE
        );
        return sibling;
    }
}
