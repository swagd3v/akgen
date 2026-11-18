import * as THREE from 'three';
import {GLTFLoader} from '../vendor/loaders/GLTFLoader.js';

export const GLOVES = [
  ['hardknuckle', 'Hard-Knuckle'], ['hardknuckle-black', 'Black Hard-Knuckle'],
  ['fingerless', 'Fingerless'], ['fullfinger', 'Full-Finger'], ['original', 'Original Hands'],
];
export const SLEEVES = [['bare', 'Bare Arms'], ['fbi', 'FBI'], ['sas', 'SAS'], ['balkan', 'Balkan']];

function findBone(root, expression) {
  let result; root.traverse(o => { if (o.isBone && expression.test(o.name)) result = o; });
  if (!result) throw Error(`Missing hand joint: ${expression}`);
  return result;
}

function donorMap(record) {
  const root = record.id === 'ak47' ? record.hands : record.root, map = new Map();
  for (const side of ['l', 'r']) {
    const classic = record.id === 'ak47';
    const get = (native, valve) => findBone(root, classic ? new RegExp(`Bip01_${side.toUpperCase()}_${valve}_\\d+$`) : new RegExp(`^${native}_${side}_\\d+$`));
    map.set(`hand_${side}`, get('hand', 'Hand'));
    map.set(`arm_upper_${side}`, get('upperarm', 'UpperArm'));
    map.set(`arm_lower_${side}`, get('forearm', 'Forearm'));
    map.set(`arm_lower_${side}_twist`, get('forearm_twist_4', 'ForeTwist'));
    for (const [digit, number] of [['thumb', 1], ['index', 2], ['middle', 3], ['ring', 4], ['pinky', 5]]) {
      for (let segment = 0; segment < 3; segment++) {
        const native = digit === 'thumb' ? segment === 0 ? 'palm_1' : `finger_1${segment}` : `finger_${number}${segment + 1}`;
        const valve = `Finger${number - 1}${segment ? segment : ''}`;
        map.set(`finger_${digit}_${segment}_${side}`, get(native, valve));
      }
    }
  }
  return map;
}

function state(object) {
  return {position: object.getWorldPosition(new THREE.Vector3()), quaternion: object.getWorldQuaternion(new THREE.Quaternion()), scale: object.getWorldScale(new THREE.Vector3())};
}
function snapshot(root) {
  const out=[]; root.traverse(object=>out.push({object,position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone(),matrix:object.matrix.clone()})); return out;
}
function restore(list) {
  for(const item of list){item.object.position.copy(item.position);item.object.quaternion.copy(item.quaternion);item.object.scale.copy(item.scale);item.object.matrix.copy(item.matrix);}
}
function orientation(direction, normal) {
  const x=direction.clone().normalize(), z=normal.clone().addScaledVector(x,-normal.dot(x));
  if(z.lengthSq()<1e-8)z.copy(Math.abs(x.y)<.8?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1)).addScaledVector(x,-x.dot(Math.abs(x.y)<.8?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1)));
  z.normalize();const y=new THREE.Vector3().crossVectors(z,x).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
}
function palmNormal(states, side) {
  const forward=states.get(`finger_middle_0_${side}`).position.clone().sub(states.get(`hand_${side}`).position);
  const across=states.get(`finger_index_0_${side}`).position.clone().sub(states.get(`finger_pinky_0_${side}`).position);
  return new THREE.Vector3().crossVectors(forward,across).normalize();
}
function handLength(states,side) {
  const p=key=>states.get(key).position;
  return p(`hand_${side}`).distanceTo(p(`finger_middle_0_${side}`))+p(`finger_middle_0_${side}`).distanceTo(p(`finger_middle_1_${side}`))+p(`finger_middle_1_${side}`).distanceTo(p(`finger_middle_2_${side}`));
}
function calibrateMaterials(root) {
  const seen=new Set();
  root.traverse(mesh=>{
    if(!mesh.isMesh||seen.has(mesh.material))return;const material=mesh.material;seen.add(material);
    const original=material.roughnessMap;
    if(original){
      const image=original.image,c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,c.width,c.height);
      const floor=material.name.includes('bare_arm')?180:material.name.includes('sleeve')?185:163;
      for(let i=0;i<pixels.data.length;i+=4)pixels.data[i+1]=Math.max(floor,pixels.data[i+1]);
      ctx.putImageData(pixels,0,0);const texture=original.clone();texture.source=new THREE.Source(c);texture.needsUpdate=true;
      material.roughnessMap=texture;
      if(material.metalnessMap===original)material.metalnessMap=texture;
      if(material.aoMap===original)material.aoMap=texture;
    }
    // These presets represent cloth, rubber and leather, not metallic paint.
    material.metalness=0;material.roughness=1;material.color.multiplyScalar(.6);
  });
}

