import type { Candle, MarketEpisode } from './types';

export type MarketInterval = '1M' | '5M' | '1H' | '1D';
export type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type MarketProduct = Omit<MarketEpisode, 'data'> & {
  productId: string;
  base: string;
  quote: string;
};

export type MarketTick = {
  productId: string;
  price: number;
  size: number;
  time: number;
  open24h?: number;
  volume24h?: number;
};

export const marketIntervals: Record<MarketInterval, { seconds: number; label: string }> = {
  '1M': { seconds: 60, label: '1 minute' },
  '5M': { seconds: 300, label: '5 minutes' },
  '1H': { seconds: 3600, label: '1 hour' },
  '1D': { seconds: 86400, label: '1 day' },
};

export const marketProducts: MarketProduct[] = [
  { id: 'BTC-USD', productId: 'BTC-USD', base: 'BTC', quote: 'USD', symbol: 'BTC/USD', title: 'Bitcoin', year: 'LIVE', thesis: 'A monetary network becoming an image of itself.', color: '#f7931a' },
  { id: 'ETH-USD', productId: 'ETH-USD', base: 'ETH', quote: 'USD', symbol: 'ETH/USD', title: 'Ethereum', year: 'LIVE', thesis: 'Programmable value under continuous negotiation.', color: '#627eea' },
  { id: 'SOL-USD', productId: 'SOL-USD', base: 'SOL', quote: 'USD', symbol: 'SOL/USD', title: 'Solana', year: 'LIVE', thesis: 'Velocity priced as collective belief.', color: '#14f195' },
];

const API = 'https://api.exchange.coinbase.com';
const SOCKET = 'wss://ws-feed.exchange.coinbase.com';
const KRAKEN_API = 'https://api.kraken.com/0/public/OHLC';
const KRAKEN_PAIRS: Record<string, string> = {
  'BTC-USD': 'XBTUSD',
  'ETH-USD': 'ETHUSD',
  'SOL-USD': 'SOLUSD',
};

function cacheKey(productId: string, interval: MarketInterval) {
  return `market-ritual:candles:${productId}:${interval}`;
}

function normalizeCoinbaseRows(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new Error('The exchange returned an invalid candle response.');
  const candles = rows.map((row): Candle | null => {
    if (!Array.isArray(row) || row.length < 6) return null;
    const [time, low, high, open, close, volume] = row.map(Number);
    if (![time, low, high, open, close, volume].every(Number.isFinite)) return null;
    return { time, low, high, open, close, volume };
  }).filter((candle): candle is Candle => candle !== null).sort((a, b) => a.time - b.time).slice(-300);
  if (!candles.length) throw new Error('No market candles are currently available.');
  return candles;
}

