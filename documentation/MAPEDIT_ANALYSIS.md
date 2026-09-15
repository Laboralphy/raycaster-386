# MapEdit: what it is, and what a replacement would take

An analysis of `apps/mapedit` in the original `o876-raycaster-engine`, the web level editor that produced
every level in `games/mansion`. Written to answer one question: modernise it in
place, or start again with `raycaster-386` as a dependency?

**Short answer: start again.** Not because the code is bad — most of it is
sound — but because the parts that would survive a Vue 2 to Vue 3 migration and
the parts that would not are cleanly separable, and the surviving parts are a
minority of the file count but most of the value.

Last updated 2026-09-12, when the target stack was settled: **a web app, its
own repository, TypeScript + Vue 3 + Pinia + Vite, with a small Koa backend.**
The feasibility assessment for exactly that stack is below, measured against
the old source rather than estimated.

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

---

# Feasibility: TypeScript + Vue 3 + Pinia + Koa

**Verdict: feasible, and easier than the file count suggests.** The app is
large but idiomatically plain. Almost none of the Vue 2 patterns that make
migrations painful appear in it. The expensive part is not compatibility — it
is that 5,979 lines of Options API script have to be rewritten as Composition
API, which is typing work, not puzzle work.

## The Vue 2 → 3 hazard audit

Every idiom that Vue 3 removed or changed, counted across all 38 components and
27 scripts:

| Vue 2 idiom | Occurrences | Cost |
|---|---|---|
| `filters:` | **0** | — |
| `.sync` modifier | **0** | — |
| Event bus (`$on`/`$off`/`$once`) | **0** | — |
| `model:` option | **0** | — |
| Functional components | **0** | — |
| `$listeners` | **0** | — |
| `Vue.set` / `$set` | **1** | trivial — plain assignment in 3 |
| Component `mixins:` | **1** | `mixins/popup.js`, 18 lines, all Vuex mapping |
| `$children` | **5** | **the one real redesign** — see below |
| `$refs` | 14 | fine; `ref()` in Composition API |

This is an unusually clean result. The typical Vue 2 app of this age is full of
event buses and `.sync`; this one has neither. **`$children` is the only removed
API it actually leans on.**

Slots are already on the modern syntax (`v-slot:`, Vue 2.6+), and there are only
two: a default slot and one named `toolbar` on `Window.vue`. No scoped slots
carrying data. Templates transfer essentially unchanged.

A caution on counting: 20 files appear to use old `slot=` syntax, but every one
is `xmlns:v-slot="http://www.w3.org/1999/XSL/Transform"` on the root
`<template>` tag — an IDE artifact silencing a WebStorm warning. Delete the
attribute; there is no slot migration behind it.

### The `$children` problem

`Siblings.vue` is a radio-group that reaches into its child component instances,
mutates `c.selected` directly, and reads `c.$props.disabled`:

```js
highlighSiblingIndex (n) {
    this.$children.forEach((c, i) => { c.selected = i === n; });
}
```

`$children` does not exist in Vue 3 and has no replacement. This needs
`provide`/`inject`: the parent provides the selected index plus a register
callback, `SiblingButton` injects both and derives its own `selected`. It is
about 40 lines of new code, but it touches `Siblings.vue`, `SiblingButton.vue`
and every call site. `TileSet.vue` and `ThingBrowser.vue` use `$children` the
same way and get the same treatment.

Budget half a day. It is the only place where the migration requires a *design
decision* rather than a transcription.

## The external dependency surface is tiny

Everything the editor imports from outside itself, with counts:

| Import | Uses | Replacement |
|---|---|---|
| `vuex` | 21 | Pinia |
| `libs/canvas-helper` | 10 | `raycaster-386` `Canvas` — mostly (see gap below) |
| `vue-material-design-icons/*.vue` | ~88 (56 distinct icons) | see below |
| `libs/raycaster/consts` | 3 | `raycaster-386` `consts` |
| `vue-router` | 1 | vue-router 4 |
| `libs/engine/Engine` | 1 | `Renderer` + `loadLevel` + `buildObjects` |
| `libs/raycaster/TileAnimation` | 1 | ported |
| `libs/marker-registry` | 1 | ported |
| `libs/fetch-json` | 1 | `fetch` |
| `events` (Node `EventEmitter`) | 1 | `grid-renderer` only; a 20-line typed emitter |

Nine distinct third-party packages for a 6,000-line app. Nothing exotic, nothing
abandoned-and-load-bearing, no jQuery-era escape hatch.

**`libs/engine/Engine` appears exactly once**, in `RenderView.vue`, to render a
preview of the level being edited — 51.6 kB of engine for one preview pane, and
precisely what this port replaces. **Nothing in mapedit needs the entity tier,
the thinkers, the automaton or the game loop.** It is a drawing tool that
happens to preview its output.

### The canvas-helper gap

