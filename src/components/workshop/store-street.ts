import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStorePerson } from './store-people';
import { createStoreCar } from './store-car';

type Resources = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> };

/** Street-level arrival; traffic clears the crossing before the camera leaves the opposite curb. */
export function createStoreStreet(world: THREE.Scene, resources: Resources) {
  const street = new THREE.Group(); world.add(street);
  const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness: .7, ...extra }); resources.materials.add(result); return result;
  };
  const asphalt = material('#434944'), paving = material('#c5bdad'), paint = material('#e5e1d4');
  const stone = material('#aaa391'), bronze = material('#625b48', { metalness: .65, roughness: .35 });
  const glass = material('#344c51', { metalness: .25, roughness: .2 });
  const metal = material('#a8aaa2', { metalness: .8, roughness: .3 });
  function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = street) {
    resources.geometries.add(geometry); const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = street) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const round = (w: number, h: number, d: number, r: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = street) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z, parent);
  box(80, .15, 8, 0, -.19, 16, asphalt);
  box(80, .25, 6, 0, -.095, 9, paving);
  box(80, .25, 7, 0, -.095, 23.5, paving);
  for (const z of [11.95, 20.05]) box(80, .23, .16, 0, -.085, z, stone);
  // Zebra crossing lies directly on the camera's route to the entrance.
  for (let z = 12.4; z < 20; z += .95) box(3.2, .012, .46, 0, -.107, z, paint);
  for (let x = -36; x <= 36; x += 4) if (Math.abs(x) > 3) box(2.1, .012, .09, x, -.107, 16, paint);
  for (const z of [8, 10, 22, 24, 26]) box(78, .006, .012, 0, .033, z, stone);
  for (let x = -36; x <= 36; x += 2.5) { box(.012, .006, 5.8, x, .033, 9, stone); box(.012, .006, 6.8, x, .033, 23.5, stone); }
  for (const x of [-8.5, 8.5]) {
    box(.1, 4.2, .1, x, 2.12, 10.9, bronze);
    round(.65, .12, .38, .045, x, 4.2, 10.9, bronze);
    box(.51, .025, .29, x, 4.12, 10.9, material('#fff0cf', { emissive: '#fbe6ba', emissiveIntensity: .45 }));
    // Bollards stay outside the unobstructed entry/crosswalk corridor.
    for (const dx of [-.65, .65]) round(.1, .75, .1, .025, x + dx, .4, 11.25, bronze);
  }
  for (const side of [-1, 1]) {
    const facade = material(side === -1 ? '#bcb3a2' : '#a8afa3');
    box(9, 7.8, 13, side * 11, 3.87, -1, facade);
    box(9.1, .22, .4, side * 11, 3.5, 5.65, stone);
    for (const dx of [-2.7, 0, 2.7]) {
      box(1.9, 2.3, .07, side * 11 + dx, 1.7, 5.56, glass);
      box(1.6, 1.8, .07, side * 11 + dx, 5.6, 5.56, glass);
      box(1.85, .1, .18, side * 11 + dx, 4.67, 5.62, stone);
    }
  }

  function car(color: string, lane: number, direction: number, offset: number) {
    const { group, wheels } = createStoreCar(color, resources);
    street.add(group); group.position.z = lane; group.rotation.y = direction === 1 ? 0 : Math.PI;
    return { group, wheels, direction, offset };
  }
  const cars = [car('#9ba8a5', 14, 1, -8), car('#465765', 18, -1, 8)];
  const pedestrians = [
    { figure: createStorePerson({ jacket: '#9d8570', skin: '#bd9678', trousers: '#444a43', longHair: true }, resources), z: 9.2, direction: 1, offset: -4.8 },
    { figure: createStorePerson({ jacket: '#626f78', skin: '#916d56', trousers: '#c5bcab' }, resources), z: 10.4, direction: -1, offset: 5.7 },
  ];
  pedestrians.forEach(({ figure, z, direction }) => { street.add(figure.group); figure.group.position.y = .04; figure.group.position.z = z; figure.group.rotation.y = direction * Math.PI / 2; });
  const crossing = createStorePerson({ jacket: '#a6aa93', skin: '#cba483', trousers: '#51534b' }, resources);
  street.add(crossing.group); crossing.group.rotation.y = Math.PI;
  let clock = 0;
  function update(progress: number, elapsed: number, still: boolean) {
    street.visible = progress < 1.05;
    if (!street.visible) return;
    if (!still && progress < .06) clock += elapsed;
    const clear = THREE.MathUtils.smoothstep(progress, .06, .16);
    cars.forEach(({ group, wheels, direction, offset }) => {
      const moving = THREE.MathUtils.euclideanModulo(offset + direction * clock * 2.2 + 20, 40) - 20;
      group.position.x = THREE.MathUtils.lerp(moving, direction * 27, clear);
      wheels.forEach(wheel => { wheel.rotation.z = -clock * 2.2 / .31; });
    });
    pedestrians.forEach(({ figure, direction, offset }) => {
      const moving = THREE.MathUtils.euclideanModulo(offset + direction * clock * .7 + 17, 34) - 17;
      const leave = THREE.MathUtils.smoothstep(progress, .12, .55);
      figure.group.position.x = THREE.MathUtils.lerp(moving, direction * 9, leave);
      figure.pose(clock * 3.6 + progress * 30, !still, 0);
    });
    const crossingProgress = THREE.MathUtils.smoothstep(progress, .16, .55);
    const crossingZ = THREE.MathUtils.lerp(20.5, 9.5, crossingProgress);
    const onRoad = THREE.MathUtils.smoothstep(crossingZ, 11.8, 12.2) * (1 - THREE.MathUtils.smoothstep(crossingZ, 19.8, 20.2));
    crossing.group.position.set(-1.03, .04 - onRoad * .14, crossingZ);
    crossing.pose(progress * 60, !still && progress > .16 && progress < .55, 0);
  }
  return { update };
}
