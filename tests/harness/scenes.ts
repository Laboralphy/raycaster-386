import type { SceneSpec } from './fixtures.js';

const SHADING = { shades: 8, color: 'black', filter: null, brightness: 0 };
const METRICS = { spacing: 64, height: 96 };
const SCREEN = { width: 128, height: 128 };

/**
 * Four walls of a room, a floor and a ceiling. The baseline: if this differs,
 * something fundamental is wrong.
 */
const room: SceneSpec = {
    name: 'room',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'centre-east', x: 4 * 64, y: 4 * 64, angle: 0, height: 1 },
        { name: 'centre-diag', x: 4 * 64, y: 4 * 64, angle: Math.PI / 4, height: 1 },
        { name: 'corner', x: 1.5 * 64, y: 1.5 * 64, angle: Math.PI / 3, height: 1 },
        { name: 'off-grid', x: 3.37 * 64, y: 5.11 * 64, angle: 1.234, height: 1 },
        // height !== 1 takes the general flat path rather than the fvh === 1
        // fast path, so both branches of renderFlats are covered.
        { name: 'crouched', x: 4 * 64, y: 4 * 64, angle: 0, height: 0.5 },
        { name: 'raised', x: 4 * 64, y: 4 * 64, angle: 0, height: 1.6 }
    ]
};

/**
 * Doors and a transparent block. Exercises the phys switch in
 * createScreenSlice and, through scene.resume, the interleaved slices that
 * the 3-deep zbuffer lookback exists to merge.
 */
const doors: SceneSpec = {
    name: 'doors',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 6,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 },
        3: { n: 4, e: 4, s: 4, w: 4, f: null, c: null },
        4: { n: 5, e: 5, s: 5, w: 5, f: null, c: null }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 },
        // PHYS_DOOR_UP, half open: drives the sy/sh/dh door branch.
        'U': { material: 3, phys: 2, offset: 48 },
        // PHYS_DOOR_LEFT, part open: drives the lateral-slide branch.
        'L': { material: 3, phys: 6, offset: 24 },
        // PHYS_TRANSPARENT_BLOCK: the ray passes through and resumes.
        'T': { material: 4, phys: 10, offset: 0 },
        // PHYS_INVISIBLE_BLOCK: solid, but the slice is dropped.
        'I': { material: 4, phys: 11, offset: 0 }
    },
    map: [
        '########',
        '#..T...#',
        '#..#...#',
        '#U....L#',
        '#..#...#',
        '#..I...#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'facing-door-up', x: 4 * 64, y: 3.5 * 64, angle: Math.PI, height: 1 },
        { name: 'facing-transparent', x: 3.5 * 64, y: 4 * 64, angle: -Math.PI / 2, height: 1 },
        { name: 'facing-door-left', x: 4 * 64, y: 3.5 * 64, angle: 0, height: 1 },
        { name: 'oblique', x: 2.2 * 64, y: 5.7 * 64, angle: 0.9, height: 1 }
    ]
};

/**
 * Lit room. The only fixture that reads the LightMap grid, and so the only
 * one that depends on the @laboralphy/grid shim.
 */
const lit: SceneSpec = {
    name: 'lit',
    screen: SCREEN,
    metrics: METRICS,
    shading: { shades: 16, color: '#102030', filter: null, brightness: 0.1 },
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#..##..#',
        '#......#',
        '#......#',
        '#..##..#',
        '#......#',
        '########'
    ],
    lights: [
        { x: 2 * 64, y: 2 * 64, r0: 32, r1: 200, v: 0.9 },
        { x: 6 * 64, y: 6 * 64, r0: 16, r1: 150, v: 0.6 }
    ],
    cameras: [
        { name: 'between-lights', x: 4 * 64, y: 4 * 64, angle: Math.PI / 4, height: 1 },
        { name: 'near-light', x: 2.5 * 64, y: 2.5 * 64, angle: 0, height: 1 }
    ]
};

/**
 * A colour filter plus a non-black fog, on a shallow shading ramp. Isolates
 * the ShadedTileSet compute path from the geometry.
 */
const tinted: SceneSpec = {
    name: 'tinted',
    screen: SCREEN,
    metrics: METRICS,
    shading: { shades: 4, color: '#402000', filter: '#80c0ff', brightness: 0.25 },
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 2, c: 3 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'long-view', x: 1.5 * 64, y: 4 * 64, angle: 0, height: 1 },
        { name: 'short-view', x: 6.5 * 64, y: 4 * 64, angle: 0, height: 1 }
    ]
};

