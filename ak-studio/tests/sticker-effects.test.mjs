import test from 'node:test';
import assert from 'node:assert/strict';
import {METALS, applyEngrave, applyHolo, applyMetal, metalTable} from '../src/weapon/skin/sticker-effects.js';

/** A width x height RGBA image running from black (left) to white (right). */
function ramp(width = 64, height = 8) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = Math.round(x / (width - 1) * 255);
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  return data;
}
const stats = {mean: [128, 0, 0], spread: [64, 0, 0]};
const at = (data, width, x, y = 0) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('a metal table runs from its first stop to its last', () => {
  for (const stops of Object.values(METALS)) {
    const table = metalTable(stops);
    assert.deepEqual([...table.slice(0, 3)], stops[0][1]);
    assert.deepEqual([...table.slice(255 * 3)], stops.at(-1)[1]);
  }
});

test('gold keeps light and dark apart, stays warm and leaves alpha alone', () => {
  const data = ramp(); data[3] = 40;
  applyMetal(data, 64, metalTable(METALS.gold), stats);
  assert.equal(data[3], 40);
  const dark = at(data, 64, 2), light = at(data, 64, 61);
  assert.ok(light[0] + light[1] + light[2] > dark[0] + dark[1] + dark[2] + 200);
  for (let i = 0; i < data.length; i += 4) assert.ok(data[i] >= data[i + 1] && data[i + 1] >= data[i + 2], 'red >= green >= blue');
});

test('foil is a cool, nearly neutral silver', () => {
  const data = ramp();
  applyMetal(data, 64, metalTable(METALS.foil), stats);
  for (let i = 0; i < data.length; i += 4) assert.ok(Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) <= 16);
});

test('holo adds colour that changes across the sticker', () => {
  const data = new Uint8ClampedArray(64 * 8 * 4).fill(128);
  applyHolo(data, 64, 8);
  const hues = new Set();
  for (let x = 0; x < 64; x += 8) {
    const [r, g, b, a] = at(data, 64, x);
    assert.equal(a, 128);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 40, 'grey has become coloured');
    hues.add([r, g, b].indexOf(Math.max(r, g, b)) * 3 + [r, g, b].indexOf(Math.min(r, g, b)));
  }
  assert.ok(hues.size >= 3, 'several different hues appear');
});

test('engraving is dark where the image is dark and nearly clear where it is light', () => {
  const data = ramp();
  applyEngrave(data, stats);
  const dark = at(data, 64, 0), light = at(data, 64, 63);
  assert.ok(dark[3] > 200 && light[3] < 50);
  assert.ok(dark[0] < 40 && light[0] < 40, 'the etch itself is always near-black');
});
