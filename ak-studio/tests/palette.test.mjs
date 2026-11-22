import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE_PRESETS, PALETTE_SLOTS, applyDuotone, applyMatch, applyPosterize, colorStats, extractPalette, gradientMap, hexToRgb, luminance, rgbToHex, targetStats,
} from '../src/weapon/skin/palette.js';

/** RGBA pixels made of equal runs of the given colours. */
function pixels(colors, each = 200) {
  const data = new Uint8ClampedArray(colors.length * each * 4);
  colors.forEach((color, index) => { for (let i = 0; i < each; i++) data.set([...color, 255], (index * each + i) * 4); });
  return data;
}

test('hex and rgb conversions round-trip', () => {
  for (const hex of ['#000000', '#ffffff', '#c56540', '#0a1b2c']) assert.equal(rgbToHex(hexToRgb(hex)), hex);
  assert.equal(rgbToHex([300, -5, 127.6]), '#ff0080');
});

test('every preset defines every slot as a hex colour', () => {
  for (const preset of PALETTE_PRESETS) for (const slot of PALETTE_SLOTS) assert.match(preset.colors[slot], /^#[0-9a-f]{6}$/);
});

test('an extracted palette is ordered dark to light and reproducible', () => {
  const samples = pixels([[10, 10, 30], [200, 40, 40], [40, 160, 60], [250, 240, 220], [30, 60, 200], [120, 120, 120]]);
  const palette = extractPalette(samples);
  assert.deepEqual(extractPalette(samples), palette);
  const brightness = slot => luminance(hexToRgb(palette[slot]));
  assert.ok(brightness('dark') < brightness('main') && brightness('main') < brightness('light'));
  assert.ok(brightness('dark') <= .17 && brightness('light') >= .8);
  assert.notEqual(palette.accent, palette.main);
});

test('extraction ignores transparent pixels and survives tiny inputs', () => {
  const transparent = new Uint8ClampedArray(400);
  assert.deepEqual(extractPalette(transparent), PALETTE_PRESETS[0].colors);
});

test('a gradient map runs dark, main, light', () => {
  const palette = {dark: '#000000', main: '#804020', light: '#ffffff', accent: '#00ff00'}, table = gradientMap(palette);
  assert.deepEqual([...table.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...table.slice(255 * 3)], [255, 255, 255]);
  const middle = [...table.slice(127 * 3, 127 * 3 + 3)];
  assert.ok(Math.abs(middle[0] - 0x80) <= 2 && Math.abs(middle[1] - 0x40) <= 2 && Math.abs(middle[2] - 0x20) <= 2);
});

test('duotone leaves only palette tones and keeps alpha', () => {
  const data = pixels([[20, 20, 20], [240, 240, 240], [200, 30, 30]]);
  data[3] = 77;
  applyDuotone(data, gradientMap({dark: '#101020', main: '#3050a0', light: '#e0e8ff'}), colorStats(data));
  assert.equal(data[3], 77);
  // Blue stays the strongest channel for every pixel of a blue palette.
  for (let i = 0; i < data.length; i += 4) assert.ok(data[i + 2] >= data[i] && data[i + 2] >= data[i + 1]);
});

test('posterising leaves only the given colours, darkest for the darkest pixels', () => {
  const colors = [[10, 10, 10], [200, 30, 30], [30, 200, 200], [250, 250, 250]];
  const data = pixels([[0, 0, 0], [60, 60, 60], [120, 120, 120], [180, 180, 180], [255, 255, 255]]);
  data[3] = 12;
  applyPosterize(data, colors, colorStats(data));
  assert.equal(data[3], 12, 'alpha is untouched');
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) seen.add(colors.findIndex(color => color.every((channel, k) => channel === data[i + k])));
  assert.ok(!seen.has(-1), 'every pixel is one of the palette colours');
  assert.deepEqual([...data.slice(0, 3)], colors[0]);
  assert.deepEqual([...data.slice(data.length - 4, data.length - 1)], colors[3]);
  assert.ok(seen.size >= 3);
});

test('matching moves images toward the shared brightness without swapping hues', () => {
  const dim = pixels([[30, 10, 10], [60, 20, 20]]), bright = pixels([[200, 220, 255], [240, 250, 255]]);
  const stats = [colorStats(dim), colorStats(bright)], target = targetStats(stats);
  const gap = Math.abs(stats[0].mean[0] - stats[1].mean[0]);
  applyMatch(dim, stats[0], target, [128, 128, 128]); applyMatch(bright, stats[1], target, [128, 128, 128]);
  assert.ok(Math.abs(colorStats(dim).mean[0] - colorStats(bright).mean[0]) < gap * .7);
  assert.ok(dim[0] > dim[2], 'the red image is still red');
  assert.ok(bright[2] >= bright[0], 'the blue image is still blue');
});

test('the match target takes its contrast from the punchier images', () => {
  const flat = {mean: [100, 0, 0], spread: [10, 5, 5]}, punchy = {mean: [140, 10, -10], spread: [70, 40, 30]};
  const target = targetStats([flat, flat, punchy, punchy]);
  assert.deepEqual(target.mean, [120, 5, -5]);
  assert.deepEqual(target.spread, [70, 40, 30]);
});
