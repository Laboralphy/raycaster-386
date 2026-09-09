/**
 * Simulation: world state advanced by a tick, sitting above the renderer.
 *
 * Nothing here imports the renderer, and nothing here touches the DOM — the
 * two rules that keep this layer runnable headless, on a server with no
 * canvas, and keep a god object from forming across the boundary. Door state is produced as plain data and
 * applied by whoever owns both — see `DoorManager.process()`. That keeps the
 * renderer a pure function of world state, which is what makes its golden
 * image tests possible.
 */
export * from './consts.js';
export { Easing, EASING_FUNCTIONS } from './Easing.js';
export type { EasingName, EasingFunction, EasingOptions } from './Easing.js';
export { TypedEmitter } from './TypedEmitter.js';
export type { Listener } from './TypedEmitter.js';
export { DoorContext } from './DoorContext.js';
export type {
    DoorContextOptions, DoorData, DoorState, DoorEvents, DoorCloseCheck
} from './DoorContext.js';
export { DoorManager } from './DoorManager.js';
export type { DoorCellUpdate, DoorManagerStateEntry } from './DoorManager.js';
export { DoorPolicy } from './DoorPolicy.js';
export type { DoorPolicyOptions, DoorPolicyEvents, DoorMetrics } from './DoorPolicy.js';
export {
    forEachNeighbor, CELL_NEIGHBOR_SIDE, CELL_NEIGHBOR_CORNER, CELL_NEIGHBOR_SELF
} from './neighbors.js';
export { computeWallCollisions } from './wallCollider.js';
export type { WallCollisionFlags, WallCollisionResult, SolidTest } from './wallCollider.js';
export { Dummy } from './Dummy.js';
export type { Tangibility, DummySector } from './Dummy.js';
export { ForceField } from './ForceField.js';
export type { Force } from './ForceField.js';
export { Sector, SectorRegistry } from './SectorRegistry.js';
export { Smasher } from './Smasher.js';
export type { SmashingEntity, SmasherEvents } from './Smasher.js';
