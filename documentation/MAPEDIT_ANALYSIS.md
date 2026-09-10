# MapEdit: what it is, and what a replacement would take

An analysis of `_OLD_PROJECT_/apps/mapedit`, the web level editor that produced
every level in `games/mansion`. Written to answer one question: modernise it in
place, or start again with `raycaster-386` as a dependency?

**Short answer: start again.** Not because the code is bad — most of it is
sound — but because the parts that would survive a Vue 2 to Vue 3 migration and
the parts that would not are cleanly separable, and the surviving parts are a
minority of the file count but most of the value.

## What is there

644 KB, 71 files.

| Part | Size | Character |
|---|---|---|
| 38 single-file components | 5,979 lines | Vue 2, Options API, `mapGetters`/`mapActions` |
| Vuex store, two namespaced modules | 1,535 lines | mutations, actions, and string-constant type files |
| App-specific libraries | 730 lines | plain JS over canvas; no framework |
| Entry point and routes | ~200 lines | `new Vue()`, `vue-router` 3 |

The largest components, which is where the work is:

```
LevelGrid.vue        1,159    the canvas grid editor: the heart of the app
BlockBuilder.vue       546    assembling a block's six faces from tiles
TileBrowser.vue        303
AnimationBuilder.vue   290
TileLoader.vue         249
ThingBuilder.vue       248
MarkerManager.vue      227
```

The store splits as `level/mutations.js` 520, `level/actions.js` 350,
`editor/state.js` 179, `editor/mutations.js` 109, plus 96 lines of
`mutation-types` / `action-types` string constants.

## The dependency on the engine is small

This is the finding that matters most, and it is the opposite of what the app's
size suggests. Everything mapedit imports from outside itself:

| Import | Uses | Covered by raycaster-386 |
|---|---|---|
| `libs/canvas-helper` | 8 | `Canvas` (`src/core/canvas.ts`) |
| `libs/raycaster/consts` | 3 | `src/consts.ts` |
| `libs/engine/Engine` | 1 | `Renderer` + `loadLevel` |
| `libs/raycaster/TileAnimation` | 1 | ported |
| `libs/marker-registry` | 1 | ported |
| `libs/fetch-json` | 1 | trivial, or `fetch` |
| `vue-material-design-icons` | ~60 | still published |

`libs/engine/Engine` appears exactly once, in `RenderView.vue`, to render a
preview of the level being edited. That is 51.6 kB of engine imported for one
preview pane — and it is precisely what this port replaces. A new editor would
use `Renderer` + `loadLevel` + `buildObjects`, which is the whole reason those
exist.

**Nothing in mapedit needs the entity tier, the thinkers, the automaton or the
game loop.** It is a drawing tool that happens to preview its output.

## Two formats, and a converter worth keeping

The editor does **not** save RCE-100. It saves its own shape:

```js
{ tiles: { walls, flats, sprites }, blocks, things, grid,
  metrics, flags, ambiance, actor, startpoints, preview }
```

`libs/generate/index.js` — 521 lines — converts that into RCE-100: merging
individual tiles into atlases, concatenating animation frames, resolving phys
and loop codes into `@PHYS_*` and `@LOOP_*` strings. In the old deployment this
ran **on the server**, behind the `/publish/` endpoint.

Two formats is the right call, and worth keeping. RCE-100 is a *build artifact*
— textures merged, frames concatenated, symbols resolved. An editor needs the
unmerged sources, per-tile identity and room for undo. Squashing them into one
format would make the editor's job harder, not easier.

But `generate` need not stay on a server. Its only host-specific part is image
concatenation, and that is already injected:

```js
function setImageAppender(f) { combineTiles = f; }
```

Give it a canvas-based appender and it runs in the browser. Its only other
node-ism is `module.exports`. **Porting it to TypeScript and running export
client-side removes the `/publish/` endpoint entirely** and makes the backend a
dumb file store.

## What it needs that we do not have

