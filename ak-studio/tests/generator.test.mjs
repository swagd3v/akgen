import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, DEFAULT_STICKERS, SCALES, STICKER_EFFECTS, STICKER_LIMIT, STICKER_SIZES, STYLES, TOUCHES, TREATMENTS,
  designIdentity, initialParts, planDesign, planStickerSheet, poolFor, resetRevisions, surprise, zoneForName,
} from '../src/weapon/skin/generator.js';

/** A rifle-ish side profile: a long body with a magazine hanging below it. */
function silhouette(width = 384, height = 134) {
  const core = new Uint8Array(width * height), valid = new Uint8Array(width * height);
  const inside = (x, y, grow) => (x >= 20 - grow && x < 364 + grow && y >= 30 - grow && y < 60 + grow) || (x >= 180 - grow && x < 215 + grow && y >= 60 - grow && y < 115 + grow);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    core[y * width + x] = inside(x, y, 0) ? 1 : 0; valid[y * width + x] = inside(x, y, 10) ? 1 : 0;
  }
  const area = core.reduce((total, value) => total + value, 0);
  return {width, height, core, valid, box: {x0: 20, y0: 30, x1: 364, y1: 115}, thickness: area / 344};
}
const images = [{id: 'a', aspect: 1.5}, {id: 'b', aspect: 1}, {id: 'c', aspect: .7}, {id: 'd', aspect: 1.8}];
const plan = options => planDesign({style: 'collage', scale: 'balanced', seed: 'seed', side: 'left', images, silhouette: silhouette(), ...options});

test('the same inputs always produce the same plan, whatever the upload order', () => {
  for (const style of Object.keys(STYLES)) {
    for (let i = 0; i < 5; i++) {
      const expected = plan({style, seed: `seed-${i}`});
      assert.deepEqual(plan({style, seed: `seed-${i}`}), expected);
      assert.deepEqual(plan({style, seed: `seed-${i}`, images: [...images].reverse()}), expected);
    }
  }
});

test('different seeds and different sides give different layouts', () => {
  assert.notDeepEqual(plan({seed: 'one'}), plan({seed: 'two'}));
  assert.notDeepEqual(plan({side: 'left'}), plan({side: 'right'}));
  // A pattern must match on both flanks.
  assert.deepEqual(plan({style: 'pattern', side: 'left'}), plan({style: 'pattern', side: 'right'}));
});

test('no images or an unknown style plans nothing', () => {
  assert.deepEqual(plan({images: []}), []);
  assert.deepEqual(plan({style: 'nope'}), []);
});

test('a collage covers nearly all of the weapon', () => {
  const shape = silhouette();
  for (const scale of Object.keys(SCALES)) {
    const covered = new Uint8Array(shape.valid.length);
    for (const {x, y, w, h, angle} of plan({scale})) {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let py = 0; py < shape.height; py++) for (let px = 0; px < shape.width; px++) {
        const dx = px - x, dy = py - y;
        if (Math.abs(dx * cos + dy * sin) <= w / 2 && Math.abs(-dx * sin + dy * cos) <= h / 2) covered[py * shape.width + px] = 1;
      }
    }
    let total = 0, hit = 0;
    for (let i = 0; i < covered.length; i++) if (shape.valid[i]) { total++; hit += covered[i]; }
    assert.ok(hit / total > .95, `${scale} collage covered only ${(hit / total * 100).toFixed(1)}%`);
  }
});

test('a collage uses every image before repeating any', () => {
  const placements = plan({scale: 'busy'});
  assert.ok(placements.length >= images.length);
  assert.deepEqual(new Set(placements.slice(0, images.length).map(placement => placement.id)), new Set(images.map(image => image.id)));
});

