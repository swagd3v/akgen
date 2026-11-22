import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const file = await readFile(new URL('../assets/awp.glb', import.meta.url));
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const binary = file.subarray(28 + jsonLength);
const PARTS = ['Body', 'Barrel', 'Scope', 'Bolt & Magazine', 'Bipod'];

function floats(index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView], size = {VEC2: 2, VEC3: 3}[accessor.type];
  return new Float32Array(binary.buffer, binary.byteOffset + view.byteOffset, accessor.count * size);
}

test('the AWP is one mesh per paintable part', () => {
  assert.equal(file.readUInt32LE(0), 0x46546c67);
  assert.equal(file.readUInt32LE(8), file.length);
  assert.deepEqual(gltf.meshes.map(mesh => mesh.name), PARTS);
  assert.deepEqual(gltf.nodes.map(node => node.name), PARTS);
});

test('every part has positions, normals and UVs inside the sheet', () => {
  let triangles = 0;
  for (const mesh of gltf.meshes) {
    const {attributes, indices} = mesh.primitives[0];
    const position = floats(attributes.POSITION), normal = floats(attributes.NORMAL), uv = floats(attributes.TEXCOORD_0);
    assert.equal(position.length, normal.length);
    assert.equal(position.length / 3, uv.length / 2);
    assert.ok(uv.every(value => value >= 0 && value <= 1), `${mesh.name} has UVs off the sheet`);
    assert.ok(position.every(Number.isFinite) && normal.every(Number.isFinite));
    assert.equal(gltf.accessors[indices].count % 3, 0);
    triangles += gltf.accessors[indices].count / 3;
  }
  assert.equal(triangles, 39769, 'no triangles were lost in conversion');
});

test('the rifle keeps its shape: about 54 inches long, muzzle toward +Z, scope on top', () => {
  const bounds = name => gltf.accessors[gltf.meshes.find(mesh => mesh.name === name).primitives[0].attributes.POSITION];
  const length = bounds('Barrel').max[2] - bounds('Body').min[2];
  assert.ok(length > 53 && length < 55, `length ${length}`);
  assert.ok(bounds('Scope').min[1] > bounds('Bolt & Magazine').min[1]);
  assert.ok(bounds('Bipod').max[1] < bounds('Scope').min[1]);
});
