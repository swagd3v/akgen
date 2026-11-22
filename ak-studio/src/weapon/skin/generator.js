// Pure skin-generation logic: settings, per-part state and layout planning.
// No DOM or WebGL in here, so every decision is reproducible under node --test.
import {randomFromSeed, pick, shuffled} from '../../shared/random.js';
import {PALETTE_PRESETS} from './palette.js';

export const SIZE = 2048;
export const DEFAULT_SEED = 'edition-001';

// Classic AK-47 paint zones. Names follow skingen's components, including source typos.
export const ZONES = {
  Body: ['UPPER_RECIEVER', 'LOWER_RECIEVER'],
  Barrel: ['BARREL', 'GASTUBE', 'GAS_LOCK', 'FRONT_HARDWARE', 'CLEANING_ROD'],
  Stock: ['STOCK', 'STOCK_PLATE', 'STOCK_HARDWARE'],
  Magazine: ['MAGAZINE', 'BULLETS'],
  Grip: ['PISTOL_GRIP', 'TRIGGER', 'TRIGGER_GAURD', 'MAG_RELEASE'],
  Foregrip: ['FOREGRIP_LOWER', 'FOREGRIP_TOP'],
  Details: ['BOLT', 'SIGHT_REAR', 'SCOPE_MOUNT', 'SPRING_COVER', 'BATTERY', 'BLOCK_&_BATTERY', 'BITS_N_THANGS', 'SAFE'],
};

export function zoneForName(name) {
  return Object.keys(ZONES).find(zone => ZONES[zone].includes(name.toUpperCase())) || null;
}

export const STYLES = {
  collage: {label: 'Collage', hint: 'Overlapping images cover the whole weapon, laid out on its side profile.'},
  panels: {label: 'Panels', hint: 'Angled bands along the weapon, one image per band.'},
  camo: {label: 'Camo', hint: 'Camouflage blobs, each cut from a different image or a palette colour.'},
  text: {label: 'Stencil', hint: 'Your word set large along the weapon, with the images showing through the letters.'},
  hero: {label: 'Hero', hint: 'One image shown whole on the receiver, the rest in palette colours.'},
  split: {label: 'Split', hint: 'Artwork up front, a solid colour behind, divided by a hard diagonal.'},
  film: {label: 'Filmstrip', hint: 'Rows of film frames with sprocket holes, one image per frame.'},
  slices: {label: 'Slices', hint: 'One image cut into strips that slip up and down.'},
  hex: {label: 'Hex', hint: 'A honeycomb of cells, each holding a different image.'},
  pattern: {label: 'Pattern', hint: 'One image, mirrored and repeated from stock to muzzle.'},
};

// Sizes are multiples of the weapon's average body thickness in profile, so
// an image at 1.0 is about as tall as the receiver.
export const SCALES = {
  bold: {
    label: 'Bold', hint: 'Few, large shapes.', collage: {height: 2.1, max: 14}, panels: 2, pattern: 2.4,
    camo: {radius: 1.05, max: 18}, text: {height: 2.3, rows: 1}, hero: 2.7, film: 2.3, slices: 1.1, hex: 1.15,
  },
  balanced: {
    label: 'Balanced', hint: 'Sized so each image stays readable.', collage: {height: 1.45, max: 24}, panels: 4, pattern: 1.3,
    camo: {radius: .72, max: 34}, text: {height: 1.5, rows: 1}, hero: 2.1, film: 1.6, slices: .6, hex: .75,
  },
  busy: {
    label: 'Busy', hint: 'Many small shapes.', collage: {height: .95, max: 60}, panels: 7, pattern: .75,
    camo: {radius: .48, max: 80}, text: {height: .95, rows: 3}, hero: 1.6, film: 1.1, slices: .32, hex: .46,
  },
};

export const TREATMENTS = {
  original: {label: 'Original', hint: 'Images keep their own colours.'},
  matched: {label: 'Matched', hint: 'Brightness, contrast and colour cast are pulled together.'},
  duotone: {label: 'Duotone', hint: 'Every image is recoloured with the palette. The most unified look.'},
  halftone: {label: 'Halftone', hint: 'Comic-print dots in palette colours. Hides differences in photo quality.'},
  poster: {label: 'Poster', hint: 'Every image flattened to the four palette colours, like a screen print.'},
};