test('size presets change how large and how many', () => {
  const height = scale => plan({scale}).reduce((total, placement) => total + placement.h, 0) / plan({scale}).length;
  assert.ok(height('bold') > height('balanced') && height('balanced') > height('busy'));
  const count = (style, scale) => plan({style, scale}).filter(placement => placement.kind !== 'line').length;
  assert.equal(count('panels', 'busy'), SCALES.busy.panels);
  assert.equal(plan({style: 'panels', scale: 'busy'}).filter(placement => placement.kind === 'line').length, SCALES.busy.panels - 1);
});

/** Every placement in a plan, including those nested in groups. */
const flatten = placements => placements.flatMap(placement => placement.kind === 'group' ? [placement, ...flatten(placement.children)] : [placement]);

test('every layout plans something, with finite geometry and known images and colours', () => {
  const ids = new Set(images.map(image => image.id)), slots = new Set(['dark', 'main', 'light', 'accent']);
  for (const style of Object.keys(STYLES)) for (const scale of Object.keys(SCALES)) for (const side of ['left', 'right']) {
    const placements = flatten(plan({style, scale, side}));
    assert.ok(placements.length > 0, `${style} planned nothing`);
    for (const placement of placements) {
      if (placement.id !== undefined) assert.ok(ids.has(placement.id), `${style} used an unknown image`);
      if (placement.color !== undefined) assert.ok(slots.has(placement.color), `${style} used an unknown colour`);
      for (const value of [placement.x, placement.y, placement.w, placement.h, ...(placement.clip || []).flat()]) {
        if (value !== undefined) assert.ok(Number.isFinite(value), `${style} produced ${value}`);
      }
    }
  }
});

test('single-image layouts agree on their image across both flanks', () => {
  for (const style of ['hero', 'slices', 'pattern']) {
    const used = side => new Set(flatten(plan({style, side})).filter(placement => placement.id).map(placement => placement.id));
    assert.equal(used('left').size, 1);
    assert.deepEqual(used('left'), used('right'));
  }
});

test('a split cuts both flanks at the same place on the weapon', () => {
  const shape = silhouette(), seam = side => plan({style: 'split', side}).find(placement => placement.kind === 'line');
  const left = seam('left'), right = seam('right');
  // The right profile is the left one mirrored, and so is the seam.
  assert.ok(Math.abs(left.from[0] - (shape.width - right.from[0])) < 1e-9);
  assert.ok(Math.abs(left.to[0] - (shape.width - right.to[0])) < 1e-9);
});

test('stencil text is cleaned up and sits on the body', () => {
  const lettering = text => plan({style: 'text', text})[0].text;
  assert.equal(lettering('  rush b ').value, 'RUSH B');
  assert.equal(lettering('').value, DEFAULT_SETTINGS.text);
  assert.equal(lettering('x'.repeat(60)).value.length, 24);
  const {y} = lettering('ak');
  assert.ok(y >= 30 && y <= 60, 'centred on the receiver, not the magazine');
});

test('finishing touches are added on top of any layout and change nothing beneath', () => {
  for (const style of Object.keys(STYLES)) {
    const bare = plan({style}), finished = plan({style, fade: true, stripes: true});
    assert.deepEqual(finished.slice(0, bare.length), bare);
    assert.deepEqual(finished.slice(bare.length).map(placement => placement.kind), ['fade', 'line', 'line']);
  }
  assert.deepEqual(Object.keys(TOUCHES), ['fade', 'stripes', 'wear']);
});

const sheet = options => planStickerSheet({seed: 's', side: 'left', images, silhouette: silhouette(), ...options});

test('stickers are their own pass, not a layout', () => {
  assert.equal(STYLES.stickers, undefined);
  assert.deepEqual(plan({style: 'stickers'}), []);
  assert.ok(STICKER_EFFECTS[DEFAULT_STICKERS.effect] && STICKER_SIZES[DEFAULT_STICKERS.size]);
  for (const effect of ['paper', 'gold', 'holo', 'foil', 'engraved']) {
    const {roughness, metalness} = STICKER_EFFECTS[effect];
    assert.ok(roughness > 0 && roughness <= 1 && metalness >= 0 && metalness <= 1, effect);
  }
});

