import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { storeCatalog, type StoreProductKind } from './store-catalog';

type Resources = { geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>; textures: Set<THREE.Texture> };

/** Shared product models. Their bases sit at y=0; fronts face +Z. */
export function createStoreProductFactory(resources: Resources) {
  const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: .8, ...extra }); resources.materials.add(value); return value;
  };
  const canvas = material('#d3c5a7'), strap = material('#ac9b79'), kraft = material('#a98052'), seal = material('#735638');
  const enamel = material('#527b70', { metalness: .22, roughness: .43 }), lid = material('#2d423d', { roughness: .55 });
  const steel = material('#b1b7ad', { metalness: .7, roughness: .3 });
  const prototypes = new Map<StoreProductKind, THREE.Group>();
  function add(group: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
    resources.geometries.add(geometry); const object = new THREE.Mesh(geometry, mat); object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
  }
  function label(group: THREE.Group, lines: string[], w: number, h: number, y: number, z: number, bg: string, fg: string) {
    const surface = document.createElement('canvas'); surface.width = 512; surface.height = 384;
    const ctx = surface.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 384); ctx.fillStyle = fg; ctx.textAlign = 'center';
    ctx.font = '22px Arial'; ctx.fillText('ATELIER / EVERYDAY', 256, 58);
    lines.forEach((line, i) => { ctx.font = i === 0 ? '54px Georgia' : '24px Arial'; ctx.fillText(line, 256, 170 + i * 65); });
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; resources.textures.add(texture);
    const mat = material('#ffffff', { map: texture });
    add(group, new THREE.PlaneGeometry(w, h), mat, 0, y, z);
  }
  for (const product of storeCatalog) {
    const group = new THREE.Group(); group.name = product.sku; group.userData.sku = product.sku;
    if (product.kind === 'tote') {
      add(group, new RoundedBoxGeometry(.40, .36, .135, 3, .024), canvas, 0, .18);
      add(group, new RoundedBoxGeometry(.37, .018, .105, 2, .007), strap, 0, .357);
      const handle = new THREE.Shape(); handle.moveTo(-.125, .31); handle.lineTo(-.125, .455);
      handle.bezierCurveTo(-.125, .61, .125, .61, .125, .455); handle.lineTo(.125, .31); handle.lineTo(.100, .31); handle.lineTo(.100, .455);
      handle.bezierCurveTo(.100, .574, -.100, .574, -.100, .455); handle.lineTo(-.100, .31); handle.closePath();
      for (const z of [-.055, .047]) add(group, new THREE.ExtrudeGeometry(handle, { depth: .009, bevelEnabled: false, curveSegments: 16, steps: 1 }), strap, 0, 0, z);
      for (const x of [-.173, .173]) add(group, new RoundedBoxGeometry(.005, .30, .004, 1, .001), strap, x, .177, .069);
      label(group, ['EVERYDAY', 'CANVAS TOTE'], .27, .15, .19, .07, '#d3c5a7', '#514c3c');
      group.userData.height = .58;
    } else if (product.kind === 'coffee') {
      // A gusseted pouch narrows to a folded, sealed top rather than reading as a box or tin.
      const levels = [{ y: 0, w: .095, d: .045 }, { y: .045, w: .12, d: .065 }, { y: .25, w: .10, d: .042 }, { y: .325, w: .09, d: .012 }];
      const points: number[] = [], indices: number[] = [];
      levels.forEach(({ y, w, d }) => points.push(-w, y, d, w, y, d, w, y, -d, -w, y, -d));
      for (let row = 0; row < levels.length - 1; row++) for (let side = 0; side < 4; side++) {
        const a = row * 4 + side, b = row * 4 + (side + 1) % 4, c = b + 4, d = a + 4; indices.push(a, b, c, a, c, d);
      }
      indices.push(0, 3, 2, 0, 2, 1, 12, 13, 14, 12, 14, 15);
      const pouch = new THREE.BufferGeometry(); pouch.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); pouch.setIndex(indices); pouch.computeVertexNormals(); add(group, pouch, kraft);
      add(group, new RoundedBoxGeometry(.205, .017, .028, 2, .004), seal, 0, .326);
      label(group, ['HOUSE', 'COFFEE', 'WHOLE BEAN / 250g'], .165, .19, .17, .065, '#ebe1cc', '#463d2f');
      group.userData.height = .34;
    } else {
      const profile = [[0, 0], [.056, 0], [.066, .012], [.066, .265], [.06, .285], [.04, .315], [.033, .325], [.033, .35], [0, .35]].map(([x, y]) => new THREE.Vector2(x, y));
      add(group, new THREE.LatheGeometry(profile, 32), enamel);
      add(group, new THREE.CylinderGeometry(.035, .035, .015, 24), steel, 0, .342);
      add(group, new THREE.CylinderGeometry(.038, .038, .037, 24), lid, 0, .367);
      label(group, ['STUDIO', '750 ml'], .083, .092, .18, .067, '#527b70', '#eae7d9');
      group.userData.height = .39;
    }
    prototypes.set(product.kind, group);
  }
  return (kind: StoreProductKind) => {
    const group = prototypes.get(kind)!.clone(true);
    const anchor = new THREE.Object3D(); anchor.name = 'inventory-anchor'; anchor.position.set(0, group.userData.height + .035, .07); group.add(anchor);
    return { group, anchor };
  };
}
