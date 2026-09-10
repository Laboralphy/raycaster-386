import { PHYS_NONE } from '../consts.js';
import type { DoorContext, DoorState } from './DoorContext.js';

/**
 * What one door wants applied to its cell this tick.
 *
 * This is the whole interface between door simulation and rendering: a
 * caller feeds each entry to `renderer.setCellOffset` and
 * `renderer.setCellPhys`. Nothing here imports the renderer.
 */
export interface DoorCellUpdate {
    x: number;
    y: number;
    /** PHYS_NONE while open, so the cell stops blocking movement. */
    phys: number;
    /** How far the door has slid, in texels. */
    offset: number;
}

/** A door's serialised state, with the position needed to restore it. */
export interface DoorManagerStateEntry extends DoorState {
    x: number;
    y: number;
    autoclose: boolean | undefined;
    /**
     * For the leading half of a secret passage, where the block it pushes is.
     *
     * Without this a restore cannot tell the two halves apart, and rebuilding
     * from the trailing one runs the passage backwards: the block that was
     * pushed becomes the block that pushes.
     */
    child?: { x: number; y: number };
}

/**
 * Ticks every live door and reports what changed.
 *
 * Doors retire themselves once shut; a retired door is reported one last time
 * (offset 0, solid again) before being dropped, so the caller always sees the
 * final state.
 */
export class DoorManager {
    private _doors: DoorContext[] = [];

    get doors(): readonly DoorContext[] {
        return this._doors;
    }

    get state(): DoorManagerStateEntry[] {
        return this._doors.map((d) => {
            const entry: DoorManagerStateEntry = {
                ...d.state,
                x: d.data.x,
                y: d.data.y,
                autoclose: d.data.autoclose,
            };
            const child = d.data.child;
            if (child !== undefined) {
                entry.child = { x: child.data.x, y: child.data.y };
            }
            return entry;
        });
    }

    /** The door at a cell, if one is live there. */
    getDoorContext(x: number, y: number): DoorContext | undefined {
        return this._doors.find((d) => d.data.x === x && d.data.y === y);
    }

    /**
     * Registers a door, replacing any already at the same cell.
     *
     * The original looped until `getDoorContext` came back empty while only
     * calling `dispose()`, which marks a door done without unregistering it —
     * so registering a second door at an occupied cell span forever. Disposed
     * doors are removed here instead.
     */
    linkDoorContext(dc: DoorContext): void {
        const { x, y } = dc.data;
        for (const existing of this._doors) {
            if (existing.data.x === x && existing.data.y === y) {
                existing.dispose();
            }
        }
        this._doors = this._doors.filter((d) => !(d.data.x === x && d.data.y === y));
        this._doors.push(dc);
    }

    /** Removes a door without running its closing phase. */
    unlinkDoorContext(dc: DoorContext): void {
        const i = this._doors.indexOf(dc);
        if (i >= 0) {
            this._doors.splice(i, 1);
        }
    }

    /**
     * Rebuilds the live doors from a saved state.
     *
     * An entry says where a door is and how far through its cycle it got, but
     * not its timings, easing or travel — those follow from the cell's phys
     * code, which is door policy this tier does not own yet. So the caller
     * supplies `build`, which makes a context for one entry exactly as it
     * would when first opening that door; returning null skips the entry.
     *
     * There is no `set state` counterpart because restoring needs that second
     * argument. Doors already live are dropped without running their closing
     * phase, as {@link unlinkDoorContext} does.
     */
    setState(
        entries: readonly DoorManagerStateEntry[],
        build: (entry: DoorManagerStateEntry) => DoorContext | null
    ): void {
        this._doors = [];
        for (const entry of entries) {
            // `build` may link contexts itself — a secret passage builds both
            // halves at once — so a cell already filled in by an earlier entry
            // is left alone rather than rebuilt or re-linked onto itself.
            let dc = this.getDoorContext(entry.x, entry.y);
            if (dc === undefined) {
                const built = build(entry);
                if (built === null) {
                    continue;
                }
                dc = built;
                if (!this._doors.includes(dc)) {
                    this.linkDoorContext(dc);
                }
            }
            dc.state = { phase: entry.phase, time: entry.time };
        }
    }

    /**
     * Advances every door by one tick.
     *
     * @returns one entry per door, including any that finished this tick.
     */
    process(): DoorCellUpdate[] {
        const result = this._doors.map((dc) => {
            dc.process();
            return {
                x: dc.data.x,
                y: dc.data.y,
                phys: dc.isOpen() ? PHYS_NONE : dc.data.phys,
                offset: dc.offset,
            };
        });
        this._doors = this._doors.filter((dc) => !dc.isDone());
        return result;
    }
}