export const BASE_COATS = {
  none: 'Factory finish', dark: 'Palette dark', main: 'Palette main', light: 'Palette light', accent: 'Palette accent',
};

export const FINISHES = {
  auto: {label: 'Auto'},
  matte: {label: 'Matte', metalness: 0, roughness: .82},
  satin: {label: 'Satin', metalness: .05, roughness: .5},
  gloss: {label: 'Gloss', metalness: .12, roughness: .22},
};

// Finishing passes laid over any layout.
export const TOUCHES = {
  fade: {label: 'Fade', hint: 'Artwork dissolves into the base coat toward the muzzle and stock.'},
  stripes: {label: 'Stripes', hint: 'Racing stripes run the length of the weapon.'},
  wear: {label: 'Edge wear', hint: 'Paint is scuffed back to the factory finish along hard edges.'},
};

export const DEFAULT_TEXT = 'AK-47';

export const DEFAULT_SETTINGS = Object.freeze({
  seed: DEFAULT_SEED, style: 'collage', scale: 'balanced', treatment: 'matched',
  palette: 'auto', custom: null, baseCoat: 'dark', finish: 'auto',
  text: DEFAULT_TEXT, fade: false, stripes: false, wear: false,
});

/** Seeded picks for every look setting, for exploring combinations quickly. */
export function surprise(seed) {
  const random = randomFromSeed(`${seed}:surprise`);
  const style = pick(Object.keys(STYLES), random);
  return {
    style,
    scale: pick(Object.keys(SCALES), random),
    treatment: pick(['matched', 'duotone', 'duotone', 'halftone', 'poster', 'original'], random),
    palette: pick(['auto', 'auto', ...PALETTE_PRESETS.map(preset => preset.id)], random),
    baseCoat: pick(style === 'hero' ? ['dark', 'main', 'light'] : ['dark', 'dark', 'main'], random),
    fade: random() < .2, stripes: random() < .25, wear: random() < .35,
  };
}

// ---------------------------------------------------------------- parts

export const PART_MODES = {art: 'Artwork', solid: 'Solid colour', original: 'Factory finish'};

export function initialParts(zones = Object.keys(ZONES)) {
  return Object.fromEntries(zones.map(zone => [zone, {locked: false, mode: 'art', solid: 'main', allowed: [], revision: 0}]));
}

/** A new edition: unlocked parts drop their individual remixes and rejoin the shared design. */
export function resetRevisions(parts) {
  return Object.fromEntries(Object.entries(parts).map(([zone, part]) =>
    [zone, {...part, allowed: [...part.allowed], revision: part.locked ? part.revision : 0}]));
}

/** The image ids a part may use, sorted so upload order never matters. */
export function poolFor(part, imageIds) {
  const pool = part.allowed.length ? imageIds.filter(id => part.allowed.includes(id)) : imageIds;
  return [...pool].sort();
}

/**
 * Parts share one design unless they were remixed or given their own image
 * set. Two parts with equal identities are painted from the same artwork, so
 * images flow across them without a break.
 */
export function designIdentity(zone, part, seed) {
  const own = part.revision > 0 || part.allowed.length > 0;
  return own ? {seed: `${seed}/${zone}/${part.revision}`, focus: zone} : {seed, focus: null};
}

// ---------------------------------------------------------------- layout

/**
 * Counts how a rotated rectangle lands on a silhouette: pixels of the weapon
 * it newly covers, pixels it stacks onto earlier artwork, and pixels that
 * miss the weapon entirely.
 */
