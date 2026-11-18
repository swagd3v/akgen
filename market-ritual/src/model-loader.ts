export type ModelMesh = {
  positions: Float32Array;
  normals: Float32Array;
  vertexCount: number;
};

function normalizeMesh(positions: number[], normals: number[]): ModelMesh {
  if (!positions.length) throw new Error('The model contains no renderable triangles.');
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const scale = 2 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - center[0]) * scale;
    positions[i + 1] = (positions[i + 1] - center[1]) * scale;
    positions[i + 2] = (positions[i + 2] - center[2]) * scale;
  }
  if (normals.length !== positions.length) {
    normals.length = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i];
      const ay = positions[i + 4] - positions[i + 1];
      const az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i];
      const by = positions[i + 7] - positions[i + 1];
      const bz = positions[i + 8] - positions[i + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz) || 1;
      for (let point = 0; point < 3; point += 1) normals.push(nx / length, ny / length, nz / length);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), vertexCount: positions.length / 3 };
}

export function parseOBJ(source: string): ModelMesh {
  const vertices: number[][] = [];
  const sourceNormals: number[][] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) vertices.push(line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number));
    else if (line.startsWith('vn ')) sourceNormals.push(line.slice(3).trim().split(/\s+/).slice(0, 3).map(Number));
    else if (line.startsWith('f ')) {
      const points = line.slice(2).trim().split(/\s+/).map((token) => {
        const [vertex, , normal] = token.split('/');
        const vertexIndex = Number(vertex);
        const normalIndex = normal ? Number(normal) : 0;
        return {
          vertex: vertices[vertexIndex < 0 ? vertices.length + vertexIndex : vertexIndex - 1],
          normal: normalIndex ? sourceNormals[normalIndex < 0 ? sourceNormals.length + normalIndex : normalIndex - 1] : undefined,
        };
      });
      for (let index = 1; index < points.length - 1; index += 1) {
        for (const point of [points[0], points[index], points[index + 1]]) {
          if (!point.vertex) continue;
          positions.push(...point.vertex);
          if (point.normal) normals.push(...point.normal);
        }
      }
    }
  }
  return normalizeMesh(positions, normals);
}

const componentSize: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const typeSize: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json: any, binary: ArrayBuffer, accessorIndex: number): number[] {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const values: number[] = [];
  const components = typeSize[accessor.type];
  const bytes = componentSize[accessor.componentType];
  const stride = view.byteStride || components * bytes;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const data = new DataView(binary);
  const read = (position: number) => {
    switch (accessor.componentType) {
      case 5120: return data.getInt8(position);
      case 5121: return data.getUint8(position);
      case 5122: return data.getInt16(position, true);
      case 5123: return data.getUint16(position, true);
      case 5125: return data.getUint32(position, true);
      default: return data.getFloat32(position, true);
    }
  };
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) values.push(read(offset + item * stride + component * bytes));
  }
  return values;
}

function meshFromGLTF(json: any, binary: ArrayBuffer): ModelMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const mesh of json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const sourcePositions = readAccessor(json, binary, primitive.attributes.POSITION);
      const sourceNormals = primitive.attributes.NORMAL !== undefined ? readAccessor(json, binary, primitive.attributes.NORMAL) : [];
      const expanded = primitive.indices !== undefined
        ? readAccessor(json, binary, primitive.indices)
        : Array.from({ length: sourcePositions.length / 3 }, (_, index) => index);
      for (const index of expanded) {
        positions.push(sourcePositions[index * 3], sourcePositions[index * 3 + 1], sourcePositions[index * 3 + 2]);
        if (sourceNormals.length) normals.push(sourceNormals[index * 3], sourceNormals[index * 3 + 1], sourceNormals[index * 3 + 2]);
      }
    }
  }
  return normalizeMesh(positions, normals);
}

export async function parseModel(blob: Blob, format: string): Promise<ModelMesh> {
  if (format === 'obj') return parseOBJ(await blob.text());
  const buffer = await blob.arrayBuffer();
  if (format === 'glb') {
    const header = new DataView(buffer);
    if (header.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB header.');
    let offset = 12;
    let json: any;
    let binary = new ArrayBuffer(0);
    while (offset < buffer.byteLength) {
      const length = header.getUint32(offset, true);
      const type = header.getUint32(offset + 4, true);
      const chunk = buffer.slice(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      if (type === 0x004e4942) binary = chunk;
      offset += 8 + length;
    }
    if (!json) throw new Error('GLB JSON chunk missing.');
    return meshFromGLTF(json, binary);
  }
  if (format === 'gltf') {
    const json = JSON.parse(new TextDecoder().decode(buffer));
    const uri = json.buffers?.[0]?.uri;
    if (!uri?.startsWith('data:')) throw new Error('Only embedded single-file GLTF is supported; use GLB for external buffers.');
    const base64 = uri.slice(uri.indexOf(',') + 1);
    const decoded = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return meshFromGLTF(json, decoded.buffer);
  }
  throw new Error(`Unsupported model format: ${format}`);
}

export function createFallbackMesh(): ModelMesh {
  const faces = [
    [-1,-1,1, 1,-1,1, 1,1,1, -1,-1,1, 1,1,1, -1,1,1],
    [1,-1,-1, -1,-1,-1, -1,1,-1, 1,-1,-1, -1,1,-1, 1,1,-1],
    [-1,-1,-1, -1,-1,1, -1,1,1, -1,-1,-1, -1,1,1, -1,1,-1],
    [1,-1,1, 1,-1,-1, 1,1,-1, 1,-1,1, 1,1,-1, 1,1,1],
    [-1,1,1, 1,1,1, 1,1,-1, -1,1,1, 1,1,-1, -1,1,-1],
    [-1,-1,-1, 1,-1,-1, 1,-1,1, -1,-1,-1, 1,-1,1, -1,-1,1],
  ];
  return normalizeMesh(faces.flat(), []);
}
