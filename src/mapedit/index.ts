/**
 * MapEdit: compiling the level editor's save format into RCE-100.
 *
 * A build tool, not a tier. It needs no screen, no clock and no player — it is
 * a pure data transform — and **nothing in `src/` imports it**. That is the
 * point: the engine reads RCE-100 and knows nothing of the editor, so the
 * editor's format is free to change without the engine moving at all.
 *
 * Shipped as its own entry point, like the RCE-100 schema, so a game that only
 * plays levels never carries the compiler that made them.
 */
export { convertMapEditLevel, mapEditVersionOf } from './generate.js';
export { MAPEDIT_1, MAPEDIT_VERSIONS } from './types.js';
export type {
    ImageAppender,
    MapEditBlock,
    MapEditCell,
    MapEditCellThing,
    MapEditLevel,
    MapEditLight,
    MapEditStartpoint,
    MapEditThing,
    MapEditTile,
    MapEditVersion,
} from './types.js';