A backend. `src/libs/fetch-helper` names six endpoints:

```
/vault/        save, load, delete a level
/vault         list levels
/publish/      export to RCE-100     <- removable, see above
/user.json     current user
```

The server implementing these was not imported with `libs/apps/games`, so it
does not exist here. Neither does any build configuration — mapedit has no
webpack config of its own; it lived at the old repo root. **A new project needs
tooling and persistence built from scratch regardless of which path is taken**,
which weakens the case for migrating in place considerably.

## Why "migrate to Vue 3 + Pinia" is really "rewrite"

- **Options API to Composition API** rewrites every `<script>` block. The
  templates largely survive; the logic does not.
- **Vuex to Pinia removes mutations entirely.** `level/mutations.js` alone is
  520 lines, and the `mutation-types` / `action-types` string-constant files
  become meaningless — Pinia stores call typed methods.
- **`createNamespacedHelpers`, `mapGetters`, `mapActions` all disappear**, and
  they are how 20 components reach the store.
- **Vue 2 is end of life**, so this is not optional if the app is to be
  maintained.

Migrating in place means touching all 38 components and all 1,535 lines of
store, while keeping a Vue 2 app running through the change — with no build
config and no server. Starting fresh means writing the same components against
a store that is smaller by construction, with the parts worth keeping copied
across.

## What survives either way

About 1,250 lines, none of it framework-coupled:

| Piece | Lines | Note |
|---|---|---|
| `libs/generate` | 521 | the RCE-100 converter; port to TS, run client-side |
| `block-renderer` | 306 | draws a block's faces to a canvas |
| `silly-canvas-factory` | 192 | canvas pooling |
| `grid-renderer` | 96 | draws the map grid |
| `tileset-splitter` | 37 | cuts a sheet into tiles |
| `append-images` | 35 | concatenates tiles — the image appender `generate` wants |
| `block-cache`, `emoji` | 34 | |

Plus the 38 templates, which encode years of UX decisions and are the part
hardest to rederive. Copy the markup, rewrite the script.

## Recommendation

**A new repository, depending on `raycaster-386`.** Vite, Vue 3, Pinia,
TypeScript.

It also does something this project needs: it is a **second consumer**, written
by someone who is not looking at the library's internals. The demo is a
deliberate exercise; an editor is a real application with real requirements, and
it is the best available test of whether the API reads well from outside.

A workable order:

1. **Scaffold and prove the dependency.** Vite + Vue 3 + Pinia + TS, one route,
   `Renderer` drawing a hard-coded level. Answers "does raycaster-386 install
   and work in a modern bundler" before anything else is built on it.
2. **Port `generate` to TypeScript** with a canvas image-appender, and test it
   against the four mansion levels — the editor saves that this project already
   has RCE-100 output for, so the converter can be verified against known-good
   results.
3. **Store first, in Pinia.** The editor's save format is the real domain model;
   getting it typed is most of the design.
4. **The grid editor.** `LevelGrid.vue` is a fifth of the component code and the
   thing people actually use.
5. **Everything else**, browser by builder.
6. **Persistence last**, once the shape of what is saved has settled. A dumb
   file store, or the File System Access API and no server at all.

## What to keep from the old app while doing it

`_OLD_PROJECT_/apps/mapedit` should stay in this repository as reference for as
long as the new editor is being written — its templates and its 730 lines of
canvas code are the specification. Nothing in the test suite touches it, so it
costs 1.3 MB and nothing else.

## Open questions worth settling early

- **Does the new editor edit RCE-100 directly for simple levels?** Tempting, and
  wrong for anything with atlases — but worth deciding rather than inheriting.
- **Server or no server?** The File System Access API would remove the backend
  entirely for a single-user tool. The old app's `/user.json` suggests it was
  once multi-user; check whether that still matters.
- **Does the preview use `buildObjects`?** If the editor shows placed things, it
  wants the same decorative-object path a game uses — which would exercise it
  from a second angle.