function measure(rect, silhouette, mask, occupancy, commit = false) {
  const {x, y, w, h, angle} = rect, cos = Math.cos(angle), sin = Math.sin(angle);
  const radius = Math.hypot(w, h) / 2, stride = commit ? 1 : 2;
  let fresh = 0, overlap = 0, spill = 0;
  for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(silhouette.height - 1, y + radius); py += stride) {
    for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(silhouette.width - 1, x + radius); px += stride) {
      const dx = px - x, dy = py - y;
      if (Math.abs(dx * cos + dy * sin) > w / 2 || Math.abs(-dx * sin + dy * cos) > h / 2) continue;
      const index = py * silhouette.width + px;
      if (!mask[index]) spill++;
      else if (occupancy[index]) overlap++;
      else fresh++;
      if (commit && mask[index]) occupancy[index] = 1;
    }
  }
  return {fresh, overlap, spill};
}

function indicesOf(mask) {
  const out = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return out;
}

/** Cycles through a shuffled pool so every image is used before any repeats. */
function imageCycle(images, random) {
  let queue = [];
  return () => {
    if (!queue.length) queue = shuffled(images, random);
    return queue.pop();
  };
}

/** Penalty for landing next to an earlier copy of the same image. */
function crowding(rect, id, placements) {
  let penalty = 0;
  for (const other of placements) {
    if (other.id !== id) continue;
    const reach = (Math.max(rect.w, rect.h) + Math.max(other.w, other.h)) * .9;
    penalty += Math.max(0, 1 - Math.hypot(rect.x - other.x, rect.y - other.y) / reach);
  }
  return penalty * rect.w * rect.h;
}

function planCollage({images, silhouette, random, scale}) {
  const {height, max} = SCALES[scale].collage;
  const mask = silhouette.valid, targets = indicesOf(mask), occupancy = new Uint8Array(mask.length);
  // Nudge the size so the collection roughly covers the weapon once: a
  // handful of images grow a little rather than repeat, many shrink a little.
  const nominal = silhouette.thickness * height;
  const meanAspect = images.reduce((total, image) => total + Math.max(.45, Math.min(2.4, image.aspect)), 0) / images.length;
  const base = Math.max(nominal * .8, Math.min(nominal * 1.3, Math.sqrt(targets.length * 1.4 / images.length / meanAspect)));
  const next = imageCycle(images, random), placements = [];
  let covered = 0;
  while (placements.length < max && covered < targets.length * .985) {
    const image = next(), h = base * (.85 + random() * .3), w = h * Math.max(.45, Math.min(2.4, image.aspect));
    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      // Aim at still-uncovered spots so late images close the remaining gaps.
      let center = targets[Math.floor(random() * targets.length)];
      for (let retry = 0; retry < 5 && occupancy[center]; retry++) center = targets[Math.floor(random() * targets.length)];
      const rect = {x: center % silhouette.width, y: Math.floor(center / silhouette.width), w, h, angle: (random() - .5) * .34};
      const {fresh, overlap, spill} = measure(rect, silhouette, mask, occupancy);
      const score = fresh - overlap * .3 - spill * .2 - crowding(rect, image.id, placements) * .6;
      if (!best || score > best.score) best = {...rect, score};
    }
    covered += measure(best, silhouette, mask, occupancy, true).fresh;
    placements.push({kind: 'image', id: image.id, x: best.x, y: best.y, w: best.w, h: best.h, angle: best.angle});
  }
  return placements;
}

function planStickers({images, silhouette, random, count, height}) {
  const mask = silhouette.core, targets = indicesOf(mask), occupancy = new Uint8Array(mask.length);
  const base = silhouette.thickness * height, next = imageCycle(images, random);
  const placements = [];
  for (let n = 0; n < count; n++) {
    const image = next(), h = base * (.85 + random() * .35), w = h * Math.max(.5, Math.min(2.2, image.aspect));
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const center = targets[Math.floor(random() * targets.length)];
      const rect = {x: center % silhouette.width, y: Math.floor(center / silhouette.width), w, h, angle: (random() - .5) * .6};
      const {fresh, overlap, spill} = measure(rect, silhouette, mask, occupancy);
      const score = fresh - overlap * 2.5 - spill * .9 - crowding(rect, image.id, placements) * .5;
      if (!best || score > best.score) best = {...rect, score};
    }
    measure(best, silhouette, mask, occupancy, true);
    placements.push({kind: 'sticker', id: image.id, x: best.x, y: best.y, w: best.w, h: best.h, angle: best.angle});
  }
  return placements;
}

