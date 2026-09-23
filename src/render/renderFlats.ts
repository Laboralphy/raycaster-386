import { FACE_CEILING, FACE_COUNT, FACE_FLOOR } from '../consts.js';
import { resolveTile, type CellCodes, type RenderContext } from '../raycast/context.js';
import type { Scene } from '../raycast/Scene.js';

/**
 * Cached pixel data for the flat rasteriser.
 *
 * The shaded flat tileset is read as raw 32-bit pixels rather than drawn, so
 * the floor and ceiling can be textured per pixel. Both the source atlas and
 * the destination frame are kept as Uint32Array views.
 *
 * The source pixels belong to the tileset, which stores its shaded layers
 * that way (see `ShadedTileSet.setPixelStorage`); this only points at them.
 * Reading them back from the canvas here instead stored the atlas a second
 * time, and a third for every upper storey, each with its own context.
 */
export interface FlatContext {
    /** The flat tileset's shaded pixels, as a 32-bit view. Not owned. */
    pixels32: Uint32Array | null;
    /** Width of the atlas {@link pixels32} holds, the stride of a pixel row. */
    pixelsWidth: number;
    renderSurface: ImageData | null;
    renderSurface32: Uint32Array | null;
    /**
     * Floor and ceiling tile index per material code, -1 for none.
     *
     * Resolved once per frame rather than per pixel: the inner loop below
     * runs screenWidth * screenHeight/2 times, and walking the cell-code
     * table there costs a call and a type test on every one of them. It also
     * makes an animated flat hold one frame for the whole frame instead of
     * being re-read per pixel.
     */
    floorTiles: Int32Array;
    ceilTiles: Int32Array;
}

export function createFlatContext(): FlatContext {
    return {
        pixels32: null,
        pixelsWidth: 0,
        renderSurface: null,
        renderSurface32: null,
        floorTiles: new Int32Array(0),
        ceilTiles: new Int32Array(0),
    };
}

/** Drops the source pixels and the frame buffer, forcing both to be reset. */
export function resetFlatContext(fc: FlatContext): void {
    fc.pixels32 = null;
    fc.pixelsWidth = 0;
    fc.renderSurface = null;
    fc.renderSurface32 = null;
}

/** Rebuilds the per-material flat tile lookup for this frame. */
function resolveFlatTiles(fc: FlatContext, codes: CellCodes): void {
    const n = codes.length;
    if (fc.floorTiles.length !== n) {
        fc.floorTiles = new Int32Array(n);
        fc.ceilTiles = new Int32Array(n);
    }
    const floor = fc.floorTiles;
    const ceil = fc.ceilTiles;
    for (let i = 0; i < n; ++i) {
        const f = resolveTile(codes, i, FACE_FLOOR);
        const c = resolveTile(codes, i, FACE_CEILING);
        floor[i] = f === null ? -1 : f;
        ceil[i] = c === null ? -1 : c;
    }
}

/**
 * Draws the floor and the ceiling, one pixel at a time.
 *
 * For each screen row the distance to the ground plane is constant, so the
 * world position of the leftmost texel plus a per-column delta walks the row
 * without any per-pixel trigonometry. A painted decal on a cell's floor or
 * ceiling face overrides the material's tile.
 *
 * The two branches are the same algorithm: at eye level the floor and ceiling
 * are mirror images and share one distance, so one pass fills both. Off eye
 * level they diverge and each needs its own.
 */
