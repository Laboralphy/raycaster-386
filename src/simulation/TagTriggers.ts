import type { ActorFrame, ActorId } from '../core/actorFrame.js';
import { TagGrid } from './TagGrid.js';
import { TypedEmitter } from './TypedEmitter.js';

/** What a tag event carries. */
export interface TagEvent {
    /** Who set it off. */
    actor: ActorId;
    /** The cell it happened in. */
    x: number;
    y: number;
    /** The tag's id, and its text split into a command and arguments. */
    id: number;
    command: string;
    parameters: string[];
    /** Clears this tag from every connected cell carrying it. */
    remove(): void;
}

export interface TagTriggerEvents extends Record<string, unknown[]> {
    /** An actor moved into a cell carrying this tag. */
    enter: [TagEvent];
    /** An actor moved out of one. */
    leave: [TagEvent];
    /** An actor pushed against a cell carrying this tag. */
    push: [TagEvent];
}

/**
 * Turns movement across a {@link TagGrid} into enter, leave and push events.
 *
 * It keys everything on actor ids and consumes the {@link ActorFrame} the
 * registry already produces, so it needs no actor objects and no renderer —
 * upstream this walked the entity list and the camera directly, and stashed
 * its bookkeeping inside each entity's user data.
 *
 * Only actors that moved are considered, which is what the frame already
 * tells us: a room full of static scenery costs nothing per tick.
 */
export class TagTriggers {
    readonly grid = new TagGrid();
    readonly events = new TypedEmitter<TagTriggerEvents>();

    /** The cell each actor was last seen in. */
    private readonly _lastCell = new Map<ActorId, { x: number; y: number }>();
    private _spacing = 1;

    /**
     * Resizes the grid to a square map and records its cell size.
     *
     * Both are properties of the map rather than of a tick, so they are given
     * once instead of on every {@link process}.
     */
    setMapSize(size: number, spacing: number): void {
        this.grid.setSize(size, size);
        this._spacing = spacing;
    }

    /**
     * Applies one tick's movement.
     *
     * An actor not seen before is treated as arriving from off the map, so it
     * enters the tags of the cell it starts in — which is what makes a trigger
     * under a start point fire.
     */
    process(frame: ActorFrame): void {
        const spacing = this._spacing;
        for (const update of frame.moved) {
            const x = (update.x / spacing) | 0;
            const y = (update.y / spacing) | 0;
            const last = this._lastCell.get(update.id) ?? { x: -1, y: -1 };
            const { entered, left } = this.grid.visit(last.x, last.y, x, y);
            for (const id of left) {
                this.emit('leave', id, update.id, last.x, last.y);
            }
            for (const id of entered) {
                this.emit('enter', id, update.id, x, y);
            }
            this._lastCell.set(update.id, { x, y });
        }
        for (const id of frame.removed) {
            this._lastCell.delete(id);
        }
    }

    /**
     * Fires the tags of a cell an actor pushed against.
     *
     * A door opened by hand is the usual source: what is behind the wall wants
     * to know it was tried, whether or not it opened.
     */
    push(actor: ActorId, x: number, y: number): void {
        for (const id of this.grid.idsAt(x, y)) {
            this.emit('push', id, actor, x, y);
        }
    }

    /** Forgets an actor, so its next move counts as an arrival. */
    forget(actor: ActorId): void {
        this._lastCell.delete(actor);
    }

    private emit(
        type: keyof TagTriggerEvents,
        id: number,
        actor: ActorId,
        x: number,
        y: number
    ): void {
        const [command = '', ...parameters] = this.grid.commandOf(id);
        this.events.emit(type, {
            actor,
            x,
            y,
            id,
            command,
            parameters,
            remove: () => {
                this.grid.removeTagRegion(x, y, id);
            },
        });
    }
}
