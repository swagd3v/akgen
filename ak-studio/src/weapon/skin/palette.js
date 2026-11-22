// Colour maths for making unrelated images read as one skin. Everything here
// is pure (typed arrays in, typed arrays out) so it runs under node --test.

export const PALETTE_SLOTS = ['dark', 'main', 'light', 'accent'];

export const PALETTE_PRESETS = [
  {id: 'ember', label: 'Ember', colors: {dark: '#1a1414', main: '#b3352a', light: '#f3dcc0', accent: '#f2a03d'}},
  {id: 'arctic', label: 'Arctic', colors: {dark: '#101b26', main: '#3f7fa6', light: '#e6f1f5', accent: '#ff6b4a'}},
  {id: 'toxic', label: 'Toxic', colors: {dark: '#121a12', main: '#4f8f2f', light: '#e4f2a8', accent: '#d8ff3d'}},
  {id: 'vapor', label: 'Vapor', colors: {dark: '#1b1230', main: '#8a3fc4', light: '#ffd6f0', accent: '#34d6e0'}},
  {id: 'desert', label: 'Desert', colors: {dark: '#2b2118', main: '#a67c4e', light: '#eadbbd', accent: '#5c6b3d'}},
  {id: 'royal', label: 'Royal', colors: {dark: '#0f1430', main: '#2c46b8', light: '#f1e6c2', accent: '#e0b23a'}},
  {id: 'graphite', label: 'Graphite', colors: {dark: '#111214', main: '#6b6f75', light: '#eceef0', accent: '#e2452f'}},
  {id: 'sakura', label: 'Sakura', colors: {dark: '#2a1620', main: '#d4668a', light: '#fff0ec', accent: '#5fb8a3'}},
];

export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('');
}

/** Perceptual-ish brightness in [0, 1]. */
export function luminance([r, g, b]) {
  return (.299 * r + .587 * g + .114 * b) / 255;
}

function saturation([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
}

function hue([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (!delta) return 0;
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

function mix(a, b, amount) {
  return a.map((channel, i) => channel + (b[i] - channel) * amount);
}

/** Scales a colour toward black or white until its luminance lands inside [low, high]. */
function withLuminance(rgb, low, high) {
  const current = luminance(rgb);
  if (current > high) return rgb.map(channel => channel * high / current);
  if (current < low) return mix(rgb, [255, 255, 255], (low - current) / (1 - current));
  return rgb;
}

/**
 * Finds a four-role palette in RGBA sample pixels (pool a few hundred pixels
 * from each image). Deterministic: k-means starts from luminance quantiles.
 */
export function extractPalette(samples, clusterCount = 6) {
  const pixels = [];
  for (let i = 0; i < samples.length; i += 4) {
    if (samples[i + 3] > 127) pixels.push([samples[i], samples[i + 1], samples[i + 2]]);
  }
  if (pixels.length < clusterCount) return {...PALETTE_PRESETS[0].colors};

  const byLuminance = [...pixels].sort((a, b) => luminance(a) - luminance(b));
  let centers = Array.from({length: clusterCount}, (_, i) => [...byLuminance[Math.floor((i + .5) / clusterCount * byLuminance.length)]]);
  let counts = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const pixel of pixels) {
      let best = 0, bestDistance = Infinity;
      for (let index = 0; index < centers.length; index++) {
        const center = centers[index];
        const distance = (pixel[0] - center[0]) ** 2 + (pixel[1] - center[1]) ** 2 + (pixel[2] - center[2]) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      }
      counts[best]++;
      for (let k = 0; k < 3; k++) sums[best][k] += pixel[k];
    }
    centers = centers.map((center, index) => counts[index] ? sums[index].map(sum => sum / counts[index]) : center);
  }

  const clusters = centers.map((rgb, index) => ({rgb, share: counts[index] / pixels.length})).filter(cluster => cluster.share > 0);
  const sorted = [...clusters].sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
  const dark = sorted[0], light = sorted.at(-1);
  const middle = sorted.slice(1, -1);
  const weight = cluster => (cluster.share + .1) * (.25 + saturation(cluster.rgb));
  const main = [...(middle.length ? middle : sorted)].sort((a, b) => weight(b) - weight(a))[0];
  const hueGap = cluster => {
    const gap = Math.abs(hue(cluster.rgb) - hue(main.rgb));
    return Math.min(gap, 360 - gap) / 180;
  };
  const pop = cluster => saturation(cluster.rgb) * (.3 + hueGap(cluster));
  const accent = clusters.filter(cluster => cluster !== main && cluster !== dark && cluster !== light).sort((a, b) => pop(b) - pop(a))[0];
  // An accent has to stand out: fall back to the main colour's complement when
  // the images simply do not contain a second saturated hue.
  const accentRgb = accent && saturation(accent.rgb) > .25 && hueGap(accent) > .12 ? accent.rgb : main.rgb.map(channel => 255 - channel);
  return {
    dark: rgbToHex(withLuminance(dark.rgb, 0, .16)),
    main: rgbToHex(withLuminance(main.rgb, .28, .58)),
    light: rgbToHex(withLuminance(light.rgb, .82, 1)),
    accent: rgbToHex(withLuminance(accentRgb, .35, .75)),
  };
}

/** A 256-entry RGB lookup table running dark, main, light. */
export function gradientMap(palette) {
  const stops = [hexToRgb(palette.dark), hexToRgb(palette.main), hexToRgb(palette.light)];
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const position = i / 255 * 2, segment = Math.min(1, Math.floor(position));
    table.set(mix(stops[segment], stops[segment + 1], position - segment), i * 3);
  }
  return table;
}

