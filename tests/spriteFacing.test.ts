import { describe, expect, it } from 'vitest';
import { Sprite } from '../src/Sprite.js';
import { faceCamera, SPRITE_DIRECTION_COUNT } from '../src/render/spriteFacing.js';

/** A sprite with one animation per facing, as a directional sprite is declared. */
function directional(): Sprite {
    const s = new Sprite();
    s.buildAnimation(
        { starts: [0, 4, 8, 12, 16, 20, 24, 28], length: 4, duration: 100, loop: 1 },
        'walk'
    );
    s.setCurrentAnimation('walk');
    return s;
}

describe('faceCamera', () => {
    it('shows every facing as the camera orbits the sprite', () => {
        const s = directional();
        s.x = 0;
        s.y = 0;
        const seen = new Set<number>();
        for (let i = 0; i < 64; ++i) {
            const a = (i / 64) * Math.PI * 2;
            // Sprite pointing along +x; camera walks a circle around it.
            faceCamera(s, 0, Math.cos(a) * 100, Math.sin(a) * 100);
            seen.add(s.direction);
        }
        expect(seen.size).toBe(SPRITE_DIRECTION_COUNT);
    });

    it('shows a different frame for a sprite facing towards versus away', () => {
        const s = directional();
        s.x = 0;
        s.y = 0;
        // Camera due east of the sprite.
        const towards = faceCamera(s, 0, 100, 0);
        const away = faceCamera(s, Math.PI, 100, 0);
        expect(towards).not.toBe(away);
        // Opposite facings are four sectors apart in an eight-sector wheel.
        expect(Math.abs(towards - away)).toBe(SPRITE_DIRECTION_COUNT / 2);
    });

    it('does not restart the walk cycle when the facing has not changed', () => {
        const s = directional();
        s.x = 0;
        s.y = 0;
        faceCamera(s, 0, 100, 0);

        // Advance a few frames of the cycle...
        for (let i = 0; i < 3; ++i) {
            s.animate(100);
        }
        const frame = s.getCurrentFrame();
        expect(frame, 'the animation never advanced').not.toBe(0);

        // ...then ask again with nothing changed.
        faceCamera(s, 0, 100, 0);
        expect(s.getCurrentFrame(), 'the cycle restarted').toBe(frame);
    });

    it('keeps the cursor across a real facing change', () => {
        const s = directional();
        s.x = 0;
        s.y = 0;
        faceCamera(s, 0, 100, 0);
        for (let i = 0; i < 3; ++i) {
            s.animate(100);
        }
        const before = s.getCurrentFrame();
        const dirBefore = s.direction;

        faceCamera(s, Math.PI, 100, 0);
        expect(s.direction).not.toBe(dirBefore);
        // A different frame of the strip, but the same point in the cycle:
        // the sprite turned mid-stride rather than snapping back to frame 0.
        expect(s.getCurrentFrame()).not.toBe(before);
        expect(s.getCurrentAnimation()!.index).toBe(3);
    });

    it('is a no-op for a sprite with only one facing', () => {
        const s = new Sprite();
        s.buildAnimation({ starts: [0], length: 4, duration: 100, loop: 1 }, 'idle');
        s.setCurrentAnimation('idle');
        expect(() => faceCamera(s, 0, 100, 0)).not.toThrow();
        expect(s.direction).toBe(0);
    });
});

describe('Sprite facings', () => {
    it('reports how many facings the current group holds', () => {
        const s = new Sprite();
        expect(s.facings, 'before any animation is chosen').toBe(0);
        s.buildAnimation({ starts: [0, 4, 8, 12], length: 2, duration: 100, loop: 1 }, 'walk');
        s.setCurrentAnimation('walk');
        expect(s.facings).toBe(4);
    });

    it('builds one animation per facing, appending across calls', () => {
        const s = new Sprite();
        s.buildAnimation({ starts: [0, 4], length: 2, duration: 100, loop: 1 }, 'walk');
        expect(s.facings).toBe(0);
        s.setCurrentAnimation('walk');
        expect(s.facings).toBe(2);
        s.buildAnimation({ starts: [8, 12], length: 2, duration: 100, loop: 1 }, 'walk');
        expect(s.facings, 'a second call should append').toBe(4);
    });

    it('refuses an animation with no facings', () => {
        const s = new Sprite();
        expect(() => s.buildAnimation({ starts: [], length: 2, duration: 100, loop: 1 }, 'walk'))
            .toThrow(/declares no facings/);
    });

    it('rejects a facing outside the group rather than crashing on undefined', () => {
        const s = new Sprite();
        s.buildAnimation({ starts: [0, 4, 8, 12], length: 2, duration: 100, loop: 1 }, 'walk');
        s.setCurrentAnimation('walk');
        // Upstream this indexed past the end and then read `.index` off
        // undefined, so the failure was a TypeError from inside the sprite.
        expect(() => s.setDirection(4)).toThrow(/outside "walk", which has 4/);
        expect(() => s.setDirection(-1)).toThrow(RangeError);
        expect(() => s.setCurrentAnimation('walk', 9)).toThrow(/outside "walk"/);
    });

    it('quantises onto a sprite drawn from four sides, not a fixed eight', () => {
        // The case that used to crash: an eight-sector wheel indexing a
        // four-entry group.
        const s = new Sprite();
        s.buildAnimation({ starts: [0, 4, 8, 12], length: 2, duration: 100, loop: 1 }, 'walk');
        s.setCurrentAnimation('walk');
        s.x = 0;
        s.y = 0;

        const seen = new Set<number>();
        for (let i = 0; i < 64; ++i) {
            const a = (i / 64) * Math.PI * 2;
            expect(() => faceCamera(s, 0, Math.cos(a) * 100, Math.sin(a) * 100)).not.toThrow();
            seen.add(s.direction);
        }
        expect(seen).toEqual(new Set([0, 1, 2, 3]));
    });

    it('leaves a single-facing sprite alone', () => {
        const s = new Sprite();
        s.buildAnimation({ starts: [0], length: 4, duration: 100, loop: 1 }, 'idle');
        s.setCurrentAnimation('idle');
        expect(s.facings).toBe(1);
        expect(faceCamera(s, 0, 100, 0)).toBe(0);
    });
});
