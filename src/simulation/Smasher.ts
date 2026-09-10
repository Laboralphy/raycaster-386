import { distance } from '../core/geometry.js';
import { Vector } from '../core/Vector.js';
import type { Dummy } from './Dummy.js';
import { SectorRegistry } from './SectorRegistry.js';
import { TypedEmitter } from './TypedEmitter.js';

/** Anything the solver can move: an id and a collision body. */
export interface SmashingEntity {
    id: string | number;
    dummy: Dummy;
}

export interface SmasherEvents extends Record<string, unknown[]> {
    /** Emitted before each entity is filed, so a caller can sync its position. */
    'dummy.update': [{ entity: SmashingEntity }];
    /** Emitted for an entity overlapping others this tick. */
    smashed: [{ entity: SmashingEntity; smashers: SmashingEntity[] }];
}

/**
 * Circle-versus-circle collision between actors.
 *
 * Nothing is moved here. Each overlapping pair contributes a separating force
 * proportional to how deeply they overlap; the resultant lands on
 * `dummy.force` and the caller decides what to do with it — which is what
 * keeps this free of any opinion about movement, inertia or rendering.
 *
 * Comparisons are limited to the nine sectors around each actor, so cost grows
 * with local crowding rather than with the number of actors.
 */
export class Smasher extends SectorRegistry<SmashingEntity> {
    readonly events = new TypedEmitter<SmasherEvents>();

    private readonly _origin = new Vector();
    private _entities: SmashingEntity[] = [];

    get entities(): readonly SmashingEntity[] {
        return this._entities;
    }

    /** The world position the sector grid starts at. */
    get origin(): Vector {
        return this._origin;
    }

    registerEntity(entity: SmashingEntity): void {
        if (this._entities.includes(entity)) {
            throw new Error(`Smasher: entity ${String(entity.id)} is already registered`);
        }
        this._entities.push(entity);
        entity.dummy.entity = entity.id;
        this.updateEntity(entity);
    }

    /** Marks an entity dead, unfiles it, and stops tracking it. */
    unregisterEntity(entity: SmashingEntity): void {
        entity.dummy.dead = true;
        this.updateEntity(entity);
        const i = this._entities.indexOf(entity);
        if (i >= 0) {
            this._entities.splice(i, 1);
        }
    }

    /**
     * Files every entity into its sector, then resolves overlaps.
     *
     * Two passes: everything must be in the right sector before anything is
     * compared, or an actor that moved this tick would be tested against a
     * stale neighbourhood.
     */
    process(): void {
        for (const entity of this._entities) {
            this.events.emit('dummy.update', { entity });
            this.updateEntity(entity);
        }
        for (const entity of this._entities) {
            this.processEntity(entity);
        }
    }

    /** Moves an entity between sectors if it has left the one it was in. */
    updateEntity(entity: SmashingEntity): void {
        const dummy = entity.dummy;
        const previous = dummy.colliderSector;
        const next = dummy.dead ? null : this.sectorFromVector(dummy.position.sub(this._origin));
        if (!dummy.dead && next === null) {
            const p = dummy.position;
            throw new Error(
                `Smasher: (${p.x}, ${p.y}) is outside the sector grid; is its size set?`
            );
        }
        if (next === previous) {
            return;
        }
        previous?.remove(entity);
        next?.add(entity);
        dummy.colliderSector = next;
    }

    /** Resolves one entity's overlaps into a force on its dummy. */
    processEntity(entity: SmashingEntity): void {
        const dummy = entity.dummy;
        const hitters = this.getSmashingEntities(entity);
        if (hitters !== null && hitters.length > 0) {
            this.events.emit('smashed', { entity, smashers: hitters });
            this.computeSmashingForces(entity, hitters);
            dummy.setSmashers(hitters);
        } else {
            dummy.clearSmashers();
        }
        const field = dummy.forceField;
        dummy.force.set(field.computeForces());
        field.reduceForces();
    }

    /** Everything overlapping this entity, across the nine nearest sectors. */
    private getSmashingEntities(entity: SmashingEntity): SmashingEntity[] | null {
        const dummy = entity.dummy;
        if (dummy.tangibility.self === 0) {
            return null;
        }
        const sector = this.sectorFromVector(dummy.position.sub(this._origin));
        if (sector === null) {
            return null;
        }
        const grid = this.grid;
        const xMin = Math.max(0, sector.x - 1);
        const yMin = Math.max(0, sector.y - 1);
        const xMax = Math.min(grid.width - 1, sector.x + 1);
        const yMax = Math.min(grid.height - 1, sector.y + 1);
        let found: SmashingEntity[] | null = null;
        for (let y = yMin; y <= yMax; ++y) {
            for (let x = xMin; x <= xMax; ++x) {
                const here = this.sector(x, y);
                if (here === null) {
                    continue;
                }
                for (const other of here.objects) {
                    if (other.dummy !== dummy && dummy.hits(other.dummy)) {
                        (found ??= []).push(other);
                    }
                }
            }
        }
        return found;
    }

    /**
     * Adds one separating force per overlap, proportional to the overlap depth.
     *
     * The factor is 0, so each force decays to nothing on the next
     * `reduceForces` — a collision push lasts exactly one tick.
     */
    private computeSmashingForces(
        entity: SmashingEntity,
        hitters: readonly SmashingEntity[]
    ): void {
        const dummy = entity.dummy;
        const pos = dummy.position;
        for (const hitter of hitters) {
            const other = hitter.dummy;
            const otherPos = other.position;
            const d = distance(pos.x, pos.y, otherPos.x, otherPos.y);
            const push = Math.max(0, (dummy.radius + other.radius - d) / 2);
            // Exactly coincident dummies have no direction to separate along.
            // The original divided by a zero length here and produced a
            // (NaN, NaN) force, which summed into dummy.force and, once a
            // caller added it to a position, made that position NaN for good.
            // A fixed axis keeps it deterministic, which lockstep needs.
            const direction = d === 0 ? new Vector(1, 0) : pos.sub(otherPos).normalize();
            dummy.forceField.addForce(direction.scale(push), 0);
        }
    }
}
