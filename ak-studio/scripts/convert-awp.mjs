// Converts the AWP's Wavefront OBJ into assets/awp.glb, split into paintable
// parts. The OBJ is one object, so parts are found by welding it into its
// disconnected pieces and sorting those by where they sit on the rifle.
//   npm run awp -- path/to/weapon_snip_awp.obj [--pieces]
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv.slice(2).find(argument => !argument.startsWith('--'));
if (!source) { console.error('Usage: npm run awp -- path/to/weapon_snip_awp.obj'); process.exit(1); }

const PARTS = ['Body', 'Barrel', 'Scope', 'Bolt & Magazine', 'Bipod'];

/**
 * The part a piece belongs to. The rifle is in inches with +Y up and +Z to
 * the muzzle; `min`/`max` are the piece's bounds and `centre` their middle.
 * The stock, grip, butt pad and receiver are one welded shell: the Body.
 */
function partFor({min, max, centre}) {
  if (min[1] > 5.15) return 'Scope';                                   // tube, turrets, rings and rail
  if (max[2] > 30) return 'Barrel';                                    // barrel and muzzle brake
  if (min[2] > 16.9 && max[1] < 3.7) return 'Bipod';                   // folded legs under the fore-end
  if (min[0] < -1.7 && centre[2] > 0 && centre[2] < 9) return 'Bolt & Magazine';                        // bolt and handle
  if (min[2] > 4.4 && max[2] < 8.3 && max[1] < 3.9 && Math.abs(centre[0]) < .3) return 'Bolt & Magazine'; // magazine and rounds
  if (min[2] > 2.2 && max[2] < 3 && max[1] < 2.5) return 'Bolt & Magazine';                              // trigger
  return 'Body';
}

// ---------------------------------------------------------------- read

const positions = [], uvs = [], normals = [], corners = [];
for (const line of (await readFile(source, 'utf8')).split(/\r?\n/)) {
  const [kind, ...values] = line.trim().split(/\s+/);
  if (kind === 'v') positions.push(values.slice(0, 3).map(Number));
  else if (kind === 'vt') uvs.push(values.slice(0, 2).map(Number));
  else if (kind === 'vn') normals.push(values.slice(0, 3).map(Number));
  else if (kind === 'f') {
    const face = values.map(value => value.split('/').map(index => Number(index) - 1));
    if (face.some(corner => corner.length < 3 || corner.some(Number.isNaN))) throw Error('Every face needs positions, UVs and normals.');
    for (let i = 1; i < face.length - 1; i++) corners.push(face[0], face[i], face[i + 1]);
  }
}
if (!corners.length) throw Error('No faces found in the OBJ.');

// ---------------------------------------------------------------- pieces

// UV seams duplicate vertices, so weld by position before looking for pieces.
const welded = new Map(), weldOf = positions.map(position => {
  const key = position.map(value => value.toFixed(4)).join(',');
  if (!welded.has(key)) welded.set(key, welded.size);
  return welded.get(key);
});
const parent = Array.from({length: welded.size}, (_, index) => index);
const find = index => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
for (let i = 0; i < corners.length; i += 3) {
  const first = find(weldOf[corners[i][0]]);
  for (const k of [1, 2]) parent[find(weldOf[corners[i + k][0]])] = first;
}
const pieces = new Map();
for (let i = 0; i < corners.length; i += 3) {
  const id = find(weldOf[corners[i][0]]);
  if (!pieces.has(id)) pieces.set(id, {triangles: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
  const piece = pieces.get(id); piece.triangles.push(i);
  for (const k of [0, 1, 2]) positions[corners[i + k][0]].forEach((value, axis) => {
    piece.min[axis] = Math.min(piece.min[axis], value); piece.max[axis] = Math.max(piece.max[axis], value);
  });
}
const triangles = new Map(PARTS.map(part => [part, []]));
for (const piece of pieces.values()) {
  piece.centre = piece.min.map((value, axis) => (value + piece.max[axis]) / 2);
  piece.part = partFor(piece);
  triangles.get(piece.part).push(...piece.triangles);
}
if (process.argv.includes('--pieces')) {
  const show = values => values.map(value => value.toFixed(1).padStart(6)).join('');
  for (const piece of [...pieces.values()].sort((a, b) => b.triangles.length - a.triangles.length)) {
    console.log(String(piece.triangles.length).padStart(6), show(piece.min), ' ..', show(piece.max), ' ', piece.part);
  }
}

// ---------------------------------------------------------------- write

const chunks = []; let byteLength = 0;
const gltf = {
  asset: {version: '2.0', generator: 'AK Studio convert-awp'},
  scene: 0, scenes: [{nodes: PARTS.map((_, index) => index)}],
  nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [],
};
function accessor(array, type, target, bounds = false) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength), size = {SCALAR: 1, VEC2: 2, VEC3: 3}[type];
  gltf.bufferViews.push({buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target});
  chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4)); byteLength += bytes.length + (4 - bytes.length % 4) % 4;
  const entry = {bufferView: gltf.bufferViews.length - 1, componentType: array instanceof Uint32Array ? 5125 : 5126, count: array.length / size, type};
  if (bounds) {
    entry.min = [Infinity, Infinity, Infinity]; entry.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < array.length; i++) { entry.min[i % 3] = Math.min(entry.min[i % 3], array[i]); entry.max[i % 3] = Math.max(entry.max[i % 3], array[i]); }
  }
  gltf.accessors.push(entry);
  return gltf.accessors.length - 1;
}

for (const part of PARTS) {
  const list = triangles.get(part);
  if (!list.length) throw Error(`No pieces were sorted into ${part}.`);
  const vertexOf = new Map(), position = [], normal = [], uv = [], index = [];
  for (const start of list) for (const k of [0, 1, 2]) {
    const [p, t, n] = corners[start + k], key = `${p}/${t}/${n}`;
    if (!vertexOf.has(key)) {
      vertexOf.set(key, vertexOf.size);
      position.push(...positions[p]); normal.push(...normals[n]);
      uv.push(uvs[t][0], 1 - uvs[t][1]);                    // OBJ measures V from the bottom, glTF from the top
    }
    index.push(vertexOf.get(key));
  }
  gltf.meshes.push({name: part, primitives: [{
    attributes: {
      POSITION: accessor(new Float32Array(position), 'VEC3', 34962, true),
      NORMAL: accessor(new Float32Array(normal), 'VEC3', 34962),
      TEXCOORD_0: accessor(new Float32Array(uv), 'VEC2', 34962),
    },
    indices: accessor(new Uint32Array(index), 'SCALAR', 34963),
  }]});
  gltf.nodes.push({name: part, mesh: gltf.meshes.length - 1});
}
gltf.buffers.push({byteLength});

let json = Buffer.from(JSON.stringify(gltf)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binary = Buffer.concat(chunks), header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + binary.length, 8);
jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
await writeFile(`${root}assets/awp.glb`, Buffer.concat([header, jsonHeader, json, binaryHeader, binary]));
console.log(`Wrote assets/awp.glb: ${pieces.size} pieces, ${PARTS.map(part => `${part} ${triangles.get(part).length} triangles`).join(', ')}.`);