function normalizeKrakenRows(payload: unknown): Candle[] {
  if (!payload || typeof payload !== 'object') throw new Error('Kraken returned an invalid candle response.');
  const body = payload as { error?: unknown[]; result?: Record<string, unknown> };
  if (body.error?.length || !body.result) throw new Error('Kraken market data is temporarily unavailable.');
  const rows = Object.entries(body.result).find(([key, value]) => key !== 'last' && Array.isArray(value))?.[1];
  if (!Array.isArray(rows)) throw new Error('Kraken returned an invalid candle response.');
  const candles = rows.map((row): Candle | null => {
    if (!Array.isArray(row) || row.length < 7) return null;
    const [time, open, high, low, close, , volume] = row.map(Number);
    if (![time, low, high, open, close, volume].every(Number.isFinite)) return null;
    return { time, low, high, open, close, volume };
  }).filter((candle): candle is Candle => candle !== null).sort((a, b) => a.time - b.time).slice(-300);
  if (!candles.length) throw new Error('No market candles are currently available.');
  return candles;
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market data request failed (${response.status}).`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error('Market data route is not available on this host.');
  return response.json() as Promise<unknown>;
}

export async function fetchMarketCandles(productId: string, interval: MarketInterval, signal?: AbortSignal): Promise<Candle[]> {
  const granularity = marketIntervals[interval].seconds;
  const coinbaseUrls = [
    `/api/market/candles?product=${encodeURIComponent(productId)}&granularity=${granularity}`,
    `${API}/products/${encodeURIComponent(productId)}/candles?granularity=${granularity}`,
  ];
  let lastError: unknown;
  let candles: Candle[] | undefined;
  for (const url of coinbaseUrls) {
    try {
      candles = normalizeCoinbaseRows(await fetchJson(url, signal));
      break;
    } catch (reason) {
      if (signal?.aborted) throw reason;
      lastError = reason;
    }
  }
  if (!candles) {
    try {
      const pair = KRAKEN_PAIRS[productId];
      if (!pair) throw lastError;
      const minutes = Math.max(1, Math.round(granularity / 60));
      candles = normalizeKrakenRows(await fetchJson(`${KRAKEN_API}?pair=${encodeURIComponent(pair)}&interval=${minutes}`, signal));
    } catch (reason) {
      if (signal?.aborted) throw reason;
      throw new Error('Live exchange data is unreachable. Showing the last locally cached market session.', { cause: reason });
    }
  }
  try { localStorage.setItem(cacheKey(productId, interval), JSON.stringify(candles)); } catch { /* cache is optional */ }
  return candles;
}

export function readCachedCandles(productId: string, interval: MarketInterval): Candle[] {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(productId, interval)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function applyMarketTick(candles: Candle[], tick: MarketTick, interval: MarketInterval) {
  const seconds = marketIntervals[interval].seconds;
  const bucket = Math.floor(tick.time / seconds) * seconds;
  const next = candles.slice();
  const last = next.at(-1);
  if (!last || bucket > last.time) {
    const open = last?.close ?? tick.price;
    next.push({ time: bucket, open, high: Math.max(open, tick.price), low: Math.min(open, tick.price), close: tick.price, volume: tick.size });
  } else if (bucket === last.time) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, tick.price),
      low: Math.min(last.low, tick.price),
      close: tick.price,
      volume: last.volume + tick.size,
    };
  }
  return next.slice(-300);
}

export function connectMarketTicker(
  productIds: string[],
  onTick: (tick: MarketTick) => void,
  onStatus: (status: FeedStatus) => void,
) {
  let socket: WebSocket | undefined;
  let retry: number | undefined;
  let closed = false;
  let attempt = 0;

  const connect = () => {
    if (closed) return;
    onStatus(attempt ? 'reconnecting' : 'connecting');
    socket = new WebSocket(SOCKET);
    socket.onopen = () => {
      attempt = 0;
      socket?.send(JSON.stringify({ type: 'subscribe', product_ids: productIds, channels: ['ticker', 'heartbeat'] }));
      onStatus('live');
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type !== 'ticker') return;
        const price = Number(message.price);
        const size = Number(message.last_size || 0);
        const time = Date.parse(message.time) / 1000;
        if (!message.product_id || !Number.isFinite(price) || !Number.isFinite(time)) return;
        onTick({
          productId: message.product_id,
          price,
          size: Number.isFinite(size) ? size : 0,
          time,
          open24h: Number.isFinite(Number(message.open_24h)) ? Number(message.open_24h) : undefined,
          volume24h: Number.isFinite(Number(message.volume_24h)) ? Number(message.volume_24h) : undefined,
        });
      } catch { /* unsupported messages are ignored */ }
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      if (closed) return;
      onStatus('reconnecting');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      attempt += 1;
      retry = window.setTimeout(connect, delay);
    };
  };
  connect();
  return () => {
    closed = true;
    if (retry) window.clearTimeout(retry);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'unsubscribe', product_ids: productIds, channels: ['ticker', 'heartbeat'] }));
    socket?.close();
    onStatus('offline');
  };
}
