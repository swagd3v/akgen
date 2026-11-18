import type { Candle, MarketEpisode } from './types';

const DAY = 86_400;

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateEpisode(seed: number, start: number, base: number, pattern: number[]): Candle[] {
  const random = mulberry32(seed);
  const points: Candle[] = [];
  let previous = base;
  for (let i = 0; i < 144; i += 1) {
    const phase = i / 143;
    const patternIndex = Math.min(pattern.length - 1, Math.floor(phase * pattern.length));
    const regime = pattern[patternIndex];
    const noise = (random() - 0.48) * regime * 0.035;
    const wave = Math.sin(i / 5.7) * 0.006 + Math.sin(i / 15) * 0.004;
    const open = previous;
    const close = Math.max(2, open * (1 + noise + wave));
    const spread = Math.abs(close - open) + open * (0.007 + random() * 0.012);
    const high = Math.max(open, close) + spread * random();
    const low = Math.max(0.1, Math.min(open, close) - spread * random());
    const volume = Math.round(750_000 * (0.4 + random() * 1.4) * (1 + Math.abs(noise) * 16));
    points.push({
      time: start + i * DAY,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
    previous = close;
  }
  return points;
}

export const episodes: MarketEpisode[] = [
  {
    id: 'liquidity-event',
    symbol: 'LQD/08',
    title: 'The Liquidity Event',
    year: '2008—09',
    thesis: 'When confidence becomes a vanishing asset.',
    color: '#f34d2f',
    data: generateEpisode(2008, 1_220_227_200, 126, [0.9, 1.1, -2.8, -1.8, 0.8, 1.4]),
  },
  {
    id: 'meme-fever',
    symbol: 'MEME/21',
    title: 'Meme Fever',
    year: '2021',
    thesis: 'Attention discovers its own price chart.',
    color: '#4057ff',
    data: generateEpisode(2021, 1_609_459_200, 18, [0.8, 1.4, 3.2, 2.2, -2.1, 1.3]),
  },
  {
    id: 'machine-dream',
    symbol: 'AI/24',
    title: 'The Machine Dream',
    year: '2023—24',
    thesis: 'Future value, discounted by collective hallucination.',
    color: '#16a871',
    data: generateEpisode(2024, 1_694_044_800, 43, [0.8, 1.0, 1.5, 1.8, 0.7, 1.2]),
  },
];

export const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export function aggregateCandles(data: Candle[], bucket: number): Candle[] {
  if (bucket === 1) return data;
  const result: Candle[] = [];
  for (let i = 0; i < data.length; i += bucket) {
    const group = data.slice(i, i + bucket);
    if (!group.length) continue;
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, item) => sum + item.volume, 0),
    });
  }
  return result;
}

export function movingAverage(data: Candle[], length: number, exponential = false) {
  if (!exponential) {
    return data.map((bar, index) => ({
      time: bar.time,
      value: data.slice(Math.max(0, index - length + 1), index + 1).reduce((sum, item) => sum + item.close, 0) /
        Math.min(index + 1, length),
    }));
  }
  const multiplier = 2 / (length + 1);
  let value = data[0]?.close ?? 0;
  return data.map((bar) => {
    value = (bar.close - value) * multiplier + value;
    return { time: bar.time, value };
  });
}

export function rsi(data: Candle[], length = 14) {
  return data.map((bar, index) => {
    const start = Math.max(1, index - length + 1);
    let gain = 0;
    let loss = 0;
    for (let i = start; i <= index; i += 1) {
      const delta = data[i].close - data[i - 1].close;
      if (delta >= 0) gain += delta;
      else loss -= delta;
    }
    const averageGain = gain / Math.max(1, index - start + 1);
    const averageLoss = loss / Math.max(1, index - start + 1);
    return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  });
}
