import test from 'node:test';
import assert from 'node:assert/strict';
import {initialParts, generateParts, chooseImages, zoneForName, DENSITIES} from '../src/generator.js';

test('seeded choices reproduce regardless of image upload order', () => {
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(chooseImages(['a', 'b', 'c'], String(i), 8), chooseImages(['c', 'a', 'b'], String(i), 8));
  }
  assert.deepEqual(chooseImages([], 'empty', 8), []);
});
test('generation preserves locked state and does not mutate prior editions', () => {
  const previous = initialParts(); previous.Body = {...previous.Body, locked: true, seed: 'keep', allowed: ['a'], revision: 3};
  const next = generateParts(previous, 'new', 'dense');
  assert.deepEqual(next.Body, previous.Body);
  assert.equal(next.Stock.seed, 'new'); assert.equal(next.Stock.density, 'dense');
  assert.equal(previous.Stock.seed, null);
  next.Body.allowed.push('b'); assert.deepEqual(previous.Body.allowed, ['a']);
});
test('single-part rolls leave every other part unchanged', () => {
  const previous = generateParts(initialParts(), 'base', 'medium');
  const next = generateParts(previous, 'stock-only', 'sparse', 'Stock');
  for (const name of Object.keys(previous)) assert.deepEqual(next[name], name === 'Stock' ? {...previous.Stock, seed: 'stock-only', density: 'sparse'} : previous[name]);
});
test('component mapping covers all supplied model node names', () => {
  for (const name of ['LOWER_RECIEVER', 'UPPER_RECIEVER', 'BLOCK_&_BATTERY', 'BITS_N_THANGS', 'TRIGGER_GAURD', 'FOREGRIP_TOP']) assert.ok(zoneForName(name));
  assert.equal(zoneForName('not-an-ak-part'), null);
});
test('density choices increase collage count and coverage', () => {
  assert.ok(DENSITIES.sparse.count < DENSITIES.medium.count && DENSITIES.medium.count < DENSITIES.dense.count);
  assert.ok(DENSITIES.sparse.coverage < DENSITIES.medium.coverage && DENSITIES.medium.coverage < DENSITIES.dense.coverage);
});
test('model-specific paint groups have independent edit state', () => {
  const parts = initialParts(['Metal Body', 'Magazines', 'Wood Fittings']);
  assert.deepEqual(Object.keys(parts), ['Metal Body', 'Magazines', 'Wood Fittings']);
  parts.Magazines.locked = true;
  const next = generateParts(parts, 'animated', 'dense');
  assert.equal(next.Magazines.seed, null);
  assert.equal(next['Wood Fittings'].seed, 'animated');
  next['Metal Body'].allowed.push('art');
  assert.deepEqual(next['Wood Fittings'].allowed, []);
});
