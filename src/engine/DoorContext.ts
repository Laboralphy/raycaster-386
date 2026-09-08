import {
    DOOR_PHASE_CLOSED,
    DOOR_PHASE_CLOSING,
    DOOR_PHASE_DONE,
    DOOR_PHASE_OPEN,
    DOOR_PHASE_OPENING,
    DOOR_SECURITY_INTERVAL,
    type DoorPhase
} from './consts.js';
import { Easing, type EasingFunction, type EasingName } from './Easing.js';
import { TypedEmitter } from './TypedEmitter.js';

/**
 * Passed to the `check` event just before a door starts closing. A listener
 * setting `cancel` keeps the door open — used to stop a door shutting on
 * something standing in the doorway.
 */
export interface DoorCloseCheck {
    context: DoorContext;
    cancel: boolean;
}

export interface DoorEvents extends Record<string, unknown[]> {
    opening: [];
    open: [];
    closing: [];
    close: [];
    check: [DoorCloseCheck];
}

/** Where the door is, and what it does when open. */
export interface DoorData {
    /** Cell coordinates. */
    x: number;
    y: number;
    /** The cell's phys code while the door is not open. */
    phys: number;
    /** Part of a secret passage. */
    secret?: boolean;
    /** Closes itself after the maintain duration. */
    autoclose?: boolean;
}

export interface DoorContextOptions {
    /** Ticks the door takes to slide open or shut. */
    slidingDuration?: number;
    /** Ticks the door stays open. Infinity never closes by itself. */
    maintainDuration?: number;
    /** Ticks to wait before starting to open. */
    delayDuration?: number;
    /** Offset at full open, in texels. */
    offsetMax?: number;
    /** Curve used while opening. */
    openFunction?: EasingName | EasingFunction;
    /** Curve used while closing. Defaults to the opening curve. */
    closeFunction?: EasingName | EasingFunction | null;
}

/** Serialisable door state. */
export interface DoorState {
    phase: DoorPhase;
    time: number;
}

/**
 * One door's state machine.
 *
 * Knows nothing about rendering: it produces an {@link offset} and a phase,
 * and something above it is responsible for pushing those into a renderer.
 * That separation is deliberate — door state is also read by collision, AI
 * and save games, none of which should have to go through a renderer.
 */
export class DoorContext {
    /** Where this door is and how it behaves. Filled in by the creator. */
    readonly data: DoorData = { x: 0, y: 0, phys: 0 };
    readonly events = new TypedEmitter<DoorEvents>();

    private _phase: DoorPhase = DOOR_PHASE_CLOSED;
    private _time = 0;
    private _offset = 0;
    private readonly _slidingDuration: number;
    private readonly _maintainDuration: number;
    private readonly _delayDuration: number;
    private readonly _offsetMax: number;
    private readonly _openFunction: EasingName | EasingFunction;
    private readonly _closeFunction: EasingName | EasingFunction;
    private readonly _easing: Easing;

    constructor({
        slidingDuration = 0,
        maintainDuration = 0,
        delayDuration = 0,
        offsetMax = 0,
        openFunction = 'smoothstep',
        closeFunction = null
    }: DoorContextOptions = {}) {
        this._slidingDuration = slidingDuration;
        this._maintainDuration = maintainDuration;
        this._delayDuration = delayDuration;
        this._offsetMax = offsetMax;
        this._openFunction = openFunction;
        this._closeFunction = closeFunction ?? openFunction;
        this._easing = new Easing({ use: this._openFunction });
    }

    /** How far the door has slid, in texels. */
    get offset(): number {
        return this._offset;
    }

    getPhase(): DoorPhase {
        return this._phase;
    }

    isOpen(): boolean {
        return this._phase === DOOR_PHASE_OPEN;
    }

    isClosed(): boolean {
        return this._phase === DOOR_PHASE_CLOSED || this._phase === DOOR_PHASE_DONE;
    }

    /** True once the door has finished closing and can be retired. */
    isDone(): boolean {
        return this._phase === DOOR_PHASE_DONE;
    }

    reset(): void {
        this._phase = DOOR_PHASE_CLOSED;
        this._time = 0;
        this._offset = 0;
    }

    /**
     * Starts closing the door, unless it already is. The way to shut a door
     * that never closes on its own.
     */
    close(): void {
        if (this._phase < DOOR_PHASE_CLOSING) {
            this.initPhase(DOOR_PHASE_CLOSING);
        }
    }

    /** Retires the door immediately. */
    dispose(): void {
        this.initPhase(DOOR_PHASE_DONE);
    }

    /**
     * Enters a phase, setting up whatever that phase needs.
     */
    initPhase(phase: DoorPhase): void {
        const easing = this._easing;
        this._phase = phase;
        switch (phase) {
            case DOOR_PHASE_CLOSED:
                this._time = 0;
                break;

            case DOOR_PHASE_OPENING:
                easing.setOutputRange(0, this._offsetMax);
                easing.setStepCount(this._slidingDuration);
                this._time = 0;
                this.events.emit('opening');
                break;

            case DOOR_PHASE_OPEN:
                this._offset = this._offsetMax;
                this._time = this._maintainDuration;
                this.events.emit('open');
                break;

            case DOOR_PHASE_CLOSING: {
                const check: DoorCloseCheck = { context: this, cancel: false };
                this.events.emit('check', check);
                if (check.cancel) {
                    // Something is in the way. Stay open and retry shortly.
                    this._time = DOOR_SECURITY_INTERVAL;
                    this._phase = DOOR_PHASE_OPEN;
                } else {
                    easing.setOutputRange(this._offsetMax, 0);
                    easing.setStepCount(this._slidingDuration);
                    easing.setFunction(this._closeFunction);
                    this._time = 0;
                    this.events.emit('closing');
                }
                break;
            }

            case DOOR_PHASE_DONE:
                this._time = 0;
                this._offset = 0;
                this.events.emit('close');
                break;
        }
    }

    getState(): DoorState {
        return { phase: this._phase, time: this._time };
    }

    /**
     * Restores a serialised state by replaying every phase up to the target,
     * so listeners see the same sequence they would have live.
     */
    setState({ phase, time }: DoorState): void {
        for (let i = 0; i <= phase; ++i) {
            this.initPhase(i as DoorPhase);
        }
        this._time = time;
        this._easing.compute(time);
    }

    get state(): DoorState {
        return this.getState();
    }

    set state(value: DoorState) {
        this.setState(value);
    }

    /** Advances the door by one tick. */
    process(): void {
        const easing = this._easing;
        switch (this._phase) {
            case DOOR_PHASE_CLOSED:
                if (++this._time >= this._delayDuration) {
                    this.initPhase(DOOR_PHASE_OPENING);
                }
                break;

            case DOOR_PHASE_OPENING:
                this._offset = easing.compute(++this._time).y;
                if (easing.over()) {
                    this.initPhase(DOOR_PHASE_OPEN);
                }
                break;

            case DOOR_PHASE_OPEN:
                // A maintain duration of Infinity never reaches zero, which is
                // how a door that only closes on command is expressed.
                if (--this._time <= 0) {
                    this.initPhase(DOOR_PHASE_CLOSING);
                }
                break;

            case DOOR_PHASE_CLOSING:
                this._offset = easing.compute(++this._time).y;
                if (easing.over()) {
                    this.initPhase(DOOR_PHASE_DONE);
                }
                break;

            case DOOR_PHASE_DONE:
                break;
        }
    }
}
