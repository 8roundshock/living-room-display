// Autumn fruit that lies beside the Chuseok tray (#629): an opened chestnut burr with two glossy
// nuts showing, and jujubes turning from green to red-brown. See ../README.md.
import { smooth } from './seollal-forms.js';

/** An opened chestnut burr centred on the origin: a spiny husk split toward the viewer and two nuts in the split. */
export function chestnutBurr(kit, { radius = .3, salt = 3 } = {}) {
  const { T, V, C, rnd, mat, mix, canvasTexture } = kit, group = new T.Group(), split = V(.2, .72, .66).normalize();
  const husk = new T.Mesh(kit.sphereGeo, mat({ color: 0xc2aa78, roughness: .85 }, .3, false)); husk.scale.setScalar(radius * .7); group.add(husk);
  const total = 320, spines = new T.InstancedMesh(new T.ConeGeometry(.034, 1, 4, 1, true), mat({ color: 0xffffff, roughness: .55 }, .5, false), total), o = new T.Object3D(), dir = V(), up = V(0, 1, 0);
  let count = 0;
  for (let i = 0; i < total; i++) {
    const y = 1 - 2 * (i + .5) / total, ring = Math.sqrt(1 - y * y), a = i * 2.39996; dir.set(Math.cos(a) * ring, y, Math.sin(a) * ring);
    if (dir.dot(split) > .6) continue; // the husk has split open here
    dir.set(dir.x + (rnd(i, salt) - .5) * .3, dir.y + (rnd(i, salt + 1) - .5) * .3, dir.z + (rnd(i, salt + 2) - .5) * .3).normalize();
    const length = radius * (.4 + rnd(i, salt + 3) * .34);
    o.position.copy(dir).multiplyScalar(radius * .66 + length / 2); o.quaternion.setFromUnitVectors(up, dir); o.scale.set(radius, length, radius); o.updateMatrix(); spines.setMatrixAt(count, o.matrix);
    // Drying from green to straw as it opens.
    spines.setColorAt(count, C(mix(0x8f9a4a, 0xc9a964, rnd(i, salt + 4)))); count++;
  }
  spines.count = count; spines.instanceColor.needsUpdate = true; spines.frustumCulled = false; group.add(spines);
  // The nut: a rounded base with its pale scar, drawn up to a point.
  const shell = canvasTexture(128, 256, g => {
    const skin = g.createLinearGradient(0, 0, 0, 256); skin.addColorStop(0, '#3d1c0e'); skin.addColorStop(.3, '#6a3b22'); skin.addColorStop(.74, '#7a4526'); skin.addColorStop(.78, '#b99a68'); skin.addColorStop(1, '#c9ad7c'); g.fillStyle = skin; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(40,16,6,${(.08 + rnd(i, 31) * .14).toFixed(3)})`; g.lineWidth = 1 + rnd(i, 32) * 2; g.beginPath(); g.moveTo(rnd(i, 33) * 128, 0); g.lineTo(rnd(i, 33) * 128 + (rnd(i, 34) - .5) * 10, 196); g.stroke(); }
  });
  const nutGeo = new T.SphereGeometry(1, 32, 22), p = nutGeo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = y > 0 ? 1 - .58 * y * y : 1; p.setXYZ(i, p.getX(i) * k, y > 0 ? y * 1.2 : y * .8, p.getZ(i) * k * .7); }
  nutGeo.computeVertexNormals();
  const gloss = mat({ map: shell, roughness: .2, clearcoat: .9, clearcoatRoughness: .12 }, 1.1);
  [[-.3, .12, .2], [.34, -.1, -.25]].forEach(([side, lift, turn]) => {
    const nut = new T.Mesh(nutGeo, gloss); nut.scale.setScalar(radius * .46); nut.quaternion.setFromUnitVectors(up, V(split.x + side * .9, split.y + lift, split.z).normalize()); nut.rotateY(turn);
    nut.position.copy(split).multiplyScalar(radius * .42).add(V(side * radius * .62, lift * radius, 0)); group.add(nut);
  });
  return group;
}

/** A jujube lying on its side along x, about `length` long. `ripe` (0-1) is how much of it has turned red-brown. */
export function jujube(kit, { length = .3, ripe = .7, salt = 1 } = {}) {
  const { T, rnd, mat, canvasTexture } = kit, group = new T.Group();
  const skin = canvasTexture(128, 128, g => {
    g.fillStyle = '#b3b862'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 90; i++) { if (rnd(i, salt) > ripe) continue; g.fillStyle = `rgba(${rnd(i, salt + 1) < .7 ? '140,47,37' : '112,34,26'},${(.5 + rnd(i, salt + 2) * .4).toFixed(2)})`; g.beginPath(); g.arc(rnd(i, salt + 3) * 128, rnd(i, salt + 4) * 128, 9 + rnd(i, salt + 5) * 24, 0, 7); g.fill(); }
  });
  const geometry = new T.SphereGeometry(1, 28, 20), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 + .08 * y; p.setXYZ(i, p.getX(i) * k * .36 * length, (y - .1 * smooth(y, .8, 1)) * .5 * length, p.getZ(i) * k * .36 * length); }
  geometry.computeVertexNormals(); geometry.rotateZ(Math.PI / 2);
  const stalk = new T.Mesh(new T.CylinderGeometry(.006, .008, length * .22, 5), mat({ color: 0x6a4a2a, roughness: .8 }, .3, false)); stalk.rotation.z = Math.PI / 2; stalk.position.x = -length * .52;
  group.add(new T.Mesh(geometry, mat({ map: skin, roughness: .25, clearcoat: .85, clearcoatRoughness: .15 }, 1)), stalk);
  return group;
}
