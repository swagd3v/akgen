// Draws a layout plan (see generator.js) as flat side-view artwork, applying
// the colour treatment that ties the images together.
import {PALETTE_SLOTS, applyDuotone, applyMatch, applyPosterize, gradientMap, hexToRgb, luminance} from './palette.js';

const TREATED_MAX = 900; // Longest edge of a recoloured copy; artwork is never drawn larger.
const LETTERING = '900 100px Impact, "Arial Black", "Helvetica Neue", Arial, sans-serif';

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Adds a closed outline to the current path; `smooth` rounds it through the midpoints. */
function trace(context, points, unit, smooth) {
  const at = index => points[(index + points.length) % points.length].map(value => value * unit);
  if (!smooth) {
    points.forEach((_, i) => i ? context.lineTo(...at(i)) : context.moveTo(...at(i)));
  } else {
    const middle = index => { const a = at(index), b = at(index + 1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    context.moveTo(...middle(-1));
    points.forEach((_, i) => context.quadraticCurveTo(...at(i), ...middle(i)));
  }
  context.closePath();
}

/**
 * Redraws a canvas as comic-print dots: the palette's light colour as paper,
 * main-colour dots that grow with darkness, and the darkest areas solid.
 */
function halftone(canvas, look, stats) {
  const {width, height} = canvas, context = canvas.getContext('2d', {willReadFrequently: true});
  const source = context.getImageData(0, 0, width, height).data;
  const original = makeCanvas(width, height); original.getContext('2d').drawImage(canvas, 0, 0);
  const low = Math.max(0, stats.mean[0] - stats.spread[0] * 2), range = Math.max(1, Math.min(255, stats.mean[0] + stats.spread[0] * 2) - low);
  const cell = Math.max(5, Math.round(Math.max(width, height) / 85)), reach = Math.ceil((width + height) / cell);
  const mid = new Path2D(), deep = new Path2D();
  // A grid turned 45 degrees, the classic screen angle.
  for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
    const x = width / 2 + (i - j) * cell * .7071, y = height / 2 + (i + j) * cell * .7071;
    if (x < -cell || y < -cell || x > width + cell || y > height + cell) continue;
    const index = (Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * 4;
    const brightness = Math.max(0, Math.min(1, (.299 * source[index] + .587 * source[index + 1] + .114 * source[index + 2] - low) / range));
    const darkness = 1 - brightness;
    if (darkness < .06) continue;
    const path = darkness > .8 ? deep : mid, radius = cell * .74 * Math.sqrt(darkness);
    path.moveTo(x + radius, y); path.arc(x, y, radius, 0, Math.PI * 2);
  }
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = look.palette.light; context.fillRect(0, 0, width, height);
  context.fillStyle = look.palette.main; context.fill(mid);
  context.fillStyle = look.palette.dark; context.fill(deep);
  // Keep the source's transparency, so cut-out images stay cut out.
  context.globalCompositeOperation = 'destination-in'; context.drawImage(original, 0, 0);
  context.globalCompositeOperation = 'source-over';
}

export class DesignComposer {
  constructor() {
    this.cache = new Map();
    this.cacheKey = '';
  }

  /** Recoloured copies are cached until the look changes. */
  prepare(look) {
    if (look.key !== this.cacheKey) { this.cache.clear(); this.cacheKey = look.key; }
  }

  treated(entry, look) {
    if (look.treatment === 'original') return entry.image;
    const key = `treated:${entry.id}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const ratio = Math.min(1, TREATED_MAX / Math.max(entry.image.width, entry.image.height));
    const canvas = makeCanvas(entry.image.width * ratio, entry.image.height * ratio);
    const context = canvas.getContext('2d', {willReadFrequently: true});
    // A slight blur before posterising keeps the colour bands from speckling.
    if (look.treatment === 'poster') context.filter = `blur(${Math.max(1, canvas.width / 400)}px)`;
    context.drawImage(entry.image, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';
    if (look.treatment === 'halftone') halftone(canvas, look, entry.stats);
    else {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      if (look.treatment === 'duotone') applyDuotone(pixels.data, gradientMap(look.palette), entry.stats);
      else if (look.treatment === 'poster') applyPosterize(pixels.data, PALETTE_SLOTS.map(slot => hexToRgb(look.palette[slot])).sort((a, b) => luminance(a) - luminance(b)), entry.stats);
      else applyMatch(pixels.data, entry.stats, look.target, hexToRgb(look.palette.main));
      context.putImageData(pixels, 0, 0);
    }
    this.cache.set(key, canvas);
    return canvas;
  }

  /**
   * @param placements  plan from planDesign, in silhouette pixels
   * @param size        {width, height} of the artwork canvas
   * @param unit        artwork pixels per silhouette pixel
   * @param images      Map of id to library entry
   * @param look        {key, treatment, palette, baseCoat, target}
   */
  compose(placements, size, unit, images, look) {
    this.prepare(look);
    const canvas = makeCanvas(size.width, size.height), context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    if (look.baseCoat !== 'none') {
      context.fillStyle = look.palette[look.baseCoat]; context.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.draw(context, placements, unit, images, look);
    return canvas;
  }

  draw(context, placements, unit, images, look) {
    const canvas = context.canvas;
    for (const placement of placements) {
      context.save();
      if (placement.clip && placement.kind !== 'group') {
        context.beginPath(); trace(context, placement.clip, unit, placement.smooth); context.clip();
      }
      switch (placement.kind) {
        case 'line':
          context.strokeStyle = look.palette[placement.color || 'accent']; context.lineWidth = placement.width * unit;
          context.beginPath();
          context.moveTo(placement.from[0] * unit, placement.from[1] * unit); context.lineTo(placement.to[0] * unit, placement.to[1] * unit);
          context.stroke();
          break;
        case 'fill':
          context.fillStyle = look.palette[placement.color]; context.fillRect(0, 0, canvas.width, canvas.height);
          break;
        case 'rect':
          context.fillStyle = look.palette[placement.color];
          context.fillRect(placement.x * unit, placement.y * unit, placement.w * unit, placement.h * unit);
          break;
        case 'tile':
          this.tile(context, this.treated(images.get(placement.id), look), placement, unit);
          break;
        case 'fade':
          this.fade(context, placement, unit, look);
          break;
        case 'group':
          this.group(context, placement, unit, images, look);
          break;
        default: {
          const w = placement.w * unit, h = placement.h * unit;
          context.translate(placement.x * unit, placement.y * unit); context.rotate(placement.angle);
          context.drawImage(this.treated(images.get(placement.id), look), -w / 2, -h / 2, w, h);
          if (placement.frame) {
            context.strokeStyle = look.palette.light; context.lineWidth = placement.frame * unit;
            context.strokeRect(-w / 2, -h / 2, w, h);
          }
        }
      }
      context.restore();
    }
  }

  /** Children drawn on their own layer, then shown through a polygon or through lettering. */
  group(context, placement, unit, images, look) {
    const layer = makeCanvas(context.canvas.width, context.canvas.height), inner = layer.getContext('2d');
    inner.imageSmoothingQuality = 'high';
    if (placement.clip) { inner.beginPath(); trace(inner, placement.clip, unit, placement.smooth); inner.clip(); }
    this.draw(inner, placement.children, unit, images, look);
    if (placement.text) {
      const mask = makeCanvas(layer.width, layer.height), letters = mask.getContext('2d');
      this.lettering(letters, placement.text, unit, false);
      inner.globalCompositeOperation = 'destination-in'; inner.drawImage(mask, 0, 0);
      inner.globalCompositeOperation = 'source-over';
      // A thin outline keeps the letters legible where the artwork inside
      // them is close to the base coat's colour.
      inner.strokeStyle = look.palette.light;
      this.lettering(inner, placement.text, unit, true);
    }
    context.drawImage(layer, 0, 0);
  }

  /** Sets a word in rows along the weapon, repeated to run its full length. */
  lettering(context, text, unit, outline) {
    context.save();
    context.font = LETTERING; context.textBaseline = 'middle'; context.textAlign = 'left';
    const span = (text.x1 - text.x0) * unit, word = context.measureText(text.value).width / 100;
    // Capital letters fill about 73% of the font size; never let one word outgrow the weapon.
    const size = Math.min(text.height * unit / .73, span * .96 / word), advance = (word + .45) * size;
    context.font = LETTERING.replace('100px', `${size}px`); context.lineWidth = size * .03; context.lineJoin = 'round';
    for (let row = 0; row < text.rows; row++) {
      const y = text.y * unit + (row - (text.rows - 1) / 2) * size * .86;
      const copies = Math.max(1, Math.floor((span + .45 * size) / advance)) + (text.rows > 1 ? 2 : 0);
      // Centre whole words on the weapon; extra rows are staggered by half a word.
      let x = text.x0 * unit + (span - (copies * advance - .45 * size)) / 2 + (row % 2 ? advance / 2 : 0);
      for (let copy = 0; copy < copies; copy++, x += advance) outline ? context.strokeText(text.value, x, y) : context.fillText(text.value, x, y);
    }
    context.restore();
  }

  /** Dissolves whatever is drawn so far into the base coat toward both ends. */
  fade(context, placement, unit, look) {
    const x0 = placement.x0 * unit, x1 = placement.x1 * unit, gradient = context.createLinearGradient(x0, 0, x1, 0);
    const [r, g, b] = look.baseCoat === 'none' ? [0, 0, 0] : hexToRgb(look.palette[look.baseCoat]);
    for (const [stop, alpha] of [[0, 1], [.1, .85], [.3, 0], [.7, 0], [.9, .85], [1, 1]]) gradient.addColorStop(stop, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    // With no base coat the artwork is erased instead, so the factory finish shows.
    if (look.baseCoat === 'none') context.globalCompositeOperation = 'destination-out';
    context.fillStyle = gradient; context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }

  /** Mirror-repeats one image across the whole canvas so neighbouring tiles always match up. */
  tile(context, source, placement, unit) {
    const canvas = context.canvas, w = placement.w * unit, h = placement.h * unit, originX = placement.x * unit, originY = placement.y * unit;
    const firstColumn = Math.floor(-originX / w), firstRow = Math.floor(-originY / h);
    for (let row = firstRow; originY + row * h < canvas.height; row++) {
      for (let column = firstColumn; originX + column * w < canvas.width; column++) {
        const flipX = column & 1, flipY = row & 1;
        context.save();
        context.translate(originX + (column + flipX) * w, originY + (row + flipY) * h);
        context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        // Half a pixel of overdraw hides hairline gaps between tiles.
        context.drawImage(source, 0, 0, w + .5, h + .5);
        context.restore();
      }
    }
  }
}