test('a sticker sheet is reproducible, split across both flanks and stays on the weapon', () => {
  const shape = silhouette();
  assert.deepEqual(sheet({count: 6}), sheet({count: 6}));
  assert.deepEqual(sheet({count: 6}), sheet({count: 6, images: [...images].reverse()}));
  assert.notDeepEqual(sheet({count: 6}), sheet({count: 6, seed: 'other'}));
  for (const count of [1, 2, 5, 12]) {
    const left = sheet({count}), right = sheet({count, side: 'right'});
    assert.equal(left.length + right.length, count);
    assert.ok(left.length >= right.length && left.length - right.length <= 1);
    for (const sticker of [...left, ...right]) {
      assert.equal(sticker.kind, 'sticker');
      assert.equal(shape.valid[Math.round(sticker.y) * shape.width + Math.round(sticker.x)], 1);
    }
  }
  assert.equal(sheet({count: 99}).length + sheet({count: 99, side: 'right'}).length, STICKER_LIMIT);
  assert.deepEqual(sheet({count: 0}), []);
  assert.deepEqual(sheet({images: []}), []);
});

test('sticker sizes change how large they are', () => {
  const height = size => sheet({count: 6, size}).reduce((total, sticker) => total + sticker.h, 0);
  assert.ok(height('small') < height('medium') && height('medium') < height('large'));
});

test('parts share one design until they are remixed or given their own images', () => {
  const parts = initialParts(['Body', 'Stock', 'Grip']);
  assert.deepEqual(designIdentity('Body', parts.Body, 's'), designIdentity('Stock', parts.Stock, 's'));
  const remixed = designIdentity('Stock', {...parts.Stock, revision: 2}, 's');
  assert.equal(remixed.focus, 'Stock');
  assert.notEqual(remixed.seed, designIdentity('Stock', {...parts.Stock, revision: 3}, 's').seed);
  assert.equal(designIdentity('Grip', {...parts.Grip, allowed: ['a']}, 's').focus, 'Grip');
});

test('a new edition clears remixes on unlocked parts only, without mutating the old state', () => {
  const previous = initialParts(['Body', 'Stock']);
  previous.Body = {...previous.Body, locked: true, revision: 3, allowed: ['a']};
  previous.Stock = {...previous.Stock, revision: 2, allowed: ['b'], mode: 'solid'};
  const next = resetRevisions(previous);
  assert.deepEqual(next.Body, previous.Body);
  assert.deepEqual(next.Stock, {...previous.Stock, revision: 0});
  next.Body.allowed.push('z');
  assert.deepEqual(previous.Body.allowed, ['a']);
});

test('image pools are sorted and honour per-part restrictions', () => {
  const part = initialParts(['Body']).Body;
  assert.deepEqual(poolFor(part, ['c', 'a', 'b']), ['a', 'b', 'c']);
  assert.deepEqual(poolFor({...part, allowed: ['c', 'a', 'gone']}, ['c', 'a', 'b']), ['a', 'c']);
});

test('surprise picks only declared options and is reproducible', () => {
  for (let i = 0; i < 100; i++) {
    const picked = surprise(`seed-${i}`);
    assert.deepEqual(picked, surprise(`seed-${i}`));
    assert.ok(STYLES[picked.style] && SCALES[picked.scale] && TREATMENTS[picked.treatment]);
  }
  assert.ok(STYLES[DEFAULT_SETTINGS.style] && SCALES[DEFAULT_SETTINGS.scale] && TREATMENTS[DEFAULT_SETTINGS.treatment]);
});

test('component mapping covers the classic model node names', () => {
  for (const name of ['LOWER_RECIEVER', 'UPPER_RECIEVER', 'BLOCK_&_BATTERY', 'BITS_N_THANGS', 'TRIGGER_GAURD', 'FOREGRIP_TOP']) assert.ok(zoneForName(name));
  assert.equal(zoneForName('not-an-ak-part'), null);
});
