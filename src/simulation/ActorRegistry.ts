import type { ActorFrame, ActorId, ActorUpdate } from '../core/actorFrame.js';
import { Actor } from './Actor.js';
import { SectorRegistry } from './SectorRegistry.js';

/** What an actor starts out as. Everything is optional but a position. */
export interface ActorInit {
    x: number;
    y: number;
    z?: number;
    angle?: number;
    size?: number;
    ref?: string;
    data?: Record<string, unknown>;
}

/**
 * Holds the actors, ticks their behaviour, and reports what changed.
 *
 * It knows nothing about drawing: a tick returns an {@link ActorFrame} of
 * plain data, and whatever owns a renderer applies it. That is the same
 * handoff `DoorManager.process()` uses, one tier up.
 *
 * Actors are also filed into a coarse grid so that "what is standing here" is
 * cheap — {@link actorsAt}. Sized to one sector per map cell, that answers
 * `DoorPolicy`'s occupancy check directly.
 */
export class ActorRegistry<C = unknown> {
    private _actors: Actor<C>[] = [];
    private _byId = new Map<ActorId, Actor<C>>();
    private _sectors = new SectorRegistry<Actor<C>>();
    private _filed = new Map<ActorId, { remove(o: Actor<C>): void }>();
    private _pendingRemovals: Actor<C>[] = [];
    private _attached = new Set<ActorId>();
    private _nextId = 1;

    /**
     * Sizes the sector grid.
     *
     * Ids are handed out per registry rather than from a module-level counter,
     * so two rooms in one process cannot interfere — which a server hosting
     * several games needs.
     */
    setSectors(count: number, size: number): void {
        this._sectors.setCellWidth(size).setCellHeight(size);
        this._sectors.setSize(count, count);
    }

    get actors(): readonly Actor<C>[] {
        return this._actors;
    }

    get(id: ActorId): Actor<C> | undefined {
        return this._byId.get(id);
    }

    /** Everything currently filed in one sector. */
    actorsAt(x: number, y: number): readonly Actor<C>[] {
        return this._sectors.sector(x, y)?.objects ?? [];
    }

    /** Creates an actor and links it. */
    spawn(init: ActorInit): Actor<C> {
        const actor = new Actor<C>(this._nextId++);
        actor.position.x = init.x;
        actor.position.y = init.y;
        actor.position.z = init.z ?? 0;
        actor.position.angle = init.angle ?? 0;
        actor.size = init.size ?? 0;
        actor.ref = init.ref ?? '';
        actor.data = init.data ?? {};
        this.link(actor);
        return actor;
    }

    link(actor: Actor<C>): void {
        if (this._byId.has(actor.id)) {
            throw new Error(`ActorRegistry: id ${String(actor.id)} is already linked`);
        }
        this._actors.push(actor);
        this._byId.set(actor.id, actor);
        this.file(actor);
    }

    /**
     * Removes an actor immediately.
     *
     * Its id is reported in the next {@link process}'s `removed`, so a caller
     * driving sprites off the frame still learns about it.
     */
    unlink(actor: Actor<C>): void {
        const i = this._actors.indexOf(actor);
        if (i < 0) {
            return;
        }
        this._actors.splice(i, 1);
        this._byId.delete(actor.id);
        this._filed.get(actor.id)?.remove(actor);
        this._filed.delete(actor.id);
        this._pendingRemovals.push(actor);
    }

    /**
     * Syncs the collision body to the actor's position and files it into the
     * sector that position falls in. The single place those two are kept in
     * step, so they cannot drift.
     */
    private file(actor: Actor<C>): void {
        actor.dummy.position.set(actor.position.x, actor.position.y);
        const sector = this._sectors.sectorFromVector(actor.dummy.position);
        this._filed.get(actor.id)?.remove(actor);
        if (sector === null) {
            this._filed.delete(actor.id);
            return;
        }
        sector.add(actor);
        this._filed.set(actor.id, sector);
    }

    /**
     * Ticks every actor and reports the change.
     *
     * Behaviour runs first, then anything that moved is refiled and listed.
     * Actors the game has marked `dead` are swept last, so an actor that moved
     * and then died appears in both lists — `moved` before `removed`.
     */
    process(context: C): ActorFrame {
        const moved: ActorUpdate[] = [];
        for (const actor of [...this._actors]) {
            if (!this._attached.has(actor.id)) {
                this._attached.add(actor.id);
                actor.thinker?.attach?.(actor, context);
            }
            actor.thinker?.think(actor, context);
        }
        for (const actor of this._actors) {
            if (!actor.hasMoved()) {
                continue;
            }
            actor.markReported();
            this.file(actor);
            const p = actor.position;
            moved.push({ id: actor.id, x: p.x, y: p.y, z: p.z, angle: p.angle });
        }
        for (const actor of [...this._actors]) {
            if (actor.dead) {
                this.unlink(actor);
            }
        }
        // Detaching happens here rather than in unlink() because it needs the
        // context: a tangible thinker has to take its body out of the collision
        // set, and nothing else knows where that set is. An actor unlinked
        // outside a tick is therefore detached at the start of the next one.
        const dropped = this._pendingRemovals;
        this._pendingRemovals = [];
        const removed: ActorId[] = [];
        for (const actor of dropped) {
            actor.thinker?.detach?.(actor, context);
            this._attached.delete(actor.id);
            removed.push(actor.id);
        }
        return { moved, removed };
    }
}
