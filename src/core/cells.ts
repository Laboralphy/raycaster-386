/**
 * Cell arithmetic shared by rendering and simulation.
 *
 * A world coordinate is in texels; a cell coordinate indexes {@link CellMap}.
 * `spacing` converts between them and comes from the level's metrics, so these
 * are plain functions rather than methods on the map, which does not know how
 * big its cells are.
 */

/** A position in cell coordinates. */
export interface CellPos {
    x: number;
    y: number;
}

/** A position in world coordinates, in texels. */
export interface WorldPos {
    x: number;
    y: number;
}

/**
 * The cell containing a world position.
 *
 * Upstream this was `Engine.clipCell`, which clipped nothing — it converts.
 * Renamed for what it does; a caller wanting the result inside the map should
 * clamp it against `map.size` afterwards.
 */
export function worldToCell(x: number, y: number, spacing: number): CellPos {
    return { x: (x / spacing) | 0, y: (y / spacing) | 0 };
}

/** The world position at the centre of a cell. */
export function cellCenter(x: number, y: number, spacing: number): WorldPos {
    const half = spacing >> 1;
    return { x: x * spacing + half, y: y * spacing + half };
}

/**
 * The three writes that swapping a cell's block implies.
 *
 * Returned rather than applied, like {@link DoorCellUpdate}: a phys change
 * re-traces every light overlapping the cell, so it has to go through the
 * renderer when one is attached.
 */
export interface CellChange {
    x: number;
    y: number;
    /** Index into the level's material table. */
    material: number;
    phys: number;
    offset: number;
}

/**
 * Swaps a cell's block for another material.
 *
 * Upstream `Engine.alterBlock` looked the material up by `ref` and wrote it
 * straight into the renderer. The lookup belongs to whoever holds the level's
 * material table — `loadLevel` returns one — so it is the caller's, and the
 * three writes come back as data.
 */
export function alterBlock(
    x: number, y: number, material: number, block: { phys?: number; offset?: number }
): CellChange {
    return { x, y, material, phys: block.phys ?? 0, offset: block.offset ?? 0 };
}
