// The weapon viewport: loads the three weapon models, shows them with their
// hands and animations, and exports renders and GLB files.
import * as THREE from 'three';
import {GLTFLoader} from '../../vendor/loaders/GLTFLoader.js';
import {GLTFExporter} from '../../vendor/exporters/GLTFExporter.js';
import {OrbitControls} from '../../vendor/controls/OrbitControls.js';
import {ZONES, FINISHES, zoneForName} from './skin/generator.js';
import {buildBakeModel} from './skin/projector.js';
import {prepareAnimated, ANIMATED_ZONES} from './animated-model.js';
import {prepareCS2Weapon} from './cs2-weapon.js';
import {rigClassic, standClassic} from './classic-rig.js';
import {prepareAWP} from './awp.js';
import {createHands} from './hands.js';
import {CS2Hands} from './cs2-hands.js';

export const MODELS = {
  aks74u: {label: 'AKS-74U · Animated', tag: 'AKS-74U / 7 ANIMATIONS', hands: true, colorChannel: 1},
  ak47: {label: 'AK-47 · Classic · Animated', tag: 'AK-47 / 7 PARTS / 4 ANIMATIONS', hands: true, colorChannel: 0},
  'ak47-cs2': {label: 'AK-47 · CS2', tag: 'CS2 AK-47 / 4 ANIMATIONS', hands: false, colorChannel: 0},
  awp: {label: 'AWP', tag: 'AWP / 5 PARTS', hands: false, colorChannel: 0, text: 'AWP'},
};

const STUDIO_VIEWS = {left: [9, .35, 0], right: [-9, .35, 0], angle: [9.2, 2.2, 2.3]};
// Artwork on bare metal turns into a dark mirror, so painted zones default to
// a non-metallic paint finish.
const AUTO_PAINT = {metalness: 0, roughness: .68};

/**
 * Something for metallic stickers to reflect: a dark room with a few bright
 * softboxes. Dark, so it adds almost nothing to the paint around them.
 */
function studioReflections(renderer) {
  const room = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
  const wall = new THREE.Mesh(box, new THREE.MeshBasicMaterial({color: 0x0b0c0e, side: THREE.BackSide}));
  wall.scale.setScalar(20); room.add(wall);
  for (const [position, size, power] of [[[0, 9, 0], [9, .2, 9], 9], [[9, 2, 3], [.2, 6, 5], 6], [[-9, 3, -2], [.2, 5, 7], 4], [[0, 1, 9], [8, 4, .2], 3], [[2, 0, -9], [6, 3, .2], 2]]) {
    const light = new THREE.Mesh(box, new THREE.MeshBasicMaterial({color: new THREE.Color().setScalar(power)}));
    light.position.fromArray(position); light.scale.fromArray(size); room.add(light);
  }
  const generator = new THREE.PMREMGenerator(renderer), texture = generator.fromScene(room, .03).texture;
  generator.dispose(); box.dispose(); room.traverse(object => object.material?.dispose());
  return texture;
}

function snapshotTransforms(root) {
  const out = [];
  root.traverse(object => out.push({object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone()}));
  return out;
}

