import * as THREE from 'three';
import {GLTFLoader} from '../../vendor/loaders/GLTFLoader.js';

// Preserve the supplied POV rig's authored pose, rather than moving its wrists.
export async function createHands(meshes) {
  const source = (await new GLTFLoader().loadAsync('./assets/pov-grip.glb')).scene;
  source.updateMatrixWorld(true);
  const referenceGun = [], arms = [];
  source.traverse(object => {
    if (object.isMesh) (object.isSkinnedMesh ? arms : referenceGun).push(object);
  });
  if (referenceGun.length !== 2 || arms.length !== 3) throw Error('The POV reference does not match its grip calibration.');
  const referenceBox = new THREE.Box3(), editableBox = new THREE.Box3();
  referenceGun.forEach(mesh => referenceBox.expandByObject(mesh));
  meshes.forEach(mesh => editableBox.expandByObject(mesh));
  // Both supplied AKs use +Y up and +Z toward the muzzle. One uniform
  // registration keeps the authored hand-to-weapon relationship intact.
  const scale = editableBox.getSize(new THREE.Vector3()).z / referenceBox.getSize(new THREE.Vector3()).z;
  const group = new THREE.Group(); group.name = 'reference-pov-grip';
  group.scale.setScalar(scale);
  group.position.copy(editableBox.getCenter(new THREE.Vector3())).sub(referenceBox.getCenter(new THREE.Vector3()).multiplyScalar(scale));
  group.add(source);
  referenceGun.forEach(mesh => { mesh.visible = false; });
  // The uploaded reference has no embedded textures. Preserve its geometry
  // and skin weights with simple bare-arm, fabric and glove materials.
  for (const [index, mesh] of arms.entries()) {
    mesh.frustumCulled = false;
    mesh.material.color.set([0xc69d80, 0x38463b, 0x242e29][index]);
    mesh.material.roughness = .85; mesh.material.metalness = 0;
  }
  group.updateMatrixWorld(true);
  const referenceCamera = source.getObjectByName('Camera');
  if (!referenceCamera) throw Error('The POV reference camera is missing.');
  group.userData.cameraPosition = referenceCamera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(.6, .15, -.35)).toArray();
  group.userData.source = 'pov-grip.glb';
  return group;
}