function disposeAssets(...roots) {
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
  for(const root of roots)root?.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);if(o.isSkinnedMesh)skeletons.add(o.skeleton);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}}});
  geometries.forEach(o=>o.dispose());materials.forEach(o=>o.dispose());textures.forEach(o=>o.dispose());skeletons.forEach(o=>o.dispose());
}

export class CS2Hands {
  static async create(record, appearance) {
    const loader=new GLTFLoader();
    const loaded=await Promise.allSettled([
      loader.loadAsync(`./assets/cs2/${appearance.glove}.glb`),
      appearance.sleeve==='bare'?Promise.resolve(null):loader.loadAsync(`./assets/cs2/${appearance.sleeve}.glb`),
    ]);
    const failed=loaded.find(result=>result.status==='rejected');
    if(failed){disposeAssets(...loaded.filter(result=>result.status==='fulfilled').map(result=>result.value?.scene));throw failed.reason;}
    const [glove,sleeve]=loaded.map(result=>result.value);
    try{return new CS2Hands(record,appearance,glove.scene,sleeve?.scene);}
    catch(error){disposeAssets(glove.scene,sleeve?.scene);throw error;}
  }

  constructor(record, appearance, glove, sleeve) {
    this.record=record;this.appearance={...appearance};this.group=new THREE.Group();this.group.name='CS2_Hands';this.group.visible=false;
    this.group.add(glove);record.container.add(this.group);record.container.updateMatrixWorld(true);
    this.bones=new Map();glove.traverse(o=>{if(o.isBone)this.bones.set(o.name,o);if(o.isMesh)o.frustumCulled=false;});
    this.donors=donorMap(record);
    this.sourceRest=new Map([...this.bones].map(([key,bone])=>[key,state(bone)]));
    // Sleeve assets use the same Source 2 bind space. Share the glove joints,
    // but retain a sleeve-specific inverse bind array and attribute indices.
    if(sleeve){
      this.group.add(sleeve);this.group.updateMatrixWorld(true);
      sleeve.traverse(mesh=>{
        if(!mesh.isSkinnedMesh)return;
        const bones=mesh.skeleton.bones.map(bone=>{const shared=this.bones.get(bone.name);if(!shared)throw Error(`Unmapped sleeve joint ${bone.name}`);return shared;});
        // Valve's exported inverse binds include a bind-shape/unit conversion.
        // Keep those matrices rather than recomputing them in studio space.
        mesh.bind(new THREE.Skeleton(bones,mesh.skeleton.boneInverses.map(matrix=>matrix.clone())),mesh.bindMatrix.clone());mesh.frustumCulled=false;
      });
      // Remove the old sleeve armature nodes: only the shared glove armature
      // drives the visible sleeve and its exported skin.
      const roots=[];sleeve.traverse(o=>{if(o.isBone&&!o.parent.isBone)roots.push(o);});roots.forEach(o=>o.removeFromParent());
    }
    calibrateMaterials(this.group);
    const saved=record.id==='aks74u'?snapshot(record.root):null;
    try {
    if(saved){restore(record.restTransforms);record.container.updateMatrixWorld(true);}
    this.donorRest=new Map([...this.donors].map(([key,bone])=>[key,state(bone)]));
    this.handScales={};this.corrections=new Map();this.locals=new Map();
    for(const side of ['l','r'])this.handScales[side]=handLength(this.donorRest,side)/handLength(this.sourceRest,side);
    for(const [key,bone] of this.bones){
      if(!this.donors.has(key))throw Error(`Unsupported CS2 hand joint ${key}`);
      const side=/_l(?:_twist)?$/.test(key)?'l':'r';this.locals.set(key,bone.position.clone());
      let correction=new THREE.Quaternion();
      {
        const sourceDirection=this.direction(key,this.bones,this.sourceRest,side,false);
        const targetDirection=this.direction(key,this.donors,this.donorRest,side,true);
        const src=orientation(sourceDirection,palmNormal(this.sourceRest,side));
        const dst=orientation(targetDirection,palmNormal(this.donorRest,side));
        correction.copy(this.donorRest.get(key).quaternion).invert().multiply(dst).multiply(src.invert()).multiply(this.sourceRest.get(key).quaternion);
      }
      this.corrections.set(key,correction);
    }
    // Unique names are essential when exporting the shared bone hierarchy.
    for(const [key,bone]of this.bones)bone.name=`CS2_${key}`;
    glove.name='CS2_GloveAsset';if(sleeve)sleeve.name='CS2_SleeveAsset';
    } finally { if(saved){restore(saved);record.container.updateMatrixWorld(true);} }
    this.update();
  }

