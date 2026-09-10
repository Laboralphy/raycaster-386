import { floodFill } from '../core/floodFill.js';
import { Grid } from '../core/Grid.js';
import { quoteSplit } from '../core/quoteSplit.js';

/** A tag grid's serialised form. */
export interface TagGridState {
    width: number;
    height: number;
    /** The id the next new tag will get. */
    nextId: number;
    /** Tag text to id, so ids survive a round trip. */
    tags: Record<string, number>;
    cells: { x: number; y: number; ids: number[] }[];
}

/** What changed between two cells. Both empty when nothing did. */
export interface TagVisit {
    entered: number[];
    left: number[];
}

/**
 * Tags attached to cells of the map.
 *
 * A tag is a command written as one string — `teleport 3 4`, or
 * `sound "door open"` — because that is how a map editor stores a trigger. The
 * grid interns each distinct string against a numeric id, so a cell holds a
 * small set of numbers and the same tag placed over a whole room is one id.
 *
 * It answers the question "what changed as this moved from here to there",
 * which is what turns tags into enter and leave events.
 */
export class TagGrid {
    private readonly _grid = new Grid<Set<number>>();
    private readonly _idOf = new Map<string, number>();
    private readonly _tagOf = new Map<number, string>();
    private _nextId = 1;

    get width(): number {
        return this._grid.width;
    }

    get height(): number {
        return this._grid.height;
    }

    /** Resizes, discarding every tag placed so far. */
    setSize(width: number, height: number): void {
        this._grid.setSize(width, height, () => new Set<number>());
    }

    /**
     * The tags on a cell, or null off the map.
     *
     * Off-map is a real case rather than an error: an actor's previous cell
     * starts as (-1, -1), so its first move is always a visit from outside.
     */
    private cellAt(x: number, y: number): Set<number> | null {
        if (x < 0 || y < 0 || x >= this._grid.width || y >= this._grid.height) {
            return null;
        }
        return this._grid.cell(x, y);
    }

    /**
     * Places a tag on a cell.
     *
     * @returns the tag's id, which is the same for every cell carrying that
     * text — so removing it from a region works on one id.
     */
    addTag(x: number, y: number, tag: string): number {
        let id = this._idOf.get(tag);
        if (id === undefined) {
            id = this._nextId++;
            this._idOf.set(tag, id);
            this._tagOf.set(id, tag);
        }
        this.cellAt(x, y)?.add(id);
        return id;
    }

    /** @returns true if the tag was there. */
    removeTag(x: number, y: number, id: number): boolean {
        return this.cellAt(x, y)?.delete(id) ?? false;
    }

    /**
     * Removes a tag from every connected cell carrying it.
     *
     * How a one-shot trigger covering a room retires itself: the event names
     * the cell it fired in, and the whole region goes with it.
     *
     * @returns how many cells were cleared.
     */
    removeTagRegion(x: number, y: number, id: number): number {
        const region = floodFill(x, y, (cx, cy) => this.cellAt(cx, cy)?.has(id) ?? false);
        for (const cell of region) {
            this.removeTag(cell.x, cell.y, id);
        }
        return region.length;
    }

    /** The tag ids on a cell. Empty off the map. */
    idsAt(x: number, y: number): readonly number[] {
        const cell = this.cellAt(x, y);
        return cell === null ? [] : [...cell];
    }

    /** The text a tag id stands for. */
    tagOf(id: number): string | undefined {
        return this._tagOf.get(id);
    }

    /** A tag id as a command and its arguments. */
    commandOf(id: number): string[] {
        const tag = this._tagOf.get(id);
        return tag === undefined ? [] : quoteSplit(tag);
    }

    /**
     * What changed moving from one cell to another.
     *
     * Both lists are empty when the two cells are the same, so a caller can
     * apply the result unconditionally.
     */
    visit(fromX: number, fromY: number, toX: number, toY: number): TagVisit {
        if (fromX === toX && fromY === toY) {
            return { entered: [], left: [] };
        }
        const before = this.cellAt(fromX, fromY);
        const after = this.cellAt(toX, toY);
        const left = before === null ? [] : [...before].filter(id => after?.has(id) !== true);
        const entered = after === null ? [] : [...after].filter(id => before?.has(id) !== true);
        return { entered, left };
    }

    get state(): TagGridState {
        const cells: TagGridState['cells'] = [];
        this._grid.iterate((x, y, ids) => {
            if (ids.size > 0) {
                cells.push({ x, y, ids: [...ids] });
            }
        });
        return {
            width: this.width,
            height: this.height,
            nextId: this._nextId,
            tags: Object.fromEntries(this._idOf),
            cells
        };
    }

    set state(value: TagGridState) {
        this.setSize(value.width, value.height);
        this._idOf.clear();
        this._tagOf.clear();
        for (const [tag, id] of Object.entries(value.tags)) {
            this._idOf.set(tag, id);
            this._tagOf.set(id, tag);
        }
        this._nextId = value.nextId;
        for (const { x, y, ids } of value.cells) {
            const cell = this.cellAt(x, y);
            for (const id of ids) {
                cell?.add(id);
            }
        }
    }
}