export class GunScene {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.models = new Map();
    this.lastTick = performance.now();
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, .01, 150);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false; this.controls.enableDamping = false;
    this.controls.minDistance = 5; this.controls.maxDistance = 22;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight(0xf1f6ff, 0x7d7769, 2.5));
    for (const [color, power, position] of [[0xfff6e8, 4, [4, 6, -3]], [0xc9dff3, 2, [-4, 2, 4]], [0xffffff, 2.5, [2, 1, 6]]]) {
      const light = new THREE.DirectionalLight(color, power);
      light.position.fromArray(position); this.scene.add(light);
    }
    const backdrop = document.createElement('canvas'); backdrop.width = 1024; backdrop.height = 576;
    const ctx = backdrop.getContext('2d'), gradient = ctx.createRadialGradient(500, 240, 20, 500, 240, 690);
    gradient.addColorStop(0, '#eef0e9'); gradient.addColorStop(1, '#b5bfb6');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, backdrop.width, backdrop.height);
    this.backgroundTexture = new THREE.CanvasTexture(backdrop); this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.backgroundTexture;

    // A click (not a drag) selects the paint zone under the pointer.
    this.raycaster = new THREE.Raycaster();
    canvas.addEventListener('pointerdown', event => { this.down = [event.clientX, event.clientY]; });
    canvas.addEventListener('pointerup', event => {
      if (!this.down || Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 5) return;
      const bounds = canvas.getBoundingClientRect(), visible = (this.meshes || []).filter(mesh => mesh.visible);
      // Refresh bounds so moving magazines remain selectable in reload poses.
      for (const mesh of visible) if (mesh.isSkinnedMesh) { mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      onSelect(this.raycaster.intersectObjects(visible)[0]?.object.userData.zone || null);
    });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      canvas.dispatchEvent(new CustomEvent('scene-error', {detail: 'Graphics context lost. Reload to restore AK Studio.'}));
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);

    const tick = time => {
      const delta = Math.max(0, Math.min((time - this.lastTick) / 1000, .1));
      this.lastTick = time;
      if (this.active?.playing && !this.freeze) { this.active.mixer.update(delta); this.render(); this.onAnimation?.(this.animationState); }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ loading

  async load(id = 'aks74u') {
    if (!MODELS[id]) throw Error('Unknown weapon model.');
    const record = this.models.get(id) || await this.createRecord(id);
    if (this.active) {
      this.select(null);
      this.active.playing = false;
      if (this.active.action) this.active.action.paused = true;
      this.active.container.visible = false;
      if (this.active.hands) this.active.hands.visible = false;
    }
    this.active = record; record.container.visible = true;
    this.root = record.root; this.meshes = record.meshes; this.texture = record.texture; this.hands = record.hands;
    this.selected = null;
    await this.setView(record.view);
    this.resize(); this.onAnimation?.(this.animationState);
    return record.meshes;
  }

  async createRecord(id) {
    const gltf = await new GLTFLoader().loadAsync(`./assets/${id}.glb`);
    const container = new THREE.Group(); container.name = `${id}_studio_model`; container.add(gltf.scene);
    const record = {
      id, capabilities: MODELS[id], root: gltf.scene, container, clips: gltf.animations,
      playing: false, view: 'angle', arms: [], appearance: {glove: 'hardknuckle', sleeve: 'fbi'},
    };
    if (id === 'aks74u') {
      const prepared = prepareAnimated(gltf.scene);
      Object.assign(record, prepared);
      record.meshes = prepared.paintMeshes;
      record.atlasOptions = {zones: ANIMATED_ZONES, uvAttribute: 'uv1', colors: prepared.colors};
      // The authored weapon points down -Z; turn the whole rig, including its
      // hands and animation, into the studio's +Z muzzle convention.
      container.rotation.y = Math.PI;
      this.addMixer(record, Math.max(0, gltf.animations.findIndex(clip => clip.name.endsWith('Fire_single'))));
    } else if (id === 'ak47-cs2') {
      Object.assign(record, prepareCS2Weapon(gltf));
      this.addMixer(record, 0);
    } else if (id === 'awp') {
      Object.assign(record, prepareAWP(gltf));
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
      // The parts ride the CS2 weapon's skeleton, and so do the hands.
      const response = await fetch('./assets/ak47-rig.json');
      if (!response.ok) throw Error('The classic AK-47 animation rig could not be loaded.');
      const toInches = standClassic(gltf.scene, record.meshes);
      record.hands = await createHands(record.meshes); record.hands.visible = false;
      const rigged = rigClassic(record.meshes, await response.json(), toInches);
      rigged.grip.add(record.hands);
      container.remove(gltf.scene); container.add(rigged.root);
      Object.assign(record, {root: rigged.root, clips: rigged.clips, grip: rigged.grip});
      this.addMixer(record, 0);
    }

    // Normalise every weapon to eight units long, centred on the origin.
    container.updateMatrixWorld(true);
    const box = new THREE.Box3(); record.meshes.forEach(mesh => box.expandByObject(mesh));
    const scale = 8 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
    container.scale.setScalar(scale);
    container.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
    this.scene.add(container); container.updateMatrixWorld(true);
    record.restBox = new THREE.Box3(); record.meshes.forEach(mesh => record.restBox.expandByObject(mesh));

    // Captured now, while the weapon is assembled, for projecting artwork.
    record.bake = buildBakeModel(record.meshes, record.atlasOptions.uvAttribute || 'uv');
    record.focus = record.bake.bounds.getCenter(new THREE.Vector3()).applyMatrix4(record.bake.basis);
    record.factory = new Map(record.meshes.map(mesh => [mesh.material, {
      color: mesh.material.color.clone(), metalness: mesh.material.metalness, roughness: mesh.material.roughness,
      metalnessMap: mesh.material.metalnessMap, roughnessMap: mesh.material.roughnessMap,
    }]));
    // The first-person camera is placed against the weapon as it idles.
    if (record.grip) record.gripFrame = record.grip.matrixWorld.clone();
    this.updateSpare(record);
    this.models.set(id, record);
    return record;
  }

  addMixer(record, clipIndex) {
    record.restTransforms = snapshotTransforms(record.root);
    record.mixer = new THREE.AnimationMixer(record.root);
    this.setClipOnRecord(record, clipIndex);
    record.mixer.addEventListener('finished', () => {
      record.playing = false;
      if (this.active === record && !this.freeze) this.onAnimation?.(this.animationState);
    });
  }

  // ------------------------------------------------------------ paint

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

  /**
   * Chooses how painted surfaces reflect light. `paintedZones` lists the
   * zones carrying artwork or a solid colour; every other zone keeps its
   * factory material, so bare steel next to a painted stock still looks like steel.
   *
   * While the weapon carries stickers, pass `surfaceMap` (the atlas's
   * surfaceMap method): it is given each zone's roughness and metalness and
   * returns a texture with the stickers' own shine laid over them. Unpainted
   * zones that have factory roughness maps keep those instead, so stickers
   * there show their colour but not their shine.
   */
  setFinish(paintedZones, finishId = 'auto', surfaceMap = null) {
    const record = this.active, preset = FINISHES[finishId] || FINISHES.auto;
    const paint = preset.roughness === undefined ? AUTO_PAINT : preset;
    const values = new Map();
    for (const mesh of record.meshes) {
      const material = mesh.material, factory = record.factory.get(material), painted = paintedZones.has(mesh.userData.zone);
      material.color.copy(painted ? new THREE.Color('#ffffff') : factory.color);
      material.metalness = painted ? paint.metalness : factory.metalness;
      material.roughness = painted ? paint.roughness : factory.roughness;
      material.metalnessMap = painted ? null : factory.metalnessMap;
      material.roughnessMap = painted ? null : factory.roughnessMap;
      material.envMap = null;
      if (surfaceMap && !material.roughnessMap && !material.metalnessMap) values.set(mesh.userData.zone, {roughness: material.roughness, metalness: material.metalness});
      material.needsUpdate = true;
    }
    record.surface?.dispose(); record.surface = null;
    if (values.size) {
      record.surface = new THREE.CanvasTexture(surfaceMap(values));
      record.surface.channel = record.capabilities.colorChannel;
      record.surface.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.reflections ||= studioReflections(this.renderer);
      for (const mesh of record.meshes) {
        if (!values.has(mesh.userData.zone)) continue;
        // The texture now carries the zone's own values as well as the stickers'.
        Object.assign(mesh.material, {roughness: 1, metalness: 1, roughnessMap: record.surface, metalnessMap: record.surface, envMap: this.reflections});
      }
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

  // ------------------------------------------------------------ views

  async setView(view) {
    const record = this.active;
    if (view === 'hands' && !record.capabilities.hands) throw Error('This weapon has no matching arm animations.');
    if (view === 'hands') {
      await this.ensureDonor(record);
      if (record.appearance.glove !== 'original') await this.setAppearance(record.appearance);
    }
    this.view = view; record.view = view;
    this.handVisibility();
    this.controls.enabled = view !== 'hands';
    this.camera.up.set(0, 1, 0);
    if (view === 'hands') {
      const animated = record.id === 'aks74u';
      this.camera.fov = animated ? 60 : 50;
      this.camera.position.fromArray(animated ? [1.4, .9, -3.3] : this.hands.userData.cameraPosition);
      this.controls.target.set(0, .15, animated ? 1.7 : 1.5);
      if (record.gripFrame) {
        this.camera.position.applyMatrix4(record.gripFrame); this.controls.target.applyMatrix4(record.gripFrame);
        this.camera.up.transformDirection(record.gripFrame);
      }
    } else {
      // Studio views orbit the weapon itself (not the spare magazine's bounds)
      // and are squared up to its barrel, whichever way the model was authored.
      this.camera.fov = 35;
      this.controls.target.copy(record.focus);
      this.camera.position.fromArray(STUDIO_VIEWS[view] || STUDIO_VIEWS.angle).applyMatrix4(record.bake.basis).add(record.focus);
    }
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.controls.target); this.controls.update(); this.render();
  }

  resize() {
    const width = this.canvas.parentElement.clientWidth;
    if (!width) return;
    this.renderer.setSize(width, width * 9 / 16, false); this.render();
  }

  render() {
    if (this.active?.cs2 && this.active.appearance.glove !== 'original') this.active.cs2.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ hands

  async ensureDonor(record) {
    if (this.active === record) this.hands = record.hands;
  }

  async prepareAppearance(appearance) {
    const record = this.active;
    if (!record.capabilities.hands) return;
    if (appearance.glove === 'original') { record.appearance = {...appearance}; return; }
    await this.ensureDonor(record);
    if (record.cs2?.appearance.glove === appearance.glove && record.cs2?.appearance.sleeve === appearance.sleeve) { record.appearance = {...appearance}; return; }
    let candidate;
    try { candidate = await CS2Hands.create(record, appearance); }
    catch (error) {
      // A constructor can fail after attachment; remove that incomplete rig
      // while preserving the last working appearance and its resources.
      for (const child of [...record.container.children]) if (child.name === 'CS2_Hands' && child !== record.cs2?.group) child.removeFromParent();
      throw error;
    }
    record.cs2?.dispose(); record.cs2 = candidate; record.appearance = {...appearance};
  }

  async setAppearance(appearance) {
    this.freeze = true;
    try { await this.prepareAppearance(appearance); this.handVisibility(); this.render(); }
    finally { this.freeze = false; this.lastTick = performance.now(); }
  }

  handVisibility() {
    const record = this.active;
    if (!record) return;
    const hands = record.view === 'hands', original = record.appearance.glove === 'original';
    if (record.hands) record.hands.visible = hands && original;
    record.arms.forEach(mesh => { mesh.visible = hands && original; });
    if (record.cs2) record.cs2.group.visible = hands && !original;
  }

  // ------------------------------------------------------------ animation

  get animationState() {
    const record = this.active;
    return record?.action ? {clipIndex: record.clipIndex, duration: record.clips[record.clipIndex].duration, time: record.action.time, playing: record.playing} : null;
  }

  setClipOnRecord(record, index) {
    record.mixer.stopAllAction(); record.playing = false; record.clipIndex = index;
    record.action = record.mixer.clipAction(record.clips[index]);
    record.action.reset().setLoop(THREE.LoopOnce, 1); record.action.clampWhenFinished = true;
    record.action.play(); record.mixer.update(0); record.action.paused = true;
    this.updateSpare(record);
  }

  /** The spare magazine only belongs in the picture while a reload is swapping it in. */
  updateSpare(record, force = false) {
    const reloading = /reload/i.test(record.clips[record.clipIndex]?.name || '');
    for (const mesh of record.meshes || []) if (mesh.userData.spare) mesh.visible = force || reloading;
  }

  setClip(index) { this.setClipOnRecord(this.active, index); this.render(); this.onAnimation?.(this.animationState); }

  togglePlay() {
    const record = this.active;
    if (!record.action || record.clips[record.clipIndex].duration <= 0) return;
    if (!record.playing && record.action.time >= record.clips[record.clipIndex].duration - .0001) record.action.reset().play();
    record.playing = !record.playing; record.action.paused = !record.playing;
    this.lastTick = performance.now(); this.onAnimation?.(this.animationState);
  }

  scrub(time) {
    const record = this.active;
    if (!record.action) return;
    record.playing = false; record.action.enabled = true; record.action.paused = false;
    record.action.time = Math.max(0, Math.min(time, record.clips[record.clipIndex].duration));
    record.mixer.update(0); record.action.paused = true;
    this.render(); this.onAnimation?.(this.animationState);
  }

  // ------------------------------------------------------------ export

  async exportPNG(width = 1920, height = 1080) {
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio(), selected = this.selected;
    this.freeze = true;
    try {
      this.select(null);
      this.renderer.setPixelRatio(1); this.renderer.setSize(width, height, false); this.render();
      return await new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('The render could not be exported.')), 'image/png'));
    } finally {
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false); this.select(selected);
      this.freeze = false; this.lastTick = performance.now();
    }
  }

  async exportGLB() {
    this.freeze = true;
    const record = this.active, selected = this.selected, visibility = record.arms.map(mesh => mesh.visible);
    const animation = this.animationState;
    try {
      this.select(null);
      await this.prepareAppearance(record.appearance);
      let clips = record.clips;
      if (record.capabilities.hands && record.appearance.glove !== 'original') {
        record.arms.forEach(mesh => { mesh.visible = false; });
        if (record.hands) record.hands.visible = false;
        record.cs2.group.visible = true;
        if (record.clips.length) clips = await record.cs2.bake(this);
      } else if (record.capabilities.hands) {
        record.arms.forEach(mesh => { mesh.visible = true; });
        if (record.hands) record.hands.visible = true;
      }
      // Clips animate different subsets of bones. Export the original base
      // pose, rather than baking the currently scrubbed reload into all clips.
      if (record.mixer) {
        record.mixer.stopAllAction();
        for (const saved of record.restTransforms) {
          saved.object.position.copy(saved.position); saved.object.quaternion.copy(saved.quaternion);
          saved.object.scale.copy(saved.scale); saved.object.matrix.copy(saved.matrix);
        }
      }
      this.updateSpare(record, true);
      this.scene.updateMatrixWorld(true);
      if (record.cs2 && record.appearance.glove !== 'original') record.cs2.update();
      const data = await new GLTFExporter().parseAsync(record.container, {binary: true, animations: clips, onlyVisible: true, maxTextureSize: 4096});
      return new Blob([data], {type: 'model/gltf-binary'});
    } finally {
      if (animation) {
        this.setClipOnRecord(record, animation.clipIndex);
        record.action.paused = false; record.action.time = animation.time; record.mixer.update(0);
        record.playing = animation.playing; record.action.paused = !animation.playing;
        this.onAnimation?.(this.animationState);
      }
      this.updateSpare(record);
      record.arms.forEach((mesh, i) => { mesh.visible = visibility[i]; });
      this.handVisibility(); this.select(selected);
      this.freeze = false; this.lastTick = performance.now();
    }
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect(); this.controls.dispose(); this.texture?.dispose(); this.backgroundTexture.dispose();
    for (const record of this.models.values()) {
      record.cs2?.dispose(); record.surface?.dispose();
      record.mixer?.stopAllAction(); record.mixer?.uncacheRoot(record.root); record.texture?.dispose();
      record.bake.meshes.forEach(mesh => mesh.geometry.dispose());
      record.container.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); } });
    }
    this.reflections?.dispose();
    this.renderer.dispose();
    this.hands?.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.map?.dispose(); object.material.dispose(); } });
  }
}
