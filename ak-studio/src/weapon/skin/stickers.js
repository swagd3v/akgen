// Draws a sticker plan (see planStickerSheet in generator.js) as two flat
// side-view layers: the stickers' colours, and how their surface should
// catch the light (roughness in green, metalness in blue).
import {STICKER_EFFECTS} from './generator.js';
import {METALS, applyEngrave, applyHolo, applyMetal, metalTable} from './sticker-effects.js';

const ART_MAX = 512; // Longest edge of a prepared sticker.

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** A copy of `source` with every visible pixel set to one colour. */
function silhouette(source, color) {
  const canvas = makeCanvas(source.width, source.height), context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = 'source-in'; context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export class StickerPrinter {
  constructor() { this.cache = new Map(); }

  /**
   * One image prepared as a sticker: `canvas` is its artwork, `mask` its
   * surface (roughness and metalness), `grow` how much wider than the image
   * the die-cut edge makes it.
   */
  art(entry, effect) {
    const key = `${effect}:${entry.id}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const {image} = entry, ratio = Math.min(1, ART_MAX / Math.max(image.width, image.height));
    const width = Math.round(image.width * ratio), height = Math.round(image.height * ratio);
    const engraved = effect === 'engraved', border = engraved ? 0 : Math.max(2, Math.round(Math.max(width, height) * .01));
    const canvas = makeCanvas(width + border * 2, height + border * 2), context = canvas.getContext('2d', {willReadFrequently: true});
    if (border) {
      // The die-cut edge: the image's own outline, grown outward and filled white.
      for (let step = 0; step < 16; step++) {
        const angle = step / 16 * Math.PI * 2;
        context.drawImage(image, border + Math.cos(angle) * border, border + Math.sin(angle) * border, width, height);
      }
      context.globalCompositeOperation = 'source-in'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'source-over';
    }
    context.drawImage(image, border, border, width, height);

    if (effect !== 'paper') {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      if (METALS[effect]) applyMetal(pixels.data, canvas.width, metalTable(METALS[effect]), entry.stats);
      else if (effect === 'holo') applyHolo(pixels.data, canvas.width, canvas.height);
      else applyEngrave(pixels.data, entry.stats);
      context.putImageData(pixels, 0, 0);
    }
    if (engraved) {
      // A pale copy nudged down and right reads as the lit lip of the cut.
      const lip = silhouette(canvas, '#ffffff');
      context.globalCompositeOperation = 'destination-over'; context.globalAlpha = .28;
      context.drawImage(lip, Math.max(1, width / 260), Math.max(1, width / 260));
      context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
    }
    const {roughness, metalness} = STICKER_EFFECTS[effect];
    const result = {canvas, mask: silhouette(canvas, `rgb(0, ${Math.round(roughness * 255)}, ${Math.round(metalness * 255)})`), grow: canvas.width / width};
    this.cache.set(key, result);
    return result;
  }

  /**
   * @param placements  plan from planStickerSheet, in silhouette pixels
   * @param size        {width, height} of the artwork canvas
   * @param unit        artwork pixels per silhouette pixel
   * @param images      Map of id to sticker library entry
   * @returns {color, surface} transparent canvases
   */
  compose(placements, size, unit, images, effect) {
    const color = makeCanvas(size.width, size.height), surface = makeCanvas(size.width, size.height);
    for (const [target, layer] of [[color, 'canvas'], [surface, 'mask']]) {
      const context = target.getContext('2d'); context.imageSmoothingQuality = 'high';
      for (const placement of placements) {
        const art = this.art(images.get(placement.id), effect), source = art[layer];
        const width = placement.w * unit * art.grow, height = width * source.height / source.width;
        context.save();
        context.translate(placement.x * unit, placement.y * unit); context.rotate(placement.angle);
        if (layer === 'canvas' && effect !== 'engraved') {
          context.shadowColor = 'rgba(0, 0, 0, .4)'; context.shadowBlur = height * .05; context.shadowOffsetY = height * .02;
        }
        context.drawImage(source, -width / 2, -height / 2, width, height);
        context.restore();
      }
    }
    return {color, surface};
  }

  /** Forget prepared stickers for images that have been removed. */
  prune(ids) {
    for (const key of this.cache.keys()) if (!ids.has(key.slice(key.indexOf(':') + 1))) this.cache.delete(key);
  }
}
