import { FX_NONE } from './consts.js';
import { createTileAnimation, TileAnimation, type TileAnimationDef } from './texture/TileAnimation.js';
import { ShadedTileSet } from './texture/ShadedTileSet.js';

/** The source and destination rectangles a sprite was last drawn with. */
export interface RenderedRect {
    tileset: ShadedTileSet | null;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
}

/**
 * A billboard drawn inside the raycast world.
 *
 * Animations are grouped by reference name; within a group, each entry is one
 * facing direction, so a directional sprite is a group of N animations sharing
 * a frame cursor.
 */
export class Sprite {
    /** World position. */
    x = 0;
    y = 0;
    /** Altitude above the floor. */
    h = 0;
    visible = true;
    /** Larger values shrink the sprite: projected size is divided by this. */
    scale = 1;
    /** FX_* bit flags. */
    flags = FX_NONE;

    /**
     * Where this sprite last landed on screen. Written by the renderer each
     * frame; useful for hit-testing and for effects that need to draw over a
     * sprite exactly where it appeared.
     */
    readonly lastRendered: RenderedRect = {
        tileset: null,
        sx: 0, sy: 0, sw: 0, sh: 0,
        dx: 0, dy: 0, dw: 0, dh: 0
    };

    private _animations: Record<string, TileAnimation[]> = {};
    private _animation: TileAnimation | null = null;
    private _currentRef = '';
    private _currentDir = 0;
    private _tileset: ShadedTileSet | null = null;
    /** Animated along with this sprite. Not drawn by the renderer. */
    private _children: Sprite[] = [];

    get animation(): TileAnimation | null {
        return this._animation;
    }

    set animation(value: TileAnimation | null) {
        this._animation = value;
    }

    get children(): readonly Sprite[] {
        return this._children;
    }

    addChild(sprite: Sprite): void {
        this._children.push(sprite);
    }

    removeChild(sprite: Sprite): void {
        const i = this._children.indexOf(sprite);
        if (i >= 0) {
            this._children.splice(i, 1);
        }
    }

    addFlag(v: number): void {
        this.flags |= v;
    }

    removeFlag(v: number): void {
        this.flags &= ~v;
    }

    hasFlag(v: number): boolean {
        return (this.flags & v) !== 0;
    }

    /**
     * Adds an animation to a group. Passing an array of `start` indices adds
     * one animation per index, which is how a directional sprite is declared.
     */
    buildAnimation(
        def: Omit<TileAnimationDef, 'start'> & { start?: number | number[] },
        ref = 'default'
    ): void {
        const { start = 0 } = def;
        if (Array.isArray(start)) {
            start.forEach(s => this.buildAnimation({ ...def, start: s }, ref));
            return;
        }
        const a = createTileAnimation({ ...def, start: start as number });
        (this._animations[ref] ??= []).push(a);
        if (this._animation === null) {
            this._animation = a;
        }
    }

    /** The name of the first declared animation group. */
    getFirstAnimation(): string | undefined {
        return Object.keys(this._animations).shift();
    }

    /**
     * Switches to another animation group.
     *
     * @param index which direction within the group; defaults to the current
     * direction, so switching group keeps the sprite facing the same way.
     */
    setCurrentAnimation(ref: string, index?: number): void {
        const group = this._animations[ref];
        if (group === undefined) {
            throw new Error(`Sprite.setCurrentAnimation: this animation does not exist: "${ref}"`);
        }
        if (index === undefined) {
            if (this._currentRef === ref) {
                return;
            }
            // The original clamped to group.length, which could index one
            // past the end and leave the sprite with no animation.
            index = Math.min(this._currentDir, group.length - 1);
        }
        this._currentRef = ref;
        this._animation = group[index];
        this._animation.index = 0;
    }

    getCurrentAnimation(): TileAnimation | null {
        return this._animation;
    }

    /**
     * Faces a directional sprite a different way, preserving its frame cursor
     * so the walk cycle does not restart. A no-op for non-directional groups.
     */
    setDirection(direction: number): void {
        const ref = this._currentRef;
        if (!ref) {
            return;
        }
        const group = this._animations[ref];
        if (group === undefined) {
            throw new Error(`Sprite.setDirection: "${ref}" is not in the current animations`);
        }
        if (group.length > 1 && this._animation !== null) {
            const { index, time, loopDir } = this._animation;
            this.setCurrentAnimation(ref, direction);
            const a = this._animation;
            a.index = index;
            a.time = time;
            a.loopDir = loopDir;
            this._currentDir = direction;
        }
    }

    /** Which facing of the current animation group is showing. */
    get direction(): number {
        return this._currentDir;
    }

    setTileSet(ts: ShadedTileSet | null): void {
        this._tileset = ts;
    }

    getTileSet(): ShadedTileSet | null {
        return this._tileset;
    }

    /** The tileset index of the frame currently shown. */
    getCurrentFrame(): number {
        return this._animation === null ? 0 : this._animation.frame();
    }

    /**
     * Advances this sprite's animation and its children's.
     */
    animate(time: number): void {
        this._animation?.animate(time);
        const c = this._children;
        for (let i = 0, l = c.length; i < l; ++i) {
            c[i].animate(time);
        }
    }
}
