import { describe, expect, it } from 'vitest';
import { createTileAnimation, TileAnimation } from '../src/texture/TileAnimation.js';
import { ANIM_LOOP_FORWARD, ANIM_LOOP_NONE, ANIM_LOOP_YOYO } from '../src/consts.js';

function anim(loop: 0 | 1 | 2, count: number, duration = 10): TileAnimation {
    const a = new TileAnimation();
    a.base = 100;
    a.count = count;
    a.duration = duration;
    a.loop = loop;
    return a;
}

describe('TileAnimation', () => {
    it('does not advance in ANIM_LOOP_NONE', () => {
        const a = anim(ANIM_LOOP_NONE, 4);
        a.animate(1000);
        expect(a.frame()).toBe(100);
    });

    it('cycles forward and wraps', () => {
        const a = anim(ANIM_LOOP_FORWARD, 3);
        expect(a.frame()).toBe(100);
        a.animate(10);
        expect(a.frame()).toBe(101);
        a.animate(10);
        expect(a.frame()).toBe(102);
        a.animate(10);
        expect(a.frame()).toBe(100);
    });

    it('bounces in yoyo mode, holding the top frame for one extra step', () => {
        const a = anim(ANIM_LOOP_YOYO, 3);
        const seen: number[] = [];
        for (let i = 0; i < 8; ++i) {
            a.animate(10);
            seen.push(a.frame() - 100);
        }
        // The bounce is asymmetric, and deliberately preserved as such.
        // Overshooting the top clamps `count` back to `count - 1`, a
        // different frame, so the last frame shows twice; overshooting the
        // bottom clamps 0 to 0, the same frame, so frame 0 shows once.
        // Pinned against the original by TileAnimation.diff.test.ts.
        expect(seen).toEqual([1, 2, 2, 1, 0, 1, 2, 2]);
    });

    it('carries sub-frame time across calls', () => {
        const a = anim(ANIM_LOOP_FORWARD, 8, 100);
        a.animate(60);
        expect(a.frame()).toBe(100);
        a.animate(60);
        expect(a.frame()).toBe(101);
        expect(a.time).toBe(20);
    });

    it('advances several frames when given a large time step', () => {
        const a = anim(ANIM_LOOP_FORWARD, 8, 10);
        a.animate(35);
        expect(a.frame()).toBe(103);
    });

    it('freezes after exhausting its iterations', () => {
        const a = anim(ANIM_LOOP_FORWARD, 2);
        a.iterations = 1;
        a.animate(10);
        a.animate(10);
        expect(a.frozen).toBe(true);
        const frozenAt = a.frame();
        a.animate(1000);
        expect(a.frame()).toBe(frozenAt);
    });

    it('restores the original iteration count on reset', () => {
        const a = anim(ANIM_LOOP_FORWARD, 2);
        a.iterations = 1;
        a.animate(20);
        expect(a.frozen).toBe(true);
        a.reset();
        expect(a.frozen).toBe(false);
        expect(a.iterations).toBe(1);
        expect(a.frame()).toBe(100);
    });

    it('applies the documented defaults', () => {
        const a = createTileAnimation();
        expect(a.base).toBe(0);
        expect(a.count).toBe(1);
        expect(a.duration).toBe(100);
        expect(a.loop).toBe(ANIM_LOOP_NONE);
        expect(a.iterations).toBe(Infinity);
    });

    it('treats null iterations as forever', () => {
        expect(createTileAnimation({ iterations: null }).iterations).toBe(Infinity);
    });
});
