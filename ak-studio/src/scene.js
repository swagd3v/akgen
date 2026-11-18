import * as THREE from 'three';
import {GLTFLoader} from '../vendor/loaders/GLTFLoader.js';
import {OrbitControls} from '../vendor/controls/OrbitControls.js';
import {zoneForName} from './generator.js';
import {createHands} from './hands.js';
import {GLTFExporter} from '../vendor/exporters/GLTFExporter.js';
import {prepareAnimated, ANIMATED_ZONES} from './animated-model.js';
import {ZONES} from './generator.js';
import {CS2Hands} from './cs2-hands.js';
import {prepareCS2Weapon} from './cs2-weapon.js';

export const MODELS = {
  aks74u: {label: 'AKS-74U · Animated', hands: true, colorChannel: 1},
  ak47: {label: 'AK-47 · Classic', hands: true, colorChannel: 0},
  'ak47-cs2': {label: 'AK-47 · CS2', hands: false, colorChannel: 0},
};

export class GunScene {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.models = new Map(); this.lastTick = performance.now();
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#dbe0d9');
    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, .01, 150);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false; this.controls.enableDamping = false;
    this.controls.minDistance = 5; this.controls.maxDistance = 22;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xf1f6ff, 0x7d7769, 2.5));
    for (const [color, power, position] of [[0xfff6e8, 4, [4, 6, -3]], [0xc9dff3, 2, [-4, 2, 4]], [0xffffff, 2.5, [2, 1, 6]]]) {
      const light = new THREE.DirectionalLight(color, power); light.position.fromArray(position); this.scene.add(light);
    }
    const bg = document.createElement('canvas'); bg.width = 1024; bg.height = 576;
    const ctx = bg.getContext('2d');
    const gradient = ctx.createRadialGradient(500, 240, 20, 500, 240, 690);
    gradient.addColorStop(0, '#eef0e9'); gradient.addColorStop(1, '#b5bfb6');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, bg.width, bg.height);
    this.backgroundTexture = new THREE.CanvasTexture(bg); this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundTexture;
    this.raycaster = new THREE.Raycaster();
    canvas.addEventListener('pointerdown', event => { this.down = [event.clientX, event.clientY]; });
    canvas.addEventListener('pointerup', event => {
      if (!this.down || Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 5) return;
      const bounds = canvas.getBoundingClientRect();
      // Refresh bounds so moving magazines remain selectable in reload poses.
      for (const mesh of this.meshes || []) if (mesh.isSkinnedMesh) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      const hit = this.raycaster.intersectObjects(this.meshes || [])[0];
      onSelect(hit?.object.userData.zone || null);
    });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); canvas.dispatchEvent(new CustomEvent('scene-error', {detail: 'Graphics context lost. Reload to restore AK Studio.'}));
    });
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
    const tick = time => {
      const delta = Math.max(0, Math.min((time - this.lastTick) / 1000, .1)); this.lastTick = time;
      if (this.active?.playing && !this.freeze) { this.active.mixer.update(delta); this.render(); this.onAnimation?.(this.animationState); }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  async load(id = 'aks74u') {
    if (!MODELS[id]) throw Error('Unknown weapon model.');
    let record = this.models.get(id);
    if (!record) {
      const gltf = await new GLTFLoader().loadAsync(`./assets/${id}.glb`);
      const container = new THREE.Group(); container.name = `${id}_studio_model`; container.add(gltf.scene);
      record = {id, capabilities: MODELS[id], root: gltf.scene, container, clips: gltf.animations, playing: false, view: 'angle', arms: [], appearance: {glove: 'hardknuckle', sleeve: 'fbi'}};
      if (id === 'aks74u') {
        const prepared = prepareAnimated(gltf.scene);
        Object.assign(record, prepared);
        record.meshes = prepared.paintMeshes;
        record.atlasOptions = {zones: ANIMATED_ZONES, uvAttribute: 'uv1', colors: prepared.colors};
        record.restTransforms = [];
        gltf.scene.traverse(object => record.restTransforms.push({object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone()}));
        record.mixer = new THREE.AnimationMixer(gltf.scene);
        record.clipIndex = Math.max(0, gltf.animations.findIndex(clip => clip.name.endsWith('Fire_single')));
        this.setClipOnRecord(record, record.clipIndex);
        // The authored weapon points down -Z; turn the whole rig, including
        // its hands and animation, into the studio's +Z muzzle convention.
        container.rotation.y = Math.PI;
        record.mixer.addEventListener('finished', () => { record.playing = false; if (this.active === record && !this.freeze) this.onAnimation?.(this.animationState); });
      } else if (id === 'ak47-cs2') {
        Object.assign(record, prepareCS2Weapon(gltf));
        record.restTransforms = [];
        gltf.scene.traverse(object => record.restTransforms.push({object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone()}));
        record.mixer = new THREE.AnimationMixer(gltf.scene); record.clipIndex = 0;
        this.setClipOnRecord(record, 0);
        record.mixer.addEventListener('finished', () => { record.playing = false; if (this.active === record && !this.freeze) this.onAnimation?.(this.animationState); });
      } else {
        record.meshes = [];
        gltf.scene.traverse(object => {
          if (!object.isMesh) return;
          object.userData.zone = zoneForName(object.name);
          if (!object.userData.zone) throw Error(`Unmapped gun part: ${object.name}`);
          object.material.dispose();
          object.material = new THREE.MeshStandardMaterial({roughness: .68, metalness: .13, side: THREE.DoubleSide});
          record.meshes.push(object);
        });
        record.atlasOptions = {zones: Object.keys(ZONES)};
      }
      container.updateMatrixWorld(true);
      const box = new THREE.Box3(); record.meshes.forEach(mesh => box.expandByObject(mesh));
      const scale = 8 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
      container.scale.setScalar(scale); container.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
      this.scene.add(container); container.updateMatrixWorld(true);
      record.restBox = new THREE.Box3(); record.meshes.forEach(mesh => record.restBox.expandByObject(mesh));
      this.models.set(id, record);
    }
    if (this.active) {
      this.select(null);
      this.active.playing = false; if (this.active.action) this.active.action.paused = true;
      this.active.container.visible = false; if (this.active.hands) this.active.hands.visible = false;
    }
    this.active = record; record.container.visible = true;
    this.root = record.root; this.meshes = record.meshes; this.texture = record.texture; this.hands = record.hands;
    this.selected = null;
    await this.setView(record.view); this.resize(); this.onAnimation?.(this.animationState);
    return record.meshes;
  }

  setAtlas(canvas) {
    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.channel = this.active.capabilities.colorChannel;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.meshes.forEach(mesh => { mesh.material.map = this.texture; mesh.material.needsUpdate = true; });
    this.active.texture = this.texture;
    this.render();
  }
  refresh() { this.texture.needsUpdate = true; this.render(); }
  setPainted(painted) {
    const r = this.active; if (!r.originalMaterial) return;
    for (const mesh of r.meshes) {
      const m = mesh.material, original = r.originalMaterial;
      m.color.copy(painted ? new THREE.Color('#ffffff') : original.color);
      m.metalness = painted ? 0 : original.metalness; m.roughness = painted ? .75 : original.roughness;
      m.metalnessMap = painted ? null : original.metalnessMap; m.roughnessMap = painted ? null : original.roughnessMap;
      m.needsUpdate = true;
    }
    this.render();
  }
  select(zone) {
    this.selected = zone;
    for (const mesh of this.meshes || []) {
      mesh.material.emissive.set(mesh.userData.zone === zone ? '#4d835f' : '#000000');
      mesh.material.emissiveIntensity = .22;
    }
    this.render();
  }
  async setView(view) {
    if (view === 'hands' && !this.active.capabilities.hands) throw Error('This weapon has no matching arm animations.');
    if (view === 'hands') {
      await this.ensureDonor(this.active);
      if (this.active.appearance.glove !== 'original') await this.setAppearance(this.active.appearance);
    }
    this.view = view; this.active.view = view;
    this.handVisibility();
    this.controls.enabled = view !== 'hands';
    const positions = {left: [9, .35, 0], right: [-9, .35, 0], angle: [9.2, 2.2, 2.3]};
    this.camera.fov = view === 'hands' ? this.active.id === 'aks74u' ? 60 : 50 : 35;
    this.camera.up.set(0, 1, 0); this.camera.updateProjectionMatrix();
    this.camera.position.fromArray(view === 'hands' ? this.active.id === 'aks74u' ? [1.4, .9, -3.3] : this.hands.userData.cameraPosition : positions[view] || positions.angle);
    this.controls.target.set(0, view === 'hands' ? .15 : 0, view === 'hands' ? this.active.id === 'aks74u' ? 1.7 : 1.5 : 0);
    this.camera.lookAt(this.controls.target); this.controls.update(); this.render();
  }
  resize() {
    const width = this.canvas.parentElement.clientWidth;
    if (!width) return;
    this.renderer.setSize(width, width * 9 / 16, false); this.render();
  }
  render() { if (this.active?.cs2 && this.active.appearance.glove !== 'original') this.active.cs2.update(); this.renderer.render(this.scene, this.camera); }
  async ensureDonor(record) {
    if (record.id === 'ak47' && !record.hands) {
      record.hands = await createHands(record.meshes); record.hands.visible = false; this.scene.add(record.hands);
    }
    if (this.active === record) this.hands = record.hands;
  }
  async prepareAppearance(appearance) {
    const r=this.active;
    if (!r.capabilities.hands) return;
    if (appearance.glove === 'original') { r.appearance={...appearance}; return; }
    await this.ensureDonor(r);
    if (r.cs2?.appearance.glove === appearance.glove && r.cs2?.appearance.sleeve === appearance.sleeve) { r.appearance={...appearance}; return; }
    let candidate;
    try { candidate=await CS2Hands.create(r,appearance); }
    catch(error){
      // A constructor can fail after attachment; remove that incomplete rig
      // while preserving the last working appearance and its resources.
      for(const child of [...r.container.children])if(child.name==='CS2_Hands'&&child!==r.cs2?.group)child.removeFromParent();
      throw error;
    }
    r.cs2?.dispose();r.cs2=candidate;r.appearance={...appearance};
  }
  async setAppearance(appearance) {
    this.freeze=true;
    try { await this.prepareAppearance(appearance); this.handVisibility(); this.render(); }
    finally { this.freeze=false; this.lastTick=performance.now(); }
  }
  handVisibility() {
    const r=this.active;if(!r)return;const hands=r.view==='hands',original=r.appearance.glove==='original';
    if(r.hands)r.hands.visible=hands&&original;
    r.arms.forEach(mesh=>{mesh.visible=hands&&original;});
    if(r.cs2)r.cs2.group.visible=hands&&!original;
  }
  get animationState() {
    const r = this.active;
    return r?.action ? {clipIndex: r.clipIndex, duration: r.clips[r.clipIndex].duration, time: r.action.time, playing: r.playing} : null;
  }
  setClipOnRecord(record, index) {
    record.mixer.stopAllAction(); record.playing = false; record.clipIndex = index;
    record.action = record.mixer.clipAction(record.clips[index]);
    record.action.reset().setLoop(THREE.LoopOnce, 1); record.action.clampWhenFinished = true;
    record.action.play(); record.mixer.update(0); record.action.paused = true;
  }
  setClip(index) { this.setClipOnRecord(this.active, index); this.render(); this.onAnimation?.(this.animationState); }
  togglePlay() {
    const r = this.active; if (!r.action || r.clips[r.clipIndex].duration <= 0) return;
    if (!r.playing && r.action.time >= r.clips[r.clipIndex].duration - .0001) r.action.reset().play();
    r.playing = !r.playing; r.action.paused = !r.playing;
    this.lastTick = performance.now(); this.onAnimation?.(this.animationState);
  }
  scrub(time) {
    const r = this.active; if (!r.action) return;
    r.playing = false; r.action.enabled = true; r.action.paused = false;
    r.action.time = Math.max(0, Math.min(time, r.clips[r.clipIndex].duration));
    r.mixer.update(0); r.action.paused = true; this.render(); this.onAnimation?.(this.animationState);
  }
  async exportPNG() {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio(), selected = this.selected;
    this.freeze = true;
    try {
      this.select(null); this.renderer.setPixelRatio(1); this.renderer.setSize(1920, 1080, false); this.render();
      return await new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('The render could not be exported.')), 'image/png'));
    } finally {
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false); this.select(selected);
      this.freeze = false; this.lastTick = performance.now();
    }
  }
  async exportGLB() {
    this.freeze = true;
    const r = this.active, selected = this.selected, visibility = r.arms.map(mesh => mesh.visible);
    const animation = this.animationState;
    let nativeParent=null,nativeVisible=false;
    try {
      this.select(null);
      await this.prepareAppearance(r.appearance);
      let clips=r.clips;
      if(r.capabilities.hands && r.appearance.glove!=='original'){
        r.arms.forEach(mesh=>{mesh.visible=false;});if(r.hands)r.hands.visible=false;
        r.cs2.group.visible=true;
        if(r.clips.length)clips=await r.cs2.bake(this);
      }else if(r.capabilities.hands){
        r.arms.forEach(mesh=>{mesh.visible=true;});
        if(r.id==='ak47'){
          await this.ensureDonor(r);nativeParent=r.hands.parent;nativeVisible=r.hands.visible;
          r.container.attach(r.hands);r.hands.visible=true;
        }
      }
      // Clips animate different subsets of bones. Export the original base
      // pose, rather than baking the currently scrubbed reload into all clips.
      if (r.mixer) {
        r.mixer.stopAllAction();
        for (const saved of r.restTransforms) {
          saved.object.position.copy(saved.position); saved.object.quaternion.copy(saved.quaternion);
          saved.object.scale.copy(saved.scale); saved.object.matrix.copy(saved.matrix);
        }
      }
      this.scene.updateMatrixWorld(true);
      if(r.cs2&&r.appearance.glove!=='original')r.cs2.update();
      const data = await new GLTFExporter().parseAsync(r.container, {binary: true, animations: clips, onlyVisible: true, maxTextureSize: 4096});
      return new Blob([data], {type: 'model/gltf-binary'});
    } finally {
      if (animation) {
        this.setClipOnRecord(r, animation.clipIndex);
        r.action.paused = false; r.action.time = animation.time; r.mixer.update(0);
        r.playing = animation.playing; r.action.paused = !animation.playing;
        this.onAnimation?.(this.animationState);
      }
      if(nativeParent){nativeParent.attach(r.hands);r.hands.visible=nativeVisible;}
      r.arms.forEach((mesh, i) => { mesh.visible = visibility[i]; });this.handVisibility();this.select(selected);
      this.freeze = false; this.lastTick = performance.now();
    }
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect(); this.controls.dispose(); this.texture?.dispose(); this.backgroundTexture.dispose();
    for (const r of this.models.values()) {
      r.cs2?.dispose();
      r.mixer?.stopAllAction(); r.mixer?.uncacheRoot(r.root); r.texture?.dispose();
      r.container.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    }
    this.renderer.dispose();
    this.hands?.traverse(object => { if(object.isMesh) { object.geometry.dispose(); object.material.map?.dispose(); object.material.dispose(); } });
  }
}
