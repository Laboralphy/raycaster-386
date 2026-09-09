/**
 * Door phases, in the order a door passes through them.
 *
 * A door always advances forwards: CLOSED waits out its delay, OPENING slides
 * it open, OPEN holds it, CLOSING slides it shut, DONE retires it. There is no
 * transition back to CLOSED — reopening means a new context.
 */
export const DOOR_PHASE_CLOSED = 0;
export const DOOR_PHASE_OPENING = 1;
export const DOOR_PHASE_OPEN = 2;
export const DOOR_PHASE_CLOSING = 3;
export const DOOR_PHASE_DONE = 4;

export type DoorPhase = 0 | 1 | 2 | 3 | 4;

/** Default time a door takes to slide, in ticks. */
export const DOOR_SLIDING_DURATION = 24;
/** Default time a door stays open before closing itself, in ticks. */
export const DOOR_MAINTAIN_DURATION = 300;
/**
 * How long a door waits before re-checking, when something blocked it from
 * closing. Short, so it retries promptly once the way is clear.
 */
export const DOOR_SECURITY_INTERVAL = 10;
