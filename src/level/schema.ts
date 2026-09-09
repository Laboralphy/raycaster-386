import schema from './rce-100.json';

/**
 * The RCE-100 JSON schema, exactly as the original engine shipped it.
 *
 * Its own entry point — `raycaster-386/schema` — so that the 22 kB never
 * lands in the renderer bundle. Pair it with any JSON-schema validator and
 * hand the result to `loadLevel` as its `validate` hook:
 *
 * ```ts
 * import { Validator } from 'jsonschema';
 * import RCE_100_SCHEMA from 'raycaster-386/schema';
 *
 * const v = new Validator();
 * const validate = (data: unknown) => {
 *     const result = v.validate(data, RCE_100_SCHEMA);
 *     if (result.errors.length > 0) throw new Error(result.errors[0].stack);
 * };
 * ```
 *
 * Note that it requires `blueprints`, `objects` and `camera` — sections this
 * library reports rather than interprets — because it describes the format as
 * the original editor writes it, and is left unmodified so that a level valid
 * here is valid upstream. A level authored for this library alone, omitting
 * the entity tier, will not satisfy it.
 */
export const RCE_100_SCHEMA: unknown = schema;

export default RCE_100_SCHEMA;
