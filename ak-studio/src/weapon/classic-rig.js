// Animates the multi-part classic AK-47 with the CS2 AK-47's skeleton.
//
// Both models are the same Counter-Strike rifle at the same size, and the CS2
// skin weights are fully rigid (each vertex follows exactly one bone). So the
// classic parts need no skinning: each one is simply parented to the bone that
// moves the matching piece of the CS2 weapon.
import * as THREE from 'three';

// Classic part name -> the CS2 bone that carries it. Everything else rides
// the weapon bone.
const WEAPON_BONE = 'weapon_hand_r';
const PART_BONES = {MAGAZINE: 'clip', BULLETS: 'clip', BOLT: 'bolt', TRIGGER: 'trigger'};
const INCHES_PER_METRE = 39.37;
// The classic bolt mesh reaches further back than the CS2 one, so at full
// travel it would poke out behind the receiver. This fraction keeps it inside.
const BOLT_TRAVEL = .35;
const TRACKS = {translation: ['position', THREE.VectorKeyframeTrack], rotation: ['quaternion', THREE.QuaternionKeyframeTrack], scale: ['scale', THREE.VectorKeyframeTrack]};

/** The rig's key for a node: "weapon_hand_r_3" -> "weapon_hand_r", "v_weapon_ak47_clip_0" -> "clip". */
const boneKey = name => name.replace(/_\d+$/, '').replace(/^v_weapon_ak47_/, '');

/**
 * Puts the freshly loaded classic model in its "grip frame": eight units
 * long, centred on the origin, +Y up and +Z to the muzzle. The first-person
 * hands are authored against the weapon in this frame. Returns the matrix
 * from the grip frame back to the model's own space, which is in inches.
 */
export function standClassic(classic, meshes) {
  classic.updateMatrixWorld(true);
  const box = new THREE.Box3(); meshes.forEach(mesh => box.expandByObject(mesh));
  const scale = 8 / box.getSize(new THREE.Vector3()).z;
  classic.scale.setScalar(scale);
  classic.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
  classic.updateMatrixWorld(true);
  return classic.matrixWorld.clone().invert();
}

/**
 * Moves the meshes of a classic model (already stood in its grip frame, with
 * `toInches` as returned by standClassic) onto a copy of the CS2 skeleton.
 *
 * The result's `grip` group is that same grip frame, carried by the weapon
 * bone: anything added to it, such as hands, follows the weapon through
 * every clip.
 */
export function rigClassic(meshes, rig, toInches) {
  const root = new THREE.Group(); root.name = 'classic_ak47_rig';
  const nodes = rig.nodes.map(source => {
    const node = source.inverseBind ? new THREE.Bone() : new THREE.Group();
    node.name = `rig_${source.name.replace(/[^\w]+/g, '_')}`;
    if (source.matrix) new THREE.Matrix4().fromArray(source.matrix).decompose(node.position, node.quaternion, node.scale);
    if (source.translation) node.position.fromArray(source.translation);
    if (source.rotation) node.quaternion.fromArray(source.rotation);
    if (source.scale) node.scale.fromArray(source.scale);
    return node;
  });
  rig.nodes.forEach((source, index) => (source.parent < 0 ? root : nodes[source.parent]).add(nodes[index]));

  // Grip frame -> CS2 mesh space. The classic model is authored in inches
  // around the same origin as the CS2 mesh, which is in metres.
  const toMesh = new THREE.Matrix4().makeScale(1 / INCHES_PER_METRE, 1 / INCHES_PER_METRE, 1 / INCHES_PER_METRE).multiply(toInches);

  // One "grip frame" group per bone, placed exactly as skinning would place
  // the CS2 vertices bound to that bone.
  const frames = new Map();
  rig.nodes.forEach((source, index) => {
    if (!source.inverseBind) return;
    const frame = new THREE.Group(); frame.name = `${nodes[index].name}_parts`;
    new THREE.Matrix4().fromArray(source.inverseBind).multiply(toMesh).decompose(frame.position, frame.quaternion, frame.scale);
    nodes[index].add(frame); frames.set(boneKey(source.name), frame);
  });
  const grip = frames.get(WEAPON_BONE);
  if (!grip || Object.values(PART_BONES).some(key => !frames.has(key))) throw Error('The animation rig does not match the classic AK-47.');

  for (const mesh of meshes) {
    const local = mesh.matrixWorld.clone();
    (frames.get(PART_BONES[mesh.name.toUpperCase()]) || grip).add(mesh);
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
  }

  const clips = rig.clips.map(clip => new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.map(track => {
    const [property, Track] = TRACKS[track.path], source = rig.nodes[track.node];
    if (boneKey(source.name) === 'bolt' && track.path === 'translation') {
      const rest = source.translation;
      track = {...track, values: track.values.map((value, index) => rest[index % 3] + (value - rest[index % 3]) * BOLT_TRAVEL)};
    }
    return new Track(`${nodes[track.node].name}.${property}`, track.times, track.values, track.step ? THREE.InterpolateDiscrete : THREE.InterpolateLinear);
  })));
  return {root, grip, clips};
}
