import * as THREE from 'three';

/** Align the rear camera's optical axis, including its offset from the phone centre. */
export function aimCameraAtQr(phone: THREE.Object3D, lens: THREE.Object3D, target: THREE.Vector3) {
  const lensPosition = new THREE.Vector3(), phonePosition = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    phone.updateWorldMatrix(true, true);
    lens.getWorldPosition(lensPosition); phone.getWorldPosition(phonePosition);
    phone.lookAt(phonePosition.add(target.clone().sub(lensPosition)));
  }
  lens.getWorldPosition(lensPosition);
  return lensPosition;
}