export function renderFlats(
    ctx: RenderContext,
    scene: Scene,
    renderContext: CanvasRenderingContext2D,
    fc: FlatContext
): void {
    const aFloorSurf = fc.pixels32;
    if (aFloorSurf === null) {
        return;
    }
    const w = ctx.screenWidth;
    const h = ctx.screenWidth >> 1;
    const hPhys = ctx.screenHeight >> 1;

    fc.renderSurface = renderContext.getImageData(0, 0, w, hPhys << 1);
    fc.renderSurface32 = new Uint32Array(fc.renderSurface.data.buffer);
    resolveFlatTiles(fc, ctx.cellCodes);

    const aRenderSurf = fc.renderSurface32;

    const { direction, fov } = scene.camera;
    const wx1 = Math.cos(direction - fov);
    const wy1 = Math.sin(direction - fov);
    const wx2 = Math.cos(direction + fov);
    const wy2 = Math.sin(direction + fov);

    const ps = ctx.spacing;
    // Cell size is a power of two in every practical configuration, which
    // turns the six divisions and moduli each pixel needs into shifts and
    // masks. Measured at ~7% of a whole frame, so the loop below is written
    // out twice rather than branching per pixel: a branch here costs more
    // than the division it avoids, because it stops V8 keeping the values in
    // registers across the loop body.
    const pow2 = (ps & (ps - 1)) === 0;
    const psh = pow2 ? Math.log2(ps) | 0 : 0;
    const psm = ps - 1;
    const yTexture2 = ctx.wallHeight >> 1;
    const cam = scene.camera;
    const fvh = cam.height;

    const fh = yTexture2 - (fvh - 1) * yTexture2;
    const xDelta = (wx2 - wx1) / w;
    const yDelta = (wy2 - wy1) / w;
    const ff = h << 1;

    const xCam = cam.x;
    const yCam = cam.y;
    const nFloorWidth = fc.pixelsWidth;
    const xyMax = ctx.map.size * ps;
    const st = ctx.shades - 1;
    const sf = ctx.shadingFactor;
    const csm = ctx.csm;
    // Sampled once per pixel, so both tables are indexed directly rather than
    // through CellSurfaceManager's accessors.
    const surfaces = csm.surfaces;
    const lmData = csm.lightMapData;
    const lmWidth = csm.lightMapWidth;
    const lmc = csm.lightMapCellCount;
    const csmW = csm.width;
    const csmH = csm.height;
    const floorTiles = fc.floorTiles;
    const ceilTiles = fc.ceilTiles;
    // Rows an opaque wall will be drawn over, per column. The wall is drawn
    // after this pass and repaints them, so rasterising the floor or the
    // ceiling there is work whose result never reaches the screen.
    const coverTop = ctx.coverTop;
    const coverBottom = ctx.coverBottom;
    // Read the map through its backing store: the inner loop cannot afford an
    // accessor call per pixel.
    const mapData = ctx.map.data;
    const mapSize = ctx.map.size;
    const offsetTop = ctx.offsetTop;
    const offsetTopPix = offsetTop * w;

    let dFront: number;
    let xDeltaFront: number;
    let yDeltaFront: number;
    let fx: number;
    let fy: number;
    let fx64: number;
    let fy64: number;
    let ofsDst: number;
    let ofsDstCeil: number;
    let ofsSrc = 0;
    let wy: number;
    let wyCeil: number;
    let yOfs: number;
    let yOfsCorr: number;
    let lmCorr: number;
    let xOfs: number;
    let cellX = -1;
    let cellY = -1;
    let base = 0;
    let code = 0;
    let floorPixels: Uint32Array | null = null;
    let ceilPixels: Uint32Array | null = null;
    /** Screen rows the current iteration writes. */
    let rowFloor = 0;
    let rowCeil = 0;
    /** Whether a wall will cover this pixel's floor / ceiling row. */
    let hidFloor = false;
    let hidCeil = false;

    if (fvh === 1) {
        for (let y = 1, hMax = h - offsetTop; y < hMax; ++y) {
            dFront = (fh * ff) / y;
            fy = wy1 * dFront + yCam;
            fx = wx1 * dFront + xCam;
            xDeltaFront = xDelta * dFront;
            yDeltaFront = yDelta * dFront;
            wy = w * (h + y) - offsetTopPix;
            wyCeil = w * (h - y - 1) - offsetTopPix;
            rowFloor = h + y - offsetTop;
            rowCeil = h - y - 1 - offsetTop;
            yOfs = Math.min(st, (dFront / sf) | 0);

            // The cell under the cursor changes far less often than once per
            // pixel, so its surfaces and material are looked up on change.
            cellX = -1;
            cellY = -1;
            floorPixels = null;
            ceilPixels = null;
            code = 0;
            if (pow2) {
                for (let x = 0; x < w; ++x) {
                    // Cover is tested before anything else: a pixel a wall
                    // will repaint should not pay even for its own index
                    // arithmetic.
                    hidFloor = rowFloor < coverBottom[x];
                    hidCeil = rowCeil >= coverTop[x];
                    if ((!hidFloor || !hidCeil) && fx >= 0 && fy >= 0 && fx < xyMax && fy < xyMax) {
                        ofsDst = wy + x;
                        ofsDstCeil = wyCeil + x;
                        fy64 = fy >> psh;
                        fx64 = fx >> psh;
                        if (fx64 !== cellX || fy64 !== cellY) {
                            cellX = fx64;
                            cellY = fy64;
                            if (fx64 < csmW && fy64 < csmH) {
                                base = (fy64 * csmW + fx64) * FACE_COUNT;
                                floorPixels = surfaces[base + FACE_FLOOR].imageData32;
                                ceilPixels = surfaces[base + FACE_CEILING].imageData32;
                            } else {
                                floorPixels = null;
                                ceilPixels = null;
                            }
                            code = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        // 0 = no decal, 1 = floor decal, 2 = ceiling decal, 3 = both
                        let drawn = 0;
                        lmCorr = lmData[((lmc * fy) >> psh) * lmWidth + ((lmc * fx) >> psh)];
                        yOfsCorr = Math.max(0, yOfs - lmCorr);

                        if (!hidFloor && floorPixels !== null) {
                            ofsSrc = ((fy & psm) + yOfsCorr * ps) * ps + (fx & psm);
                            aRenderSurf[ofsDst] = floorPixels[ofsSrc];
                            drawn += 1;
                        }
                        if (!hidCeil && ceilPixels !== null) {
                            if (drawn === 0) {
                                ofsSrc = ((fy & psm) + yOfsCorr * ps) * ps + (fx & psm);
                            }
                            aRenderSurf[ofsDstCeil] = ceilPixels[ofsSrc];
                            drawn += 2;
                        }
                        if (drawn !== 3) {
                            if (drawn !== 1 && !hidFloor) {
                                xOfs = floorTiles[code];
                                if (xOfs >= 0) {
                                    ofsSrc =
                                        ((fy & psm) + yOfsCorr * ps) * nFloorWidth +
                                        ((fx & psm) + xOfs * ps);
                                    aRenderSurf[ofsDst] = aFloorSurf[ofsSrc];
                                }
                            }
                            if (drawn !== 2 && !hidCeil) {
                                xOfs = ceilTiles[code];
                                if (xOfs >= 0) {
                                    ofsSrc =
                                        ((fy & psm) + yOfsCorr * ps) * nFloorWidth +
                                        ((fx & psm) + xOfs * ps);
                                    aRenderSurf[ofsDstCeil] = aFloorSurf[ofsSrc];
                                }
                            }
                        }
                    }
                    fy += yDeltaFront;
                    fx += xDeltaFront;
                }
            } else {
                for (let x = 0; x < w; ++x) {
                    // Cover is tested before anything else: a pixel a wall
                    // will repaint should not pay even for its own index
                    // arithmetic.
                    hidFloor = rowFloor < coverBottom[x];
                    hidCeil = rowCeil >= coverTop[x];
                    if ((!hidFloor || !hidCeil) && fx >= 0 && fy >= 0 && fx < xyMax && fy < xyMax) {
                        ofsDst = wy + x;
                        ofsDstCeil = wyCeil + x;
                        fy64 = (fy / ps) | 0;
                        fx64 = (fx / ps) | 0;
                        if (fx64 !== cellX || fy64 !== cellY) {
                            cellX = fx64;
                            cellY = fy64;
                            if (fx64 < csmW && fy64 < csmH) {
                                base = (fy64 * csmW + fx64) * FACE_COUNT;
                                floorPixels = surfaces[base + FACE_FLOOR].imageData32;
                                ceilPixels = surfaces[base + FACE_CEILING].imageData32;
                            } else {
                                floorPixels = null;
                                ceilPixels = null;
                            }
                            code = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        // 0 = no decal, 1 = floor decal, 2 = ceiling decal, 3 = both
                        let drawn = 0;
                        lmCorr =
                            lmData[(((lmc * fy) / ps) | 0) * lmWidth + (((lmc * fx) / ps) | 0)];
                        yOfsCorr = Math.max(0, yOfs - lmCorr);

                        if (!hidFloor && floorPixels !== null) {
                            ofsSrc = (((fy % ps) | 0) + yOfsCorr * ps) * ps + ((fx % ps) | 0);
                            aRenderSurf[ofsDst] = floorPixels[ofsSrc];
                            drawn += 1;
                        }
                        if (!hidCeil && ceilPixels !== null) {
                            if (drawn === 0) {
                                ofsSrc = (((fy % ps) | 0) + yOfsCorr * ps) * ps + ((fx % ps) | 0);
                            }
                            aRenderSurf[ofsDstCeil] = ceilPixels[ofsSrc];
                            drawn += 2;
                        }
                        if (drawn !== 3) {
                            if (drawn !== 1 && !hidFloor) {
                                xOfs = floorTiles[code];
                                if (xOfs >= 0) {
                                    ofsSrc =
                                        (((fy % ps) | 0) + yOfsCorr * ps) * nFloorWidth +
                                        (((fx % ps) | 0) + xOfs * ps);
                                    aRenderSurf[ofsDst] = aFloorSurf[ofsSrc];
                                }
                            }
                            if (drawn !== 2 && !hidCeil) {
                                xOfs = ceilTiles[code];
                                if (xOfs >= 0) {
                                    ofsSrc =
                                        (((fy % ps) | 0) + yOfsCorr * ps) * nFloorWidth +
                                        (((fx % ps) | 0) + xOfs * ps);
                                    aRenderSurf[ofsDstCeil] = aFloorSurf[ofsSrc];
                                }
                            }
                        }
                    }
                    fy += yDeltaFront;
                    fx += xDeltaFront;
                }
            }
        }
    } else {
        const fhCeil = yTexture2 + (fvh - 1) * yTexture2;
        let dFrontCeil: number;
        let xDeltaFrontCeil: number;
        let yDeltaFrontCeil: number;
        let fxCeil: number;
        let fyCeil: number;
        let yOfsCeil: number;
        let yOfsCeilCorr: number;

        // The floor and the ceiling sample different cells here, so each
        // needs its own per-cell cache.
        let ceilCellX = -1;
        let ceilCellY = -1;
        let ceilCode = 0;

        for (let y = 1, hMax = h - offsetTop; y < hMax; ++y) {
            cellX = -1;
            cellY = -1;
            ceilCellX = -1;
            ceilCellY = -1;
            floorPixels = null;
            ceilPixels = null;
            code = 0;
            ceilCode = 0;

            dFront = (fh * ff) / y;
            fy = wy1 * dFront + yCam;
            fx = wx1 * dFront + xCam;
            xDeltaFront = xDelta * dFront;
            yDeltaFront = yDelta * dFront;
            wy = w * (h + y - 1) - offsetTopPix;
            rowFloor = h + y - 1 - offsetTop;
            yOfs = Math.min(st, (dFront / sf) | 0);

            dFrontCeil = (fhCeil * ff) / y;
            fyCeil = wy1 * dFrontCeil + yCam;
            fxCeil = wx1 * dFrontCeil + xCam;
            xDeltaFrontCeil = xDelta * dFrontCeil;
            yDeltaFrontCeil = yDelta * dFrontCeil;
            wyCeil = w * (h - y) - offsetTopPix;
            rowCeil = h - y - offsetTop;
            yOfsCeil = Math.min(st, (dFrontCeil / sf) | 0);
            void yOfsCeil;

            if (pow2) {
                for (let x = 0; x < w; ++x) {
                    hidFloor = rowFloor < coverBottom[x];
                    if (!hidFloor && fx >= 0 && fy >= 0 && fx < xyMax && fy < xyMax) {
                        ofsDst = wy + x;
                        fy64 = fy >> psh;
                        fx64 = fx >> psh;
                        if (fx64 !== cellX || fy64 !== cellY) {
                            cellX = fx64;
                            cellY = fy64;
                            floorPixels =
                                fx64 < csmW && fy64 < csmH
                                    ? surfaces[(fy64 * csmW + fx64) * FACE_COUNT + FACE_FLOOR]
                                          .imageData32
                                    : null;
                            code = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        lmCorr = lmData[((lmc * fy) >> psh) * lmWidth + ((lmc * fx) >> psh)];
                        yOfsCorr = Math.max(0, yOfs - lmCorr);
                        if (floorPixels !== null) {
                            ofsSrc = ((fy & psm) + yOfsCorr * ps) * ps + (fx & psm);
                            aRenderSurf[ofsDst] = floorPixels[ofsSrc];
                        } else {
                            xOfs = floorTiles[code];
                            if (xOfs >= 0) {
                                ofsSrc =
                                    ((fy & psm) + yOfsCorr * ps) * nFloorWidth +
                                    ((fx & psm) + xOfs * ps);
                                aRenderSurf[ofsDst] = aFloorSurf[ofsSrc];
                            }
                        }
                    }
                    hidCeil = rowCeil >= coverTop[x];
                    if (
                        !hidCeil &&
                        fxCeil >= 0 &&
                        fyCeil >= 0 &&
                        fxCeil < xyMax &&
                        fyCeil < xyMax
                    ) {
                        ofsDstCeil = wyCeil + x;
                        fy64 = fyCeil >> psh;
                        fx64 = fxCeil >> psh;
                        if (fx64 !== ceilCellX || fy64 !== ceilCellY) {
                            ceilCellX = fx64;
                            ceilCellY = fy64;
                            ceilPixels =
                                fx64 < csmW && fy64 < csmH
                                    ? surfaces[(fy64 * csmW + fx64) * FACE_COUNT + FACE_CEILING]
                                          .imageData32
                                    : null;
                            ceilCode = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        lmCorr =
                            lmData[((lmc * fyCeil) >> psh) * lmWidth + ((lmc * fxCeil) >> psh)];
                        // Reads yOfs, the floor's shading level, not yOfsCeil.
                        // Faithful to the original; yOfsCeil is computed and unused.
                        yOfsCeilCorr = Math.max(0, yOfs - lmCorr);
                        if (ceilPixels !== null) {
                            ofsSrc = ((fyCeil & psm) + yOfsCeilCorr * ps) * ps + (fxCeil & psm);
                            aRenderSurf[ofsDstCeil] = ceilPixels[ofsSrc];
                        } else {
                            xOfs = ceilTiles[ceilCode];
                            if (xOfs >= 0) {
                                ofsSrc =
                                    ((fyCeil & psm) + yOfsCeilCorr * ps) * nFloorWidth +
                                    ((fxCeil & psm) + xOfs * ps);
                                aRenderSurf[ofsDstCeil] = aFloorSurf[ofsSrc];
                            }
                        }
                    }
                    fyCeil += yDeltaFrontCeil;
                    fxCeil += xDeltaFrontCeil;
                    fy += yDeltaFront;
                    fx += xDeltaFront;
                }
            } else {
                for (let x = 0; x < w; ++x) {
                    hidFloor = rowFloor < coverBottom[x];
                    if (!hidFloor && fx >= 0 && fy >= 0 && fx < xyMax && fy < xyMax) {
                        ofsDst = wy + x;
                        fy64 = (fy / ps) | 0;
                        fx64 = (fx / ps) | 0;
                        if (fx64 !== cellX || fy64 !== cellY) {
                            cellX = fx64;
                            cellY = fy64;
                            floorPixels =
                                fx64 < csmW && fy64 < csmH
                                    ? surfaces[(fy64 * csmW + fx64) * FACE_COUNT + FACE_FLOOR]
                                          .imageData32
                                    : null;
                            code = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        lmCorr =
                            lmData[(((lmc * fy) / ps) | 0) * lmWidth + (((lmc * fx) / ps) | 0)];
                        yOfsCorr = Math.max(0, yOfs - lmCorr);
                        if (floorPixels !== null) {
                            ofsSrc = (((fy % ps) | 0) + yOfsCorr * ps) * ps + ((fx % ps) | 0);
                            aRenderSurf[ofsDst] = floorPixels[ofsSrc];
                        } else {
                            xOfs = floorTiles[code];
                            if (xOfs >= 0) {
                                ofsSrc =
                                    (((fy % ps) | 0) + yOfsCorr * ps) * nFloorWidth +
                                    (((fx % ps) | 0) + xOfs * ps);
                                aRenderSurf[ofsDst] = aFloorSurf[ofsSrc];
                            }
                        }
                    }
                    hidCeil = rowCeil >= coverTop[x];
                    if (
                        !hidCeil &&
                        fxCeil >= 0 &&
                        fyCeil >= 0 &&
                        fxCeil < xyMax &&
                        fyCeil < xyMax
                    ) {
                        ofsDstCeil = wyCeil + x;
                        fy64 = (fyCeil / ps) | 0;
                        fx64 = (fxCeil / ps) | 0;
                        if (fx64 !== ceilCellX || fy64 !== ceilCellY) {
                            ceilCellX = fx64;
                            ceilCellY = fy64;
                            ceilPixels =
                                fx64 < csmW && fy64 < csmH
                                    ? surfaces[(fy64 * csmW + fx64) * FACE_COUNT + FACE_CEILING]
                                          .imageData32
                                    : null;
                            ceilCode = mapData[fy64 * mapSize + fx64] & 0xfff;
                        }
                        lmCorr =
                            lmData[
                                (((lmc * fyCeil) / ps) | 0) * lmWidth + (((lmc * fxCeil) / ps) | 0)
                            ];
                        // Reads yOfs, the floor's shading level, not yOfsCeil.
                        // Faithful to the original; yOfsCeil is computed and unused.
                        yOfsCeilCorr = Math.max(0, yOfs - lmCorr);
                        if (ceilPixels !== null) {
                            ofsSrc =
                                (((fyCeil % ps) | 0) + yOfsCeilCorr * ps) * ps +
                                ((fxCeil % ps) | 0);
                            aRenderSurf[ofsDstCeil] = ceilPixels[ofsSrc];
                        } else {
                            xOfs = ceilTiles[ceilCode];
                            if (xOfs >= 0) {
                                ofsSrc =
                                    (((fyCeil % ps) | 0) + yOfsCeilCorr * ps) * nFloorWidth +
                                    (((fxCeil % ps) | 0) + xOfs * ps);
                                aRenderSurf[ofsDstCeil] = aFloorSurf[ofsSrc];
                            }
                        }
                    }
                    fyCeil += yDeltaFrontCeil;
                    fxCeil += xDeltaFrontCeil;
                    fy += yDeltaFront;
                    fx += xDeltaFront;
                }
            }
        }
    }
    renderContext.putImageData(fc.renderSurface, 0, 0);
}
