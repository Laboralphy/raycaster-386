/**
 * A small typed event emitter.
 *
 * Exists so the engine layer carries no dependency on Node's `events`, which
 * the original imported into browser code.
 */
export type Listener<A extends unknown[]> = (...args: A) => void;

/** Storage type: listeners are erased going in and restored coming out. */
type AnyListener = (...args: never[]) => void;

export class TypedEmitter<E extends Record<string, unknown[]>> {
    private _listeners = new Map<keyof E, AnyListener[]>();

    on<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
        const list = this._listeners.get(event);
        if (list === undefined) {
            this._listeners.set(event, [listener as unknown as AnyListener]);
        } else {
            list.push(listener as unknown as AnyListener);
        }
        return this;
    }

    off<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
        const list = this._listeners.get(event);
        if (list !== undefined) {
            const i = list.indexOf(listener as unknown as AnyListener);
            if (i >= 0) {
                list.splice(i, 1);
            }
        }
        return this;
    }

    once<K extends keyof E>(event: K, listener: Listener<E[K]>): this {
        const wrapper = ((...args: E[K]) => {
            this.off(event, wrapper);
            listener(...args);
        }) as Listener<E[K]>;
        return this.on(event, wrapper);
    }

    emit<K extends keyof E>(event: K, ...args: E[K]): boolean {
        const list = this._listeners.get(event);
        if (list === undefined || list.length === 0) {
            return false;
        }
        // Copy: a listener may remove itself, or another, while we iterate.
        for (const listener of list.slice()) {
            (listener as unknown as Listener<E[K]>)(...args);
        }
        return true;
    }

    removeAllListeners(event?: keyof E): this {
        if (event === undefined) {
            this._listeners.clear();
        } else {
            this._listeners.delete(event);
        }
        return this;
    }

    listenerCount(event: keyof E): number {
        return this._listeners.get(event)?.length ?? 0;
    }
}
