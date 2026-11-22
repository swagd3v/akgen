// Pixel maths for the sticker effects. Pure: works on RGBA arrays, no DOM.

const GOLD = [[0, [46, 26, 4]], [.3, [122, 78, 14]], [.6, [214, 160, 48]], [.85, [248, 222, 122]], [1, [255, 248, 208]]];
const SILVER = [[0, [24, 27, 30]], [.3, [88, 96, 102]], [.6, [168, 177, 183]], [.85, [228, 233, 236]], [1, [255, 255, 255]]];
export const METALS = {gold: GOLD, foil: SILVER};

/** A 256-entry RGB lookup running through `stops` ([position, [r, g, b]] pairs). */
export function metalTable(stops) {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255, upper = Math.max(1, stops.findIndex(([position]) => position >= t));
    const [from, a] = stops[upper - 1], [to, b] = stops[upper], mix = (t - from) / (to - from || 1);
    for (let k = 0; k < 3; k++) table[i * 3 + k] = Math.round(a[k] + (b[k] - a[k]) * mix);
  }
  return table;
}

/** Brightness of a pixel from 0 to 1, stretched over the image's own range. */
function tone(data, index, low, range) {
  return Math.max(0, Math.min(1, (.299 * data[index] + .587 * data[index + 1] + .114 * data[index + 2] - low) / range));
}
function levels(own) {
  const low = Math.max(0, own.mean[0] - own.spread[0] * 2);
  return [low, Math.max(1, Math.min(255, own.mean[0] + own.spread[0] * 2) - low)];
}

/**
 * Recolours an image as polished metal: its brightness picks the shade, and
 * soft diagonal bands of sheen run across it. Alpha is kept.
 */
export function applyMetal(data, width, table, own) {
  const [low, range] = levels(own);
  for (let i = 0; i < data.length; i += 4) {
    const pixel = i / 4, x = pixel % width, y = (pixel - x) / width;
    const sheen = Math.sin((x + y * .6) / width * Math.PI * 3) * .07;
    const level = Math.round(Math.max(0, Math.min(1, tone(data, i, low, range) * .9 + .06 + sheen)) * 255) * 3;
    data[i] = table[level]; data[i + 1] = table[level + 1]; data[i + 2] = table[level + 2];
  }
}

function hueToRgb(hue) {
  const channel = offset => {
    const k = (offset + hue * 12) % 12;
    return 255 * (.6 - .4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)));   // HSL at 100% saturation, 60% lightness
  };
  return [channel(0), channel(8), channel(4)];
}

/** Lays a diagonal rainbow film over an image, brightest where the image is bright. Alpha is kept. */
export function applyHolo(data, width, height) {
  const span = Math.max(width, height);
  for (let i = 0; i < data.length; i += 4) {
    const pixel = i / 4, x = pixel % width, y = (pixel - x) / width;
    const rainbow = hueToRgb((((x * .9 + y * .55) / span * 2.3) % 1 + 1) % 1);
    const glow = tone(data, i, 0, 255) * .3;
    for (let k = 0; k < 3; k++) {
      const mixed = data[i + k] * .5 + rainbow[k] * .5;
      data[i + k] = mixed + (255 - mixed) * glow;
    }
  }
}

/**
 * Turns an image into an etching: near-black where the image is dark and
 * almost clear where it is light, so the surface underneath shows through.
 */
export function applyEngrave(data, own) {
  const [low, range] = levels(own);
  for (let i = 0; i < data.length; i += 4) {
    const depth = 1 - tone(data, i, low, range);
    data[i + 3] = Math.round(data[i + 3] * (.12 + .78 * depth));
    data[i] = 22; data[i + 1] = 20; data[i + 2] = 18;
  }
}
