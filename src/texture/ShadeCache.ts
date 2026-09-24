/**
 * Shaded sprite frames, built when first drawn and kept under a byte budget.
 *
 * A sprite sheet normally stores every frame at every shade, which for a dozen
 * animated characters is most of a level's texture memory and nearly all of it
 * never drawn: an actor facing north at four cells away needs one frame at one
 * shade, not thirty-six at sixteen. This holds the combinations that were
 * actually asked for and evicts the ones asked for longest ago.
 *
 * It is affordable here and not for walls because of how each is drawn. A wall
 * is a slice per screen column, hundreds a frame, so anything per draw is paid
 * hundreds of times; a sprite is one draw for the whole billboard, and a level
 * showing eight of them pays eight times.
 *
 * The cache is shared by every tileset so that the budget means something at
 * the level of a game rather than per sheet.
 */

/** Room for roughly 170 frames of 64x96, which no sane scene draws at once. */
const DEFAULT_BUDGET = 4 * 1024 * 1024;

/** Shades per tile in a key. Above this a tileset's keys would collide. */
const LEVEL_SPAN = 64;
/** Tiles per owner in a key. */
const TILE_SPAN = 16384;

interface Entry {
    canvas: HTMLCanvasElement;
    bytes: number;
    owner: number;
}

export interface ShadeCacheStats {
    hits: number;
    misses: number;
    evictions: number;
    entries: number;
    bytes: number;
    budget: number;
}

export class ShadeCache {
    private _budget = DEFAULT_BUDGET;
    private _bytes = 0;
    /** Insertion-ordered, which is what makes eviction least-recently-used. */
    private _entries = new Map<number, Entry>();
    private _perOwner = new Map<number, number>();
    private _hits = 0;
    private _misses = 0;
    private _evictions = 0;

    get budget(): number {
        return this._budget;
    }

    /** Sets the budget, evicting immediately if the new one is smaller. */
    setBudget(bytes: number): void {
        this._budget = Math.max(0, bytes);
        this.evict();
    }

    static key(owner: number, tile: number, level: number): number {
        return (owner * TILE_SPAN + tile) * LEVEL_SPAN + level;
    }

    /** The cached frame, or undefined. A hit is moved to the young end. */
    get(key: number): HTMLCanvasElement | undefined {
        const entry = this._entries.get(key);
        if (entry === undefined) {
            ++this._misses;
            return undefined;
        }
        ++this._hits;
        // Re-inserting moves it last in iteration order, so eviction, which
        // takes from the front, takes what has gone longest unused.
        this._entries.delete(key);
        this._entries.set(key, entry);
        return entry.canvas;
    }

    put(key: number, owner: number, canvas: HTMLCanvasElement): void {
        const bytes = canvas.width * canvas.height * 4;
        const previous = this._entries.get(key);
        if (previous !== undefined) {
            this.charge(previous.owner, -previous.bytes);
        }
        this._entries.set(key, { canvas, bytes, owner });
        this.charge(owner, bytes);
        this.evict();
    }

    /** Drops everything a tileset owns. Call when its shading changes. */
    dropOwner(owner: number): void {
        if ((this._perOwner.get(owner) ?? 0) === 0) {
            return;
        }
        for (const [key, entry] of this._entries) {
            if (entry.owner === owner) {
                this._entries.delete(key);
                this.charge(owner, -entry.bytes);
            }
        }
    }

    clear(): void {
        this._entries.clear();
        this._perOwner.clear();
        this._bytes = 0;
    }

    /** Bytes held on behalf of one tileset, for memory reporting. */
    bytesFor(owner: number): number {
        return this._perOwner.get(owner) ?? 0;
    }

    resetStats(): void {
        this._hits = 0;
        this._misses = 0;
        this._evictions = 0;
    }

    stats(): ShadeCacheStats {
        return {
            hits: this._hits,
            misses: this._misses,
            evictions: this._evictions,
            entries: this._entries.size,
            bytes: this._bytes,
            budget: this._budget,
        };
    }

    private charge(owner: number, bytes: number): void {
        this._bytes += bytes;
        const total = (this._perOwner.get(owner) ?? 0) + bytes;
        if (total <= 0) {
            this._perOwner.delete(owner);
        } else {
            this._perOwner.set(owner, total);
        }
    }

    private evict(): void {
        while (this._bytes > this._budget) {
            // Map iteration starts at the oldest entry.
            const oldest = this._entries.keys().next();
            if (oldest.done === true) {
                return;
            }
            const entry = this._entries.get(oldest.value);
            this._entries.delete(oldest.value);
            if (entry !== undefined) {
                this.charge(entry.owner, -entry.bytes);
            }
            ++this._evictions;
        }
    }
}

/**
 * The cache every lazily shaded tileset draws from.
 *
 * One for the process: a budget is a statement about a machine, and a game
 * that wanted one per sheet would have to divide it up itself.
 */
export const shadeCache = new ShadeCache();
