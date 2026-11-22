// The image collection shared by the weapon and phone studios. Images stay in
// this tab's memory; nothing is ever uploaded.
import {colorStats} from '../weapon/skin/palette.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const MAX_EDGE = 1200;   // Working copies are scaled down to bound memory.
const SAMPLE_EDGE = 40;  // Thumbnail used for colour statistics and palettes.

async function contentId(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fires a "change" event whenever images are added or removed. Entries are
 * {id, name, url, image, stats, samples}: `id` is a content hash, so the same
 * file is never added twice and upload order never affects seeded results.
 */
export class ImageLibrary extends EventTarget {
  images = [];

  /**
   * @param maxEdge  working copies are scaled down to this longest edge
   * @param sorted   keep images ordered by content (so seeded results never
   *                 depend on upload order) rather than in the order added
   */
  constructor({maxEdge = MAX_EDGE, sorted = true} = {}) {
    super();
    this.maxEdge = maxEdge; this.sorted = sorted;
  }

  get(id) { return this.images.find(entry => entry.id === id); }

  /** Returns {added, errors} where errors are ready-to-show sentences. */
  async add(files) {
    let added = 0;
    const errors = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) { errors.push(`${file.name}: choose an image file.`); continue; }
      if (file.size > MAX_BYTES) { errors.push(`${file.name}: exceeds 20 MB.`); continue; }
      let url;
      try {
        const id = await contentId(file);
        if (this.get(id)) continue;
        url = URL.createObjectURL(file);
        const decoded = new Image(); decoded.src = url; await decoded.decode();
        if (decoded.width * decoded.height > MAX_PIXELS) throw Error('Use an image smaller than 50 megapixels.');
        const ratio = Math.min(1, this.maxEdge / Math.max(decoded.width, decoded.height));
        const image = document.createElement('canvas');
        image.width = Math.max(1, Math.round(decoded.width * ratio)); image.height = Math.max(1, Math.round(decoded.height * ratio));
        image.getContext('2d').drawImage(decoded, 0, 0, image.width, image.height);

        const thumb = document.createElement('canvas'); thumb.width = thumb.height = SAMPLE_EDGE;
        const context = thumb.getContext('2d', {willReadFrequently: true});
        context.drawImage(image, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
        const samples = context.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE).data;
        this.images.push({id, name: file.name, url, image, samples, stats: colorStats(samples)});
        url = null; added++;
      } catch (error) {
        errors.push(`${file.name}: ${error.message.includes('megapixels') ? error.message : 'could not open this image. Try JPG, PNG or WebP.'}`);
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
    if (this.sorted) this.images.sort((a, b) => a.id.localeCompare(b.id));
    if (added) this.dispatchEvent(new CustomEvent('change', {detail: {reason: 'add'}}));
    return {added, errors};
  }

  remove(id) {
    const entry = this.get(id);
    if (!entry) return;
    this.images = this.images.filter(item => item !== entry);
    URL.revokeObjectURL(entry.url);
    this.dispatchEvent(new CustomEvent('change', {detail: {reason: 'remove', id}}));
  }

  clear() {
    this.images.forEach(entry => URL.revokeObjectURL(entry.url));
    this.images = [];
    this.dispatchEvent(new CustomEvent('change', {detail: {reason: 'clear'}}));
  }

  dispose() { this.images.forEach(entry => URL.revokeObjectURL(entry.url)); }
}