function planPanels({images, silhouette, random, scale}) {
  const count = SCALES[scale].panels, {box, width, height} = silhouette;
  const centerY = (box.y0 + box.y1) / 2, slant = (random() < .5 ? -1 : 1) * (.25 + random() * .35);
  const weights = Array.from({length: count}, () => .7 + random() * .6), total = weights.reduce((a, b) => a + b, 0);
  // Interior boundaries split the weapon's length; the outer two panels run
  // off the canvas so wrapped faces at the muzzle and stock stay covered.
  const edges = [-width * 2];
  let cursor = box.x0;
  for (let i = 0; i < count - 1; i++) { cursor += weights[i] / total * (box.x1 - box.x0); edges.push(cursor); }
  edges.push(width * 3);

  const bounds = Array.from({length: count}, () => ({x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity}));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!silhouette.valid[y * width + x]) continue;
    const along = x - slant * (y - centerY);
    let panel = 0;
    while (panel < count - 1 && along >= edges[panel + 1]) panel++;
    const b = bounds[panel];
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x + 1); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y + 1);
  }

  const top = -height, bottom = height * 2, at = (edge, y) => edge + slant * (y - centerY);
  const next = imageCycle(images, random), placements = [];
  for (let panel = 0; panel < count; panel++) {
    const b = bounds[panel];
    if (b.x0 === Infinity) continue;
    const image = next(), bw = b.x1 - b.x0 + 4, bh = b.y1 - b.y0 + 4;
    const w = Math.max(bw, bh * image.aspect), h = w / image.aspect;
    placements.push({
      kind: 'image', id: image.id, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, w, h, angle: 0,
      clip: [[at(edges[panel], top), top], [at(edges[panel + 1], top), top], [at(edges[panel + 1], bottom), bottom], [at(edges[panel], bottom), bottom]],
    });
  }
  const lineWidth = silhouette.thickness * .09;
  for (let i = 1; i < count; i++) placements.push({kind: 'line', from: [at(edges[i], top), top], to: [at(edges[i], bottom), bottom], width: lineWidth});
  return placements;
}

function planPattern({images, silhouette, random, scale}) {
  const image = pick(images, random), {box} = silhouette;
  const h = silhouette.thickness * SCALES[scale].pattern;
  return [{kind: 'tile', id: image.id, x: box.x0 + random() * h * image.aspect, y: box.y0, w: h * image.aspect, h}];
}

// ---- shared measurements, cached on the silhouette

/** The row and column where the weapon's mass is centred: roughly the middle of the receiver. */
function bodyCentre(silhouette) {
  if (silhouette.centre) return silhouette.centre;
  const {width, height, core} = silhouette, rows = new Float64Array(height);
  let total = 0, sumX = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (core[y * width + x]) { rows[y]++; total++; sumX += x; }
  let seen = 0, y = 0;
  while (y < height - 1 && seen + rows[y] < total / 2) seen += rows[y++];
  return silhouette.centre = {x: sumX / total, y: y + .5};
}

/** Bounding box of the area artwork has to cover. */
function coverBox(silhouette) {
  if (silhouette.cover) return silhouette.cover;
  const {width, height, valid} = silhouette, box = {x0: width, y0: height, x1: 0, y1: 0};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (valid[y * width + x]) {
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x + 1); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y + 1);
  }
  return silhouette.cover = box;
}

function touchesWeapon(silhouette, x0, y0, x1, y1) {
  const {width, height, valid} = silhouette;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, y1); y += 2) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, x1); x += 2) if (valid[y * width + x]) return true;
  }
  return false;
}

/** Centre and size for an image that must cover a w x h box centred on (x, y). */
function coverFit(image, x, y, w, h) {
  const width = Math.max(w, h * image.aspect);
  return {x, y, w: width, h: width / image.aspect, angle: 0};
}

const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---- the newer layouts