/** Mean and spread of brightness and the two chroma axes, ignoring transparent pixels. */
export function colorStats(data) {
  const sum = [0, 0, 0], squares = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const values = [.299 * r + .587 * g + .114 * b, -.169 * r - .331 * g + .5 * b, .5 * r - .419 * g - .081 * b];
    for (let k = 0; k < 3; k++) { sum[k] += values[k]; squares[k] += values[k] * values[k]; }
    count++;
  }
  if (!count) return {mean: [128, 0, 0], spread: [50, 20, 20]};
  const mean = sum.map(value => value / count);
  return {mean, spread: squares.map((value, k) => Math.sqrt(Math.max(1, value / count - mean[k] ** 2)))};
}

/**
 * The shared look a set of images is matched toward: their average brightness
 * and colour cast, but the contrast and saturation of the punchier ones, so
 * matching lifts flat images instead of dulling vivid ones.
 */
export function targetStats(list) {
  const mean = [0, 1, 2].map(k => list.reduce((total, stats) => total + stats.mean[k], 0) / list.length);
  const upper = k => [...list.map(stats => stats.spread[k])].sort((a, b) => a - b)[Math.ceil((list.length - 1) * .7)];
  return {mean, spread: [upper(0), upper(1), upper(2)]};
}

/**
 * In place: replaces every pixel by its brightness looked up in a gradient map.
 * Each image's own brightness range is stretched first, so a dim photo and a
 * bright one land on the same tones of the palette.
 */
export function applyDuotone(data, table, own) {
  const low = Math.max(0, own.mean[0] - own.spread[0] * 2), high = Math.min(255, own.mean[0] + own.spread[0] * 2);
  const range = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) {
    const y = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    const index = Math.max(0, Math.min(255, Math.round((y - low) / range * 255))) * 3;
    data[i] = table[index]; data[i + 1] = table[index + 1]; data[i + 2] = table[index + 2];
  }
}

/**
 * In place: flattens an image to a handful of flat colours by brightness
 * band. `colors` are RGB triples ordered dark to light; as with duotone,
 * each image's own brightness range is stretched first.
 */
export function applyPosterize(data, colors, own) {
  const low = Math.max(0, own.mean[0] - own.spread[0] * 2), high = Math.min(255, own.mean[0] + own.spread[0] * 2);
  const range = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) {
    const y = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    const color = colors[Math.max(0, Math.min(colors.length - 1, Math.floor((y - low) / range * colors.length)))];
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
}

/**
 * In place: pulls an image's brightness, contrast and saturation part of the
 * way toward a shared target, nudges its colour cast the same direction, and
 * adds a light wash of a tint colour. Deliberately gentle: hues stay
 * recognisable, the images just stop fighting each other.
 */
export function applyMatch(data, own, target, tint, tintAmount = .07) {
  const lerp = (from, to, amount) => from + (to - from) * amount;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lumaGain = lerp(1, clamp(target.spread[0] / own.spread[0], .7, 1.6), .6), lumaMean = lerp(own.mean[0], target.mean[0], .5);
  // One gain for both chroma axes changes saturation without rotating hue.
  const chromaGain = lerp(1, clamp(Math.hypot(target.spread[1], target.spread[2]) / Math.hypot(own.spread[1], own.spread[2]), .7, 1.6), .6);
  const cbMean = lerp(own.mean[1], target.mean[1], .25), crMean = lerp(own.mean[2], target.mean[2], .25);
  const [tr, tg, tb] = tint;
  const tintCb = -.169 * tr - .331 * tg + .5 * tb, tintCr = .5 * tr - .419 * tg - .081 * tb;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = (.299 * r + .587 * g + .114 * b - own.mean[0]) * lumaGain + lumaMean;
    let cb = (-.169 * r - .331 * g + .5 * b - own.mean[1]) * chromaGain + cbMean;
    let cr = (.5 * r - .419 * g - .081 * b - own.mean[2]) * chromaGain + crMean;
    cb += (tintCb - cb) * tintAmount;
    cr += (tintCr - cr) * tintAmount;
    data[i] = y + 1.402 * cr; data[i + 1] = y - .344 * cb - .714 * cr; data[i + 2] = y + 1.772 * cb;
  }
}
