// Projects flat side-view artwork onto a weapon's UV atlas.
//
// Collaging directly in UV space chops every image along UV island borders,
// which is why skins made from many images looked like confetti. Here the
// artwork is composed on the weapon's left and right side profiles instead,
// and the GPU then works out, for every atlas texel, which point of that
// artwork lies on the surface there. Images stay whole and run straight
// across part boundaries.
import * as THREE from 'three';
import {SIZE} from './generator.js';
import {randomFromSeed} from '../../shared/random.js';

export const SILHOUETTE_WIDTH = 384;
export const DESIGN_WIDTH = 2048;

/** Unit eigenvector of a symmetric 3 x 3 matrix with the smallest eigenvalue (cyclic Jacobi). */
function narrowestAxis(m) {
  const a = m.map(row => [...row]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-12) continue;
    const theta = .5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(theta), s = Math.sin(theta);
    for (let k = 0; k < 3; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
    for (let k = 0; k < 3; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
    for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
  }
  const smallest = [0, 1, 2].reduce((best, i) => a[i][i] < a[best][best] ? i : best, 0);
  return new THREE.Vector3(v[0][smallest], v[1][smallest], v[2][smallest]).normalize();
}

/**
 * Captures the weapon in its current (assembled) pose as plain meshes whose
 * positions and normals are static, paired with their paint UVs. Skinned
 * meshes are resolved through their bones.
 *
 * Positions are in "profile space": +X out of the weapon's left side, +Z
 * toward the muzzle. First-person models are authored canted toward the
 * camera, so the weapon's own sideways axis is measured (the direction in
 * which its vertices spread least) rather than assumed. `basis` maps profile
 * space back to studio space, for anything that must face the weapon squarely.
 */
export function buildBakeModel(meshes, uvAttribute = 'uv') {
  const captured = [], point = new THREE.Vector3(), tip = new THREE.Vector3();
  const sum = [0, 0, 0], products = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let count = 0;
  for (const mesh of meshes) {
    if (mesh.userData.spare) continue;
    const source = mesh.geometry, position = source.attributes.position, normal = source.attributes.normal;
    const uv = source.attributes[uvAttribute];
    if (!uv) throw Error(`Missing UV coordinates for ${mesh.name}.`);
    if (!source.boundingSphere) source.computeBoundingSphere();
    const epsilon = source.boundingSphere.radius * 1e-3 || 1e-3;
    const positions = new Float32Array(position.count * 3), normals = new Float32Array(position.count * 3), coordinates = new Float32Array(uv.count * 2);
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index);
      // Push a second point along the normal through the same transform; the
      // difference is the posed normal, with no separate normal-matrix maths.
      tip.fromBufferAttribute(normal, index).multiplyScalar(epsilon).add(point);
      if (mesh.isSkinnedMesh) { mesh.applyBoneTransform(index, point); mesh.applyBoneTransform(index, tip); }
      point.applyMatrix4(mesh.matrixWorld); tip.applyMatrix4(mesh.matrixWorld).sub(point).normalize();
      point.toArray(positions, index * 3); tip.toArray(normals, index * 3);
      coordinates[index * 2] = uv.getX(index); coordinates[index * 2 + 1] = uv.getY(index);
      const xyz = [point.x, point.y, point.z];
      for (let i = 0; i < 3; i++) { sum[i] += xyz[i]; for (let j = 0; j < 3; j++) products[i][j] += xyz[i] * xyz[j]; }
      count++;
    }
    captured.push({mesh, positions, normals, coordinates});
  }

  const covariance = products.map((row, i) => row.map((value, j) => value / count - sum[i] / count * sum[j] / count));
  const sideways = narrowestAxis(covariance);
  if (sideways.x < 0) sideways.negate();
  // Keep the muzzle direction as close to studio +Z as the sideways axis allows.
  const forward = new THREE.Vector3(0, 0, 1).addScaledVector(sideways, -sideways.z).normalize();
  const basis = new THREE.Matrix4().makeBasis(sideways, new THREE.Vector3().crossVectors(forward, sideways), forward);
  const toProfile = new THREE.Matrix3().setFromMatrix4(basis).transpose();

  const bounds = new THREE.Box3(), baked = [];
  for (const {mesh, positions, normals, coordinates} of captured) {
    for (const array of [positions, normals]) for (let i = 0; i < array.length; i += 3) point.fromArray(array, i).applyMatrix3(toProfile).toArray(array, i);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(coordinates, 2));
    // Leave out triangles a model flagged as stretched across the atlas
    // (see animated-model.js): drawn, they would smear over other islands.
    const stretched = mesh.geometry.userData.stretched;
    if (stretched?.size) geometry.setIndex(Array.from({length: positions.length / 3}, (_, i) => i).filter(i => !stretched.has(i - i % 3)));
    else if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox);
    const copy = new THREE.Mesh(geometry);
    copy.frustumCulled = false; copy.userData.zone = mesh.userData.zone;
    baked.push(copy);
  }

  // The artwork frame is the side profile plus a margin as deep as half the
  // weapon's width: faces on top wrap that far "over the edge" of the profile.
  const size = bounds.getSize(new THREE.Vector3()), wrap = size.x / 2, margin = wrap + size.z * .01;
  const frame = {
    zFar: bounds.max.z + margin, yTop: bounds.max.y + margin,
    width: size.z + margin * 2, height: size.y + margin * 2,
    xMin: bounds.min.x, xMax: bounds.max.x, xMid: (bounds.min.x + bounds.max.x) / 2, wrap,
  };
  const design = {width: DESIGN_WIDTH, height: Math.round(DESIGN_WIDTH * frame.height / frame.width)};
  return {meshes: baked, bounds, frame, design, basis, mirrored: sidesShareTexels(baked), silhouettes: new Map()};
}