/** A lumpy closed outline, wider than tall, like a patch of camouflage. */
function blob(x, y, radius, random) {
  const phases = [random() * 6.283, random() * 6.283, random() * 6.283], tilt = (random() - .5) * 1.2;
  const stretch = 1.35 + random() * .5, cos = Math.cos(tilt), sin = Math.sin(tilt), points = [];
  for (let step = 0; step < 20; step++) {
    const angle = step / 20 * Math.PI * 2;
    const reach = radius * (1 + .3 * Math.sin(2 * angle + phases[0]) + .2 * Math.sin(3 * angle + phases[1]) + .1 * Math.sin(5 * angle + phases[2]));
    const px = Math.cos(angle) * reach * stretch, py = Math.sin(angle) * reach;
    points.push([x + px * cos - py * sin, y + px * sin + py * cos]);
  }
  return points;
}

function planCamo({images, silhouette, random, scale}) {
  const {radius, max} = SCALES[scale].camo, mask = silhouette.valid, targets = indicesOf(mask), occupancy = new Uint8Array(mask.length);
  const next = imageCycle(images, random), solids = ['dark', 'main', 'accent'], placements = [];
  let covered = 0;
  while (placements.length < max && covered < targets.length * .93) {
    const size = silhouette.thickness * radius * (.75 + random() * .5);
    let best = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      let centre = targets[Math.floor(random() * targets.length)];
      for (let retry = 0; retry < 5 && occupancy[centre]; retry++) centre = targets[Math.floor(random() * targets.length)];
      const rect = {x: centre % silhouette.width, y: Math.floor(centre / silhouette.width), w: size * 2.4, h: size * 1.6, angle: 0};
      const {fresh, overlap} = measure(rect, silhouette, mask, occupancy);
      if (!best || fresh - overlap * .4 > best.score) best = {...rect, score: fresh - overlap * .4};
    }
    covered += measure(best, silhouette, mask, occupancy, true).fresh;
    const outline = blob(best.x, best.y, size, random);
    // Roughly one patch in three is flat colour: that is what makes it read
    // as camouflage instead of a collage with odd edges.
    if (random() < .32) placements.push({kind: 'fill', color: solids[placements.length % solids.length], clip: outline, smooth: true});
    else {
      const image = next();
      placements.push({kind: 'image', id: image.id, ...coverFit(image, best.x, best.y, size * 4, size * 3), clip: outline, smooth: true});
    }
  }
  return placements;
}

function planText(context) {
  const {silhouette, scale, text} = context, {height, rows} = SCALES[scale].text, centre = bodyCentre(silhouette);
  return [{
    kind: 'group', children: planCollage(context),
    text: {value: text, x0: silhouette.box.x0, x1: silhouette.box.x1, y: centre.y, height: silhouette.thickness * height, rows},
  }];
}

function planHero({images, silhouette, shared, scale}) {
  const image = pick(images, shared), centre = bodyCentre(silhouette), h = silhouette.thickness * SCALES[scale].hero;
  const stripe = silhouette.thickness * .1, y = centre.y - h * .28, far = silhouette.width * 3;
  return [
    {kind: 'line', from: [-far, y], to: [far, y], width: stripe, color: 'accent'},
    {kind: 'line', from: [-far, y + stripe * 1.8], to: [far, y + stripe * 1.8], width: stripe * .45, color: 'light'},
    {kind: 'image', id: image.id, x: centre.x, y: centre.y, w: h * image.aspect, h, angle: 0, frame: stripe * .6},
  ];
}

function planSplit(context) {
  const {silhouette, shared, side} = context, {box, width, height} = silhouette, centre = bodyCentre(silhouette);
  // Decided once for both flanks, then mirrored, so the cut sits at the same
  // place on the weapon whichever side you look at. Artwork is toward the muzzle.
  const along = .38 + shared() * .24, lean = (shared() < .5 ? -1 : 1) * (.4 + shared() * .5), flip = side === 'right' ? -1 : 1;
  const span = box.x1 - box.x0, cut = side === 'right' ? box.x1 - along * span : box.x0 + along * span, slant = lean * flip;
  const top = -height, bottom = height * 2, at = (y, offset = 0) => cut + offset + slant * (y - centre.y);
  const front = -flip * width * 3, rear = flip * width * 3, stripe = silhouette.thickness * .2, gap = flip * silhouette.thickness * .32;
  return [
    {kind: 'group', clip: [[front, top], [at(top), top], [at(bottom), bottom], [front, bottom]], children: planCollage(context)},
    {kind: 'fill', color: 'main', clip: [[rear, top], [at(top), top], [at(bottom), bottom], [rear, bottom]]},
    {kind: 'line', from: [at(top), top], to: [at(bottom), bottom], width: stripe, color: 'accent'},
    {kind: 'line', from: [at(top, gap), top], to: [at(bottom, gap), bottom], width: stripe * .35, color: 'light'},
  ];
}

