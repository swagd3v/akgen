// The phone viewport: a first-person view of a rigged hand holding a phone in
// a small game-like world. The phone's screen is a live, scrollable feed.
import * as THREE from 'three';
import {GLTFLoader} from '../../vendor/loaders/GLTFLoader.js';
import {RiggedHand} from './hand.js';
import {PhoneScreen} from './screen.js';
import {drawHud} from './hud.js';
import {SCREEN, advanceScroll, environments, formats, holdOffset, holds, nextFlick, thumbGesture} from './generator.js';
import {randomFromSeed} from '../shared/random.js';

// The phone model's display: two triangles on this plane, in source units.
const DISPLAY = {z: 4.444224, u: {min: -4.374197, max: 4.359792}, v: {min: -8.993731, max: 8.963436}};
/** Everything is sized in hand units (the hand is about 2.2 long). */
const PHONE_WIDTH = .84;
const PHONE_SCALE = PHONE_WIDTH / (DISPLAY.u.max - DISPLAY.u.min);

/**
 * How the hand sits on the phone, in the phone's frame: x to the right of
 * the screen, y up it, z out of the glass. Tuned for the bundled models.
 */
export const GRIP = {
  palm: [-.03, .95, .3],          // the point of the hand that `position` places, in the hand's own frame
  position: [.28, -.45, -.27],
  roll: 62, pitch: 0, yaw: 0,      // degrees: fingers lean left, behind the phone
  // Starting curl; the fingers and thumb are then bent onto the phone.
  curl: {
    index: [.5, .1, .25, .25], middle: [.5, .1, .25, .25], ring: [.5, .1, .25, .25], pinky: [.5, .15, .3, .3],
    thumb: [.35, .3, .2, .2],
  },
  edge: [-.475, 0],                // x of the phone's left side and the z fingertips come round to
  back: -.16,                      // z that fingertips too short to reach the side rest at
  thumbRest: [.12, -.3, .05],      // where the thumb tip rests on the glass
  swipe: .2, lift: .16,            // thumb travel while scrolling, in radians
  sleeve: {centre: [0, .05], radius: [.3, .42], top: .5, length: 9},
};

const EYE = 18.6;   // eye height: one hand unit is about 8.6 cm
/** Boxes that make up the world: [x, y, z, width, height, depth, shade]. */
const WORLD = [
  [-150, 0, -330, 90, 78, 260, 0], [165, 0, -380, 110, 96, 220, 1], [0, 0, -640, 620, 70, 40, 2], [-60, 0, -470, 70, 44, 60, 1],
  [70, 0, -250, 50, 30, 50, 0], [-48, 0, -170, 15, 15, 15, 1], [-31, 0, -174, 13, 13, 13, 2], [-41, 15, -171, 12, 12, 12, 0],
  [36, 0, -210, 16, 16, 16, 2], [110, 0, -150, 14, 26, 14, 1], [-110, 0, -120, 30, 12, 12, 2], [18, 0, -330, 22, 22, 22, 0],
];
const LAMPS = [[-48, 34, -160], [72, 36, -244]];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  return canvas;
}

