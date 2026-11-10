// Ripening rice (벼 이삭) for the three holiday days of Chuseok (#629): standing stalks whose
// ears droop under their grain, with long leaves. Never a tied sheaf. See ../README.md.
import { taperTube } from './seollal-forms.js';

/** One stalk rooted at the group's origin, `height` tall, arcing toward -x by `lean`; its ear carries `grains` grains. */
export function riceStalk(kit, { height = 2.4, lean = .5, grains = 45, salt = 1 } = {}) {
  const { T, V, rnd, mat } = kit, group = new T.Group();
  const spine = new T.CatmullRomCurve3([V(0, 0, 0), V(-lean * .1, height * .4, 0), V(-lean * .45, height * .78, 0), V(-lean, height * .96, 0), V(-lean * 1.5, height * .9, .02), V(-lean * 1.9, height * .74, .03)]);
  group.add(new T.Mesh(taperTube(kit, spine, u => .024 * (1 - .65 * u), 40, 6), mat({ color: 0xa9b25a, roughness: .7 }, .4, false)));
  // The ear: grains on short branchlets along the drooping end of the stalk.
  const ear = new T.InstancedMesh(new T.SphereGeometry(1, 7, 5), mat({ color: 0xd9b24a, roughness: .5, clearcoat: .25 }, .7), grains), o = new T.Object3D(), at = V(), along = V(), up = V(0, 1, 0);
  for (let i = 0; i < grains; i++) {
    const u = .6 + .4 * (i + rnd(i, salt) * .8) / grains; spine.getPointAt(Math.min(1, u), at); spine.getTangentAt(Math.min(1, u), along);
    along.add(V((rnd(i, salt + 1) - .5) * .9, -.5 - rnd(i, salt + 2) * .5, (rnd(i, salt + 3) - .5) * .9)).normalize();
    o.position.copy(at).addScaledVector(along, .03 + rnd(i, salt + 4) * .07); o.quaternion.setFromUnitVectors(up, along); o.scale.set(.03, .068, .03); o.updateMatrix(); ear.setMatrixAt(i, o.matrix);
  }
  ear.frustumCulled = false; group.add(ear);
  // Long leaves that leave the stalk low down, rise, and bend over at the tip.
  const blade = mat({ color: 0x9fd070, roughness: .65, side: T.DoubleSide }, .4, false);
  for (let k = 0; k < 2; k++) {
    const from = spine.getPointAt(.18 + k * .2), side = k ? 1 : -1, reach = height * (.42 + rnd(k, salt + 7) * .16), points = [];
    for (let i = 0; i <= 16; i++) { const u = i / 16; points.push(V(from.x + side * reach * (.25 * u + .55 * u * u), from.y + reach * (1.1 * u - .75 * u * u * u), from.z + (k ? -.05 : .05) * u)); }
    // The blade turns partly toward the viewer and narrows to a point.
    const across = u => { const i = Math.min(15, Math.floor(u * 16)), tangent = points[i + 1].clone().sub(points[i]).normalize(); return V(-tangent.y, tangent.x, 0).multiplyScalar(.8).add(V(0, 0, .6)).normalize().multiplyScalar(Math.max(.06, Math.sin(Math.PI * Math.min(1, u * 1.15 + .12)))); };
    group.add(new T.Mesh(kit.ribbonGeo(points, .07, across), blade));
  }
  return group;
}