/**
 * Sprites at a range of distances, altitudes, scales and effect flags.
 * Covers the billboard projection and the FX_* blending paths.
 */
const sprites: SceneSpec = {
    name: 'sprites',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    sprites: [
        { x: 5.0 * 64, y: 4.0 * 64, tile: 0 },
        { x: 6.0 * 64, y: 4.0 * 64, tile: 1, h: 24 },
        { x: 6.5 * 64, y: 3.4 * 64, tile: 2, scale: 2 },
        // FX_LIGHT_ADD: composited with "lighter".
        { x: 5.5 * 64, y: 4.7 * 64, tile: 3, flags: 1 },
        // FX_ALPHA_50: half opacity.
        { x: 4.6 * 64, y: 4.3 * 64, tile: 1, flags: 2 << 2 },
        // FX_LIGHT_SOURCE: never dimmed by distance.
        { x: 6.8 * 64, y: 4.8 * 64, tile: 2, flags: 2 }
    ],
    cameras: [
        { name: 'facing-sprites', x: 2 * 64, y: 4 * 64, angle: 0, height: 1 },
        { name: 'close-up', x: 4.2 * 64, y: 4 * 64, angle: 0, height: 1 },
        { name: 'raised-view', x: 2 * 64, y: 4 * 64, angle: 0, height: 1.4 }
    ]
};

/**
 * Painted wall and floor decals, which replace a cell's material on one face
 * and are shaded independently of the atlas.
 */
const decals: SceneSpec = {
    name: 'decals',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    decals: [
        // Wall faces: west of (7,4) is what a camera at x=4 looking east sees.
        { x: 7, y: 4, face: 0, fill: '#c02020' },
        { x: 7, y: 3, face: 0, fill: '#20c020' },
        { x: 0, y: 4, face: 2, fill: '#2020c0' },
        // Floor and ceiling faces take the per-pixel rasteriser path.
        { x: 5, y: 4, face: 4, fill: '#c0c020' },
        { x: 5, y: 4, face: 5, fill: '#c020c0' }
    ],
    cameras: [
        { name: 'facing-decals', x: 4 * 64, y: 4.5 * 64, angle: 0, height: 1 },
        { name: 'over-floor-decal', x: 3.5 * 64, y: 4.5 * 64, angle: 0.2, height: 1 }
    ]
};

/**
 * A second storey rendered above the ground floor: the one feature
 * implemented by a Renderer driving another Renderer.
 *
 * The storey's slices are drawn before renderFlats, which then does
 * putImageData over the whole frame — so the upper floor is only visible
 * through cells whose ceiling face is null. The ground floor here is
 * deliberately open to the sky for that reason.
 */
const storey: SceneSpec = {
    name: 'storey',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        // Floor but no ceiling: open to the storey above.
        2: { n: null, e: null, s: null, w: null, f: 0, c: null },
        3: { n: 2, e: 3, s: 0, w: 1, f: null, c: null },
        4: { n: null, e: null, s: null, w: null, f: null, c: null }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 },
        '=': { material: 3, phys: 1 },
        ' ': { material: 4, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    storey: {
        map: [
            '========',
            '=      =',
            '=      =',
            '=      =',
            '=      =',
            '=      =',
            '=      =',
            '========'
        ]
    },
    cameras: [
        { name: 'centre', x: 4 * 64, y: 4 * 64, angle: 0, height: 1 },
        { name: 'centre-diag', x: 4 * 64, y: 4 * 64, angle: Math.PI / 4, height: 1 }
    ]
};

/**
 * A cell size that is not a power of two, which is the only thing that
 * exercises the generic branch of the flat rasteriser. Everything else here
 * uses 64, so without this scene that path would be dead code.
 */
const oddSpacing: SceneSpec = {
    name: 'odd-spacing',
    screen: SCREEN,
    metrics: { spacing: 48, height: 72 },
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'centre', x: 4 * 48, y: 4 * 48, angle: 0, height: 1 },
        { name: 'diag', x: 3.3 * 48, y: 4.7 * 48, angle: 0.9, height: 1 },
        // Also covers the general flat branch with a non-power-of-two spacing.
        { name: 'crouched', x: 4 * 48, y: 4 * 48, angle: 0, height: 0.5 }
    ]
};

/**
 * A backdrop seen through an open ceiling.
 *
 * The sky is only visible where the flat rasteriser writes nothing, so the
 * courtyard cells declare no ceiling face. Turning the camera scrolls the
 * backdrop, which is what the second and third poses check.
 */