The editor uses four `CanvasHelper` functions. `raycaster-386`'s
`src/core/canvas.ts` covers three — `createCanvas`, `getData`, `loadCanvas` —
and **does not have `text`**. Either reimplement it in the editor (it is a thin
wrapper over `fillText`) or add it to the library. Reimplementing is the right
call: text rendering is an editor concern, and the library has no other use
for it.

### The icon pack needs a decision

`vue-material-design-icons@5.3.1` is current and its SFCs declare `emits:
['click']`, which is a Vue 3 option — so it was written with Vue 3 in mind and
will very likely compile. But its `devDependencies` still pin `vue@^2.7.14`,
and it publishes no `peerDependencies` at all. That is a package that has not
committed to Vue 3 in writing.

56 distinct icons across ~88 usages is a real dependency to take on trust. The
lower-risk route is `@mdi/js` (pure path data, framework-agnostic) plus a
15-line local `SvgIcon.vue`. Same icons, same designer, no framework coupling,
and it tree-shakes — 56 path strings instead of 56 components. Recommended.

## Vuex → Pinia: mechanical, but 141 members wide

| | Count |
|---|---|
| Components importing Vuex | 20 of 38 |
| `mapGetters` call sites | 32 |
| `mapActions` call sites | 22 |
| `mapMutations` call sites | 12 |
| `level` mutations / actions / getters | 38 / 37 / 35 |
| `editor` mutations / actions | 24 / 7 |

**Pinia removes the mutation layer entirely.** All 62 mutations become plain
store methods, and the 80 lines of `mutation-types` / `action-types` string
constants become meaningless — Pinia calls typed methods, so the indirection
that made string constants useful disappears with them. `mixins/popup.js` goes
the same way: 18 lines mapping five popup mutations, replaced by importing the
store.

So the store shrinks by construction. But 66 `map*` call sites across 20
components all have to be rewritten, and that is the single largest mechanical
task in the project. It is also the one most improved by TypeScript: a Pinia
store is typed end to end, where `mapGetters(['getLevel'])` was a string that
either matched something or silently did not.

## Why "migrate in place" is not on the table

- **Options API to Composition API rewrites every `<script>` block.** For the
  biggest component this is the bulk of the work, not a detail: `LevelGrid.vue`
  is 179 lines of template against **967 lines of script**. The often-repeated
  "templates survive, logic doesn't" is true, and here the logic is 5:1.
- **Vue 2 reached end of life**, so this is not optional if the app is to be
  maintained.
- **There is no build configuration to migrate.** The original contains no
  `package.json` and no webpack config for mapedit — the app lived at the old
  repo root, and only `games/mansion/webpack.config.js` came across. Tooling is
  built from scratch either way, which removes most of the usual argument for
  incremental migration.
- **There is no server either** (below). Persistence is built from scratch too.

Migrating in place would mean touching all 38 components and all 1,535 lines of
store, while keeping a Vue 2 app running through the change, with neither a
build nor a backend to run it against. Starting fresh means writing the same
components against a store that is smaller by construction.

---

# The backend

## What the old one exposed

`src/libs/fetch-helper` (29 lines) names six endpoints, and the whole app
reaches the server through it — **7 call sites across 4 files**, which is as
contained as this gets:

```
GET    /vault          list levels
GET    /vault/:name    load a level
PUT    /vault/:name    save a level
DELETE /vault/:name    delete a level
PUT    /publish/:name  export to RCE-100     <- now removable
GET    /user.json      current user          <- now unnecessary
```

The server implementing these was never imported, so it does not exist here.

## Koa, not Nest — and it is genuinely small

**Four routes that read and write JSON files in a directory.** Koa with
`@koa/router` and a body parser is roughly 150 lines including path validation
and error handling.

Nest.js would be the wrong tool by an order of magnitude: a DI container,
decorators, modules, providers and DTO classes to serve four file operations.
Nest earns its structure on applications with many collaborating services and a
database; this is a file store with a list endpoint. **The instinct to skip it
is correct.**

The one thing to get right regardless of framework is path handling: `:name`
comes from the client and is used to build a filesystem path. Resolve it against
the vault root and reject anything that escapes — this is the only security
question the backend has, and it has it whether or not anyone else can reach the
server.

## Two endpoints that no longer need to exist

**`/publish/` is gone.** `libs/generate` has been ported — it is
`src/mapedit` in this repository, shipped as `raycaster-386/mapedit`, with a
fidelity test proving it reproduces the original converter field for field on a
real level. Export runs in the browser now. This is the step the earlier version
of this document listed as future work; it is done.

**`/user.json` is gone too**, because the app is single-user. Settled
2026-09-12: a local-first editor with no accounts. Should remote multi-device
access ever be wanted, the cheap paths are GitHub OAuth (the editor's output is
a repo of JSON and PNGs, so identity, storage, versioning and history arrive
together) or deployment-level auth such as Cloudflare Access. What to avoid is a
bespoke users table with password hashing for a tool with one user.

## The new problem client-side export creates

Moving `generate` into the browser removes an endpoint but adds a question the
old architecture never had to answer.

RCE-100 references its textures **by path**, not inline:

