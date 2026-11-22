// Pure phone-scene logic: presets, seeded scene choice, the feed's layout and
// its scrolling. No DOM or WebGL.
import {randomFromSeed, pick, shuffled} from '../shared/random.js';

export const DEFAULT_SEED = 'pocket-001';
/** The phone display in texture pixels. */
export const SCREEN = {width: 768, height: 1576};
/** Heights of the app bars drawn over the feed, in screen pixels. */
export const BARS = {top: 268, bottom: 166};
/** Id of the feed post made from the weapon studio's render. */
export const WEAPON_POST = 'weapon-render';

export const environments = [
  {id: 'yard', label: 'Dust yard', sky: ['#5f8fc4', '#c9d6dc', '#e6d3ad'], fog: '#d9cfb6', ground: '#b9a47c', line: '#a08c66', props: ['#c2ad84', '#a8926a', '#8d7a58'],
    sun: '#fff0d2', sunPower: 3.4, ambient: ['#dcebff', '#8b7a5c'], ambientPower: 1.9, glow: null},
  {id: 'night', label: 'Night range', sky: ['#05080f', '#101a2c', '#26344a'], fog: '#131c2b', ground: '#232a33', line: '#39434f', props: ['#2c3540', '#252d37', '#353f4b'],
    sun: '#9db8ff', sunPower: 2, ambient: ['#6f8ab8', '#1c222c'], ambientPower: 1.8, glow: '#ffb45e'},
  {id: 'hall', label: 'Training hall', sky: ['#7d8791', '#a9b1b8', '#c7cdd1'], fog: '#b3babf', ground: '#8e969c', line: '#f2b33d', props: ['#9aa2a8', '#7f888f', '#b4bbc0'],
    sun: '#f4f8ff', sunPower: 2.6, ambient: ['#eef3f8', '#6c7378'], ambientPower: 2.1, glow: null},
];

/**
 * How the phone is held in view. `anchor` is where the screen's centre sits,
 * as a fraction of the half-frame ([1, -1] is the bottom-right corner);
 * `distance` is how far from the eye in hand units; angles are in degrees.
 */
export const holds = [
  {id: 'hip', label: 'Low right, like a viewmodel', anchor: [.5, -.2], distance: 3.3, yaw: -13, pitch: -7, roll: -5},
  {id: 'raised', label: 'Raised to read', anchor: [.16, -.04], distance: 2.35, yaw: -5, pitch: -3, roll: -2},
];

export const formats = [
  {id: 'wide', label: 'Landscape 16:9', width: 1920, height: 1080},
  {id: 'tall', label: 'Vertical 9:16', width: 1080, height: 1920},
  {id: 'post', label: 'Portrait 4:5', width: 1080, height: 1350},
];

/** Auto-scroll paces: seconds between flicks and how far each one travels, in screen heights. */
export const speeds = [
  {id: 'slow', label: 'Slow', wait: [2.6, 4.2], travel: [.35, .6]},
  {id: 'normal', label: 'Normal', wait: [1.4, 2.6], travel: [.45, .8]},
  {id: 'fast', label: 'Fast', wait: [.7, 1.3], travel: [.6, 1]},
];

export const DEFAULT_OPTIONS = {format: 'wide', hud: true, bars: true};

/** Picks an environment and a hold with equal weights; `options` are carried over unchanged. */
export function chooseScene(seed, options = DEFAULT_OPTIONS) {
  const random = randomFromSeed(seed);
  return {seed, environment: pick(environments, random).id, hold: pick(holds, random).id, ...DEFAULT_OPTIONS, ...options};
}

/** Where to draw an image inside a w x h box: [x, y, width, height]. */
export function imageRect(imageWidth, imageHeight, w, h, fit) {
  const scale = fit === 'contain' ? Math.min(w / imageWidth, h / imageHeight) : Math.max(w / imageWidth, h / imageHeight);
  return [(w - imageWidth * scale) / 2, (h - imageHeight * scale) / 2, imageWidth * scale, imageHeight * scale];
}

/**
 * Stacks posts into one column `width` wide, each scaled to that width.
 * @param posts [{id, width, height}]
 * @returns {items: [{id, y, height}], height} with `gap` pixels after each post
 */
export function layoutFeed(posts, width = SCREEN.width, gap = 2) {
  let y = 0;
  const items = posts.map(post => {
    const height = Math.max(1, Math.round(width * post.height / post.width)), item = {id: post.id, y, height};
    y += height + gap;
    return item;
  });
  return {items, height: y};
}

/** `value` wrapped into 0 (inclusive) to `size` (exclusive). */
export const wrap = (value, size) => ((value % size) + size) % size;

/**
 * The posts showing in a window of the feed. The feed is endless: after the
 * last post it starts again, so the same post can appear more than once.
 * @param top     feed position at the top edge of the window
 * @param height  window height
 * @returns [{id, y, height}] with y relative to the window's top edge
 */
export function visiblePosts(layout, top, height) {
  if (!layout.items.length || layout.height <= 0) return [];
  const result = [];
  for (let lap = Math.floor(top / layout.height); lap * layout.height < top + height; lap++) {
    for (const item of layout.items) {
      const y = lap * layout.height + item.y - top;
      if (y < height && y + item.height > 0) result.push({id: item.id, y, height: item.height});
    }
  }
  return result;
}

/** Moves a scroll position toward its target; quick at first, easing out. */
export function advanceScroll(position, target, seconds) {
  const next = position + (target - position) * (1 - Math.exp(-seconds * 7));
  return Math.abs(target - next) < .25 ? target : next;
}

/** The next automatic flick: how long to wait and how far to travel, in pixels. */
export function nextFlick(speedId, random, viewHeight = SCREEN.height) {
  const speed = speeds.find(item => item.id === speedId) || speeds[1], between = ([low, high]) => low + (high - low) * random();
  return {wait: between(speed.wait), distance: Math.round(between(speed.travel) * viewHeight)};
}

/**
 * The thumb's part in a flick, from 0 to 1 through the gesture: `along` runs
 * from -1 to 1 as it drags and back as it returns; `lift` is 0 while it
 * touches the glass and 1 at the top of its return.
 */
export function thumbGesture(progress) {
  const t = Math.max(0, Math.min(1, progress)), ease = x => x * x * (3 - 2 * x), drag = .42;
  if (t < drag) return {along: -1 + 2 * ease(t / drag), lift: 0};
  const back = (t - drag) / (1 - drag);
  return {along: 1 - 2 * ease(back), lift: Math.sin(back * Math.PI)};
}

/** 'light' or 'dark' from an image's RGBA samples, for bars that match the screenshots. */
export function themeFor(samples) {
  if (!samples?.length) return 'dark';
  let total = 0;
  for (let i = 0; i < samples.length; i += 4) total += .299 * samples[i] + .587 * samples[i + 1] + .114 * samples[i + 2];
  return total / (samples.length / 4) > 140 ? 'light' : 'dark';
}

/** A seeded feed order that does not depend on the order the ids arrive in. */
export function shuffleFeed(ids, seed) {
  return shuffled([...ids].sort(), randomFromSeed(seed));
}

/**
 * Where the centre of the phone's screen goes for a hold, in units of the
 * half frame height, keeping the phone inside narrow frames.
 * @returns [x, y]
 */
export function holdOffset(hold, aspect, phoneHalfWidth = .16) {
  const reach = Math.max(0, aspect - phoneHalfWidth);
  return [Math.min(hold.anchor[0] * 16 / 9, reach * .55), hold.anchor[1]];
}
