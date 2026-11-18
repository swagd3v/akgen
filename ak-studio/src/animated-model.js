import * as THREE from 'three';

export const ANIMATED_ZONES = ['Metal Body', 'Magazines', 'Wood Fittings'];

function mainBone(mesh, vertex) {
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  let best = 0, result = 0;
  for (let i = 0; i < 4; i++) if (weights.getComponent(vertex, i) > best) {
    best = weights.getComponent(vertex, i); result = indices.getComponent(vertex, i);
  }
  return mesh.skeleton.bones[result].name;
}

// Subset all attributes together: positions, weights, normals, tangents and
// original UVs must remain in sync for animation and material maps.
function subset(source, vertices) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const data = new attr.array.constructor(vertices.length * attr.itemSize);
    vertices.forEach((v, i) => { for (let k = 0; k < attr.itemSize; k++) data[i * attr.itemSize + k] = attr.array[v * attr.itemSize + k]; });
    out.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
  }
  return out;
}

function metalUV(geometry, zone) {
  const original = geometry.attributes.uv, data = [];
  // Repeated/out-of-range source UV islands retain their periodic layout.
  // The square uses 1536px of a 2048px atlas; the right strip is for wood.
  for (let i = 0; i < original.count; i++) {
    const wrap = value => ((value % 1) + 1) % 1;
    data.push((4 + wrap(original.getX(i)) * 1528) / 2048, (4 + wrap(original.getY(i)) * 1528) / 2048);
  }
  // A few small source faces also have collapsed UVs. Put those faces into
  // padded box charts in the unused top band instead of leaving them unpaintable.
  const p = geometry.attributes.position, buckets = Array.from({length: 6}, () => []);
  for (let i = 0; i < p.count; i += 3) {
    const area = (data[(i+1)*2]-data[i*2])*(data[(i+2)*2+1]-data[i*2+1])-(data[(i+1)*2+1]-data[i*2+1])*(data[(i+2)*2]-data[i*2]);
    if (Math.abs(area) > 1e-10) continue;
    const a = new THREE.Vector3().fromBufferAttribute(p,i), b = new THREE.Vector3().fromBufferAttribute(p,i+1), c = new THREE.Vector3().fromBufferAttribute(p,i+2);
    const n = b.sub(a).cross(c.sub(a)).toArray();
    let axis=0; for(let k=1;k<3;k++)if(Math.abs(n[k])>Math.abs(n[axis]))axis=k;
    buckets[axis*2+(n[axis]<0?1:0)].push(i,i+1,i+2);
  }
  buckets.forEach((indices, chart) => {
    if (!indices.length) return;
    const axes=[[1,2],[0,2],[0,1]][Math.floor(chart/2)];
    const points=indices.map(i=>[p.getComponent(i,axes[0]),p.getComponent(i,axes[1])]);
    const min=[Math.min(...points.map(v=>v[0])),Math.min(...points.map(v=>v[1]))];
    const range=[Math.max(...points.map(v=>v[0]))-min[0],Math.max(...points.map(v=>v[1]))-min[1]];
    const scale=Math.min(248/Math.max(range[0],1e-9),248/Math.max(range[1],1e-9));
    indices.forEach((index,j)=>{data[index*2]=(chart*256+128+(points[j][0]-min[0]-range[0]/2)*scale)/2048;data[index*2+1]=(1536+(zone==='Magazines'?256:0)+128+(points[j][1]-min[1]-range[1]/2)*scale)/2048;});
  });
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(data, 2));
}

// The source wood UVs are all zero. Box-project its triangles into six
// separate padded charts; leave the original channel untouched.
function woodUV(geometry) {
  const p = geometry.attributes.position, buckets = Array.from({length: 6}, () => []);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const n = b.sub(a).cross(c.sub(a)), values = n.toArray();
    let axis = 0; for (let k = 1; k < 3; k++) if (Math.abs(values[k]) > Math.abs(values[axis])) axis = k;
    buckets[axis * 2 + (values[axis] < 0 ? 1 : 0)].push(i, i + 1, i + 2);
  }
  const data = new Float32Array(p.count * 2);
  buckets.forEach((indices, chart) => {
    if (!indices.length) return;
    const axes = [[1, 2], [0, 2], [0, 1]][Math.floor(chart / 2)];
    const points = indices.map(i => [p.getComponent(i, axes[0]), p.getComponent(i, axes[1])]);
    const min = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
    const range = [Math.max(...points.map(p => p[0])) - min[0], Math.max(...points.map(p => p[1])) - min[1]];
    const scale = Math.min(504 / Math.max(range[0], 1e-9), 332 / Math.max(range[1], 1e-9));
    const startX = 1536 + 256 - range[0] * scale / 2, startY = chart * 341 + 170 - range[1] * scale / 2;
    indices.forEach((i, j) => { data[i * 2] = (startX + (points[j][0] - min[0]) * scale) / 2048; data[i * 2 + 1] = (startY + (points[j][1] - min[1]) * scale) / 2048; });
  });
  geometry.setAttribute('uv1', new THREE.BufferAttribute(data, 2));
}

export function prepareAnimated(root) {
  const all = []; root.traverse(o => { if (o.isSkinnedMesh) all.push(o); });
  const arms = all.filter(m => m.material.name === 'arms');
  const body = all.find(m => m.material.name === 'aks74u');
  const wood = all.find(m => m.material.name === 'aks74u.wood');
  if (!body || !wood || arms.length !== 1) throw Error('The animated model does not match its material and rig configuration.');
  const geometry = body.geometry.index ? body.geometry.toNonIndexed() : body.geometry.clone();
  const originalGeometry = body.geometry; body.geometry = geometry;
  const groups = {'Metal Body': [], Magazines: []};
  for (let i = 0; i < geometry.attributes.position.count; i += 3) {
    const magazine = [0, 1, 2].filter(k => /wpn_magazine_(?:2_)?07[24]$/.test(mainBone(body, i + k))).length >= 2;
    groups[magazine ? 'Magazines' : 'Metal Body'].push(i, i + 1, i + 2);
  }
  const paintMeshes = [], colors = {};
  for (const [zone, vertices] of Object.entries(groups)) {
    if (!vertices.length) throw Error(`No paintable triangles found for ${zone}.`);
    const mesh = body.clone(false); mesh.name = `Paint_${zone.replaceAll(' ', '_')}`;
    mesh.geometry = subset(geometry, vertices); metalUV(mesh.geometry, zone);
    mesh.material = body.material.clone(); colors[zone] = mesh.material.color.getStyle(); mesh.material.color.set('#ffffff');
    mesh.userData.zone = zone; mesh.frustumCulled = false; body.parent.add(mesh); paintMeshes.push(mesh);
  }
  body.parent.remove(body); geometry.dispose(); originalGeometry.dispose(); body.material.dispose();
  wood.geometry = wood.geometry.index ? wood.geometry.toNonIndexed() : wood.geometry.clone();
  woodUV(wood.geometry); wood.userData.zone = 'Wood Fittings'; colors['Wood Fittings'] = wood.material.color.getStyle(); wood.material.color.set('#ffffff');
  wood.frustumCulled = false; paintMeshes.push(wood);
  all.forEach(mesh => { mesh.frustumCulled = false; });
  return {paintMeshes, arms, colors};
}
