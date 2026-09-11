import { describe, expect, it } from 'vitest';
import { Renderer } from '../src/Renderer.js';
import type { Sprite } from '../src/Sprite.js';
import { installDom } from './harness/dom.js';
import { buildFlatAtlas, buildSpriteAtlas, buildWallAtlas, SPRITE_TILE_HEIGHT, SPRITE_TILE_WIDTH } from './harness/fixtures.js';
import { SCENES } from './harness/scenes.js';

const TWO_PI = Math.PI * 2;
const SPEC = SCENES.find(s => s.name === 'sprites')!;

/**
 * An empty room with one sprite due east of the camera, which therefore must
 * be drawn from any angle that looks east.
 */
function room(): { rc: Renderer; sprite: Sprite; x: number; y: number } {
    installDom();
    const rc = new Renderer();
    rc.setScreen({ width: SPEC.screen.width, height: SPEC.screen.height });
    rc.setMetrics(SPEC.metrics);
    rc.setShading(SPEC.shading);
    rc.setWallTextures(buildWallAtlas(SPEC));
    rc.setFlatTextures(buildFlatAtlas(SPEC));
    rc.setMapSize(8);
    rc.registerCellMaterial(1, { n: 0, e: 1, s: 2, w: 3, f: null, c: null });
    rc.registerCellMaterial(2, { n: null, e: null, s: null, w: null, f: 0, c: 1 });
    for (let y = 0; y < 8; ++y) {
        for (let x = 0; x < 8; ++x) {
            const wall = x === 0 || y === 0 || x === 7 || y === 7;
            rc.setCellMaterial(x, y, wall ? 1 : 2);
            rc.setCellPhys(x, y, wall ? 1 : 0);
        }
    }
    const tileset = rc.buildTileSet(buildSpriteAtlas(), SPRITE_TILE_WIDTH, SPRITE_TILE_HEIGHT);
    const sprite = rc.buildSprite(tileset);
    sprite.x = 5 * 64;
    sprite.y = 4 * 64;
    sprite.buildAnimation({ starts: [0], length: 1, duration: 100, loop: 0 });
    return { rc, sprite, x: 2 * 64, y: 4 * 64 };
}

/**
 * True if the sprite survived the off-axis cull this frame.
 *
 * `lastRendered.tileset` is written only by a sprite that got as far as the
 * z-buffer, so clearing it before a render makes it answer exactly "was this
 * drawn". One renderer is reused across the sweep below: building a fresh one
 * per angle is correct too, but hundreds of them do not fit in a test.
 */
const scene = room();

function drawnAt(angle: number): boolean {
    const { rc, sprite, x, y } = scene;
    sprite.lastRendered.tileset = null;
    rc.render(x, y, angle, 1);
    return sprite.lastRendered.tileset !== null;
}

/**
 * A camera angle is accumulated, never wrapped.
 *
 * `PlayerThinker` and the original's `FPSControlThinker` both do a bare
 * `angle += turn`, so a player who keeps turning winds past 2*PI without
 * bound. The off-axis test in `renderSprites` must not care: an angle and that
 * angle plus any whole number of revolutions are the same direction.
 *
 * The original reduced the bearing with a single add or subtract of 2*PI
 * (`Renderer.js:1919`), which cannot close a gap several revolutions wide.
 * Past ~1.38 net turns its sprites began failing the test and vanishing, while
 * the walls — cast with periodic `cos`/`sin` — kept rendering normally. Seen
 * in both demos on 2026-09-11; the partial-loss band, 8.66..10.19 rad, is what
 * made it look like a single bad sprite rather than a broken renderer.
 */
describe('sprite culling is invariant to camera winding', () => {
    it('draws a sprite dead ahead however far the angle has wound', () => {
        for (const turns of [0, 1, -1, 2, -2, 3, -3, 10, -10, 50]) {
            expect(drawnAt(turns * TWO_PI), `${turns} turns`).toBe(true);
        }
    });

    it('agrees with its own wrapped angle all the way round', () => {
        // The general invariant, swept over a full circle so it covers angles
        // that see the sprite and angles that do not: winding must change
        // nothing. 8.66..10.19 rad is where the original lost *some* sprites
        // and kept others, which is the shape the glitch took.
        for (let a = -Math.PI; a < Math.PI; a += 0.1) {
            const wrapped = drawnAt(a);
            for (const turns of [1, -1, 2, -2]) {
                expect(
                    drawnAt(a + turns * TWO_PI),
                    `${a.toFixed(2)} rad + ${turns} turns`
                ).toBe(wrapped);
            }
        }
    });

    it('still culls a sprite that is genuinely off to the side', () => {
        // The fix must not disable the cull: looking away must drop it, from a
        // wound angle exactly as from a fresh one.
        expect(drawnAt(Math.PI)).toBe(false);
        for (const turns of [1, -1, 4, -4]) {
            expect(drawnAt(Math.PI + turns * TWO_PI), `PI + ${turns} turns`).toBe(false);
        }
    });
});
