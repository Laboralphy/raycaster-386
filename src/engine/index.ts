/**
 * The engine layer: simulation that sits above the renderer.
 *
 * Nothing here imports the renderer. Door state is produced as plain data and
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
