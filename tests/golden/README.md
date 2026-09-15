# Golden baselines

45 PNGs, one per (scene, camera) in `tests/harness/scenes.ts`. They are the
definition of a correct frame, and `tests/renderer/port.golden.test.ts`
enforces them.

Regenerate with `UPDATE_GOLDEN=1 npm test`.

## Where they came from, and what that means now

Every one was captured from the **original** `o876-raycaster-engine` while it
was still part of this repository, through a harness that ran both
renderers on the same scene and compared them pixel for pixel. That harness and
the original were removed on 2026-09-11, once the port stopped being a
migration and started being the thing itself.

So these files are now the *frozen answer* to "what is correct", and nothing
can re-derive them. `UPDATE_GOLDEN=1` re-records from the port, which means a
bug you introduce becomes the new baseline if you update without looking.
**Read the diff artefacts in `.golden-out/` before re-recording.**

Seven of the 45 deliberately differ from what the original produced. The
reasons are kept here because the test that carried them is gone, and a
baseline nobody can explain is a baseline nobody dares change.

| Baseline | Why the original differs |
|---|---|
| `storey--centre`, `storey--centre-diag` | `createStorey()` copied no settings and the shading transmit in `optionsReaction` was commented out, so the original's upper floor shaded with the default 16 layers while sharing a tileset the ground floor built with 8 — indexing past the end of the atlas. |
| `animated-flats--frame-0`, `animated-flats--frame-2` | The original read an animated flat face straight out of the cell-code table and multiplied it by the cell size, so the `TileAnimation` became `NaN`, and `NaN \| 0` collapsed to 0 — sampling column 0 of the atlas for every pixel. The port resolves the animation to a frame. |
| `room--crouched` | One pixel. The original computed a flat source row as `((fy % ps) + layer * ps) \| 0`; where `fy % ps` landed just under the cell size (255.99999999999997) the addition rounded the deficit away to exactly 512, one row past the atlas — an out-of-bounds read yielding a transparent pixel. The port truncates before adding. |
| `sprites--wound-two-turns`, `sprites--wound-negative` | A camera angle is accumulated and never wrapped. The original reduced a sprite's bearing into (-PI, PI] by adding or subtracting `2 * PI` exactly once, which cannot close a gap several revolutions wide, so past ~1.38 net turns its sprites failed the off-axis test and vanished — while the walls, cast with periodic `cos`/`sin`, rendered normally. The port reduces with a modulo. See `tests/spriteCulling.test.ts`. |

## The poses, and why these ones

Four groups earn their place:

- **Ordinary views** — a room from its centre, a corner, off-grid, oblique.
- **Feature coverage** — doors mid-slide, transparent blocks, decals, an upper
  storey, sky, animated walls and flats, odd cell spacing, crouched and raised
  cameras, coloured light and fog.
- **Sprite culling** — the accept side, the boundary (`fov-edge`), the reject
  side (`turned-away`), and all of it again at wound camera angles. Added
  2026-09-11 after a bug that made sprites vanish past ~1.4 turns survived 276
  tests, 34 baselines and 90% coverage, and was found by playing a demo.
- **Winding invariance** — `room--wound-diag` and `room--centre-diag` are
  byte-identical, as are `sprites--facing-sprites`, `--wound-two-turns` and
  `--wound-negative`. `sprites--turned-away` and `--turned-away-wound` are
  deliberately **not**: they differ by 120 pixels in the single centre column,
  where `cos(PI)` is exactly -1 but `cos(5*PI)` carries a rounding error. That
  bounds the claim honestly — sprite culling is exact under winding, geometry
  is not.
