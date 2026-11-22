import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BARS, DEFAULT_OPTIONS, SCREEN, advanceScroll, chooseScene, environments, formats, holdOffset, holds, imageRect, layoutFeed, nextFlick, shuffleFeed,
  speeds, themeFor, thumbGesture, visiblePosts, wrap,
} from '../src/phone/generator.js';
import {randomFromSeed} from '../src/shared/random.js';

test('seeds reproduce scenes, only select declared traits and keep the options', () => {
  for (let i = 0; i < 100; i++) {
    const scene = chooseScene(`seed-${i}`);
    assert.deepEqual(scene, chooseScene(`seed-${i}`));
    assert.ok(environments.some(item => item.id === scene.environment));
    assert.ok(holds.some(item => item.id === scene.hold));
    assert.deepEqual({format: scene.format, hud: scene.hud, bars: scene.bars}, DEFAULT_OPTIONS);
  }
  const kept = chooseScene('example', {format: 'tall', hud: false, bars: false});
  assert.deepEqual([kept.format, kept.hud, kept.bars], ['tall', false, false]);
  assert.equal(kept.environment, chooseScene('example').environment);
});

test('every environment and hold occurs across seeds', () => {
  const scenes = Array.from({length: 200}, (_, i) => chooseScene(String(i)));
  assert.equal(new Set(scenes.map(scene => scene.environment)).size, environments.length);
  assert.equal(new Set(scenes.map(scene => scene.hold)).size, holds.length);
});

test('contain fits without clipping and cover fills without distortion', () => {
  for (const [iw, ih] of [[800, 1600], [1600, 800], [1000, 1000]]) {
    for (const fit of ['cover', 'contain']) {
      const [x, y, w, h] = imageRect(iw, ih, 768, 1576, fit);
      assert.ok(Math.abs(w / h - iw / ih) < 1e-9);
      if (fit === 'contain') assert.ok(w <= 768.001 && h <= 1576.001 && x >= -.001 && y >= -.001);
      else assert.ok(w >= 767.999 && h >= 1575.999 && x <= .001 && y <= .001);
    }
  }
});

const posts = [{id: 'a', width: 1170, height: 585}, {id: 'b', width: 768, height: 1000}, {id: 'c', width: 400, height: 100}];

test('the feed stacks posts at full width, in order, without distorting them', () => {
  const layout = layoutFeed(posts, 768, 2);
  assert.deepEqual(layout.items, [{id: 'a', y: 0, height: 384}, {id: 'b', y: 386, height: 1000}, {id: 'c', y: 1388, height: 192}]);
  assert.equal(layout.height, 1582);
  assert.deepEqual(layoutFeed([]), {items: [], height: 0});
});

test('the feed is endless: it repeats in both directions and always fills the window', () => {
  const layout = layoutFeed(posts, 768, 2);
  assert.deepEqual(visiblePosts(layout, 0, 500).map(post => post.id), ['a', 'b']);
  assert.deepEqual(visiblePosts(layout, 0, 500), visiblePosts(layout, layout.height * 3, 500));
  assert.deepEqual(visiblePosts(layout, 0, 500), visiblePosts(layout, -layout.height * 2, 500));
  assert.deepEqual(visiblePosts(layout, -100, 300).map(post => [post.id, post.y]), [['c', -94], ['a', 100]]);
  for (const top of [-5000, -1, 0, 777, 123456]) {
    const shown = visiblePosts(layout, top, SCREEN.height).sort((a, b) => a.y - b.y);
    assert.ok(shown[0].y <= 2 && shown.at(-1).y + shown.at(-1).height >= SCREEN.height - 2, `gap at ${top}`);
    shown.slice(1).forEach((post, index) => assert.equal(post.y, shown[index].y + shown[index].height + 2));
  }
  assert.deepEqual(visiblePosts(layoutFeed([{id: 'tiny', width: 768, height: 100}]), 0, 1000).length, 10);
  assert.deepEqual(visiblePosts(layoutFeed([]), 0, 1000), []);
  assert.equal(wrap(-1, 10), 9);
});

test('scrolling eases to its target and stops there', () => {
  let position = 0, last = 0;
  for (let frame = 0; frame < 240; frame++) {
    position = advanceScroll(position, 1000, 1 / 60);
    assert.ok(position >= last && position <= 1000); last = position;
  }
  assert.equal(position, 1000);
  assert.equal(advanceScroll(5, 5, 1), 5);
  assert.ok(advanceScroll(0, -1000, .1) < 0);
});

test('automatic flicks stay inside their pace and faster paces move sooner and further', () => {
  const average = id => {
    const random = randomFromSeed('flicks'), speed = speeds.find(item => item.id === id); let wait = 0, distance = 0;
    for (let i = 0; i < 200; i++) {
      const flick = nextFlick(id, random);
      assert.ok(flick.wait >= speed.wait[0] && flick.wait <= speed.wait[1]);
      assert.ok(flick.distance >= speed.travel[0] * SCREEN.height - 1 && flick.distance <= speed.travel[1] * SCREEN.height + 1);
      wait += flick.wait; distance += flick.distance;
    }
    return [wait, distance];
  };
  const [slow, normal, fast] = ['slow', 'normal', 'fast'].map(average);
  assert.ok(slow[0] > normal[0] && normal[0] > fast[0] && slow[1] < normal[1] && normal[1] < fast[1]);
});

test('the thumb drags on the glass, then lifts to come back', () => {
  assert.deepEqual(thumbGesture(0), {along: -1, lift: 0});
  assert.ok(Math.abs(thumbGesture(1).along + 1) < 1e-9 && Math.abs(thumbGesture(1).lift) < 1e-9);
  let previous = -1;
  for (let t = 0; t <= .42; t += .02) { const {along, lift} = thumbGesture(t); assert.ok(along >= previous && lift === 0); previous = along; }
  assert.ok(previous > .95);
  assert.ok(thumbGesture(.7).lift > .8);
});

test('bars follow the brightness of the screenshots', () => {
  const flat = value => new Uint8ClampedArray(400).fill(value);
  assert.equal(themeFor(flat(250)), 'light');
  assert.equal(themeFor(flat(8)), 'dark');
  assert.equal(themeFor(undefined), 'dark');
});

test('shuffling the feed keeps every post and ignores the order they arrived in', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(shuffleFeed(ids, 'x'), shuffleFeed([...ids].reverse(), 'x'));
  assert.deepEqual([...shuffleFeed(ids, 'x')].sort(), ids);
  assert.ok(Array.from({length: 20}, (_, i) => shuffleFeed(ids, `s${i}`).join('')).some(order => order !== ids.join('')));
});

test('holds keep the phone inside every frame shape', () => {
  for (const hold of holds) for (const format of formats) {
    const aspect = format.width / format.height, [x, y] = holdOffset(hold, aspect);
    assert.ok(x >= 0 && x + .3 < aspect, `${hold.id} in ${format.id}`);
    assert.ok(Math.abs(y) < .5);
  }
  assert.ok(BARS.top + BARS.bottom < SCREEN.height / 2);
});
