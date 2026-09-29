import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

type Resources = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material> };
type Point = [number, number, number];

/** A conventional four-door sedan, in metres, facing +X. */
export function createStoreCar(color: string, resources: Resources) {
  const group = new THREE.Group();
  const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness: .42, ...extra }); resources.materials.add(result); return result;
  };
  const paint = material(color, { metalness: .36, roughness: .37 });
  const glass = material('#263339', { metalness: .12, roughness: .28, side: THREE.DoubleSide });
  const rubber = material('#171b1d', { roughness: .93 }), trim = material('#303638', { roughness: .65 });
  const alloy = material('#b4b9bb', { metalness: .75, roughness: .3 });
  const lamp = material('#e8e6db', { emissive: '#d4d3c5', emissiveIntensity: .18 });
  const rearLamp = material('#8a302d', { roughness: .3 });
  function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = group) {
    resources.geometries.add(geometry); const result = new THREE.Mesh(geometry, mat); result.castShadow = true; result.receiveShadow = true; parent.add(result); return result;
  }
  function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, radius = .01, parent: THREE.Object3D = group) {
    const result = mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat, parent); result.position.set(x, y, z); return result;
  }
  function panel(points: Point[], mat: THREE.Material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
    return mesh(geometry, mat);
  }
  // A continuous lower body with real cut-outs around the tyres, a separate hood and short rear deck.
  const body = new THREE.Shape();
  body.moveTo(-2.23, .17); body.lineTo(-2.25, .60); body.lineTo(-2.03, .74);
  body.lineTo(-1.36, .81); body.lineTo(.98, .81); body.lineTo(1.93, .72);
  body.lineTo(2.25, .60); body.lineTo(2.25, .17);
  const arcStart = Math.asin(-.08 / .37);
  for (const axle of [1.4, -1.4]) {
    body.lineTo(axle + Math.cos(arcStart) * .37, .17);
    body.absarc(axle, .25, .37, arcStart, Math.PI - arcStart, false);
  }
  body.lineTo(-2.23, .17); body.closePath();
  const bodyMesh = mesh(new THREE.ExtrudeGeometry(body, { depth: 1.72, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 2, steps: 1, curveSegments: 20 }), paint);
  bodyMesh.position.z = -.86;

  // Painted roof and pillars wrap flat inset glazing. The cabin narrows toward the roof.
  const stations = [
    { x: -1.4, y: .81, half: .80 }, { x: -.9, y: 1.30, half: .66 },
    { x: .35, y: 1.33, half: .66 }, { x: 1.10, y: .81, half: .80 },
  ];
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    panel([[a.x, a.y, -a.half], [a.x, a.y, a.half], [b.x, b.y, b.half], [b.x, b.y, -b.half]], paint);
  }
  const pillarMaterial = material(color, { metalness: .36, roughness: .37, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    panel([[-1.4, .81, side * .80], [-.9, 1.3, side * .66], [.35, 1.33, side * .66], [1.1, .81, side * .80]], pillarMaterial);
    const windowZ = (y: number) => side * (.80 - (y - .81) / .52 * .14 + .012);
    panel([[-1.25, .855, windowZ(.855)], [-.855, 1.255, windowZ(1.255)], [-.22, 1.272, windowZ(1.272)], [-.22, .855, windowZ(.855)]], glass);
    panel([[-.12, .855, windowZ(.855)], [-.12, 1.272, windowZ(1.272)], [.30, 1.286, windowZ(1.286)], [.97, .855, windowZ(.855)]], glass);
    box(2.38, .018, .023, -.15, .83, side * .815, alloy, .005);
    box(1.94, .07, .034, 0, .22, side * .89, trim, .008);
    for (const x of [-.77, .54]) box(.17, .035, .028, x, .71, side * .896, alloy, .01);
    box(.17, .09, .15, .8, .92, side * .92, paint, .024);
    const seamMaterial = new THREE.LineBasicMaterial({ color: '#263034', transparent: true, opacity: .55 }); resources.materials.add(seamMaterial);
    const seam = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.17, .79, side * .888), new THREE.Vector3(-.17, .31, side * .888), new THREE.Vector3(.83, .31, side * .888)]);
    resources.geometries.add(seam); group.add(new THREE.Line(seam, seamMaterial));
  }
  panel([[1.043, .858, -.735], [.414, 1.293, -.61], [.414, 1.293, .61], [1.043, .858, .735]], glass);
  panel([[-1.36, .858, .735], [-.949, 1.261, .61], [-.949, 1.261, -.61], [-1.36, .858, -.735]], glass);
  // Low bumpers and restrained lamps keep the silhouette recognizably sedan-like.
  box(.035, .14, 1.25, 2.27, .32, 0, trim);
  box(.03, .11, .32, 2.295, .34, 0, lamp, .007);
  box(.035, .095, 1.18, -2.27, .28, 0, trim);
  for (const side of [-1, 1]) {
    box(.035, .12, .40, 2.24, .59, side * .61, lamp, .018);
    box(.035, .10, .42, -2.245, .59, side * .61, rearLamp, .012);
  }
  const wheels: THREE.Group[] = [];
  for (const x of [-1.4, 1.4]) for (const side of [-1, 1]) {
    const wheel = new THREE.Group(); wheel.position.set(x, .21, side * .84); group.add(wheel); wheels.push(wheel);
    const tyre = mesh(new THREE.CylinderGeometry(.31, .31, .22, 40), rubber, wheel); tyre.rotation.x = Math.PI / 2;
    const well = mesh(new THREE.CylinderGeometry(.20, .20, .225, 32), trim, wheel); well.rotation.x = Math.PI / 2;
    const lip = mesh(new THREE.TorusGeometry(.19, .013, 8, 40), alloy, wheel); lip.position.z = side * .119;
    for (let i = 0; i < 5; i++) {
      const spoke = box(.027, .31, .018, 0, 0, side * .12, alloy, .005, wheel); spoke.rotation.z = i * Math.PI / 5;
    }
    const hub = mesh(new THREE.CylinderGeometry(.06, .06, .025, 20), alloy, wheel); hub.rotation.x = Math.PI / 2; hub.position.z = side * .13;
  }
  return { group, wheels };
}