function planFilm({images, silhouette, random, scale}) {
  const {width, height} = silhouette, row = silhouette.thickness * SCALES[scale].film, centre = bodyCentre(silhouette);
  const frameHeight = row * .7, frameWidth = frameHeight * 1.45, gap = row * .09, hole = row * .07, next = imageCycle(images, random);
  const placements = [{kind: 'fill', color: 'dark'}];
  const firstRow = Math.floor((-centre.y - row / 2) / row);
  for (let index = firstRow; centre.y + (index - .5) * row < height; index++) {
    const y = centre.y + index * row, start = -random() * (frameWidth + gap) - width * .05;
    for (let x = start; x < width; x += frameWidth + gap) {
      if (!touchesWeapon(silhouette, x, y - frameHeight / 2, x + frameWidth, y + frameHeight / 2)) continue;
      const image = next();
      placements.push({kind: 'image', id: image.id, ...coverFit(image, x + frameWidth / 2, y, frameWidth, frameHeight), clip: rectangle(x, y - frameHeight / 2, x + frameWidth, y + frameHeight / 2)});
    }
    for (const edge of [-1, 1]) for (let x = start; x < width; x += hole * 2.4) {
      placements.push({kind: 'rect', x, y: y + edge * (row * .425) - hole / 2, w: hole * 1.3, h: hole, color: 'light'});
    }
  }
  return placements;
}

function planSlices({images, silhouette, random, shared, scale}) {
  const image = pick(images, shared), box = coverBox(silhouette), centre = bodyCentre(silhouette), strip = silhouette.thickness * SCALES[scale].slices;
  // The image is sized to the receiver and mirror-repeats in every direction,
  // so the whole picture is visible on the body; each strip then shows it
  // nudged up or down.
  const h = silhouette.thickness * (1.3 + SCALES[scale].slices * 1.2), w = h * image.aspect, slip = h * .2;
  const top = -silhouette.height, bottom = silhouette.height * 2, placements = [];
  for (let x = box.x0 - random() * strip; x < box.x1; x += strip) {
    placements.push({kind: 'tile', id: image.id, x: box.x0, y: centre.y - h / 2 + (random() - .5) * 2 * slip, w, h, clip: rectangle(x, top, x + strip + .5, bottom)});
  }
  return placements;
}

function planHex({images, silhouette, random, scale}) {
  const radius = silhouette.thickness * SCALES[scale].hex, rise = Math.sqrt(3) * radius, inner = radius * .92;
  const next = imageCycle(images, random), placements = [{kind: 'fill', color: 'dark'}];
  for (let column = -1; column * radius * 1.5 < silhouette.width + radius; column++) {
    for (let row = -1; row * rise < silhouette.height + rise; row++) {
      const x = column * radius * 1.5, y = row * rise + (column & 1 ? rise / 2 : 0);
      if (!touchesWeapon(silhouette, x - radius, y - rise / 2, x + radius, y + rise / 2)) continue;
      const image = next(), cell = Array.from({length: 6}, (_, corner) => [x + inner * Math.cos(corner * Math.PI / 3), y + inner * Math.sin(corner * Math.PI / 3)]);
      placements.push({kind: 'image', id: image.id, ...coverFit(image, x, y, inner * 2, rise * .92), clip: cell});
    }
  }
  return placements;
}

const PLANNERS = {
  collage: planCollage, panels: planPanels, pattern: planPattern,
  camo: planCamo, text: planText, hero: planHero, split: planSplit, film: planFilm, slices: planSlices, hex: planHex,
};

