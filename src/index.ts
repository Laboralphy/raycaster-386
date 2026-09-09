export * from './consts.js';

export { MarkerRegistry } from './core/MarkerRegistry.js';
export { Grid } from './core/Grid.js';
export { line as bresenhamLine } from './core/bresenham.js';
export { distance, squareDistance, circleInRect, linear } from './core/geometry.js';
export * as Rainbow from './core/Rainbow.js';
export type { RGBA } from './core/Rainbow.js';
export * as Canvas from './core/canvas.js';
export type { ImageSource, FilterColor } from './core/canvas.js';

export { CellMap, materialOf, physOf, offsetOf } from './map/CellMap.js';
export { CellSurfaceManager, isWallFace } from './map/CellSurfaceManager.js';
export type { CellSurface } from './map/CellSurfaceManager.js';

export { ShadedTileSet } from './texture/ShadedTileSet.js';
export type { ShadingParams } from './texture/ShadedTileSet.js';
export { TileAnimation, createTileAnimation } from './texture/TileAnimation.js';
export type { TileAnimationDef } from './texture/TileAnimation.js';

export { LightMap } from './light/LightMap.js';
export { LightSource } from './light/LightSource.js';
export type { LightSourceState } from './light/LightSource.js';

export { Sprite } from './Sprite.js';
export type { RenderedRect } from './Sprite.js';
export { DebugDisplay } from './DebugDisplay.js';

export { Renderer } from './Renderer.js';
export type {
    ScreenSettings, MetricsSettings, ShadingSettings,
    CellMaterial, LightHandle, SharedResources
} from './Renderer.js';
export { createScene } from './raycast/Scene.js';
export type { Scene, Camera, Resume, AimedCell, SceneOptions } from './raycast/Scene.js';
export { compareSlices, optimizeBuffer } from './raycast/ZBuffer.js';
export type { ZSlice } from './raycast/ZBuffer.js';
export { castRay } from './raycast/castRay.js';
export { projectRay, isWallTransparent } from './raycast/projectRay.js';
export { createScreenSlice } from './raycast/createScreenSlice.js';
export { resolveTile } from './raycast/context.js';
export type { RenderContext, CellCodes, SurfaceTile } from './raycast/context.js';
export { renderFlats, createFlatContext, resetFlatContext } from './render/renderFlats.js';
export type { FlatContext } from './render/renderFlats.js';
export { renderScreenSlice, renderScreenSliceBuffer } from './render/renderScreenSlice.js';
export { renderSprite, renderSprites } from './render/renderSprites.js';
export { renderBackground } from './render/renderBackground.js';
export { MapHelper } from './map/MapHelper.js';
export type {
    LevelMap, MapRow, MaterialDef, MaterialLight, FaceDef, FaceAnimation,
    BuiltMaterial, BlockLight, BuildResult
} from './map/MapHelper.js';

export { loadLevel, RCE_VERSION } from './level/loadLevel.js';
export type { LoadLevelOptions, LoadedLevel } from './level/loadLevel.js';
export { LEVEL_CONSTANTS, resolveConstant, resolveConstants } from './level/constants.js';
export type {
    RceLevel, RceMetrics, RceTextures, RceShading, RceTileset,
    RceLightSource, RceDecal, RceDecalFace, RceStartPoint, RceTag, DecalAlign
} from './level/types.js';
