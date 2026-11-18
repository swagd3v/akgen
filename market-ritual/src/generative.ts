import type { GeneratedScene, GeneratedTrait, TraitLayer } from './types';

export const SCENE_VERSION = 1;

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed: string) {
  let state = hashString(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T extends { weight: number }>(items: T[], random: () => number) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

const image = (name: string) => `/media/${name}.svg`;

export const traitLayers: TraitLayer[] = [
  {
    id: 'institution', optional: false, zPlane: 'behind', anchorTypes: ['viewport', 'time-price'], scale: [0.72, 1.22], opacity: [0.1, 0.28],
    assets: [
      { id: 'vault', kind: 'image', src: image('vault'), label: 'A monumental bank vault', weight: 5, blendMode: 'multiply' },
      { id: 'tower', kind: 'image', src: image('tower'), label: 'An impossible financial tower', weight: 3, blendMode: 'multiply' },
    ],
  },
  {
    id: 'body', optional: false, zPlane: 'front', anchorTypes: ['time-price', 'candle'], scale: [0.5, 0.92], opacity: [0.38, 0.78],
    assets: [
      { id: 'hand', kind: 'image', src: image('hand'), label: 'A hand reaching through a price chart', weight: 5, blendMode: 'screen' },
      { id: 'eye', kind: 'image', src: image('eye'), label: 'An eye observing the market', weight: 4, blendMode: 'multiply' },
      { id: 'mouth', kind: 'image', src: image('mouth'), label: 'A mouth speaking in numbers', weight: 2, blendMode: 'hard-light' },
    ],
  },
  {
    id: 'signal', optional: false, zPlane: 'front', anchorTypes: ['candle', 'time-price'], scale: [0.3, 0.65], opacity: [0.5, 0.92],
    assets: [
      { id: 'halo', kind: 'image', src: image('halo'), label: 'A fluorescent market halo', weight: 5, blendMode: 'screen' },
      { id: 'stamp', kind: 'image', src: image('stamp'), label: 'A distressed value stamp', weight: 4, blendMode: 'multiply' },
    ],
  },
  {
    id: 'ghost', optional: true, zPlane: 'front', anchorTypes: ['viewport', 'time-price'], scale: [0.45, 0.8], opacity: [0.2, 0.5],
    assets: [
      { id: 'ticker-film', kind: 'video', src: 'procedural:ticker-film', label: 'A looping field of financial glyphs', weight: 1, blendMode: 'screen' },
      { id: 'receipt', kind: 'image', src: image('receipt'), label: 'A receipt for an unknowable transaction', weight: 3, blendMode: 'multiply' },
    ],
  },
];

export function generateScene(seed: string, episodeId: string, pointCount: number): GeneratedScene {
  const random = seededRandom(`${seed}:${episodeId}:v${SCENE_VERSION}`);
  const reactions: GeneratedTrait['reaction'][] = ['volatility', 'volume', 'return'];
  const traits = traitLayers.flatMap((layer, layerIndex) => {
    if (layer.optional && random() < 0.25) return [];
    const count = layer.id === 'signal' ? 2 : 1;
    return Array.from({ length: count }, (_, duplicate): GeneratedTrait => {
      const asset = weighted(layer.assets, random);
      return {
        id: `${layer.id}-${asset.id}-${duplicate}`,
        layerId: layer.id,
        asset,
        zPlane: layer.zPlane,
        anchor: layer.anchorTypes[Math.floor(random() * layer.anchorTypes.length)],
        timeIndex: Math.floor(random() * Math.max(1, pointCount - 1)),
        priceFactor: 0.15 + random() * 0.72,
        x: 8 + random() * 78,
        y: 6 + random() * 72,
        scale: layer.scale[0] + random() * (layer.scale[1] - layer.scale[0]),
        rotation: -14 + random() * 28,
        opacity: layer.opacity[0] + random() * (layer.opacity[1] - layer.opacity[0]),
        reaction: reactions[(layerIndex + duplicate + Math.floor(random() * 3)) % reactions.length],
      };
    });
  });
  return { seed, episodeId, version: SCENE_VERSION, traits };
}

export function randomSeed() {
  const words = ['margin', 'oracle', 'liquidity', 'ritual', 'yield', 'specter', 'alpha', 'debt', 'future', 'noise'];
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `${words[values[0] % words.length]}-${(values[1] % 9999).toString().padStart(4, '0')}`;
}