```json
{ "id": "...", "src": "assets/textures/b2f56e726a1f69b5c90e79b576aa66a5.png",
  "width": 1024, "height": 96 }
```

`dark-village` compiles to a 48 kB JSON plus **55 PNG files, 664 kB**. When
`generate` ran on the server it could write those files directly. In the
browser, `ImageAppender` naturally returns `data:` URLs, and something has to
turn them into files. Three options:

1. **Client POSTs the blobs; the backend writes them and the JSON.** Keeps
   RCE-100 exactly as the engine expects. One multipart endpoint. Recommended.
2. **Leave the data URLs inline.** Self-contained and simple, but base64 inflates
   664 kB to roughly 885 kB inside the JSON, and `loadLevel` would need to accept
   it. Fine for a tiny level, wrong as a default.
3. **Zip client-side and download.** No backend at all, but the user hand-places
   the archive, and the editor loses any notion of where a level lives.

This deserves deciding before the export flow is written, not after.

---

# What survives the rewrite

About 1,250 lines, none of it framework-coupled — copy it across and add types:

| Piece | Lines | Note |
|---|---|---|
| ~~`libs/generate`~~ | ~~521~~ | **done** — now `src/mapedit`, `raycaster-386/mapedit` |
| `block-renderer` | 306 | draws a block's faces to a canvas |
| `silly-canvas-factory` | 192 | canvas pooling |
| `grid-renderer` | 96 | draws the map grid; drop the `events` import |
| `tileset-splitter` | 37 | cuts a sheet into tiles |
| `append-images` | 35 | concatenates tiles — the browser `ImageAppender` |
| `block-cache`, `emoji` | 34 | |

Plus the 38 templates, which encode years of UX decisions and are the part
hardest to rederive. Copy the markup, rewrite the script.

`append-images` is worth singling out: `src/mapedit` requires an `ImageAppender`
to be injected, and this 35-line file is exactly that function for a browser. It
is the missing half of the export path, already written.

# Effort, honestly

| Task | Shape |
|---|---|
| Scaffold: Vite + Vue 3 + Pinia + TS + Koa | small, and mostly decisions |
| Type the MapEdit save format | the real design work; `src/mapedit/types.ts` has a head start |
| Pinia store from 141 Vuex members | mechanical, wide, improved by types |
| 38 components, Options → Composition | the bulk; templates transfer, scripts do not |
| `$children` → provide/inject | the one redesign; half a day |
| Port the 730 lines of canvas libs | near-transcription plus types |
| Koa vault | ~150 lines |
| Export pipeline (client-side generate) | small code, one open decision above |

The honest summary: **no blockers, one redesign, and a long transcription.**
The risk is not that some piece proves impossible — nothing here is close to
impossible — but that 6,000 lines of component script is a lot of sustained,
unglamorous rewriting, and the temptation will be to improve the UX while
translating. Resist it. Get it working first; the old app is the specification.

# A workable order

1. **Scaffold and prove the dependency.** Vite + Vue 3 + Pinia + TS, one route,
   `Renderer` drawing a hard-coded level. Answers "does `raycaster-386` install
   and work in a modern bundler" before anything is built on it. Partly answered
   already: the packed tarball typechecks against all four entry points, so what
   remains is the *runtime* half through Vite.
2. ~~**Port `generate` to TypeScript.**~~ Done: `src/mapedit`.
3. **Type the save format, then build the Pinia store.** The editor's save format
   is the real domain model; getting it typed is most of the design.
   `src/mapedit/types.ts` already describes it — `MapEditLevel` and friends —
   because the converter had to read it. Start there rather than from scratch.
4. **The grid editor.** `LevelGrid.vue` is a fifth of the component code and the
   thing people actually use.
5. **Everything else**, browser by builder.
6. **Persistence.** The Koa vault, once the shape of what is saved has settled.

The second-consumer argument still stands and is worth stating again: the editor
is written by someone who cannot see the library's internals, which makes it the
best available test of whether `raycaster-386`'s API reads well from outside.
The demos are a deliberate exercise; an editor has real requirements.

# What to keep from the old app while doing it

Its templates and its 730 lines of canvas code are the specification for as long
as the new editor is being written. The copy that lived in this repository was
deleted on 2026-09-15; read them from git history or the original
`o876-raycaster-engine` repository.

# Open questions worth settling early

- **How do exported textures reach disk?** The three options above. Decide
  before writing the export flow.
- **Does the new editor edit RCE-100 directly for simple levels?** Tempting, and
  wrong for anything with atlases — but worth deciding rather than inheriting.
- **Does the preview use `buildObjects`?** If the editor shows placed things, it
  wants the same decorative-object path a game uses — which would exercise it
  from a second angle.
- **Icons: `vue-material-design-icons` or `@mdi/js`?** See above; `@mdi/js`
  recommended.
- **Does the editor re-atlas, or only compile?** `dark-village`'s 2.1 MB of
  unmerged source tiles were deleted rather than committed, so that level can be
  converted but not re-atlased. Whatever the editor writes, it should keep tile
  sources beside the save.