/**
 * Many game models texture both flanks from the same UV islands. Painting
 * the two sides differently is impossible there (each texel shows on both),
 * so such weapons get one design, mirrored on the far side. Detected by
 * rasterising left-facing and right-facing triangles into the atlas and
 * measuring how much they overlap.
 */
function sidesShareTexels(meshes) {
  const resolution = 512, masks = [];
  for (const direction of [1, -1]) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = resolution;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.beginPath();
    for (const mesh of meshes) {
      const {normal, uv} = mesh.geometry.attributes, index = mesh.geometry.index, count = index ? index.count : uv.count;
      for (let i = 0; i < count; i += 3) {
        const corners = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
        if (corners.reduce((total, vertex) => total + normal.getX(vertex), 0) * direction < 1.2) continue;
        corners.forEach((vertex, k) => {
          const x = uv.getX(vertex) * resolution, y = (1 - uv.getY(vertex)) * resolution;
          k ? context.lineTo(x, y) : context.moveTo(x, y);
        });
        context.closePath();
      }
    }
    context.fill('nonzero');
    masks.push(readMask(context, resolution, resolution));
  }
  let left = 0, right = 0, both = 0;
  for (let i = 0; i < masks[0].length; i++) { left += masks[0][i]; right += masks[1][i]; both += masks[0][i] & masks[1][i]; }
  return both > Math.min(left, right) * .3;
}

function readMask(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data, mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 96 ? 1 : 0;
  return mask;
}

function mirrored(silhouette) {
  const {width, height} = silhouette;
  const flip = mask => {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = mask[y * width + width - 1 - x];
    return out;
  };
  const {x0, x1, y0, y1} = silhouette.box;
  return {width, height, core: flip(silhouette.core), valid: flip(silhouette.valid), box: {x0: width - x1, x1: width - x0, y0, y1}, thickness: silhouette.thickness};
}

/**
 * Low-resolution side profiles used to plan layouts: `core` is the weapon's
 * outline seen from the side, `valid` is that outline grown by the wrap depth
 * (the area artwork must cover for wrapped faces to stay painted) and
 * `thickness` its average height. Pass a zone to get the profile of one part only.
 */
export function silhouettesFor(model, zone = null) {
  const key = zone || '*';
  if (model.silhouettes.has(key)) return model.silhouettes.get(key);
  const {frame} = model, width = SILHOUETTE_WIDTH, height = Math.max(8, Math.round(width * frame.height / frame.width));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const scale = width / frame.width;
  context.beginPath();
  for (const mesh of model.meshes) {
    if (zone && mesh.userData.zone !== zone) continue;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => {
        const vertex = index ? index.getX(i + k) : i + k;
        return [(frame.zFar - position.getZ(vertex)) * scale, (frame.yTop - position.getY(vertex)) * scale];
      });
      // Near and far faces project with opposite winding and would cancel
      // each other under the nonzero fill rule, so wind every triangle alike.
      const clockwise = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      context.moveTo(...a); context.lineTo(...(clockwise ? b : c)); context.lineTo(...(clockwise ? c : b));
      context.closePath();
    }
  }
  context.fillStyle = context.strokeStyle = '#fff';
  context.fill('nonzero');
  const core = readMask(context, width, height);
  context.lineJoin = 'round'; context.lineWidth = frame.wrap * scale * 2;
  context.stroke();
  const valid = readMask(context, width, height);
  const box = {x0: width, y0: height, x1: 0, y1: 0};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (core[y * width + x]) {
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x + 1); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y + 1);
  }
  if (box.x1 <= box.x0) throw Error(`Nothing to paint for ${zone || 'this weapon'}.`);
  // Average height of the outline along its length: the natural size unit for artwork.
  const thickness = core.reduce((total, value) => total + value, 0) / (box.x1 - box.x0);
  const left = {width, height, core, valid, box, thickness};
  const result = {left, right: mirrored(left)};
  model.silhouettes.set(key, result);
  return result;
}

