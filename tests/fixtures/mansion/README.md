# Mansion level fixtures

Four levels from the original engine's `games/mansion`, with the textures they
reference, vendored here so `tests/level/` runs on a fresh clone.

| Level | Why it is here |
|---|---|
| `mans-test-ai` | 4 KB, 2 textures — the cheap one, used wherever content does not matter |
| `mans-cabin` | 89 decorative objects; the only level `buildObjects` is tested against |
| `mans-level-1` | a full playable level |
| `mans-test1` | the largest, 55 tilesets |

They are **build artifacts in RCE-100**, produced by the original's
`libs/generate` from MapEdit saves that no longer exist anywhere — not in this
repo, and not in the legacy tree. So they are input fixtures only: nothing can
regenerate them, and nothing should try.

Copied verbatim, paths included: a level names its textures as
`assets/textures/<hash>.png` relative to the game root, which is why the
`assets/` layout is preserved rather than flattened.

They are real assets rather than synthetic ones because
`tests/level/loadLevel.test.ts` renders each level from its own start point and
asserts the frame carries more than 200 distinct colours. A generated texture
would pass that trivially and prove nothing about atlas slicing or shading over
real images.
