/**
 * The contract between the simulation and whatever draws it.
 *
 * Plain data, and deliberately in Core: the simulation produces it and the
 * renderer consumes it, so neither has to import the other. It is the same
 * arrangement that lets both tiers share a `CellMap`.
 */

export type ActorId = string | number;

/** Where an actor has got to. Emitted only for actors that actually moved. */
export interface ActorUpdate {
    id: ActorId;
    /** World coordinates, in texels. */
    x: number;
    y: number;
    /** Altitude above the floor. */
    z: number;
    /** Facing, in radians. */
    angle: number;
}

/**
 * One tick's worth of change.
 *
 * `moved` is sparse — a level of static scenery costs nothing per tick — and
 * `removed` is drained each tick rather than accumulated, so an id appears in
 * it exactly once.
 *
 * An id may appear in both, having moved during its think and then been
 * removed. Consumers must apply `moved` first.
 */
export interface ActorFrame {
    moved: readonly ActorUpdate[];
    removed: readonly ActorId[];
}
