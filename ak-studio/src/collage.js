import {SIZE, ZONES, DENSITIES, randomFromSeed, chooseImages} from './generator.js';

export function canvas(width = SIZE, height = width) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  // Keep compositing on one backend. Chromium can otherwise migrate a canvas
  // after readback and subtly change transparent pixel rounding between reads.
  c.getContext('2d', {willReadFrequently: true});
  return c;
}

// Rasterize the model itself, not skingen's independently cropped mask images.
// A fixed owner per UV pixel prevents another zone repainting a locked zone.
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
    const small = canvas(256), sctx = small.getContext('2d', {willReadFrequently: true});
    sctx.drawImage(full, 0, 0, 256, 256);
    const pixels = sctx.getImageData(0, 0, 256, 256).data;
    const valid = new Uint8Array(256 * 256), centers = [];
    for (let i = 0; i < valid.length; i++) if (pixels[i * 4 + 3] > 128) { valid[i] = 1; centers.push(i); }
    masks[zone] = {full, valid, centers, pixelCount, smallArea: centers.length};
  }
  return masks;
}

function clipToMask(source, mask) {
  const ctx = source.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask.full, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

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

function scoreRect(candidate, mask, occupancy, commit = false) {
  const {x, y, w, h, angle} = candidate, cos = Math.cos(angle), sin = Math.sin(angle);
  const radius = Math.hypot(w, h) / 2;
  let fresh = 0, overlap = 0, spill = 0;
  const stride = commit ? 1 : 3;
  for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(255, y + radius); py += stride) {
    for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(255, x + radius); px += stride) {
      const dx = px - x, dy = py - y;
      if (Math.abs(dx * cos + dy * sin) > w / 2 || Math.abs(-dx * sin + dy * cos) > h / 2) continue;
      const index = py * 256 + px;
      if (!mask.valid[index]) spill++;
      else if (occupancy[index]) overlap++;
      else fresh++;
      if (commit && mask.valid[index]) occupancy[index] = 1;
    }
  }
  return fresh - overlap * .55 - spill * .65;
}

// Inspired by skingen's candidate-scoring collage layout. Score at low resolution
// without allocating an atlas per candidate; draw only the winners at full size.
export function createCollage(zone, part, images, mask) {
  const layer = canvas();
  if (!part.seed || !images.length) return layer;
  const pool = part.allowed.length ? images.filter(image => part.allowed.includes(image.id)) : images;
  if (!pool.length || !mask.centers.length) return layer;
  const key = `${part.seed}:${zone}:${part.revision}:${part.density}`;
  const rng = randomFromSeed(key), settings = DENSITIES[part.density];
  const choices = chooseImages(pool.map(image => image.id), `${key}:images`, settings.count);
  const occupancy = new Uint8Array(256 * 256), ctx = layer.getContext('2d');
  for (const id of choices) {
    const image = pool.find(image => image.id === id).image;
    const aspect = image.width / image.height;
    let best;
    for (let attempt = 0; attempt < 72; attempt++) {
      const center = mask.centers[Math.floor(rng() * mask.centers.length)];
      const area = mask.smallArea * settings.coverage / settings.count * (.7 + rng() * 1.15);
      const w = Math.sqrt(area * aspect), h = w / aspect;
      const angle = (rng() < .3 ? Math.PI / 2 : 0) + (rng() - .5) * .55;
      const candidate = {x: center % 256, y: Math.floor(center / 256), w, h, angle};
      const score = scoreRect(candidate, mask, occupancy);
      if (!best || score > best.score) best = {...candidate, score};
    }
    if (!best) continue;
    scoreRect(best, mask, occupancy, true);
    ctx.save(); ctx.translate(best.x * 8, best.y * 8); ctx.rotate(best.angle);
    ctx.drawImage(image, -best.w * 4, -best.h * 4, best.w * 8, best.h * 8); ctx.restore();
  }
  clipToMask(layer, mask);
  return layer;
}

export class Atlas {
  constructor(meshes, options = {}) {
    this.zones = options.zones || Object.keys(ZONES);
    this.masks = createZoneMasks(meshes, this.zones, options.uvAttribute || 'uv'); this.base = createBase(this.masks, options.colors);
    if (options.baseImage) this.base.getContext('2d').drawImage(options.baseImage, 0, 0, SIZE, SIZE);
    this.canvas = canvas(); this.layers = {}; this.keys = {}; this.artwork = {};
    this.canvas.getContext('2d').drawImage(this.base, 0, 0);
  }
  async update(parts, images, onProgress = () => {}) {
    for (const zone of this.zones) {
      const part = parts[zone];
      const poolIds = part?.allowed.length ? images.filter(i => part.allowed.includes(i.id)).map(i => i.id) : images.map(i => i.id);
      const key = JSON.stringify([part?.seed, part?.density, part?.revision, poolIds.sort()]);
      if (!(part?.locked && this.layers[zone]) && this.keys[zone] !== key) {
        this.layers[zone] = part ? createCollage(zone, part, images, this.masks[zone]) : canvas();
        this.artwork[zone] = Boolean(part?.seed && poolIds.length);
        this.keys[zone] = key;
      }
      onProgress(zone);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const ctx = this.canvas.getContext('2d'); ctx.drawImage(this.base, 0, 0);
    for (const zone of this.zones) ctx.drawImage(this.layers[zone], 0, 0);
    this.hasArtwork = Object.values(this.artwork).some(Boolean);
  }
}
