import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
/**
 * One rendered frame, as raw RGBA.
 *
 * Lived in the legacy renderer harness until that was removed on 2026-09-11;
 * it is the comparison's own type, so it lives with the comparison.
 */
export interface Frame {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Where committed baseline images live. */
export const GOLDEN_DIR = resolve(here, '../golden');
/** Where failure artefacts are written. */
export const ARTIFACT_DIR = resolve(here, '../../.golden-out');

/** The outcome of comparing two frames. */
export interface Diff {
    /** Number of pixels differing in any channel. */
    differing: number;
    /** Total pixels compared. */
    total: number;
    /** Largest absolute difference across any channel of any pixel. */
    maxDelta: number;
    /** Position of the first differing pixel, or null. */
    firstDiffAt: { x: number; y: number } | null;
    /** Bounding box of all differences, or null. */
    bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function isClean(d: Diff): boolean {
    return d.differing === 0;
}

/** Human-readable one-liner for an assertion message. */
export function describeDiff(d: Diff): string {
    if (isClean(d)) {
        return 'identical';
    }
    const pct = ((d.differing / d.total) * 100).toFixed(3);
    const at = d.firstDiffAt ? `(${d.firstDiffAt.x}, ${d.firstDiffAt.y})` : '?';
    const b = d.bbox ? `[${d.bbox.x0},${d.bbox.y0} .. ${d.bbox.x1},${d.bbox.y1}]` : '?';
    return `${d.differing}/${d.total} px differ (${pct}%), max channel delta ${d.maxDelta}, first at ${at}, bbox ${b}`;
}

/**
 * Compares two frames pixel by pixel.
 *
 * `tolerance` is a per-channel allowance. It defaults to 0: a port that is
 * supposed to be a faithful transcription should be exact, and a nonzero
 * default would quietly hide small regressions.
 */
export function compareFrames(a: Frame, b: Frame, tolerance = 0): Diff {
    if (a.width !== b.width || a.height !== b.height) {
        throw new Error(
            `compareFrames: size mismatch, ${a.width}x${a.height} vs ${b.width}x${b.height}`
        );
    }
    const total = a.width * a.height;
    let differing = 0;
    let maxDelta = 0;
    let firstDiffAt: Diff['firstDiffAt'] = null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;

    for (let i = 0, p = 0; p < total; ++p, i += 4) {
        const dr = Math.abs(a.data[i] - b.data[i]);
        const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
        const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
        const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
        const delta = Math.max(dr, dg, db, da);
        if (delta > maxDelta) {
            maxDelta = delta;
        }
        if (delta > tolerance) {
            ++differing;
            const x = p % a.width;
            const y = (p / a.width) | 0;
            if (firstDiffAt === null) {
                firstDiffAt = { x, y };
            }
            if (x < x0) {
                x0 = x;
            }
            if (y < y0) {
                y0 = y;
            }
            if (x > x1) {
                x1 = x;
            }
            if (y > y1) {
                y1 = y;
            }
        }
    }
    return {
        differing,
        total,
        maxDelta,
        firstDiffAt,
        bbox: differing === 0 ? null : { x0, y0, x1, y1 }
    };
}

function frameToPng(frame: Frame): Buffer {
    const canvas = createCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(frame.width, frame.height);
    img.data.set(frame.data);
    ctx.putImageData(img, 0, 0);
    return canvas.toBuffer('image/png');
}

/**
 * Decodes a PNG back into pixels.
 *
 * Must go through loadImage: assigning a Buffer to `new Image().src` reports
 * correct dimensions and `complete === true`, but the image does not actually
 * draw — every pixel comes back as zero. That silently turns every baseline
 * comparison into "expected is blank", which passes nothing and fails
 * everything for the wrong reason.
 */
async function pngToFrame(buf: Buffer): Promise<Frame> {
    const image = await loadImage(buf);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const img = ctx.getImageData(0, 0, image.width, image.height);
    return {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(img.data)
    };
}

/** Exposed so the harness can prove its own PNG round-trip is lossless. */
export async function roundTripPng(frame: Frame): Promise<Frame> {
    return pngToFrame(frameToPng(frame));
}

export function writeFrame(path: string, frame: Frame): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, frameToPng(frame));
}

/**
 * Renders a visual diff: unchanged pixels dimmed to grey, changed pixels in
 * red. Written next to the actual/expected images when a case fails.
 */
export function diffImage(a: Frame, b: Frame): Frame {
    const data = new Uint8ClampedArray(a.data.length);
    for (let i = 0; i < a.data.length; i += 4) {
        const same =
            a.data[i] === b.data[i] &&
            a.data[i + 1] === b.data[i + 1] &&
            a.data[i + 2] === b.data[i + 2] &&
            a.data[i + 3] === b.data[i + 3];
        if (same) {
            const grey = ((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3) * 0.25;
            data[i] = data[i + 1] = data[i + 2] = grey;
        } else {
            data[i] = 255;
            data[i + 1] = 0;
            data[i + 2] = 0;
        }
        data[i + 3] = 255;
    }
    return { width: a.width, height: a.height, data };
}

export interface GoldenResult {
    /** True if there was no committed baseline and one was just written. */
    created: boolean;
    diff: Diff | null;
    /** Paths of artefacts written on failure. */
    artifacts: string[];
}

/**
 * Compares a frame against its committed baseline.
 *
 * With no baseline on disk, or with UPDATE_GOLDEN=1, the baseline is written
 * and the case reports `created`. Otherwise a mismatch writes the actual,
 * expected and diff images under .golden-out for inspection.
 */
export async function matchGolden(name: string, actual: Frame): Promise<GoldenResult> {
    const goldenPath = resolve(GOLDEN_DIR, `${name}.png`);
    const update = process.env.UPDATE_GOLDEN === '1';

    if (update || !existsSync(goldenPath)) {
        writeFrame(goldenPath, actual);
        return { created: true, diff: null, artifacts: [goldenPath] };
    }

    const expected = await pngToFrame(readFileSync(goldenPath));
    const diff = compareFrames(expected, actual);
    if (isClean(diff)) {
        return { created: false, diff, artifacts: [] };
    }

    const actualPath = resolve(ARTIFACT_DIR, `${name}.actual.png`);
    const expectedPath = resolve(ARTIFACT_DIR, `${name}.expected.png`);
    const diffPath = resolve(ARTIFACT_DIR, `${name}.diff.png`);
    writeFrame(actualPath, actual);
    writeFrame(expectedPath, expected);
    writeFrame(diffPath, diffImage(expected, actual));
    return { created: false, diff, artifacts: [actualPath, expectedPath, diffPath] };
}
