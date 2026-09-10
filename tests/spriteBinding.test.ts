import { describe, expect, it } from 'vitest';
import { SpriteBinding } from '../src/index.js';
import type { ActorFrame } from '../src/index.js';
import { Renderer } from '../src/Renderer.js';
import { Sprite } from '../src/Sprite.js';
import { installDom } from './harness/dom.js';

const frame = (
    moved: ActorFrame['moved'] = [], removed: ActorFrame['removed'] = []
): ActorFrame => ({ moved, removed });

const at = (id: number, x: number, y: number, z = 0, angle = 0) => ({ id, x, y, z, angle });

/** A sprite with eight facings, as a directional actor has. */
function directional(rc: Renderer): Sprite {
    const s = rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8));
    s.buildAnimation(
        { starts: [0, 1, 2, 3, 4, 5, 6, 7], length: 1, duration: 100, loop: 0 },
        'walk'
    );
    s.setCurrentAnimation('walk');
    return s;
}

function installCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    return c;
}

describe('SpriteBinding', () => {
    it('moves a sprite and its light from one frame', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);

        const sprite = rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8));
        const light = rc.addLightSource(0, 0, 10, 20, 1);
        binding.bind(1, sprite, { light });

        binding.apply(frame([at(1, 128, 256, -8)]), { x: 0, y: 0 });
        expect([sprite.x, sprite.y, sprite.h]).toEqual([128, 256, -8]);
        expect([light.x, light.y], 'the light should follow').toEqual([128, 256]);
    });

    it('ignores an update for an actor nothing is bound to', () => {
        installDom();
        const rc = new Renderer();
        const binding = new SpriteBinding(rc);
        // Spawned and removed inside one tick: never bound.
        expect(() => binding.apply(frame([at(9, 1, 1)], [9]), { x: 0, y: 0 })).not.toThrow();
    });

    it('disposes the sprite and removes the light of a removed actor', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);

        const sprite = rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8));
        const light = rc.addLightSource(0, 0, 10, 20, 1);
        binding.bind(1, sprite, { light });
        expect(binding.size).toBe(1);

        binding.apply(frame([], [1]), { x: 0, y: 0 });
        expect(binding.size).toBe(0);
        expect(binding.get(1)).toBeUndefined();
    });

    it('applies a move before a removal in the same frame', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);
        const sprite = rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8));
        binding.bind(1, sprite);

        // Moving a disposed sprite would be the bug; this must not throw and
        // the sprite must have reached its final position.
        binding.apply(frame([at(1, 50, 60)], [1]), { x: 0, y: 0 });
        expect([sprite.x, sprite.y]).toEqual([50, 60]);
        expect(binding.size).toBe(0);
    });

    it('turns a directional sprite when the camera moves, not only the actor', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);
        const sprite = directional(rc);
        binding.bind(1, sprite);

        // Place it once, with the camera due west.
        binding.apply(frame([at(1, 100, 100, 0, 0)]), { x: 0, y: 100 });
        const first = sprite.direction;

        // The actor does not move; the camera walks round to the far side.
        binding.apply(frame(), { x: 200, y: 100 });
        expect(sprite.direction, 'a static statue must still turn to face you')
            .not.toBe(first);
    });

    it('leaves a single-facing sprite alone however the camera moves', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);
        const sprite = rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8));
        sprite.buildAnimation({ starts: [0], length: 1, duration: 100, loop: 0 }, 'idle');
        sprite.setCurrentAnimation('idle');
        binding.bind(1, sprite);

        binding.apply(frame([at(1, 100, 100)]), { x: 0, y: 100 });
        binding.apply(frame(), { x: 200, y: 100 });
        expect(sprite.direction).toBe(0);
    });

    it('clears everything it holds', () => {
        installDom();
        const rc = new Renderer();
        rc.setScreen({ width: 64, height: 64 });
        rc.setMapSize(8);
        const binding = new SpriteBinding(rc);
        binding.bind(1, rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8)));
        binding.bind(2, rc.buildSprite(rc.buildTileSet(installCanvas(), 8, 8)));
        binding.clear();
        expect(binding.size).toBe(0);
    });
});
