// The paint atlas: one 2048 x 2048 colour texture per weapon, built from a
// base finish plus one layer per paint zone.
import {SIZE, ZONES, designIdentity, planDesign, planStickerSheet, poolFor} from './generator.js';
import {randomFromSeed} from '../../shared/random.js';
import {DESIGN_WIDTH, SILHOUETTE_WIDTH, silhouettesFor, wearMaskFor} from './projector.js';

export function canvas(width = SIZE, height = width) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  // Keep compositing on one backend. Chromium can otherwise migrate a canvas
  // after readback and subtly change transparent pixel rounding between reads.
  c.getContext('2d', {willReadFrequently: true});
  return c;
}

/**
 * Rasterises each zone's UV triangles into a mask. A fixed owner per atlas
 * pixel prevents one zone from repainting another zone's locked artwork.
 */
export function createZoneMasks(meshes, zones = Object.keys(ZONES), uvAttribute = 'uv') {
  const masks = {}, claimed = new Uint8Array(SIZE * SIZE);
  for (const zone of zones) {
    const full = canvas(), ctx = full.getContext('2d', {willReadFrequently: true});
    ctx.fillStyle = '#fff'; ctx.beginPath();
    for (const mesh of meshes.filter(m => m.userData.zone === zone)) {
      const uv = mesh.geometry.attributes[uvAttribute], index = mesh.geometry.index;
      if (!uv) throw Error(`Missing UV coordinates for ${mesh.name}.`);
      const count = index ? index.count : uv.count;
      for (let i = 0; i < count; i += 3) {
        if (mesh.geometry.userData.stretched?.has(i)) continue;
        for (let k = 0; k < 3; k++) {
          const j = index ? index.getX(i + k) : i + k;
          const x = uv.getX(j) * SIZE, y = (1 - uv.getY(j)) * SIZE;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.fill('nonzero');
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    let pixelCount = 0;
    for (let i = 0; i < claimed.length; i++) {
      const valid = data.data[i * 4 + 3] > 64 && !claimed[i];
      data.data[i * 4 + 3] = valid ? 255 : 0;
      if (valid) { claimed[i] = 1; pixelCount++; }
    }
    if (!pixelCount) throw Error(`The ${zone} UV mask is empty.`);
    ctx.putImageData(data, 0, 0);
    masks[zone] = {full, pixelCount};
  }
  return masks;
}

function clipToMask(target, mask) {
  const ctx = target.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask.full, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/** The starting finish for models that ship without a usable colour texture. */
export function createBase(masks, colors = {}) {
  const base = canvas(), ctx = base.getContext('2d');
  ctx.fillStyle = '#343638'; ctx.fillRect(0, 0, SIZE, SIZE);
  for (const [zone, mask] of Object.entries(masks)) {
    const layer = canvas(), lc = layer.getContext('2d');
    const wood = ['Stock', 'Foregrip', 'Grip', 'Wood Fittings'].includes(zone);
    lc.fillStyle = colors[zone] || (wood ? '#78503a' : zone === 'Magazine' ? '#3c4246' : '#41484c');
    lc.fillRect(0, 0, SIZE, SIZE);
    const rng = randomFromSeed(`finish:${zone}`);
    lc.lineWidth = wood ? 1.5 : .8;
    for (let i = 0; i < (colors[zone] ? 0 : wood ? 650 : 1600); i++) {
      const y = rng() * SIZE;
      lc.strokeStyle = wood ? `rgba(28,10,2,${.04 + rng() * .12})` : `rgba(220,228,232,${rng() * .035})`;
      lc.beginPath(); lc.moveTo(0, y); lc.bezierCurveTo(650, y + rng() * 12, 1300, y - rng() * 15, SIZE, y + rng() * 9); lc.stroke();
    }
    clipToMask(layer, mask); ctx.drawImage(layer, 0, 0);
  }
  return base;
}

/**
 * Turns a design identity into baked atlas pixels: plans both side layouts,
 * draws them, and projects them onto the weapon.
 */
export class SkinPainter {
  constructor(model, projector, composer, printer) {
    this.model = model; this.projector = projector; this.composer = composer; this.printer = printer;
    this.lastDesigns = null;
  }

  /**
   * Bakes a sheet of stickers over the whole weapon. Returns two atlas-sized
   * canvases: the stickers' colour, and their surface (roughness, metalness).
   */
  paintStickers({images, settings}) {
    const silhouettes = silhouettesFor(this.model, null);
    const records = [...images.values()].map(entry => ({id: entry.id, aspect: entry.image.width / entry.image.height}));
    const sides = {};
    for (const side of ['left', 'right']) {
      const plan = planStickerSheet({seed: settings.seed, side, images: records, silhouette: silhouettes[side], count: settings.count, size: settings.size});
      sides[side] = this.printer.compose(plan, this.model.design, DESIGN_WIDTH / SILHOUETTE_WIDTH, images, settings.effect);
    }
    const bake = layer => this.projector.bake(this.model.meshes, this.model.frame, sides.left[layer], sides.right[layer], this.model.mirrored);
    return {color: bake('color'), surface: bake('surface')};
  }

  paint({identity, pool, zones, settings, look, images}) {
    const silhouettes = silhouettesFor(this.model, identity.focus);
    const records = pool.map(id => ({id, aspect: images.get(id).image.width / images.get(id).image.height}));
    const designs = {};
    for (const side of ['left', 'right']) {
      const plan = planDesign({
        style: settings.style, scale: settings.scale, seed: identity.seed, side, images: records, silhouette: silhouettes[side],
        text: settings.text, fade: settings.fade, stripes: settings.stripes,
      });
      designs[side] = this.composer.compose(plan, this.model.design, DESIGN_WIDTH / SILHOUETTE_WIDTH, images, look);
    }
    this.lastDesigns = designs;
    const meshes = this.model.meshes.filter(mesh => zones.includes(mesh.userData.zone));
    return this.projector.bake(meshes, this.model.frame, designs.left, designs.right, this.model.mirrored);
  }
}

export class Atlas {
  constructor(meshes, options = {}, painter) {
    this.zones = options.zones || Object.keys(ZONES);
    this.painter = painter;
    this.masks = createZoneMasks(meshes, this.zones, options.uvAttribute || 'uv');
    this.base = createBase(this.masks, options.colors);
    if (options.baseImage) this.base.getContext('2d').drawImage(options.baseImage, 0, 0, SIZE, SIZE);
    this.canvas = canvas();
    this.layers = Object.fromEntries(this.zones.map(zone => [zone, canvas()]));
    this.keys = Object.fromEntries(this.zones.map(zone => [zone, 'original']));
    this.canvas.getContext('2d').drawImage(this.base, 0, 0);
    this.paintedZones = new Set();
    this.stickers = null; this.stickerKey = '';
  }

  get hasArtwork() { return this.paintedZones.size > 0; }

  /**
   * Repaints every unlocked zone whose inputs changed. `images` is the
   * library (array of {id, image, stats}); `look` carries the palette and
   * treatment. Locked zones keep their pixels exactly as they are.
   * `stickers` ({images, settings}) is the separate sticker pass laid on top.
   */
  async update(parts, images, settings, look, onProgress = () => {}, stickers = null) {
    const byId = new Map(images.map(entry => [entry.id, entry])), ids = images.map(entry => entry.id);
    const groups = new Map(), pause = () => new Promise(resolve => setTimeout(resolve, 0));
    for (const zone of this.zones) {
      const part = parts[zone];
      if (!part || part.locked) continue;
      const layer = this.layers[zone], ctx = layer.getContext('2d');
      const pool = part.mode === 'art' ? poolFor(part, ids) : [];
      let key = 'original';
      if (part.mode === 'solid') key = `solid:${look.palette[part.solid]}`;
      else if (pool.length) {
        const identity = designIdentity(zone, part, settings.seed);
        key = JSON.stringify([identity, pool, settings.style, settings.scale, settings.style === 'text' ? settings.text : '', settings.fade, settings.stripes, look.key]);
        if (key !== this.keys[zone]) {
          if (!groups.has(key)) groups.set(key, {identity, pool, zones: []});
          groups.get(key).zones.push(zone);
        }
        continue;
      }
      if (key === this.keys[zone]) continue;
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (part.mode === 'solid') { ctx.fillStyle = look.palette[part.solid]; ctx.fillRect(0, 0, SIZE, SIZE); clipToMask(layer, this.masks[zone]); }
      this.keys[zone] = key;
    }

    for (const [key, group] of groups) {
      onProgress(group.zones);
      await pause();
      const baked = this.painter.paint({...group, settings, look, images: byId});
      for (const zone of group.zones) {
        const layer = this.layers[zone], ctx = layer.getContext('2d');
        ctx.clearRect(0, 0, SIZE, SIZE); ctx.drawImage(baked, 0, 0); clipToMask(layer, this.masks[zone]);
        this.keys[zone] = key;
      }
      baked.width = baked.height = 0; // Release the 16 MB scratch canvas promptly.
    }

    this.paintedZones = new Set(this.zones.filter(zone => this.keys[zone] !== 'original'));
    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.base, 0, 0);
    if (settings.wear && this.paintedZones.size) {
      // Edge wear is an overlay, not part of any layer: all the paint is
      // gathered, rubbed away along the wear mask, then laid over the finish.
      const paint = this.scratch ||= canvas(), pc = paint.getContext('2d');
      pc.clearRect(0, 0, SIZE, SIZE);
      for (const zone of this.zones) pc.drawImage(this.layers[zone], 0, 0);
      pc.globalCompositeOperation = 'destination-out'; pc.drawImage(wearMaskFor(this.painter.model), 0, 0);
      pc.globalCompositeOperation = 'source-over';
      ctx.drawImage(paint, 0, 0);
    } else {
      for (const zone of this.zones) ctx.drawImage(this.layers[zone], 0, 0);
    }

    // Stickers go on last, over paint, wear and factory finish alike.
    const wanted = stickers && stickers.images.length > 0 && stickers.settings.count > 0;
    const stickerKey = wanted ? JSON.stringify([stickers.images.map(entry => entry.id).sort(), stickers.settings]) : '';
    if (stickerKey !== this.stickerKey) {
      for (const layer of Object.values(this.stickers || {})) layer.width = layer.height = 0;
      this.stickers = null;
      if (wanted) {
        onProgress(['stickers']);
        await pause();
        this.stickers = this.painter.paintStickers({images: new Map(stickers.images.map(entry => [entry.id, entry])), settings: stickers.settings});
      }
      this.stickerKey = stickerKey;
    }
    if (this.stickers) ctx.drawImage(this.stickers.color, 0, 0);
  }

  /**
   * A roughness (green) and metalness (blue) texture for the weapon while it
   * carries stickers. `values` maps each zone that should use it to its own
   * {roughness, metalness}; the stickers' surface is laid over those.
   */
  surfaceMap(values) {
    const map = this.surface ||= canvas(), ctx = map.getContext('2d');
    const fill = ({roughness, metalness}) => `rgb(0, ${Math.round(roughness * 255)}, ${Math.round(metalness * 255)})`;
    // Flood with one zone's value first, so texture filtering at island
    // edges never picks up an unset (mirror-smooth) texel.
    const first = values.values().next().value;
    ctx.fillStyle = first ? fill(first) : '#00b000'; ctx.fillRect(0, 0, SIZE, SIZE);
    const layer = this.scratch ||= canvas(), lc = layer.getContext('2d');
    for (const [zone, value] of values) {
      lc.globalCompositeOperation = 'source-over'; lc.fillStyle = fill(value); lc.fillRect(0, 0, SIZE, SIZE);
      clipToMask(layer, this.masks[zone]); ctx.drawImage(layer, 0, 0);
    }
    if (this.stickers) ctx.drawImage(this.stickers.surface, 0, 0);
    return map;
  }
}