const sky: SceneSpec = {
    name: 'sky',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    background: { width: 384, height: 128 },
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        // Floor but no ceiling: open to the sky.
        2: { n: null, e: null, s: null, w: null, f: 0, c: null },
        // Roofed, for contrast within one frame.
        3: { n: null, e: null, s: null, w: null, f: 0, c: 1 }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 },
        'o': { material: 3, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#..oo..#',
        '#..oo..#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'north', x: 4 * 64, y: 5 * 64, angle: -Math.PI / 2, height: 1 },
        // Same spot, turned: the backdrop must scroll with the view.
        { name: 'east', x: 4 * 64, y: 5 * 64, angle: 0, height: 1 },
        { name: 'south-west', x: 4 * 64, y: 5 * 64, angle: Math.PI * 0.75, height: 1 },
        // Raised, so more sky and less floor is in frame.
        { name: 'raised', x: 4 * 64, y: 6 * 64, angle: -Math.PI / 2, height: 1.5 }
    ]
};

/**
 * Animated wall surfaces.
 *
 * Animations only advance when the caller ticks them, so each pose pins its
 * own animation time and captures a different frame of the same cycle.
 */
const animated: SceneSpec = {
    name: 'animated',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: 0, c: 1 },
        // Every wall face cycles tiles 0..3, one frame per 10 ticks.
        3: { n: [0, 4, 10, 1], e: [0, 4, 10, 1], s: [0, 4, 10, 1], w: [0, 4, 10, 1], f: null, c: null },
        // A slower cycle over two tiles, to prove they advance independently.
        4: { n: [2, 2, 25, 1], e: [2, 2, 25, 1], s: [2, 2, 25, 1], w: [2, 2, 25, 1], f: null, c: null }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 },
        'A': { material: 3, phys: 1 },
        'B': { material: 4, phys: 1 }
    },
    map: [
        '########',
        '#......#',
        '#.AAAA.#',
        '#......#',
        '#......#',
        '#.BBBB.#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'frame-0', x: 4 * 64, y: 4 * 64, angle: -Math.PI / 2, height: 1, animationTime: 0 },
        { name: 'frame-1', x: 4 * 64, y: 4 * 64, angle: -Math.PI / 2, height: 1, animationTime: 10 },
        { name: 'frame-2', x: 4 * 64, y: 4 * 64, angle: -Math.PI / 2, height: 1, animationTime: 20 },
        // Looking the other way, at the slower pair, mid-cycle.
        { name: 'slow-cycle', x: 4 * 64, y: 4 * 64, angle: Math.PI / 2, height: 1, animationTime: 30 }
    ]
};

/**
 * Animated floor and ceiling faces.
 *
 * Separated from `animated` because the original cannot render these: it
 * reads the face straight out of the cell-code table and multiplies it by the
 * cell size, so a TileAnimation there becomes NaN, and `NaN | 0` collapses to
 * 0 — sampling column 0 of the atlas for every pixel. The result is opaque and
 * plausible-looking, which is why it went unnoticed. These baselines record
 * the port's behaviour, which resolves the animation to a frame.
 */
const animatedFlats: SceneSpec = {
    name: 'animated-flats',
    screen: SCREEN,
    metrics: METRICS,
    shading: SHADING,
    tileCount: 4,
    materials: {
        1: { n: 0, e: 1, s: 2, w: 3, f: null, c: null },
        2: { n: null, e: null, s: null, w: null, f: [0, 4, 10, 1], c: [2, 2, 15, 1] }
    },
    legend: {
        '#': { material: 1, phys: 1 },
        '.': { material: 2, phys: 0 }
    },
    map: [
        '########',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '#......#',
        '########'
    ],
    cameras: [
        { name: 'frame-0', x: 4 * 64, y: 4 * 64, angle: 0, height: 1, animationTime: 0 },
        { name: 'frame-2', x: 4 * 64, y: 4 * 64, angle: 0, height: 1, animationTime: 25 }
    ]
};

export const SCENES: readonly SceneSpec[] = [
    room, doors, lit, tinted, sprites, decals, storey, oddSpacing, sky, animated, animatedFlats
];

/** Every (scene, camera) pair, which is one golden image each. */
export function allCases(): { spec: SceneSpec; camera: SceneSpec['cameras'][number] }[] {
    return SCENES.flatMap(spec => spec.cameras.map(camera => ({ spec, camera })));
}