/**
 * A SIZE x SIZE canvas marking where paint would rub off first: the weapon's
 * hard, outward-pointing edges, drawn into the atlas as chipped strokes.
 *
 * Edges are found on the geometry itself. Corners are welded by position, so
 * an edge is recognised even where the model splits it for a UV seam, and it
 * counts as worn when its two faces meet at a sharp convex angle. Each such
 * edge is stroked on both faces' UVs, broken into pieces of random strength.
 */
export function wearMaskFor(model) {
  if (model.wear) return model.wear;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d'), random = randomFromSeed('edge-wear');
  context.lineCap = 'round'; context.strokeStyle = context.fillStyle = '#fff';
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  const SHARP = Math.cos(THREE.MathUtils.degToRad(38));

  for (const mesh of model.meshes) {
    const {position, uv} = mesh.geometry.attributes, index = mesh.geometry.index;
    const corner = i => index ? index.getX(i) : i, count = index ? index.count : position.count;
    const welded = new Map(), weld = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.round(position.getX(i) * 2500)},${Math.round(position.getY(i) * 2500)},${Math.round(position.getZ(i) * 2500)}`;
      if (!welded.has(key)) welded.set(key, welded.size);
      weld[i] = welded.get(key);
    }
    const edges = new Map();
    for (let i = 0; i < count; i += 3) {
      const corners = [corner(i), corner(i + 1), corner(i + 2)];
      a.fromBufferAttribute(position, corners[0]); b.fromBufferAttribute(position, corners[1]); c.fromBufferAttribute(position, corners[2]);
      normal.crossVectors(b.sub(a), c.sub(a));
      if (normal.lengthSq() < 1e-14) continue;
      normal.normalize();
      for (let k = 0; k < 3; k++) {
        const from = corners[k], to = corners[(k + 1) % 3], low = Math.min(weld[from], weld[to]), high = Math.max(weld[from], weld[to]);
        if (low === high) continue;
        const key = low * 4194304 + high, face = {from, to, opposite: corners[(k + 2) % 3], normal: normal.toArray()};
        edges.has(key) ? edges.get(key).push(face) : edges.set(key, [face]);
      }
    }
    for (const faces of edges.values()) {
      if (faces.length !== 2) continue;
      const [first, second] = faces, cosine = first.normal[0] * second.normal[0] + first.normal[1] * second.normal[1] + first.normal[2] * second.normal[2];
      if (cosine > SHARP) continue;
      // Convex if the far corner of one face lies behind the other face's plane.
      a.fromBufferAttribute(position, first.from); b.fromBufferAttribute(position, second.opposite).sub(a);
      if (b.x * first.normal[0] + b.y * first.normal[1] + b.z * first.normal[2] > -1e-5) continue;
      if (a.distanceTo(c.fromBufferAttribute(position, first.to)) < .02) continue;
      const sharpness = Math.min(1, (1 - cosine) / 1.2);
      for (const face of faces) {
        const x0 = uv.getX(face.from) * SIZE, y0 = (1 - uv.getY(face.from)) * SIZE, x1 = uv.getX(face.to) * SIZE, y1 = (1 - uv.getY(face.to)) * SIZE;
        const pieces = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12));
        for (let piece = 0; piece < pieces; piece++) {
          const strength = random(), width = random();
          if (strength < .3) continue;
          const startX = x0 + (x1 - x0) * piece / pieces, startY = y0 + (y1 - y0) * piece / pieces;
          context.globalAlpha = Math.min(1, (.35 + strength * .65) * (.6 + sharpness * .4));
          context.lineWidth = 3 + width * 10 * (.5 + sharpness * .5);
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(x0 + (x1 - x0) * (piece + 1) / pieces, y0 + (y1 - y0) * (piece + 1) / pieces);
          context.stroke();
          // A stray chip beside the heavier scuffs keeps the edge from looking ruled.
          if (strength > .8) {
            context.beginPath();
            context.arc(startX + (random() - .5) * 16, startY + (random() - .5) * 16, 1.5 + random() * 3.5, 0, Math.PI * 2);
            context.fill();
          }
        }
      }
    }
  }
  return model.wear = canvas;
}

const VERTEX = /* glsl */`
  varying vec3 vPosition;
  varying vec3 vNormal;
  void main() {
    vPosition = position;
    vNormal = normal;
    // Draw each triangle where it lives in the atlas, top row first.
    gl_Position = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  }`;

const FRAGMENT = /* glsl */`
  uniform sampler2D leftDesign;
  uniform sampler2D rightDesign;
  uniform vec4 frame;   // zFar, yTop, 1 / width, 1 / height
  uniform vec4 depth;   // xMin, xMax, xMid, wrap
  uniform float mirrored;
  varying vec3 vPosition;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    // +X is the weapon's left side. Faces that clearly look sideways take that
    // side's artwork; top, bottom and end faces split along the centre line.
    float side = abs(n.x) > 0.35 ? sign(n.x) : (vPosition.x >= depth.z ? 1.0 : -1.0);
    float inward = clamp(side > 0.0 ? depth.y - vPosition.x : vPosition.x - depth.x, 0.0, depth.w);
    // Wrap: a face turned away from the side continues the artwork past the
    // profile's edge by its distance from that side, instead of smearing.
    // Faces that do look sideways are projected flat, so bevels and rivets
    // on a flank cannot ripple the image.
    inward *= smoothstep(0.3, 0.75, 1.0 - abs(n.x));
    float z = vPosition.z + n.z * inward;
    float y = vPosition.y + n.y * inward;
    float s = (frame.x - z) * frame.z;
    float t = (frame.y - y) * frame.w;
    vec4 left = texture2D(leftDesign, vec2(s, t));
    vec4 right = texture2D(rightDesign, vec2(1.0 - s, t));
    // When both flanks share texels they must agree, so the right side
    // shows the left design straight through (mirrored).
    gl_FragColor = side > 0.0 || mirrored > 0.5 ? left : right;
  }`;

function designTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  // Raw bytes in, raw bytes out: the artwork is already sRGB and must come
  // back unchanged. Premultiplied alpha keeps transparent edges fringe-free.
  texture.colorSpace = THREE.NoColorSpace; texture.flipY = false; texture.premultiplyAlpha = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.anisotropy = 4;
  return texture;
}

export class Projector {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {depthBuffer: false, generateMipmaps: false});
    this.buffer = new Uint8Array(SIZE * SIZE * 4);
    this.camera = new THREE.Camera();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: {leftDesign: {value: null}, rightDesign: {value: null}, frame: {value: new THREE.Vector4()}, depth: {value: new THREE.Vector4()}, mirrored: {value: 0}},
    });
  }

  /** Returns a SIZE x SIZE canvas holding the artwork as it lands on the given meshes' UVs. */
  bake(meshes, frame, leftCanvas, rightCanvas, mirrored = false) {
    const {renderer, material} = this;
    const left = designTexture(leftCanvas), right = designTexture(rightCanvas);
    material.uniforms.leftDesign.value = left; material.uniforms.rightDesign.value = right;
    material.uniforms.frame.value.set(frame.zFar, frame.yTop, 1 / frame.width, 1 / frame.height);
    material.uniforms.depth.value.set(frame.xMin, frame.xMax, frame.xMid, frame.wrap);
    material.uniforms.mirrored.value = mirrored ? 1 : 0;
    const scene = new THREE.Scene();
    for (const mesh of meshes) { mesh.material = material; scene.add(mesh); }

    const previousTarget = renderer.getRenderTarget(), previousColor = renderer.getClearColor(new THREE.Color()), previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, this.camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.buffer);
    } finally {
      renderer.setRenderTarget(previousTarget); renderer.setClearColor(previousColor, previousAlpha);
      left.dispose(); right.dispose();
    }

    const raw = document.createElement('canvas'); raw.width = raw.height = SIZE;
    const image = new ImageData(SIZE, SIZE), out = image.data, data = this.buffer;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (!alpha) continue;
      const unmultiply = 255 / alpha;
      out[i] = data[i] * unmultiply; out[i + 1] = data[i + 1] * unmultiply; out[i + 2] = data[i + 2] * unmultiply; out[i + 3] = alpha;
    }
    raw.getContext('2d').putImageData(image, 0, 0);

    // Grow the result by two texels so island edges, where GPU and canvas
    // rasterisation disagree by a pixel, never show the finish underneath.
    const grown = document.createElement('canvas'); grown.width = grown.height = SIZE;
    const context = grown.getContext('2d');
    for (const radius of [2, 1]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      context.drawImage(raw, dx * radius, dy * radius);
    }
    context.drawImage(raw, 0, 0);
    return grown;
  }

  dispose() {
    this.target.dispose(); this.material.dispose();
  }
}
