import type { ActorFrame, ActorId } from '../core/actorFrame.js';
import type { LightHandle, Renderer } from '../Renderer.js';
import type { Sprite } from '../Sprite.js';
import { faceCamera } from './spriteFacing.js';

/** What is drawn for one actor. */
interface Binding {
    sprite: Sprite;
    light: LightHandle | null;
    /** Facing as last applied, so a still camera costs nothing. */
    angle: number;
}

/** Where the world is being viewed from. */
export interface CameraPosition {
    x: number;
    y: number;
}

/**
 * Draws what the simulation reports.
 *
 * A game binds a sprite to an actor id once, then hands each tick's
 * {@link ActorFrame} to {@link apply} — one call, rather than a loop that
 * moves sprites, moves lights, turns billboards and disposes the dead, which
 * is where a hand-written version usually leaks.
 *
 * It consumes plain data from Core and imports nothing from the simulation
 * tier, so the dependency arrow stays one-way in both directions.
 */
export class SpriteBinding {
    private readonly _renderer: Renderer;
    private readonly _bound = new Map<ActorId, Binding>();
    private _cameraX = NaN;
    private _cameraY = NaN;

    constructor(renderer: Renderer) {
        this._renderer = renderer;
    }

    get size(): number {
        return this._bound.size;
    }

    /** Attaches a sprite, and optionally a light that follows it. */
    bind(id: ActorId, sprite: Sprite, options: { light?: LightHandle | null } = {}): void {
        this._bound.set(id, { sprite, light: options.light ?? null, angle: NaN });
    }

    /** Detaches an actor, disposing its sprite and removing its light. */
    unbind(id: ActorId): void {
        const b = this._bound.get(id);
        if (b === undefined) {
            return;
        }
        this._renderer.disposeSprite(b.sprite);
        b.light?.remove();
        this._bound.delete(id);
    }

    get(id: ActorId): Sprite | undefined {
        return this._bound.get(id)?.sprite;
    }

    /**
     * Applies one tick.
     *
     * `moved` is handled before `removed`, because an actor can be in both —
     * it moved during its think, then died — and moving a sprite that has
     * already been disposed would be wrong.
     *
     * A billboard's facing depends on the camera as well as the actor, so a
     * directional sprite is re-faced when *either* moves. `faceCamera` returns
     * early for a sprite with a single facing, which is most scenery, so the
     * sweep after a camera move is cheap.
     */
    apply(frame: ActorFrame, camera: CameraPosition): void {
        const cameraMoved = camera.x !== this._cameraX || camera.y !== this._cameraY;

        for (const u of frame.moved) {
            const b = this._bound.get(u.id);
            // An actor spawned and removed inside one tick has nothing bound.
            if (b === undefined) {
                continue;
            }
            b.sprite.x = u.x;
            b.sprite.y = u.y;
            b.sprite.h = u.z;
            if (b.light !== null) {
                b.light.x = u.x;
                b.light.y = u.y;
            }
            b.angle = u.angle;
            if (!cameraMoved) {
                faceCamera(b.sprite, u.angle, camera.x, camera.y);
            }
        }

        if (cameraMoved) {
            // Everything directional has to turn, not just what moved.
            for (const b of this._bound.values()) {
                if (!Number.isNaN(b.angle)) {
                    faceCamera(b.sprite, b.angle, camera.x, camera.y);
                }
            }
            this._cameraX = camera.x;
            this._cameraY = camera.y;
        }

        for (const id of frame.removed) {
            this.unbind(id);
        }
    }

    /** Detaches everything. */
    clear(): void {
        for (const id of [...this._bound.keys()]) {
            this.unbind(id);
        }
    }
}
