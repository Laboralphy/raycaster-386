/** A command waiting to run. */
interface Scheduled {
    id: number;
    command: () => void;
    /** The tick it is due at. */
    time: number;
    /** Ticks between repeats, or 0 for a one-shot. */
    every: number;
}

/**
 * Runs commands later, on the simulation's clock rather than the wall's.
 *
 * A `setTimeout` fires against real time, which drifts from a paused, slowed
 * or replayed simulation and cannot be saved. This counts the same ticks
 * everything else does, so a delayed command survives a save and lands on the
 * same tick on every machine.
 */
export class Scheduler {
    private _commands: Scheduled[] = [];
    private _time = 0;
    private _lastId = 0;
    private _sorted = true;

    /** The tick last passed to {@link schedule}. */
    get time(): number {
        return this._time;
    }

    /** Runs `command` once, `delay` ticks from now. */
    delay(command: () => void, delay: number): number {
        return this.add(command, delay, 0);
    }

    /**
     * Runs `command` every `duration` ticks.
     *
     * A duration of zero or less is rejected: the original looped
     * `while (due <= now) due += duration`, which never terminates when the
     * step is zero.
     */
    loop(command: () => void, duration: number): number {
        if (duration <= 0) {
            throw new Error(`Scheduler.loop: duration must be positive, got ${duration}`);
        }
        return this.add(command, duration, duration);
    }

    /** Cancels a command by the id {@link delay} or {@link loop} returned. */
    cancel(id: number): boolean {
        const i = this._commands.findIndex((c) => c.id === id);
        if (i < 0) {
            return false;
        }
        this._commands.splice(i, 1);
        return true;
    }

    /** Drops everything pending. */
    clear(): void {
        this._commands = [];
    }

    get pending(): number {
        return this._commands.length;
    }

    /**
     * Advances to `time`, running whatever fell due.
     *
     * A repeating command catches up: skipping ten of its intervals runs it ten
     * times, so a paused simulation does not silently swallow them. Commands
     * are collected before any of them runs, so one that schedules another does
     * not have it fire within the same tick.
     */
    schedule(time: number): void {
        this._time = time;
        if (!this._sorted) {
            this._commands.sort((a, b) => a.time - b.time);
            this._sorted = true;
        }
        const due: (() => void)[] = [];
        const keep: Scheduled[] = [];
        for (const c of this._commands) {
            if (c.every === 0) {
                if (c.time <= time) {
                    due.push(c.command);
                } else {
                    keep.push(c);
                }
                continue;
            }
            while (c.time <= time) {
                c.time += c.every;
                due.push(c.command);
            }
            keep.push(c);
        }
        this._commands = keep;
        for (const command of due) {
            command();
        }
    }

    private add(command: () => void, delay: number, every: number): number {
        const id = ++this._lastId;
        this._commands.push({ id, command, time: this._time + delay, every });
        this._sorted = false;
        return id;
    }
}
