// Keep the weapon's native UVs, weights and materials; paint only its color.
export function prepareCS2Weapon(gltf) {
  gltf.scene.userData.attribution = {...gltf.asset.extras};
  const names = ['firstperson_idle', 'firstperson_draw', 'firstperson_reload', 'firstperson_shoot1', 'firstperson_lookat01'];
  const labels = ['Idle', 'Draw', 'Reload', 'Fire', 'Inspect'];
  const clips = names.map((name, index) => {
    const source = gltf.animations.find(clip => clip.name === name);
    if (!source) throw Error(`The CS2 weapon is missing ${name}.`);
    const clip = source.clone(); clip.name = labels[index]; return clip;
  });
  const meshes = []; gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 1 || !meshes[0].isSkinnedMesh || !meshes[0].material.map) throw Error('The CS2 weapon does not match the supplied model.');
  const mesh = meshes[0], texture = mesh.material.map, image = texture.image;
  const base = document.createElement('canvas'); base.width = image.width; base.height = image.height;
  const ctx = base.getContext('2d');
  // Atlas canvases use bottom-up UV coordinates; glTF images use flipY=false.
  if (!texture.flipY) { ctx.translate(0, base.height); ctx.scale(1, -1); }
  ctx.drawImage(image, 0, 0);
  mesh.userData.zone = 'Weapon'; mesh.frustumCulled = false;
  const material = mesh.material;
  return {meshes, clips, atlasOptions: {zones: ['Weapon'], baseImage: base}, originalMaterial: {
    color: material.color.clone(), metalness: material.metalness, roughness: material.roughness,
    metalnessMap: material.metalnessMap, roughnessMap: material.roughnessMap,
  }};
}