export class PhoneScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, .05, 4000);
    this.camera.position.set(0, EYE, 0); this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    /** Hand, phone and sleeve: everything that moves with the view. */
    this.viewmodel = new THREE.Group(); this.camera.add(this.viewmodel);

    this.ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.position.set(-60, 130, 90);
    this.fill = new THREE.DirectionalLight(0xffffff, .9); this.fill.position.set(70, 30, 120);
    this.scene.add(this.ambient, this.sun, this.fill);
    // A soft light that travels with the view, so the hand reads in every world.
    this.handLight = new THREE.PointLight(0xe6edff, 8, 14, 2); this.handLight.position.set(-.8, .9, .4); this.camera.add(this.handLight);
    this.buildWorld();

    this.screen = new PhoneScreen();
    this.screenTexture = new THREE.CanvasTexture(this.screen.canvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // The game overlay is drawn in 2D and laid over the finished frame.
    this.hudCanvas = makeCanvas(16, 9);
    this.hudTexture = new THREE.CanvasTexture(this.hudCanvas); this.hudTexture.colorSpace = THREE.SRGBColorSpace;
    this.hudScene = new THREE.Scene(); this.hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hud = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({map: this.hudTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false}));
    this.hudScene.add(this.hud);

    this.scroll = {position: 0, target: 0};
    this.thumb = {along: -.6, lift: .5, progress: 1, direction: 1};
    this.auto = {on: false, speed: 'normal', timer: 1, random: randomFromSeed('auto')};
    this.look = {x: 0, y: 0, yaw: 0, pitch: 0, lagX: 0, lagY: 0};
    this.clock = 0; this.dirty = true;
    /** The time shown in the phone's status bar. */
    this.now = () => new Date();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement);
    this.frame = this.frame.bind(this);
    this.listen();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      canvas.dispatchEvent(new CustomEvent('scene-error', {detail: 'The graphics context was lost. Reload to restore the studio.'}));
    });
  }

  get screenCanvas() { return this.screen.canvas; }

  // ---------- world ----------

  buildWorld() {
    this.skyCanvas = makeCanvas(4, 512);
    this.skyTexture = new THREE.CanvasTexture(this.skyCanvas); this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 16), new THREE.MeshBasicMaterial({map: this.skyTexture, side: THREE.BackSide, fog: false, depthWrite: false}));
    this.sky.position.y = EYE; this.scene.add(this.sky);

    this.groundCanvas = makeCanvas(256, 256);
    this.groundTexture = new THREE.CanvasTexture(this.groundCanvas); this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.groundTexture.wrapS = this.groundTexture.wrapT = THREE.RepeatWrapping; this.groundTexture.repeat.set(160, 160);
    this.groundTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({map: this.groundTexture, roughness: .95, metalness: 0}));
    this.ground.rotation.x = -Math.PI / 2; this.scene.add(this.ground);

    this.propMaterials = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({roughness: .9, metalness: 0}));
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const [x, y, z, width, height, depth, shade] of WORLD) {
      const prop = new THREE.Mesh(box, this.propMaterials[shade]);
      prop.scale.set(width, height, depth); prop.position.set(x, y + height / 2, z); this.scene.add(prop);
    }
    this.lampMaterial = new THREE.MeshBasicMaterial({color: 0xffffff});
    this.lamps = LAMPS.map(position => {
      const lamp = new THREE.Mesh(box, this.lampMaterial), light = new THREE.PointLight(0xffffff, 0, 260, 1.4);
      lamp.scale.set(5, 3, 5); lamp.position.fromArray(position); light.position.fromArray(position); light.position.y -= 4;
      this.scene.add(lamp, light);
      return {lamp, light};
    });
    this.scene.fog = new THREE.Fog(0xffffff, 140, 1500);
  }

  setEnvironment(id) {
    const preset = environments.find(item => item.id === id) || environments[0];
    let c = this.skyCanvas.getContext('2d');
    const gradient = c.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, preset.sky[0]); gradient.addColorStop(.36, preset.sky[1]); gradient.addColorStop(.5, preset.sky[2]); gradient.addColorStop(.52, preset.fog); gradient.addColorStop(1, preset.fog);
    c.fillStyle = gradient; c.fillRect(0, 0, 4, 512); this.skyTexture.needsUpdate = true;

    c = this.groundCanvas.getContext('2d');
    c.fillStyle = preset.ground; c.fillRect(0, 0, 256, 256);
    const random = randomFromSeed(preset.id);
    for (let speck = 0; speck < 500; speck++) { c.fillStyle = `rgba(${random() < .5 ? '0, 0, 0' : '255, 255, 255'}, ${random() * .07})`; c.fillRect(random() * 256, random() * 256, 2 + random() * 5, 2 + random() * 5); }
    c.strokeStyle = preset.line; c.lineWidth = 3; c.globalAlpha = .55; c.strokeRect(0, 0, 256, 256); c.globalAlpha = 1;
    this.groundTexture.needsUpdate = true;

    this.scene.fog.color.set(preset.fog);
    this.propMaterials.forEach((material, index) => material.color.set(preset.props[index]));
    this.sun.color.set(preset.sun); this.sun.intensity = preset.sunPower; this.fill.color.set(preset.sun); this.fill.intensity = preset.sunPower * .3;
    this.ambient.color.set(preset.ambient[0]); this.ambient.groundColor.set(preset.ambient[1]); this.ambient.intensity = preset.ambientPower;
    this.handLight.intensity = preset.glow ? 16 : 7;
    this.lampMaterial.color.set(preset.glow || preset.props[2]);
    for (const {light} of this.lamps) { light.color.set(preset.glow || '#ffffff'); light.intensity = preset.glow ? 9000 : 0; }
  }

  // ---------- hand and phone ----------

  async load() {
    const loader = new GLTFLoader();
    const [hand, phone] = await Promise.all([loader.loadAsync('./assets/phone/rigged-hand.glb'), loader.loadAsync('./assets/phone/phone.glb')]);
    this.addPhone(phone.scene);
    this.hand = new RiggedHand(hand);
    this.mount = new THREE.Group(); this.mount.matrixAutoUpdate = false;
    this.mount.add(this.hand.root); this.viewmodel.add(this.mount);
    this.sleeve = new THREE.Group(); this.mount.add(this.sleeve);
    this.grip();
    this.ready = true; this.resize();
  }

  /**
   * Rebuilds the phone around the centre of its display, facing +z. The two
   * display triangles get portrait UVs and the live screen; the body's
   * UV-checker material is replaced by graphite.
   */
  addPhone(phone) {
    this.phone = new THREE.Group(); this.viewmodel.add(this.phone);
    const centre = [(DISPLAY.u.min + DISPLAY.u.max) / 2, (DISPLAY.v.min + DISPLAY.v.max) / 2];
    let screenTriangles = 0;
    phone.traverse(object => {
      if (!object.isMesh) return;
      let geometry = object.geometry.clone();
      if (geometry.index) geometry = geometry.toNonIndexed();
      const p = geometry.attributes.position, n = geometry.attributes.normal;
      const body = [], bodyNormals = [], display = [], displayUV = [];
      for (let i = 0; i < p.count; i += 3) {
        const isDisplay = [0, 1, 2].every(k => Math.abs(p.getZ(i + k) - DISPLAY.z) < .0002);
        for (let k = 0; k < 3; k++) {
          const j = i + k, x = p.getX(j), y = p.getY(j), z = p.getZ(j);
          // The source lies on its side: its y runs across the screen and its -x up it.
          const placed = [(y - centre[0]) * PHONE_SCALE, (centre[1] - x) * PHONE_SCALE, (z - DISPLAY.z) * PHONE_SCALE];
          if (isDisplay) {
            display.push(...placed);
            displayUV.push((y - DISPLAY.u.min) / (DISPLAY.u.max - DISPLAY.u.min), (DISPLAY.v.max - x) / (DISPLAY.v.max - DISPLAY.v.min));
          } else {
            body.push(...placed); bodyNormals.push(n.getY(j), -n.getX(j), n.getZ(j));
          }
        }
        if (isDisplay) screenTriangles++;
      }
      if (body.length) {
        const shell = new THREE.BufferGeometry();
        shell.setAttribute('position', new THREE.Float32BufferAttribute(body, 3));
        shell.setAttribute('normal', new THREE.Float32BufferAttribute(bodyNormals, 3));
        this.phone.add(new THREE.Mesh(shell, new THREE.MeshStandardMaterial({color: object.name === 'Object_2' ? 0x25282b : 0x34383e, roughness: .3, metalness: .65, side: THREE.DoubleSide})));
      }
      if (display.length) {
        const panel = new THREE.BufferGeometry();
        panel.setAttribute('position', new THREE.Float32BufferAttribute(display, 3));
        panel.setAttribute('uv', new THREE.Float32BufferAttribute(displayUV, 2));
        panel.computeVertexNormals();
        this.glass = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({map: this.screenTexture, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1}));
        this.phone.add(this.glass);
      }
      geometry.dispose();
    });
    if (screenTriangles !== 2) throw Error('The phone screen geometry does not match its calibration.');
  }

  /** Places the hand on the phone and curls it into GRIP. Call again after changing GRIP. */
  grip() {
    const degrees = THREE.MathUtils.degToRad;
    // The hand model stands fingers-up with its palm facing -x; turn the palm to the viewer first.
    const turn = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(degrees(GRIP.pitch), degrees(GRIP.yaw), degrees(GRIP.roll), 'ZXY')).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    this.mount.matrix.makeTranslation(...GRIP.position).multiply(turn).multiply(new THREE.Matrix4().makeTranslation(-GRIP.palm[0], -GRIP.palm[1], -GRIP.palm[2]));
    this.scene.updateMatrixWorld(true);
    this.hand.pose(GRIP.curl);
    // Each finger runs behind the phone to its left side; those long enough hook their tip round it.
    for (const finger of ['index', 'middle', 'ring', 'pinky']) {
      const bones = this.hand.bones[finger], joints = [...bones.slice(1).map(bone => bone.getWorldPosition(new THREE.Vector3())), this.hand.tip(finger)].map(point => this.phone.worldToLocal(point));
      const length = joints.slice(1).reduce((total, point, index) => total + point.distanceTo(joints[index]), 0);
      const along = new THREE.Vector2(joints[3].x - joints[0].x, joints[3].y - joints[0].y).normalize(), toEdge = (GRIP.edge[0] - joints[0].x) / along.x;
      const reach = toEdge > 0 && toEdge < length * .92 ? toEdge : length * .9;
      const target = new THREE.Vector3(joints[0].x + along.x * reach, joints[0].y + along.y * reach, reach === toEdge ? GRIP.edge[1] : GRIP.back);
      this.hand.reach(finger, this.phone.localToWorld(target), [1, 2, 3], 30);
    }
    this.hand.reach('thumb', this.phone.localToWorld(new THREE.Vector3().fromArray(GRIP.thumbRest)));

    // Axes, in the thumb's parent frame, that slide its tip up the glass and lift it off.
    const bone = this.hand.bones.thumb[1], arm = this.hand.tip('thumb').sub(bone.getWorldPosition(new THREE.Vector3()));
    const toParent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const axis = direction => arm.clone().cross(direction.transformDirection(this.phone.matrixWorld)).normalize().applyQuaternion(toParent);
    this.thumbRig = {bone, rest: bone.quaternion.clone(), swipe: axis(new THREE.Vector3(0, 1, 0)), lift: axis(new THREE.Vector3(0, 0, 1))};

    this.sleeve.clear();
    const {centre, radius, top, length} = GRIP.sleeve, fabric = new THREE.MeshStandardMaterial({color: 0x23272b, roughness: .92, metalness: 0});
    const arm3 = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, length, 28, 1, true), fabric);
    arm3.scale.set(radius[0], 1, radius[1]); arm3.position.set(centre[0], top - length / 2, centre[1]);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.1, .26, 28, 1, true), new THREE.MeshStandardMaterial({color: 0x191c1f, roughness: .8, metalness: 0, side: THREE.DoubleSide}));
    cuff.scale.set(radius[0], 1, radius[1]); cuff.position.set(centre[0], top - .12, centre[1]);
    fabric.side = THREE.DoubleSide;
    this.sleeve.add(arm3, cuff);
    this.poseThumb(); this.dirty = true;
  }

  poseThumb() {
    const {bone, rest, swipe, lift} = this.thumbRig, turn = new THREE.Quaternion();
    bone.quaternion.copy(rest)
      .premultiply(turn.setFromAxisAngle(swipe, this.thumb.along * GRIP.swipe))
      .premultiply(turn.setFromAxisAngle(lift, this.thumb.lift * GRIP.lift));
  }

  /** Puts the phone where the hold wants it for the current frame shape. */
  arrange() {
    if (!this.config) return;
    const hold = holds.find(item => item.id === this.config.hold) || holds[0], aspect = this.camera.aspect;
    this.camera.fov = aspect < 1 ? 70 : 58; this.camera.updateProjectionMatrix();
    const half = hold.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), [x, y] = holdOffset(hold, aspect);
    this.home = {position: new THREE.Vector3(x * half, y * half, -hold.distance), rotation: new THREE.Euler(...[hold.pitch, hold.yaw, hold.roll].map(THREE.MathUtils.degToRad), 'YXZ')};
    this.dirty = true;
  }

  // ---------- content ----------

  /** @param posts [{id, image, samples?}], top to bottom */
  setPosts(posts, theme) { this.screen.setPosts(posts, theme); this.redrawScreen = true; this.dirty = true; }

  /** Applies a scene config: {environment, hold, format, hud, bars}. */
  apply(config) {
    const reframed = this.config?.format !== config.format;
    this.config = config;
    this.setEnvironment(config.environment);
    this.hud.visible = config.hud; this.redrawScreen = true;
    if (reframed) this.resize(); else this.arrange();
    this.dirty = true; this.update(0);
  }

  // ---------- live ----------

  /** Scrolls the feed by `pixels` of screen (positive moves down the feed) with a thumb flick. */
  scrollBy(pixels) {
    if (!pixels) return;
    this.scroll.target += pixels;
    if (this.thumb.progress >= .6) { this.thumb.progress = 0; this.thumb.direction = Math.sign(pixels); }
  }

  setAuto(on, speed = this.auto.speed) {
    this.auto.on = on; this.auto.speed = speed; this.auto.timer = Math.min(this.auto.timer, .4);
  }

  listen() {
    const canvas = this.canvas;
    this.onWheel = event => { event.preventDefault(); this.scrollBy(event.deltaY * (event.deltaMode ? 40 : 1) * 1.4); };
    this.onMove = event => {
      const box = canvas.getBoundingClientRect();
      this.look.x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
      this.look.y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
      if (this.drag !== undefined) { this.scrollBy((this.drag - event.clientY) / box.height * SCREEN.height * 1.6); this.drag = event.clientY; }
    };
    this.onDown = event => { this.drag = event.clientY; canvas.setPointerCapture(event.pointerId); };
    this.onUp = () => { this.drag = undefined; };
    this.onLeave = () => { this.look.x = this.look.y = 0; };
    canvas.addEventListener('wheel', this.onWheel, {passive: false});
    canvas.addEventListener('pointermove', this.onMove); canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp); canvas.addEventListener('pointercancel', this.onUp); canvas.addEventListener('pointerleave', this.onLeave);
  }

  /** Starts or stops the live loop. It should only run while the scene is on show. */
  setActive(active) {
    if (active === Boolean(this.request)) return;
    if (active) { this.last = performance.now(); this.request = requestAnimationFrame(this.frame); }
    else { cancelAnimationFrame(this.request); this.request = 0; }
  }

  frame(now) {
    this.request = requestAnimationFrame(this.frame);
    this.update(Math.min(.05, (now - this.last) / 1000)); this.last = now;
  }

  /** Advances everything by `seconds` and, unless `draw` is false, draws a frame. */
  update(seconds, draw = true) {
    if (!this.ready || !this.config) return;
    this.clock += seconds;
    if (this.auto.on && (this.auto.timer -= seconds) <= 0) {
      const flick = nextFlick(this.auto.speed, this.auto.random);
      this.scrollBy(flick.distance); this.auto.timer = flick.wait;
    }
    const before = this.scroll.position;
    this.scroll.position = advanceScroll(this.scroll.position, this.scroll.target, seconds);
    const now = this.now();
    if (before !== this.scroll.position) this.redrawScreen = true;
    if (draw && (this.redrawScreen || this.screen.clock !== now.getHours() * 60 + now.getMinutes())) {
      this.screen.draw(this.scroll.position, {bars: this.config.bars, time: now});
      this.screenTexture.needsUpdate = true; this.redrawScreen = false;
    }

    // The thumb drags the feed, lifts and comes back; between flicks it hovers.
    const ease = 1 - Math.exp(-seconds * 20);
    let wanted = {along: -.6, lift: .5};
    if (this.thumb.progress < 1) {
      this.thumb.progress = Math.min(1, this.thumb.progress + seconds / .62);
      wanted = thumbGesture(this.thumb.progress); wanted.along *= this.thumb.direction;
    }
    this.thumb.along += (wanted.along - this.thumb.along) * ease; this.thumb.lift += (wanted.lift - this.thumb.lift) * ease;
    this.poseThumb();

    // Looking around: the view follows the pointer and the hand trails it slightly.
    const follow = 1 - Math.exp(-seconds * 6), look = this.look;
    const yaw = look.yaw + (-look.x * .16 - look.yaw) * follow, pitch = look.pitch + (-look.y * .1 - look.pitch) * follow;
    look.lagX += ((yaw - look.yaw) * 5 - look.lagX) * follow; look.lagY += ((pitch - look.pitch) * 5 - look.lagY) * follow;
    look.yaw = yaw; look.pitch = pitch;
    this.camera.rotation.set(pitch, yaw, 0);
    const breath = Math.sin(this.clock * 1.5), drift = Math.sin(this.clock * .83 + 1);
    this.viewmodel.position.copy(this.home.position); this.viewmodel.rotation.copy(this.home.rotation);
    this.viewmodel.position.x -= look.lagX * .5 - drift * .006; this.viewmodel.position.y += look.lagY * .5 + breath * .012;
    this.viewmodel.rotation.y -= look.lagX * .35; this.viewmodel.rotation.x -= look.lagY * .35 - breath * .004;
    this.viewmodel.rotation.z += look.lagX * .25 + drift * .004;
    if (draw) this.render();
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.hud.visible) this.renderer.render(this.hudScene, this.hudCamera);
  }

  setFrame(width, height, pixelRatio) {
    this.renderer.setPixelRatio(pixelRatio); this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.hudCanvas.width !== size.x || this.hudCanvas.height !== size.y) {
      this.hudCanvas.width = size.x; this.hudCanvas.height = size.y;
      this.hudTexture.dispose(); // The canvas changed size, so the GPU copy must be rebuilt.
    }
    drawHud(this.hudCanvas.getContext('2d'), size.x, size.y); this.hudTexture.needsUpdate = true;
    this.arrange();
  }

  resize() {
    const wrap = this.canvas.parentElement, width = wrap.clientWidth, height = wrap.clientHeight;
    if (!width || !height) return;
    this.setFrame(width, height, Math.min(devicePixelRatio, 2));
    if (this.ready && this.config) this.update(0);
  }

  async exportPNG() {
    if (!this.ready) throw Error('The models are still loading.');
    const format = formats.find(item => item.id === this.config.format) || formats[0];
    try {
      this.setFrame(format.width, format.height, 1); this.update(0);
      return await new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG export failed.')), 'image/png'));
    } finally { this.resize(); }
  }

  /** Starts recording the live view. Returns false where the browser cannot. */
  startRecording() {
    if (this.recorder || !window.MediaRecorder || !this.canvas.captureStream) return false;
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(item => MediaRecorder.isTypeSupported(item));
    if (!type) return false;
    const chunks = [];
    this.recorder = new MediaRecorder(this.canvas.captureStream(30), {mimeType: type, videoBitsPerSecond: 12_000_000});
    this.recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    this.recording = new Promise(resolve => { this.recorder.onstop = () => resolve(new Blob(chunks, {type: 'video/webm'})); });
    this.recorder.start(250);
    return true;
  }

  /** Stops recording and resolves with the WebM video. */
  async stopRecording() {
    if (!this.recorder) return null;
    const {recorder, recording} = this;
    this.recorder = null; recorder.stop(); recorder.stream.getTracks().forEach(track => track.stop());
    return recording;
  }

  dispose() {
    this.setActive(false); this.observer.disconnect();
    this.canvas.removeEventListener('wheel', this.onWheel); this.canvas.removeEventListener('pointermove', this.onMove); this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp); this.canvas.removeEventListener('pointercancel', this.onUp); this.canvas.removeEventListener('pointerleave', this.onLeave);
    for (const scene of [this.scene, this.hudScene]) scene.traverse(object => {
      object.geometry?.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material?.map?.dispose(); material?.dispose(); }
    });
    this.screenTexture.dispose(); this.renderer.dispose();
  }
}
