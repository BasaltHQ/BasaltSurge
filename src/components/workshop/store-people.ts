import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Resources = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> };
type PersonOptions = { jacket: string; skin: string; hair?: string; trousers?: string; longHair?: boolean; merchant?: boolean };

/** Human-scale, articulated boutique characters. Coordinates are metres; forward is +Z. */
export function createStorePerson(options: PersonOptions, resources: Resources) {
  const group = new THREE.Group();
  const material = (color: string, roughness = .8) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness }); resources.materials.add(result); return result;
  };
  const skin = material(options.skin, .72), fabric = material(options.jacket), shirt = material('#ede8df');
  const trousers = material(options.trousers ?? '#343533'), leather = material('#292724', .67), outsole = material('#20211f', .85);
  const hair = material(options.hair ?? '#30251f');
  const gold = material('#bda578', .32);
  const add = (geometry: THREE.BufferGeometry, mat: THREE.Material, parent = group) => {
    resources.geometries.add(geometry); const object = new THREE.Mesh(geometry, mat); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const oval = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, parent = group) => {
    const object = add(new THREE.SphereGeometry(1, 20, 16), mat, parent); object.position.set(x, y, z); object.scale.set(sx, sy, sz); return object;
  };
  const block = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, parent = group) => {
    const object = add(new THREE.BoxGeometry(w, h, d), mat, parent); object.position.set(x, y, z); return object;
  };
  const segment = (radius: number, mat: THREE.Material) => add(new THREE.CylinderGeometry(radius * .82, radius, 1, 16), mat);
  const up = new THREE.Vector3(0, 1, 0);
  function between(object: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
    object.position.copy(from).add(to).multiplyScalar(.5);
    const direction = to.clone().sub(from); object.scale.y = direction.length(); object.quaternion.setFromUnitVectors(up, direction.normalize());
  }

  // A tailored torso, defined waist and shoulders rather than a single capsule.
  const torso = add(new THREE.LatheGeometry([
    new THREE.Vector2(.155, .89), new THREE.Vector2(.163, .97), new THREE.Vector2(.155, 1.08),
    new THREE.Vector2(.19, 1.25), new THREE.Vector2(.218, 1.36), new THREE.Vector2(.17, 1.41),
    new THREE.Vector2(.07, 1.44),
  ], 32), fabric); torso.scale.z = .62;
  oval(0, .91, 0, .165, .12, .107, trousers);
  oval(0, 1.47, 0, .054, .09, .056, skin);
  add(new THREE.CylinderGeometry(.069, .076, .036, 24, 1, true), shirt).position.y = 1.445;
  const shirtShape = new THREE.Shape(); shirtShape.moveTo(-.067, 1.43); shirtShape.lineTo(.067, 1.43); shirtShape.lineTo(0, 1.12); shirtShape.closePath();
  add(new THREE.ShapeGeometry(shirtShape), shirt).position.z = .143;
  for (const side of [-1, 1]) {
    const lapelShape = new THREE.Shape(); lapelShape.moveTo(side * .045, 1.435); lapelShape.lineTo(side * .14, 1.36); lapelShape.lineTo(side * .052, 1.14); lapelShape.lineTo(side * .005, 1.25); lapelShape.closePath();
    const lapelMaterial = material(options.jacket); lapelMaterial.color.multiplyScalar(.88); lapelMaterial.side = THREE.DoubleSide;
    add(new THREE.ShapeGeometry(lapelShape), lapelMaterial).position.z = .15;
    const collar = block(side * .034, 1.40, .081, .052, .073, .018, shirt); collar.rotation.z = -side * .32;
    oval(side * .203, 1.32, 0, .073, .095, .082, fabric);
  }
  for (const y of [1.12, 1.02]) oval(.016, y, .116, .006, .006, .003, gold);
  block(.108, 1.28, .121, .071, .012, .011, fabric);
  if (options.merchant) block(.112, 1.31, .13, .065, .027, .008, gold);

  const head = new THREE.Group(); head.position.set(0, 1.65, 0); group.add(head);
  // A single smooth, featureless form keeps the people visually quiet at close range.
  const silhouette = add(new THREE.SphereGeometry(1, 32, 24), skin, head);
  silhouette.scale.set(.104, .15, .102);
  const crown = add(new THREE.SphereGeometry(1, 32, 24, 0, Math.PI * 2, 0, 1.35), hair, head);
  crown.scale.set(.108, .156, .106);
  if (options.longHair) {
    oval(0, -.08, -.063, .116, .18, .057, hair, head);
    oval(.062, -.19, -.087, .054, .075, .06, hair, head);
  }

  const limbs = [-1, 1].map(side => {
    const upper = segment(.066, fabric), lower = segment(.051, fabric), elbow = oval(0, 0, 0, .052, .052, .052, fabric);
    const hand = new THREE.Group(); group.add(hand);
    oval(0, 0, 0, .037, .049, .02, skin, hand);
    for (let finger = 0; finger < 4; finger++) {
      const digit = add(new THREE.CapsuleGeometry(.008, .046 - Math.abs(finger - 1.5) * .005, 3, 8), skin, hand);
      digit.position.set(-.027 + finger * .018, -.048, .009); digit.rotation.x = -.22;
    }
    const thumb = add(new THREE.CapsuleGeometry(.011, .031, 3, 8), skin, hand); thumb.position.set(side * .034, -.005, .023); thumb.rotation.z = -side * .6;
    const thigh = segment(.082, trousers), calf = segment(.058, trousers), knee = oval(0, 0, 0, .066, .074, .067, trousers);
    // A single shoe assembly follows the ankle: slim shaped sole, rounded toe and fitted heel.
    const shoe = new THREE.Group(); group.add(shoe);
    const sole = add(new RoundedBoxGeometry(.114, .014, .252, 3, .006), outsole, shoe); sole.position.set(0, -.093, .04);
    const toe = add(new RoundedBoxGeometry(.108, .056, .239, 4, .025), leather, shoe); toe.position.set(0, -.063, .04);
    oval(0, -.035, -.011, .045, .036, .060, leather, shoe);
    for (const z of [.02, .035, .05]) block(0, -.027, z, .050, .003, .004, outsole, shoe);
    return { side, upper, lower, elbow, hand, thigh, calf, knee, shoe };
  });

  // The phone is attached to this palm; raising the forearm also raises the device.
  const phoneGrip = new THREE.Group(); group.add(phoneGrip);
  function pose(walkPhase: number, walking: boolean, scan: number, glance = 0, confirm = 0) {
    limbs.forEach(limb => {
      const { side, upper, lower, elbow, hand, thigh, calf, knee, shoe } = limb;
      const swing = walking ? Math.sin(walkPhase + (side === 1 ? Math.PI : 0)) : 0;
      const ankle = new THREE.Vector3(side * .105, .085 + Math.max(0, -swing) * .08, swing * .19);
      const kneePoint = new THREE.Vector3(side * .112, .51, swing * .09 + Math.max(0, -swing) * .08);
      between(thigh, new THREE.Vector3(side * .105, .91, 0), kneePoint); between(calf, kneePoint, ankle); knee.position.copy(kneePoint);
      shoe.position.copy(ankle); shoe.rotation.set(-Math.max(0, -swing) * .18, side * .055, 0);
      const shoulder = new THREE.Vector3(side * .219, 1.345, 0);
      const elbowPoint = new THREE.Vector3(side * .26, 1.08, -swing * .07);
      const palm = new THREE.Vector3(side * .27, .83, -swing * .14 + .035);
      const raise = side === -1 ? scan : scan * confirm;
      elbowPoint.lerp(new THREE.Vector3(side * .27, 1.095, .18), raise);
      palm.lerp(new THREE.Vector3(side === -1 ? -.32 : -.235, side === -1 ? 1.35 : 1.41, side === -1 ? .47 : .415), raise);
      between(upper, shoulder, elbowPoint); between(lower, elbowPoint, palm); elbow.position.copy(elbowPoint);
      hand.position.copy(palm); hand.rotation.set(-raise * 1.25, side === -1 ? raise * -.1 : raise * .5, side * .1);
      if (side === -1) { phoneGrip.position.copy(palm).add(new THREE.Vector3(.018, .067, .015)); }
    });
    head.rotation.x = scan * .10; head.rotation.y = glance;
  }
  pose(0, false, 0);
  return { group, pose, phoneGrip };
}
