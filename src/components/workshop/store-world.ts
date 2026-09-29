import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStorePerson } from './store-people';
import { aimCameraAtQr } from './store-scan';
import { createStoreStreet } from './store-street';

import { storeCatalog, type StoreProductKind } from './store-catalog';
import { createStoreProductFactory } from './store-products';

const poses = [
  { at: 0, eye: [0, 1.85, 25], look: [0, 2, 6] },
  { at: .16, eye: [0, 1.85, 21.5], look: [0, 2, 6] },
  { at: .48, eye: [0, 1.85, 12], look: [0, 1.9, 5] },
  { at: .70, eye: [0, 1.9, 8], look: [0, 1.55, -2] },
  { at: 1, eye: [1.6, 2.4, 3.4], look: [-2.6, 1.3, -2.3] },
  { at: 2, eye: [3.5, 2.4, -3.2], look: [.7, 1.25, -7] },
  { at: 3, eye: [2.25, 2.03, -5.45], look: [1.12, 1.53, -7.5] },
  { at: 4, eye: [-.9, 3.2, -4.3], look: [1.6, 1.55, -8] },
  { at: 4.6, eye: [4.5, 2.8, -10.2], look: [3.8, 1.5, -16] },
  { at: 5, eye: [4, 4, -13.3], look: [-.4, 1.1, -18.2] },
];

