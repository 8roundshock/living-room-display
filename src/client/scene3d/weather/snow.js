// Snow over a scene (Combined mode): plainly heavier snowfall than any scene's own, at every depth.
// Rain, storm, fog and wind overlays come later; until a kind has a file here, Combined weather
// over a 3D scene is drawn by the flat renderer.
/** @param {import('../engine').SceneKit} kit @param {import('../engine').SceneContext} ctx */
export default function overlay(kit, ctx) {
  kit.stage.add(kit.snow(150 + ctx.amount * 320, { size: .2, salt: 40 }), kit.snow(24 + ctx.amount * 60, { size: .36, opacity: .5, salt: 50 }));
}