  direction(key, bones, states, side, native) {
    const p=key=>states.get(key).position;
    if(key.startsWith('arm_upper'))return p(`arm_lower_${side}`).clone().sub(p(`arm_upper_${side}`));
    if(key.startsWith('arm_lower'))return p(`hand_${side}`).clone().sub(p(`arm_lower_${side}`));
    if(key===`hand_${side}`)return p(`finger_middle_0_${side}`).clone().sub(p(key));
    const match=key.match(/^(finger_\w+_)([012])_([lr])$/);
    if(match&&Number(match[2])<2)return p(`${match[1]}${Number(match[2])+1}_${side}`).clone().sub(p(key));
    const bone=bones.get(key),child=bone.children.find(o=>o.isBone);
    const direction=child?child.getWorldPosition(new THREE.Vector3()).sub(p(key)):new THREE.Vector3(native?0:1,native?1:0,0).applyQuaternion(states.get(key).quaternion);
    return direction.lengthSq()>1e-12?direction:new THREE.Vector3(native?0:1,native?1:0,0).applyQuaternion(states.get(key).quaternion);
  }

  update() {
    const r=this.record;r.container.updateMatrixWorld(true);if(r.hands)r.hands.updateMatrixWorld(true);
    const desired=new THREE.Matrix4(),local=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
    // Map insertion follows the source hierarchy, so parent matrices are ready
    // before each finger's position is derived from its original bone lengths.
    for(const [key,bone]of this.bones){
      const side=/_l(?:_twist)?$/.test(key)?'l':'r',donor=this.donors.get(key),rest=this.donorRest.get(key);
      donor.getWorldQuaternion(q);if(!q.toArray().every(Number.isFinite))q.copy(rest.quaternion);
      q.multiply(this.corrections.get(key)).normalize();
      const wrist=this.donors.get(`hand_${side}`),wristRest=this.donorRest.get(`hand_${side}`);
      const dynamic=Math.max(1e-6,wrist.getWorldScale(new THREE.Vector3()).length()/wristRest.scale.length());
      scale.copy(this.sourceRest.get(key).scale).multiplyScalar(this.handScales[side]*dynamic);
      if(key.startsWith('arm_')||key.startsWith('hand_')){
        if(key.endsWith('_twist'))this.donors.get(`arm_lower_${side}`).getWorldPosition(pos);else donor.getWorldPosition(pos);
      }else pos.copy(this.locals.get(key)).applyMatrix4(bone.parent.matrixWorld);
      desired.compose(pos,q,scale);local.copy(bone.parent.matrixWorld).invert().multiply(desired);
      local.decompose(bone.position,bone.quaternion,bone.scale);bone.updateMatrixWorld(true);
    }
  }

  async bake(scene) {
    const out=[];const r=this.record;
    for(let index=0;index<r.clips.length;index++){
      scene.setClipOnRecord(r,index);const clip=r.clips[index],times=[];
      for(let frame=0;frame<Math.ceil(clip.duration*60);frame++)times.push(frame/60);times.push(clip.duration);
      const values=new Map([...this.bones].map(([key])=>[key,{p:[],q:[],s:[]}]));
      for(const time of times){
        r.action.enabled=true;r.action.paused=false;r.action.time=time;r.mixer.update(0);r.action.paused=true;this.update();
        for(const [key,bone]of this.bones){const v=values.get(key);v.p.push(...bone.position.toArray());v.q.push(...bone.quaternion.toArray());v.s.push(...bone.scale.toArray());}
      }
      const tracks=clip.tracks.map(track=>track.clone());
      for(const [key,bone]of this.bones){const v=values.get(key);tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`,times,v.p),new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,v.q),new THREE.VectorKeyframeTrack(`${bone.name}.scale`,times,v.s));}
      out.push(new THREE.AnimationClip(clip.name,clip.duration,tracks));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return out;
  }

  dispose() {
    this.group.removeFromParent();disposeAssets(this.group);
  }
}