export function createStoreWorld(canvas: HTMLCanvasElement, qr: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const world = new THREE.Scene();
  world.background = new THREE.Color('#d3cfc4');
  world.fog = new THREE.Fog('#d3cfc4', 35, 85);
  const environmentRoom = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentRoom, .04);
  world.environment = environment.texture; world.environmentIntensity = .55;
  environmentRoom.dispose(); pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(48, 1, .08, 110);
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const makeProduct = createStoreProductFactory({ geometries, materials, textures });
  const featureAnchors: THREE.Object3D[] = [];
  function product(kind: StoreProductKind, x: number, y: number, z: number, rotation: number, parent: THREE.Object3D = world) {
    const model = makeProduct(kind); model.group.position.set(x, y, z); model.group.rotation.y = rotation; parent.add(model.group); return model;
  }
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .72, ...extra });
    materials.add(material); return material;
  };
  function surfaceTexture(kind: 'stone' | 'wood') {
    const surface = document.createElement('canvas'); surface.width = surface.height = 512;
    const ctx = surface.getContext('2d')!;
    ctx.fillStyle = kind === 'stone' ? '#e6e0d4' : '#71513a'; ctx.fillRect(0, 0, 512, 512);
    let seed = 19;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < (kind === 'wood' ? 210 : 45); i++) {
      ctx.beginPath(); const start = random() * 512;
      ctx.strokeStyle = kind === 'wood' ? `rgba(30,16,8,${.035 + random() * .1})` : `rgba(109,98,78,${.025 + random() * .055})`;
      ctx.lineWidth = kind === 'wood' ? .3 + random() * 2 : .4 + random() * 2.5;
      if (kind === 'wood') { ctx.moveTo(start, 0); ctx.bezierCurveTo(start + 18, 160, start - 22, 310, start + 8, 512); }
      else { ctx.moveTo(0, start); ctx.bezierCurveTo(160, start - 110, 290, start + 100, 512, start - 140); }
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; textures.add(texture); return texture;
  }
  const stoneTexture = surfaceTexture('stone'), walnutTexture = surfaceTexture('wood');
  const cream = mat('#eee6d7', { roughness: .64 }), green = mat('#283c34', { roughness: .45 }), dark = mat('#172821', { roughness: .5 });
  const wood = mat('#ffffff', { map: walnutTexture, roughness: .38 });
  const stone = mat('#ffffff', { map: stoneTexture, roughness: .3, metalness: .04 });
  const brass = mat('#c9ab72', { metalness: .83, roughness: .28 });
  const concrete = mat('#b8b1a1'), terracotta = mat('#b2a184'), charcoal = mat('#222725', { roughness: .32 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = world) => {
    geometries.add(geometry); const object = new THREE.Mesh(geometry, material); object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = cream, parent: THREE.Object3D = world) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
  const rounded = (w: number, h: number, d: number, radius: number, x: number, y: number, z: number, material = cream, parent: THREE.Object3D = world) => mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material, x, y, z, parent);
  const cylinder = (r: number, h: number, x: number, y: number, z: number, material = brass, parent: THREE.Object3D = world) => mesh(new THREE.CylinderGeometry(r, r, h, 16), material, x, y, z, parent);
  function placard(text: string, sub: string, w: number, h: number, x: number, y: number, z: number, bg = '#285b51', fg = '#f5edd7') {
    const surface = document.createElement('canvas'); surface.width = 1024; surface.height = Math.round(1024 * h / w);
    const ctx = surface.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, surface.width, surface.height); ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.font = `400 ${sub ? 64 : 70}px Georgia`; ctx.fillText(text, 512, surface.height * (sub ? .47 : .6));
    if (sub) { ctx.font = '30px Arial'; ctx.fillText(sub, 512, surface.height * .76); }
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture }); materials.add(material);
    return mesh(new THREE.PlaneGeometry(w, h), material, x, y, z);
  }
  world.add(new THREE.HemisphereLight('#fff6e4', '#8c8475', 1.65));
  const sun = new THREE.DirectionalLight('#fff0d6', 2.6); sun.position.set(9, 18, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 18, bottom: -22, far: 60 }); sun.shadow.bias = -.001; world.add(sun);
  for (const z of [-2, -8, -17]) { const light = new THREE.PointLight('#fff1d2', 22, 15, 2); light.position.set(0, 4.3, z); world.add(light); }

  // One continuous building: front door at +6, shopping floor, checkout, then the back stockroom.
  box(90, .2, 90, 0, -.32, -5, mat('#a7aca0'));
  const street = createStoreStreet(world, { geometries, materials });
  box(12, .2, 27, 0, -.02, -7.5, stone);
  for (let x = -6; x <= 6; x += 2) box(.008, .01, 26.8, x, .086, -7.5, concrete);
  for (let z = -20; z < 7; z += 3) box(12, .01, .008, 0, .087, z, concrete);
  box(.25, 4.8, 27, -6, 2.4, -7.5, cream); box(.25, 4.8, 27, 6, 2.4, -7.5, cream);
  for (const x of [-5.82, 5.82]) {
    box(.08, .16, 26.7, x, .17, -7.5, brass);
    box(.1, .35, 26.7, x, 4.5, -7.5, wood);
    for (const z of [-.5, -4.7, -9]) {
      box(.12, 3.7, 2.8, x, 2.0, z, wood);
      const light = mesh(new THREE.SphereGeometry(.105, 16, 12), mat('#fff0d4', { emissive: '#ffe0a4', emissiveIntensity: 2 }), x > 0 ? x - .18 : x + .18, 3.15, z);
      light.castShadow = false;
    }
  }
  box(12, 4.8, .25, 0, 2.4, -21, dark);
  const roofMaterial = mat('#293b32', { transparent: true, depthWrite: false });
  const roof = box(12.4, .25, 27.4, 0, 4.85, -7.5, roofMaterial);
  // Glazed front and a deliberately open doorway: the camera passes through real empty space.
  box(4.5, .5, .3, -3.75, .25, 6, stone); box(4.5, .5, .3, 3.75, .25, 6, stone);
  for (const x of [-5.85, -1.5, 1.5, 5.85]) box(.09, 3.5, .3, x, 1.75, 6, brass);
  const glass = mat('#99d6c7', { transparent: true, opacity: .14, roughness: .15, depthWrite: false });
  box(4.2, 2.85, .05, -3.7, 1.95, 6, glass); box(4.2, 2.85, .05, 3.7, 1.95, 6, glass);
  for (const x of [-3.7, 3.7]) {
    cylinder(.56, .88, x, .52, 4.95, stone); cylinder(.57, .025, x, .97, 4.95, brass);
    product('tote', x, .985, 4.95, 0);
    mesh(new THREE.TorusGeometry(.09, .012, 8, 24, Math.PI), brass, x, 1.40, 4.95);
  }
  box(12.3, 1.1, .5, 0, 4.05, 6, dark); placard('ATELIER / EVERYDAY', 'A CONSIDERED COLLECTION', 8, .85, 0, 4.05, 6.27, '#172821', '#d1b889');
  box(12.2, .10, 1.15, 0, 3.43, 6.5, charcoal); box(12.2, .035, .035, 0, 3.39, 7.06, brass);
  placard('WELCOME', 'DISCOVER THE COLLECTION', 1.15, .5, 1.0, 1.8, 6.05, '#e9e2d5', '#554c3b');
  for (const x of [-7, 7]) {
    cylinder(.43, .65, x, .31, 6, terracotta); cylinder(.035, 1.35, x, 1.1, 6, wood);
    for (let i = 0; i < 26; i++) {
      const angle = i * 2.4, radius = .15 + (i % 4) * .09;
      const leaf = mesh(new THREE.SphereGeometry(1, 8, 6), green, x + Math.cos(angle) * radius, 1.25 + (i % 6) * .13, 6 + Math.sin(angle) * radius);
      leaf.scale.set(.20, .055, .09); leaf.rotation.set(i * .5, angle, i * .4);
    }
  }
  placard('The considered collection', 'OBJECTS FOR EVERY DAY', 3.5, .7, -3.6, 3.45, -5.9, '#e9e2d5', '#554c3b');
  for (const z of [-1.8, -6.8, -9.8]) {
    cylinder(.018, .65, 0, 4.15, z, brass);
    mesh(new THREE.TorusGeometry(.55, .026, 8, 48), brass, 0, 3.75, z).rotation.x = Math.PI / 2;
    const diffuser = mesh(new THREE.SphereGeometry(.19, 20, 16), mat('#fff1d6', { emissive: '#fff1d6', emissiveIntensity: .9 }), 0, 3.77, z);
    diffuser.scale.y = .7; diffuser.castShadow = false;
  }

  // Stocked shelves: products have actual world-space anchors for accessible inventory hotspots.

  for (const x of [-4.6, 4.6]) {
    for (const z of [-.5, -6]) box(.045, 3.1, .06, x - .7, 1.55, z, brass), box(.045, 3.1, .06, x + .7, 1.55, z, brass);
    for (const y of [.35, 1.3, 2.25]) {
      box(1.6, .12, 6.2, x, y, -3.2, wood);
      box(1.61, .022, 6.21, x, y + .061, -3.2, brass);
      storeCatalog.forEach((item, index) => {
        const z = -1.3 - index * 2;
        for (const offset of [0, -.48, .48]) {
          const model = product(item.kind, x, y + .066, z + offset, x < 0 ? Math.PI / 2 : -Math.PI / 2);
          if (x < 0 && y === .35 && offset === (item.kind === 'bottle' ? -.48 : 0)) featureAnchors[index] = model.anchor;
        }
      });
    }
  }
  rounded(2.6, .95, 1.7, .1, -.8, .47, -2.7, wood); rounded(2.8, .12, 1.9, .05, -.8, 1, -2.7, stone);
  product('tote', -1.6, 1.065, -2.7, -.1);
  product('coffee', -.92, 1.065, -2.7, .1);
  product('coffee', -.57, 1.065, -2.7, .2);
  product('bottle', -.08, 1.065, -2.7, .15);
  placard('Everyday, elevated.', '', 1.6, .23, -.8, .65, -1.83, '#71513a', '#dfcda9');

  function person(options: Parameters<typeof createStorePerson>[0], x: number, z: number, rotation = 0) {
    const result = createStorePerson(options, { geometries, materials }); result.group.position.set(x, .1, z); result.group.rotation.y = rotation; world.add(result.group); return result;
  }
  const browserA = person({ jacket: '#768073', skin: '#b47f62', hair: '#312522', longHair: true, trousers: '#d1c6b3' }, -3.3, -6.3, -1.1);
  const browserB = person({ jacket: '#d4c6b0', skin: '#e1b590', hair: '#665144', trousers: '#605b52' }, 3, -1.25, 1.1);
  const customer = person({ jacket: '#46525b', skin: '#cca17f', hair: '#3c3029', trousers: '#303438' }, .8, -.25, Math.PI);
  const customerPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(.8, .1, -.25), new THREE.Vector3(1.35, .1, -.7),
    new THREE.Vector3(1.5, .1, -4.5), new THREE.Vector3(.75, .1, -6.5),
  ]);
  const merchant = person({ jacket: '#35433c', skin: '#9c7057', hair: '#24211d', merchant: true }, 1.5, -8.95, 0);

  rounded(4.4, 1.08, 1.25, .14, 1.6, .54, -8, wood);
  for (let x = -.45; x < 3.7; x += .11) cylinder(.032, .96, x, .59, -7.375, wood);
  rounded(4.65, .13, 1.5, .065, 1.6, 1.145, -8, stone);
  const basket = new THREE.Group(); world.add(basket);
  product('tote', 2.75, 1.215, -7.7, 0, basket);
  product('coffee', 3.15, 1.215, -7.7, 0, basket);
  box(4.3, .035, .025, 1.6, .12, -7.35, brass);
  placard('ATELIER / EVERYDAY', 'A MORE CONSIDERED CHECKOUT', 1.8, .28, 1.6, .69, -7.328, '#71513a', '#e5d3ad');
  rounded(.36, .035, .25, .035, 1.1, 1.23, -7.7, brass);
  box(.055, .2, .075, 1.1, 1.34, -7.7, brass);
  rounded(.56, .61, .037, .025, 1.1, 1.7, -7.67, charcoal);
  const qrTexture = new THREE.CanvasTexture(qr); qrTexture.colorSpace = THREE.SRGBColorSpace; textures.add(qrTexture);
  const qrMaterial = new THREE.MeshBasicMaterial({ map: qrTexture }); materials.add(qrMaterial);
  mesh(new THREE.PlaneGeometry(.38, .38), qrMaterial, 1.1, 1.74, -7.646);
  placard('Scan to pay', '64 USDC / DEMO', .46, .12, 1.1, 1.475, -7.645, '#eee8dc', '#263a30');
  const qrTarget = new THREE.Vector3(1.1, 1.74, -7.644);
  // Device dimensions match a large smartphone, with its screen toward the shopper and rear lens toward the terminal.
  const phone = new THREE.Group(); customer.phoneGrip.add(phone);
  rounded(.095, .19, .012, .007, 0, 0, 0, brass, phone);
  rounded(.089, .183, .013, .006, 0, 0, 0, charcoal, phone);
  const rearLens = mesh(new THREE.SphereGeometry(.008, 16, 12), mat('#182c37', { metalness: .6, roughness: .1 }), -.027, .063, .009, phone);
  rearLens.scale.z = .36;
  for (const y of [.045, .077]) { const lens = cylinder(.006, .004, -.013, y, .009, charcoal, phone); lens.rotation.x = Math.PI / 2; }
  function phoneUI(kind: 'scan' | 'review' | 'paid') {
    const surface = document.createElement('canvas'); surface.width = 360; surface.height = 720;
    const ctx = surface.getContext('2d')!; ctx.fillStyle = '#f5f0e6'; ctx.fillRect(0, 0, 360, 720);
    ctx.textAlign = 'center'; ctx.fillStyle = '#294136'; ctx.font = '20px Arial'; ctx.fillText('ATELIER / EVERYDAY', 180, 75);
    if (kind === 'scan') {
      ctx.drawImage(qr, 45, 190, 270, 270); ctx.strokeStyle = '#9b804b'; ctx.lineWidth = 5; ctx.strokeRect(37, 182, 286, 286);
      ctx.font = '24px Arial'; ctx.fillText('Align the code', 180, 545);
    } else {
      ctx.font = '52px Georgia'; ctx.fillText('64 USDC', 180, 240);
      ctx.font = '23px Arial'; ctx.fillText(kind === 'paid' ? 'Payment confirmed' : 'Review payment', 180, 310);
      ctx.font = '17px Arial'; ctx.fillText('Everyday tote + house coffee', 180, 355);
      ctx.fillStyle = kind === 'paid' ? '#477252' : '#263d33'; ctx.fillRect(30, 490, 300, 80);
      ctx.fillStyle = '#fff9eb'; ctx.font = '25px Arial'; ctx.fillText(kind === 'paid' ? 'Confirmed' : 'Confirm 64 USDC', 180, 539);
    }
    ctx.fillStyle = '#78786b'; ctx.font = '16px Arial'; ctx.fillText('WORKSHOP DEMONSTRATION', 180, 665);
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture); return texture;
  }
  const phoneTextures = [phoneUI('scan'), phoneUI('review'), phoneUI('paid')];
  const phoneScreenMaterial = new THREE.MeshBasicMaterial({ map: phoneTextures[0] }); materials.add(phoneScreenMaterial);
  const phoneScreen = mesh(new THREE.PlaneGeometry(.082, .172), phoneScreenMaterial, 0, 0, -.007, phone); phoneScreen.rotation.y = Math.PI;
  rounded(.025, .007, .002, .003, 0, .076, -.008, charcoal, phone);
  const scanGeometry = new THREE.BufferGeometry(); scanGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3)); geometries.add(scanGeometry);
  const guideMaterial = new THREE.LineBasicMaterial({ color: '#d6bd86', transparent: true, opacity: .28 }); materials.add(guideMaterial);
  const scanGuides = new THREE.LineSegments(scanGeometry, guideMaterial); world.add(scanGuides);
  const scanLine = box(.36, .003, .002, 1.1, 1.74, -7.64, mat('#b5d6be', { emissive: '#8cb29b', emissiveIntensity: .6 }));
  const settledSign = placard('Payment received', '64 USDC / ILLUSTRATIVE', 1.9, .47, 1.5, 2.7, -9.3, '#e9e2d5', '#294136'); settledSign.visible = false;
  const transfer = new THREE.Group(); world.add(transfer);
  const coins = Array.from({ length: 9 }, () => mesh(new THREE.SphereGeometry(.035, 12, 8), mat('#e3c990', { emissive: '#d99c3b', emissiveIntensity: .25, metalness: .6, roughness: .3 }), 0, 0, 0, transfer));
  const transferCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(1.05, 1.55, -7), new THREE.Vector3(.4, 2.8, -7.7), new THREE.Vector3(1.5, 1.65, -8.95));
  const trailMaterial = mat('#f3dba0', { transparent: true, opacity: .5 });
  mesh(new THREE.TubeGeometry(transferCurve, 32, .014, 6, false), trailMaterial, 0, 0, 0, transfer);

  // A doorway leads into the stockroom; no fake camera cuts or intersecting walls.
  box(8.8, 4.3, .2, -1.6, 2.15, -11.7, cream); box(.8, 4.3, .2, 5.6, 2.15, -11.7, cream);
  const arch = new THREE.Shape(); arch.moveTo(-1.7, .22); arch.lineTo(1.7, .22); arch.lineTo(1.7, 2.5); arch.absarc(0, 2.5, 1.7, 0, Math.PI, false); arch.closePath();
  mesh(new THREE.ShapeGeometry(arch, 48), green, .7, 0, -11.575);
  for (const x of [-.94, 2.34]) { box(.024, 2.3, .018, x, 1.4, -11.55, brass); }
  const archTrim = mesh(new THREE.TorusGeometry(1.64, .012, 8, 64, Math.PI), brass, .7, 2.5, -11.55);
  archTrim.castShadow = false;
  placard('ATELIER', 'E V E R Y D A Y', 2.1, .6, .7, 3.10, -11.54, '#283c34', '#d6bf91');
  box(2.4, .65, .2, 4, 3.97, -11.7, green); placard('STOCKROOM', '', 1.95, .38, 4, 3.9, -11.57);
  placard('KEEP THE BUSINESS MOVING', 'INVENTORY  /  PEOPLE  /  THE NEXT DAY', 8, .9, 0, 3.4, -20.84);
  const carton = mat('#c4a174');
  for (const x of [-4.2, -.9]) {
    for (const z of [-15.1, -19]) { box(.09, 3.2, .1, x - 1.1, 1.6, z, dark); box(.09, 3.2, .1, x + 1.1, 1.6, z, dark); }
    for (const y of [.25, 1.35, 2.45]) { box(2.5, .13, 4.7, x, y, -17.2, charcoal); for (let i = 0; i < 4; i++) { box(.85, .65, .82, x, y + .39, -15.5 - i, carton); box(.1, .66, .83, x, y + .39, -15.5 - i, cream); } }
  }
  box(2.3, 1, 1.1, 3.5, .5, -18, wood); box(1, .06, .6, 3.5, 1.05, -18, charcoal);
  const payroll = placard('PAYROLL', 'AVAILABLE FUNDS → YOUR PEOPLE', 1.65, .8, 3.5, 1.66, -18, '#b5e0bc', '#173d37');
  const inventory = placard('RESTOCK', 'AVAILABLE FUNDS → INVENTORY', 2, .8, -.9, 3.4, -16.4, '#e8c68b', '#503c26');
  const warehouseFlows = new THREE.Group(); world.add(warehouseFlows);
  const warehouseRoutes = [new THREE.Vector3(-.9, 2.7, -16.4), new THREE.Vector3(3.5, 1.6, -18)].map(dest => {
    const path = new THREE.QuadraticBezierCurve3(new THREE.Vector3(3.9, 1.8, -12.5), new THREE.Vector3(2, 3.3, -15), dest);
    const route = new THREE.Group(); warehouseFlows.add(route);
    mesh(new THREE.TubeGeometry(path, 24, .025, 6, false), mat('#82d9b0', { emissive: '#336850', emissiveIntensity: .4 }), 0, 0, 0, route);
    const pulses = Array.from({ length: 7 }, () => mesh(new THREE.SphereGeometry(.09, 10, 8), brass, 0, 0, 0, route));
    return { route, path, pulses };
  });
  const anchorPosition = new THREE.Vector3();
  let width = 1, height = 1, payrollFocus = 0, scanElapsed = 0, previousRender = 0, previousReplay = 0;
  function resize(w: number, h: number) { width = w; height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < 650 ? 80 : 48; camera.updateProjectionMatrix(); }
  function render(progress: number, time: number, still: boolean, fundsUse: 'inventory' | 'payroll' = 'inventory', replay = 0) {
    const p = THREE.MathUtils.clamp(progress, 0, 5);
    const elapsed = Math.min(80, Math.max(0, time - previousRender)) / 1000; previousRender = time;
    street.update(p, elapsed, still);
    if (p < 2.4 || replay !== previousReplay) { scanElapsed = 0; previousReplay = replay; }
    if (!still && p >= 2.85 && p < 3.5) scanElapsed = Math.min(10, scanElapsed + elapsed);
    const scanProgress = Math.max(scanElapsed / 10, THREE.MathUtils.smoothstep(p, 3.03, 3.75));
    const scanPhase = scanProgress < .18 ? 0 : scanProgress < .45 ? 1 : scanProgress < .82 ? 2 : 3;
    let index = poses.findIndex((pose, i) => i < poses.length - 1 && p >= pose.at && p < poses[i + 1].at); if (index < 0) index = poses.length - 2;
    const a = poses[index], b = poses[index + 1]; const t = THREE.MathUtils.smoothstep(p, a.at, b.at);
    camera.position.lerpVectors(new THREE.Vector3(...a.eye), new THREE.Vector3(...b.eye), t);
    const focusTarget = fundsUse === 'payroll' ? 1 : 0;
    payrollFocus = still ? focusTarget : THREE.MathUtils.lerp(payrollFocus, focusTarget, .12);
    const look = new THREE.Vector3(...a.look).lerp(new THREE.Vector3(...b.look), t);
    look.x += payrollFocus * THREE.MathUtils.smoothstep(p, 4.65, 5) * 3;
    camera.lookAt(look);
    const walk = THREE.MathUtils.smoothstep(p, 1.2, 2.65);
    customer.group.position.copy(customerPath.getPoint(walk));
    const heading = customerPath.getTangent(walk);
    customer.group.rotation.y = walk < .98 ? Math.atan2(heading.x, heading.z) : Math.PI;
    const lift = THREE.MathUtils.smoothstep(p, 2.55, 2.9);
    const tap = THREE.MathUtils.smoothstep(scanProgress, .68, .79) * (1 - THREE.MathUtils.smoothstep(scanProgress, .88, .98));
    customer.pose(walk * 45, walk > 0 && walk < 1 && !still, lift, -.05 * lift, tap);
    browserA.pose(0, false, 0, still ? -.25 : -.25 + Math.sin(time * .00025) * .08);
    browserB.pose(0, false, 0, still ? .2 : .2 + Math.sin(time * .0003) * .07);
    merchant.pose(0, false, 0, -.18);
    phone.visible = p > 2.55 && p < 4.55;
    basket.visible = p >= 2.15;
    customer.group.updateMatrixWorld(true);
    const lensPosition = aimCameraAtQr(phone, rearLens, qrTarget);
    scanGuides.visible = scanLine.visible = p >= 2.9 && p < 3.5 && scanPhase === 1;
    const guidePositions = scanGeometry.attributes.position;
    [[-.18, -.18], [.18, -.18], [.18, .18], [-.18, .18]].forEach(([dx, dy], i) => {
      guidePositions.setXYZ(i * 2, lensPosition.x, lensPosition.y, lensPosition.z);
      guidePositions.setXYZ(i * 2 + 1, qrTarget.x + dx, qrTarget.y + dy, qrTarget.z);
    });
    guidePositions.needsUpdate = true; scanGuides.frustumCulled = false;
    scanLine.position.y = 1.56 + (still ? .5 : (scanElapsed * .65) % 1) * .36;
    phoneScreenMaterial.map = phoneTextures[scanPhase < 2 ? 0 : scanPhase === 2 ? 1 : 2];
    roofMaterial.opacity = 1 - THREE.MathUtils.smoothstep(p, .72, .96); roof.visible = p < .96;
    transfer.visible = p >= 3.35 && p < 4.6; settledSign.visible = p >= 3.95 && p < 4.65;
    coins.forEach((coin, i) => coin.position.copy(transferCurve.getPoint((i / coins.length + (still ? .15 : time * .00022)) % 1)));
    warehouseFlows.visible = p > 4.65; payroll.visible = inventory.visible = p > 4.5;
    warehouseRoutes.forEach(({ route, path, pulses }, index) => {
      route.visible = index === (fundsUse === 'inventory' ? 0 : 1);
      pulses.forEach((pulse, i) => pulse.position.copy(path.getPoint((i / pulses.length + (still ? .1 : time * .00018)) % 1)));
    });
    renderer.render(world, camera);
    const points = featureAnchors.map(anchor => { const point = anchor.getWorldPosition(anchorPosition).clone().project(camera); return { x: (point.x + 1) / 2 * width, y: (-point.y + 1) / 2 * height, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < .94 && Math.abs(point.y) < .85 }; });
    return { points, scanPhase };
  }
  function dispose() { geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); environment.dispose(); renderer.dispose(); }
  return { resize, render, dispose };
}
