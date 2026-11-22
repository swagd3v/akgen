// Copies the skeleton and first-person clips out of the 48 MB CS2 AK-47 into
// a small JSON file, so the classic AK-47 can be animated without loading it.
//   npm run rig
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const CLIPS = {
  Idle: 'firstperson_idle', Draw: 'firstperson_draw', Reload: 'firstperson_reload', Fire: 'firstperson_shoot1',
};
// (The inspect is not here: the weapon's own bones stay still in it, and
// all of its motion belongs to the arms, which this model does not include.)
const SIZES = {SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16};

const file = await readFile(`${root}assets/ak47-cs2.glb`);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);

/** A float accessor as a flat array, rounded to keep the JSON small. */
function floats(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView], size = SIZES[accessor.type];
  if (accessor.componentType !== 5126 || !size) throw Error(`Accessor ${index} is not a float array.`);
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || size * 4;
  const out = [];
  for (let i = 0; i < accessor.count; i++) for (let k = 0; k < size; k++) out.push(Number(binary.readFloatLE(start + i * stride + k * 4).toPrecision(7)));
  return out;
}

const skin = gltf.skins[0];
const parents = new Map();
gltf.nodes.forEach((node, index) => (node.children || []).forEach(child => parents.set(child, index)));

// Every joint plus the chain of ancestors that positions the skeleton.
const kept = [];
function keep(index) {
  if (kept.includes(index)) return;
  if (parents.has(index)) keep(parents.get(index));
  kept.push(index);
}
skin.joints.forEach(keep);

const inverseBinds = floats(skin.inverseBindMatrices);
const nodes = kept.map(index => {
  const node = gltf.nodes[index], joint = skin.joints.indexOf(index);
  return {
    name: node.name, parent: parents.has(index) ? kept.indexOf(parents.get(index)) : -1,
    ...(node.matrix ? {matrix: node.matrix} : {}),
    ...(node.translation ? {translation: node.translation} : {}),
    ...(node.rotation ? {rotation: node.rotation} : {}),
    ...(node.scale ? {scale: node.scale} : {}),
    ...(joint >= 0 ? {inverseBind: inverseBinds.slice(joint * 16, joint * 16 + 16)} : {}),
  };
});

const clips = Object.entries(CLIPS).map(([label, name]) => {
  const animation = gltf.animations.find(candidate => candidate.name === name);
  if (!animation) throw Error(`The CS2 weapon is missing ${name}.`);
  const tracks = animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler], node = kept.indexOf(channel.target.node);
    if (node < 0) throw Error(`${name} animates a node outside the skeleton.`);
    if ((sampler.interpolation || 'LINEAR') === 'CUBICSPLINE') throw Error(`${name} uses spline keys, which this extractor does not convert.`);
    return {node, path: channel.target.path, step: sampler.interpolation === 'STEP', times: floats(sampler.input), values: floats(sampler.output)};
  });
  return {name: label, source: name, duration: Math.max(...tracks.map(track => track.times.at(-1))), tracks};
});

const rig = {source: 'assets/ak47-cs2.glb', attribution: gltf.asset.extras || {}, nodes, clips};
await writeFile(`${root}assets/ak47-rig.json`, JSON.stringify(rig));
console.log(`Wrote assets/ak47-rig.json: ${nodes.length} nodes, ${clips.map(clip => `${clip.name} ${clip.duration.toFixed(2)}s`).join(', ')}.`);
