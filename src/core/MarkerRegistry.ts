/**
 * A set of marked 2D integer positions.
 *
 * Positions are packed into a single int as `x << 16 | y`, so both
 * coordinates must be in the range 0..65535. All callers work in map-cell or
 * lightmap-cell space, which is well inside that.
 */
export class MarkerRegistry {
    private _s: Set<number> = new Set();

    get state(): number[] {
        return [...this._s];
    }

    set state(value: readonly number[]) {
        this._s = new Set(value);
    }

    get size(): number {
        return this._s.size;
    }

    mark(x: number, y: number): void {
        this._s.add((x << 16) | y);
    }

    unmark(x: number, y: number): void {
        this._s.delete((x << 16) | y);
    }

    clear(): void {
        this._s.clear();
    }

    isMarked(x: number, y: number): boolean {
        return this._s.has((x << 16) | y);
    }

    /**
     * Calls back for every marked position.
     */
    iterate(f: (x: number, y: number) => void): void {
        this._s.forEach((n) => {
            f(n >> 16, n & 0xffff);
        });
    }

    /**
     * Merges another registry into this one. Mutates this registry.
     */
    merge(mr: MarkerRegistry): void {
        mr._s.forEach((v) => this._s.add(v));
    }

    toArray(): { x: number; y: number }[] {
        const a: { x: number; y: number }[] = [];
        this.iterate((x, y) => {
            a.push({ x, y });
        });
        return a;
    }
}
