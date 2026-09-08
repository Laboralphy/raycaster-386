import type { Face } from '../consts.js';
import type { ZSlice } from './ZBuffer.js';

export interface Camera {
    /** World position. */
    x: number;
    y: number;
    /** Projection focal length. */
    focal: number;
    /** Half the horizontal field of view, in radians. */
    fov: number;
    /** Facing angle, in radians. */
    direction: number;
    /** Eye height; 1 is standing on the floor plane. */
    height: number;
}

/**
 * State that lets a ray continue past a transparent wall instead of stopping
 * at it.
 */
export interface Resume {
    /** True when the last projection ended on a see-through surface. */
    active: boolean;
    /** Cell to resume from. */
    xi: number;
    yi: number;
}

/**
 * Everything one frame's raycast produces and consumes.
 *
 * Every field is declared here, including the seven that the original only
 * attached to the object from inside projectRay. Growing an object after
 * construction forces a hidden-class transition on every frame; declaring the
 * full shape up front costs nothing and avoids it.
 */
export interface Scene {
    camera: Camera;
    resume: Resume;
    /** The last ray left the map without hitting anything. */
    exterior: boolean;
    /** Length of the last ray, in world units. */
    distance: number;
    /** Rays longer than this are abandoned. */
    maxDistance: number;
    /** Cell size in world units. */
    spacing: number;
    /** Packed code of the last cell hit. */
    cellCode: number;
    /** Position of the last cell hit. */
    xCell: number;
    yCell: number;
    /** Which face of that cell was hit. */
    cellSide: Face;
    /** True when the hit surface is perpendicular to the x axis. */
    wallXed: boolean;
    /** Texel column within the hit surface. */
    wallColumn: number;
    /** Ray origin and direction, as last projected. */
    x: number;
    y: number;
    dx: number;
    dy: number;
    /** World position of the last intersection. */
    xint: number;
    yint: number;
    zbuffer: ZSlice[];
    /** The upper floor's scene, rendered behind this one. */
    storeyScene: Scene | null;
}

/** The cell the centre ray struck. */
export interface AimedCell {
    xCell: number;
    yCell: number;
    /** World position of the intersection. */
    x: number;
    y: number;
    side: Face;
}

export interface SceneOptions {
    x: number;
    y: number;
    direction: number;
    height: number;
    focal: number;
    screenWidth: number;
    spacing: number;
    storeyScene?: Scene | null;
}

export function createScene({
    x,
    y,
    direction,
    height,
    focal,
    screenWidth,
    spacing,
    storeyScene = null
}: SceneOptions): Scene {
    return {
        camera: {
            x,
            y,
            focal,
            fov: Math.atan2(screenWidth >> 1, focal),
            direction,
            height
        },
        resume: { active: false, xi: 0, yi: 0 },
        exterior: false,
        distance: 0,
        maxDistance: 100,
        spacing,
        cellCode: 0,
        xCell: 0,
        yCell: 0,
        cellSide: 0,
        wallXed: false,
        wallColumn: 0,
        x: 0,
        y: 0,
        dx: 0,
        dy: 0,
        xint: 0,
        yint: 0,
        zbuffer: [],
        storeyScene
    };
}
