// The AWP: a static model converted from an OBJ by scripts/convert-awp.mjs,
// which writes one mesh per paintable part, named after the part.
import * as THREE from 'three';

// Part -> factory colour. The model ships without a texture, so the factory
// finish is the rifle's familiar olive furniture and black metal.
const FACTORY = {
  Body: '#4c5a3c', Barrel: '#26282a', Scope: '#1f2123', 'Bolt & Magazine': '#34373a', Bipod: '#2b2d2f',
};
export const AWP_ZONES = Object.keys(FACTORY);

export function prepareAWP(gltf) {
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  for (const mesh of meshes) {
    // GLTFLoader tidies node names ("Bolt & Magazine" loses its ampersand), so match loosely.
    const tidy = name => name.replace(/[^a-z]/gi, '').toLowerCase();
    mesh.userData.zone = AWP_ZONES.find(zone => tidy(zone) === tidy(mesh.name));
    if (!mesh.userData.zone) throw Error(`Unmapped AWP part: ${mesh.name}`);
    mesh.material.dispose();
    mesh.material = new THREE.MeshStandardMaterial({roughness: .68, metalness: .13, side: THREE.DoubleSide});
  }
  if (meshes.length !== AWP_ZONES.length) throw Error('The AWP model does not match its part list. Run "npm run awp" again.');
  return {meshes, atlasOptions: {zones: AWP_ZONES, colors: {...FACTORY}}};
}
