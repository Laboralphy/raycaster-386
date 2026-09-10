/**
 * Splits a string into words, keeping quoted runs together.
 *
 * ```
 * quoteSplit('teleport 3 4 "the east wing"')
 *   -> ['teleport', '3', '4', 'the east wing']
 * ```
 *
 * This is how a level's tags are written: a command and its arguments in one
 * string, so the map editor can store a trigger as a single field.
 *
 * The original returned the *input string* when nothing matched, so an empty
 * tag came back as `''` rather than `[]` and every caller doing `.shift()` on
 * the result got a character instead of a word. It returns an empty array.
 */
export function quoteSplit(s: string): string[] {
    const parts = s.match(/(?:[^\s"]+|"[^"]*")+/g);
    if (parts === null) {
        return [];
    }
    return parts.map((part) => part.replace(/^"/, '').replace(/"$/, ''));
}
