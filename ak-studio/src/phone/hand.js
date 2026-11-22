// The rigged right hand (assets/phone/rigged-hand.glb). Its one clip opens
// and closes the hand; a pose is built by blending each finger joint part of
// the way from the open hand to the fist.
import * as THREE from 'three';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const JOINTS = ['base', '01', '02', '03'];

export class RiggedHand {
  constructor(gltf) {
    this.root = gltf.scene;
    this.nodes = [];
    this.root.traverse(object => {
      this.nodes.push(object);
      if (object.isLight || object.isCamera) object.visible = false;
      if (object.isSkinnedMesh) { this.mesh = object; object.frustumCulled = false; }
    });
    if (!this.mesh || !gltf.animations.length) throw Error('The hand model is missing its skin or its animation.');
    /** bones[finger] = [base, first, second, third joint] */
    this.bones = Object.fromEntries(FINGERS.map(finger => [finger, JOINTS.map(joint => {
      const bone = this.nodes.find(node => new RegExp(`^${finger}_${joint}R_\\d+$`).test(node.name));
      if (!bone) throw Error(`The hand rig has no ${finger} ${joint} bone.`);
      return bone;
    })]));

    // Read the open hand and the tightest fist out of the clip.
    const clip = gltf.animations[0], mixer = new THREE.AnimationMixer(this.root);
    mixer.clipAction(clip).play();
    const snapshot = () => this.nodes.map(node => ({position: node.position.clone(), quaternion: node.quaternion.clone()}));
    mixer.setTime(0); this.open = snapshot();
    const curling = FINGERS.slice(1).flatMap(finger => this.bones[finger]).map(bone => this.nodes.indexOf(bone));
    let tightest = -1;
    for (let step = 1; step < 80; step++) {
      mixer.setTime(clip.duration * step / 80);
      const closed = curling.reduce((total, index) => total + this.nodes[index].quaternion.angleTo(this.open[index].quaternion), 0);
      if (closed > tightest) { tightest = closed; this.fist = snapshot(); }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(this.root);
    this.pose({});
  }

  /**
   * @param curl  {finger: [base, first, second, third]} with 0 the open hand
   *              and 1 the fist for each joint. Missing fingers stay open.
   */
  pose(curl) {
    this.nodes.forEach((node, index) => { node.position.copy(this.open[index].position); node.quaternion.copy(this.open[index].quaternion); });
    for (const finger of FINGERS) (curl[finger] || []).forEach((amount, joint) => {
      const bone = this.bones[finger][joint], index = this.nodes.indexOf(bone);
      bone.position.lerpVectors(this.open[index].position, this.fist[index].position, amount);
      bone.quaternion.slerpQuaternions(this.open[index].quaternion, this.fist[index].quaternion, amount);
    });
    this.root.updateMatrixWorld(true);
  }

  /** World position of a fingertip: the end of the finger's last bone. */
  tip(finger, target = new THREE.Vector3()) {
    const bone = this.bones[finger][3];
    return target.copy(bone.children[0]?.position || new THREE.Vector3(0, .2, 0)).applyMatrix4(bone.matrixWorld);
  }

  /**
   * Bends a finger's joints until its tip reaches a world position. A small
   * CCD solver; each step is capped so the finger curls instead of snapping.
   * @param joints  which of the finger's bones may move, as indexes
   */
  reach(finger, target, joints = [1, 2, 3], iterations = 20) {
    const chain = joints.map(joint => this.bones[finger][joint]), tip = new THREE.Vector3(), origin = new THREE.Vector3();
    const delta = new THREE.Quaternion(), parent = new THREE.Quaternion(), local = new THREE.Quaternion(), identity = new THREE.Quaternion();
    for (let iteration = 0; iteration < iterations; iteration++) for (const bone of [...chain].reverse()) {
      this.root.updateMatrixWorld(true);
      bone.getWorldPosition(origin);
      const current = this.tip(finger, tip).sub(origin).normalize(), wanted = target.clone().sub(origin).normalize();
      delta.setFromUnitVectors(current, wanted);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
      if (angle > .15) delta.slerp(identity, 1 - .15 / angle);
      bone.parent.getWorldQuaternion(parent);
      local.copy(parent).invert().multiply(delta).multiply(parent);
      bone.quaternion.premultiply(local).normalize();
    }
    this.root.updateMatrixWorld(true);
  }
}