/** Finishing passes drawn over whatever the layout produced. */
function touches(placements, {fade, stripes}, silhouette) {
  const out = [...placements], {box, thickness, width} = silhouette, centre = bodyCentre(silhouette);
  if (fade) out.push({kind: 'fade', x0: box.x0, x1: box.x1});
  if (stripes) {
    const y = centre.y - thickness * .12;
    out.push({kind: 'line', from: [-width * 3, y], to: [width * 3, y], width: thickness * .26, color: 'accent'});
    out.push({kind: 'line', from: [-width * 3, y + thickness * .24], to: [width * 3, y + thickness * .24], width: thickness * .07, color: 'light'});
  }
  return out;
}

/**
 * Lays artwork out on one side of the weapon. `images` are {id, aspect}
 * records; `silhouette` is a low-resolution side profile ({width, height,
 * valid, core, box, thickness}). Coordinates in the returned placements are
 * silhouette pixels. The same arguments always produce the same plan.
 *
 * Placement kinds: image (optionally clipped or framed), tile, line,
 * rect, fill, fade, and group (children drawn through a clip polygon or
 * through lettering).
 */
export function planDesign({style, scale, seed, side, images, silhouette, text = DEFAULT_TEXT, fade = false, stripes = false}) {
  if (!images.length || !PLANNERS[style]) return [];
  const sorted = [...images].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // A pattern is the same on both sides; the other styles get a fresh layout
  // per side, plus a `shared` stream for choices both sides must agree on.
  const random = randomFromSeed(style === 'pattern' ? `${seed}:pattern` : `${seed}:${style}:${side}`);
  const shared = randomFromSeed(`${seed}:${style}:shared`);
  const cleaned = String(text).trim().toUpperCase().slice(0, 24) || DEFAULT_TEXT;
  return touches(PLANNERS[style]({images: sorted, silhouette, random, shared, scale, side, text: cleaned}), {fade, stripes}, silhouette);
}

// ---------------------------------------------------------------- stickers

// Stickers are a separate pass laid over the finished skin, from their own
// set of images. `roughness` and `metalness` are how the sticker's surface
// catches the light.
export const STICKER_EFFECTS = {
  paper: {label: 'Paper', hint: 'A plain die-cut sticker with a white edge.', roughness: .5, metalness: 0},
  gold: {label: 'Gold', hint: 'The image struck in polished gold.', roughness: .3, metalness: 1},
  holo: {label: 'Holo', hint: 'A rainbow holographic film over the image.', roughness: .2, metalness: 1},
  foil: {label: 'Foil', hint: 'The image in mirrored silver foil.', roughness: .24, metalness: 1},
  engraved: {label: 'Engraved', hint: 'The image etched into the surface, with the skin showing through.', roughness: .45, metalness: .85},
};
// Heights are multiples of the weapon's body thickness, like the layout sizes.
export const STICKER_SIZES = {small: {label: 'Small', height: .6}, medium: {label: 'Medium', height: .9}, large: {label: 'Large', height: 1.25}};
export const STICKER_LIMIT = 12;
export const DEFAULT_STICKERS = Object.freeze({seed: 'stickers-001', count: 4, size: 'medium', effect: 'paper'});

/**
 * Places `count` stickers on one side of the weapon, away from each other and
 * from the edges. Same contract as planDesign: `images` are {id, aspect}
 * records and the result is in silhouette pixels.
 */
export function planStickerSheet({seed, side, images, silhouette, count = DEFAULT_STICKERS.count, size = DEFAULT_STICKERS.size}) {
  const total = Math.max(0, Math.min(STICKER_LIMIT, Math.round(count)));
  if (!images.length || !total || !STICKER_SIZES[size]) return [];
  const sorted = [...images].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // The stickers are shared between the two flanks: odd ones to the left.
  const mine = side === 'left' ? Math.ceil(total / 2) : Math.floor(total / 2);
  return planStickers({images: sorted, silhouette, random: randomFromSeed(`${seed}:stickers:${side}`), count: mine, height: STICKER_SIZES[size].height});
}
