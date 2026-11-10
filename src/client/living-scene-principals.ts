/** The named principal silhouette(s) of every scene: what a viewer must still
 * recognise on a populated board. A retained ribbon, far layer or path count
 * never satisfies these. Grass may use its authored compact growth.
 * Verification data shared by the unit and browser checks; the renderer does not read it. */
export const PRINCIPAL_FORMS: Readonly<Record<string, readonly string[]>> = {
  birthday: ['birthday-grounded-cake-gifts', 'birthday-tethered-balloons'],
  'birthday-russian': ['birthday-grounded-cake-gifts', 'birthday-tethered-balloons'],
  'birthday-korean': ['birthday-grounded-cake-gifts', 'birthday-tethered-balloons'],
  spring: ['spring-main-branch'], summer: ['summer-west-clump', 'summer-middle-clump', 'summer-east-clump'],
  autumn: ['autumn-low-branch'], winter: ['winter-near-drift', 'winter-frost-twigs'],
  christmas: ['christmas-linked-bough'], 'new-year': ['new-year-loop-and-fold'], 'new-year-tree': ['new-year-evergreen'],
  'orthodox-christmas': ['orthodox-winter-branch', 'orthodox-star-and-arc'], halloween: ['halloween-rooted-pumpkins'],
  thanksgiving: ['thanksgiving-bound-grain'], 'canada-day': ['canada-connected-maple'], easter: ['easter-grounded-floral-eggs'],
  seollal: ['seollal-kite-tail-and-string'], chuseok: ['chuseok-harvest-spray', 'chuseok-moon-air'],
  'lotus-lanterns': ['lotus-attached-lantern-arc'], maslenitsa: ['maslenitsa-grounded-pancakes'],
  pascha: ['pascha-geometric-eggs-on-cloth'], mimosa: ['mimosa-principal-spray'],
  rain: ['rain-reeds'], snow: ['snow-soft-bank', 'snow-needle-bough'], storm: ['storm-wind-bent-bough'],
  fog: ['fog-sharp-reeds'], wind: ['wind-west-bent-stems', 'wind-east-recovery'],
};
