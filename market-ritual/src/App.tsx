import React from 'react';
import { formatMoney, movingAverage, rsi } from './data';
import { generateScene, randomSeed } from './generative';
import { applyMarketTick, connectMarketTicker, fetchMarketCandles, marketIntervals, marketProducts, readCachedCandles, type FeedStatus, type MarketInterval } from './market-data';
import { estimateStorage, formatBytes, importFiles, listAssets, removeAsset } from './asset-library';
import { getCloudCapability, publishScene, syncAsset, type CloudCapability } from './cloud-sync';
import { PhoneView } from './PhoneView';
import { CinematicStage } from './CinematicStage';
import type { ArtistAsset, Candle, CinematicScene, GeneratedTrait, MarketEpisode } from './types';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

type Tool = 'cursor' | 'trend' | 'horizontal' | 'rectangle';
type Drawing = { id: string; tool: Exclude<Tool, 'cursor'>; x1: number; y1: number; x2: number; y2: number };

function queryState() {
  const query = new URLSearchParams(window.location.search);
  return {
    episodeId: query.get('episode') ?? marketProducts[0].id,
    seed: query.get('seed') ?? 'oracle-1987',
    cinema: query.get('cinema') === '1',
  };
}

function metricFor(trait: GeneratedTrait, bars: Candle[], index: number) {
  const bar = bars[Math.min(index, bars.length - 1)];
  const previous = bars[Math.max(0, index - 1)] ?? bar;
  if (!bar) return 0;
  if (trait.reaction === 'return') return Math.min(1, Math.abs(bar.close - previous.close) / Math.max(1, previous.close) * 18);
  if (trait.reaction === 'volatility') return Math.min(1, (bar.high - bar.low) / Math.max(1, bar.close) * 15);
  const visible = bars.slice(Math.max(0, index - 14), index + 1);
  const maxVolume = Math.max(...visible.map((item) => item.volume), 1);
  return bar.volume / maxVolume;
}

function MediaTrait({
  trait,
  episode,
  playbackIndex,
  visibleBars,
}: {
  trait: GeneratedTrait;
  episode: MarketEpisode;
  playbackIndex: number;
  visibleBars: Candle[];
}) {
  const metric = metricFor(trait, episode.data, playbackIndex);
  const point = episode.data[Math.min(trait.timeIndex, episode.data.length - 1)];
  let left = `${trait.x}%`;
  let top = `${trait.y}%`;

  if (trait.anchor !== 'viewport' && point && visibleBars.length) {
    const firstTime = visibleBars[0].time;
    const lastTime = visibleBars.at(-1)!.time;
    const priceHigh = Math.max(...visibleBars.map((bar) => bar.high));
    const priceLow = Math.min(...visibleBars.map((bar) => bar.low));
    const price = point.low + (point.high - point.low) * trait.priceFactor;
    const xRatio = (point.time - firstTime) / Math.max(1, lastTime - firstTime);
    const yRatio = 1 - (price - priceLow) / Math.max(0.01, priceHigh - priceLow);
    left = `${4 + xRatio * 88}%`;
    top = `${6 + yRatio * 78}%`;
  }

  const style = {
    left,
    top,
    opacity: Math.min(0.96, trait.opacity + metric * 0.25),
    mixBlendMode: trait.asset.blendMode as React.CSSProperties['mixBlendMode'],
    transform: `translate(-50%, -50%) rotate(${trait.rotation + metric * 7}deg) scale(${trait.scale * (0.9 + metric * 0.3)})`,
    filter: `contrast(${1 + metric * 0.5}) saturate(${0.8 + metric * 0.8})`,
  };

  if (trait.asset.kind === 'video' && trait.asset.src.startsWith('procedural:')) {
    return (
      <div className="media-trait procedural-film" style={style} role="img" aria-label={trait.asset.label}>
        <span>BUY FEAR SELL MEMORY HOLD DESIRE</span>
        <span>∞ 0.00 +24.7 −8.03 ∞ 0.00</span>
        <span>LIQUIDITY IS A FEELING</span>
      </div>
    );
  }

  return trait.asset.kind === 'video' ? (
    <video
      className="media-trait"
      style={style}
      src={trait.asset.src}
      aria-label={trait.asset.label}
      autoPlay
      muted
      loop
      playsInline
      onError={(event) => { event.currentTarget.style.display = 'none'; }}
    />
  ) : (
    <img className="media-trait" style={style} src={trait.asset.src} alt={trait.asset.label} draggable={false} />
  );
}

function NativeChart({
  bars,
  showSMA,
  showEMA,
  onViewportChange,
}: {
  bars: Candle[];
  showSMA: boolean;
  showEMA: boolean;
  onViewportChange: (bars: Candle[]) => void;
}) {
  const [windowSize, setWindowSize] = useState(72);
  const [offset, setOffset] = useState(0);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; index: number } | null>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const width = 1000;
  const height = 520;
  const chartBottom = 438;
  const rightPadding = 72;
  const plotWidth = width - rightPadding;
  const size = Math.min(windowSize, bars.length);
  const maxOffset = Math.max(0, bars.length - size);
  const safeOffset = Math.min(offset, maxOffset);
  const start = Math.max(0, bars.length - size - safeOffset);
  const visible = bars.slice(start, start + size);
  const high = Math.max(...visible.map((bar) => bar.high), 1);
  const low = Math.min(...visible.map((bar) => bar.low), 0);
  const range = Math.max(0.01, high - low);
  const maxVolume = Math.max(...visible.map((bar) => bar.volume), 1);
  const xAt = (index: number) => 12 + (index + 0.5) * ((plotWidth - 24) / Math.max(1, visible.length));
  const yAt = (price: number) => 18 + (1 - (price - low) / range) * (chartBottom - 42);
  const candleWidth = Math.max(2, Math.min(11, (plotWidth / Math.max(1, visible.length)) * 0.58));
  const sma = movingAverage(visible, 12);
  const ema = movingAverage(visible, 9, true);
  const linePath = (values: { value: number }[]) => values.map((item, index) => `${index ? 'L' : 'M'}${xAt(index).toFixed(1)} ${yAt(item.value).toFixed(1)}`).join(' ');

  useEffect(() => onViewportChange(visible), [bars, windowSize, safeOffset]);
  useEffect(() => { setOffset(0); }, [bars.length]);

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setWindowSize((value) => Math.max(20, Math.min(bars.length, value + (event.deltaY > 0 ? 8 : -8))));
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    const y = ((event.clientY - bounds.top) / bounds.height) * height;
    if (drag.current) {
      const pixelDelta = event.clientX - drag.current.x;
      const barsDelta = Math.round(-pixelDelta / Math.max(5, bounds.width / Math.max(1, visible.length)));
      setOffset(Math.max(0, Math.min(maxOffset, drag.current.offset + barsDelta)));
    }
    const index = Math.max(0, Math.min(visible.length - 1, Math.floor((x / plotWidth) * visible.length)));
    setCrosshair({ x, y, index });
  };

  const selected = crosshair ? visible[crosshair.index] : undefined;

  return (
    <svg
      className="native-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onWheel={onWheel}
      onPointerDown={(event) => { drag.current = { x: event.clientX, offset: safeOffset }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={onPointerMove}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; setCrosshair(null); }}
      aria-label="Interactive candlestick chart. Drag to pan and scroll to zoom."
    >
      <g className="chart-grid">
        {[0, 1, 2, 3, 4].map((index) => <line key={`h${index}`} x1="0" y1={25 + index * 95} x2={plotWidth} y2={25 + index * 95} />)}
        {[0, 1, 2, 3, 4, 5].map((index) => <line key={`v${index}`} x1={index * plotWidth / 5} y1="0" x2={index * plotWidth / 5} y2={chartBottom} />)}
      </g>
      <g className="volume-bars">
        {visible.map((bar, index) => {
          const volumeHeight = (bar.volume / maxVolume) * 64;
          return <rect key={bar.time} x={xAt(index) - candleWidth / 2} y={chartBottom - volumeHeight} width={candleWidth} height={volumeHeight} className={bar.close >= bar.open ? 'candle-up' : 'candle-down'} />;
        })}
      </g>
      <g className="candles">
        {visible.map((bar, index) => {
          const up = bar.close >= bar.open;
          const bodyY = Math.min(yAt(bar.open), yAt(bar.close));
          const bodyHeight = Math.max(2, Math.abs(yAt(bar.open) - yAt(bar.close)));
          return (
            <g key={bar.time} className={up ? 'candle-up' : 'candle-down'}>
              <line x1={xAt(index)} y1={yAt(bar.high)} x2={xAt(index)} y2={yAt(bar.low)} />
              <rect x={xAt(index) - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} />
            </g>
          );
        })}
      </g>
      {showSMA && <path className="indicator-line sma-line" d={linePath(sma)} />}
      {showEMA && <path className="indicator-line ema-line" d={linePath(ema)} />}
      <g className="price-axis">
        {[0, 1, 2, 3, 4].map((index) => {
          const price = high - (index / 4) * range;
          return <text key={index} x={plotWidth + 9} y={30 + index * 95}>{price.toFixed(2)}</text>;
        })}
      </g>
      {visible.filter((_, index) => index % Math.max(1, Math.floor(visible.length / 5)) === 0).map((bar, index) => (
        <text className="time-label" key={bar.time} x={xAt(index * Math.max(1, Math.floor(visible.length / 5)))} y="505">{new Date(bar.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>
      ))}
      {crosshair && crosshair.x < plotWidth && (
        <g className="chart-crosshair">
          <line x1={crosshair.x} y1="0" x2={crosshair.x} y2={chartBottom} />
          <line x1="0" y1={crosshair.y} x2={plotWidth} y2={crosshair.y} />
          {selected && <text x={Math.min(crosshair.x + 10, plotWidth - 150)} y={Math.max(20, crosshair.y - 10)}>O {selected.open.toFixed(2)} H {selected.high.toFixed(2)} L {selected.low.toFixed(2)} C {selected.close.toFixed(2)}</text>}
        </g>
      )}
    </svg>
  );
}

function RSIPane({ values, color }: { values: number[]; color: string }) {
  const width = 800;
  const height = 88;
  const path = values.length < 2 ? '' : values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (value / 100) * height;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="rsi-pane" aria-label="Relative strength index">
      <div className="pane-label">RSI 14</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path className="rsi-guide" d={`M0 ${height * 0.3}H${width} M0 ${height * 0.7}H${width}`} />
        <path className="rsi-line" d={path} style={{ stroke: color }} />
      </svg>
      <span className="rsi-number">{Math.round(values.at(-1) ?? 0)}</span>
    </div>
  );
}

function App() {
  const initial = useMemo(queryState, []);
  const [episodeId, setEpisodeId] = useState(initial.episodeId);
  const [seed, setSeed] = useState(initial.seed);
  const [interval, setIntervalKey] = useState<MarketInterval>('1H');
  const [marketData, setMarketData] = useState<Candle[]>(() => readCachedCandles(initial.episodeId, '1H'));
  const [playbackIndex, setPlaybackIndex] = useState(() => Math.max(0, readCachedCandles(initial.episodeId, '1H').length - 1));
  const [playing, setPlaying] = useState(true);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('connecting');
  const [marketFresh, setMarketFresh] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [quotes, setQuotes] = useState<Record<string, { price: number; open24h?: number; volume24h?: number }>>({});
  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showRSI, setShowRSI] = useState(true);
  const [tool, setTool] = useState<Tool>('cursor');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [averagePrice, setAveragePrice] = useState(0);
  const [toast, setToast] = useState('');
  const [viewportBars, setViewportBars] = useState<Candle[]>([]);
  const [assets, setAssets] = useState<ArtistAsset[]>([]);
  const [importing, setImporting] = useState(false);
  const [draggingAsset, setDraggingAsset] = useState(false);
  const [immersive, setImmersive] = useState(initial.cinema);
  const [sound, setSound] = useState(false);
  const [cinematicPreset, setCinematicPreset] = useState<CinematicScene['preset']>('archive');
  const [storageLabel, setStorageLabel] = useState('CALCULATING');
  const [cloud, setCloud] = useState<CloudCapability>({ available: false, authenticated: false });
  const fileInput = useRef<HTMLInputElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const product = marketProducts.find((item) => item.id === episodeId) ?? marketProducts[0];
  const episode = useMemo<MarketEpisode>(() => ({ ...product, data: marketData }), [product, marketData]);
  const data = marketData;
  const visibleIndex = data.length ? (playing ? data.length - 1 : Math.min(playbackIndex, data.length - 1)) : 0;
  const visibleData = useMemo(() => data.slice(0, visibleIndex + 1), [data, visibleIndex]);
  const current = visibleData.at(-1) ?? data[0];
  const previous = visibleData.at(-2) ?? current;
  const change = current ? current.close - previous.close : 0;
  const changePct = previous ? (change / previous.close) * 100 : 0;
  const pnl = position && current ? (current.close - averagePrice) * position : 0;
  const scene = useMemo(() => generateScene(seed, episode.id, Math.max(1, episode.data.length)), [seed, episode.id, episode.data.length]);
  const rsiValues = useMemo(() => rsi(visibleData), [visibleData]);
  const volumeWindow = visibleData.slice(Math.max(0, visibleData.length - 18));
  const maxRecentVolume = Math.max(...volumeWindow.map((bar) => bar.volume), 1);
  const marketSignal = Math.min(1, Math.abs(changePct) / 5 + (current?.volume || 0) / maxRecentVolume * .38);
  const cinematicScene = useMemo<CinematicScene>(() => ({
    seed, episodeId: episode.id, preset: cinematicPreset,
    layers: assets.map((asset, index) => ({
      id: `artist-${asset.id}`, assetId: asset.id, kind: asset.kind, enabled: true,
      opacity: asset.kind === 'video' ? .7 : .8,
      blendMode: index % 2 ? 'screen' : 'multiply',
      motion: asset.kind === 'model' ? 'orbit' : 'pulse',
      reaction: { metric: index % 2 ? 'volatility' : 'volume', target: asset.kind === 'video' ? 'speed' : 'scale', range: [.8, 1.25] },
    })),
    audioAssetId: assets.find((asset) => asset.kind === 'video')?.id,
    masterVolume: .72,
  }), [seed, episode.id, cinematicPreset, assets]);

  useEffect(() => {
    let active = true;
    listAssets().then((items) => { if (active) setAssets(items); }).catch(() => { if (active) setToast('Local asset library could not be opened'); });
    estimateStorage().then((estimate) => {
      if (!active || !estimate) return;
      setStorageLabel(`${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`);
    });
    getCloudCapability().then((capability) => { if (active) setCloud(capability); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setMarketFresh(false);
    const cached = readCachedCandles(episodeId, interval);
    if (cached.length) {
      setMarketData(cached);
      setPlaybackIndex(cached.length - 1);
    } else {
      setMarketData([]);
      setPlaybackIndex(0);
    }
    const load = async () => {
      try {
        const candles = await fetchMarketCandles(episodeId, interval, controller.signal);
        setMarketData(candles);
        if (playingRef.current) setPlaybackIndex(candles.length - 1);
        const latest = candles.at(-1);
        const dayAgo = candles.find((candle) => candle.time >= (latest?.time ?? 0) - 86_400) ?? candles[0];
        if (latest) setQuotes((items) => ({ ...items, [episodeId]: { price: latest.close, open24h: dayAgo?.open } }));
        setMarketFresh(true);
        setMarketError('');
      } catch (reason) {
        if (controller.signal.aborted) return;
        setMarketError(reason instanceof Error ? reason.message : 'Market data is temporarily unavailable.');
      }
    };
    load();
    const reconciliation = window.setInterval(load, 60_000);
    return () => { controller.abort(); window.clearInterval(reconciliation); };
  }, [episodeId, interval]);

  useEffect(() => connectMarketTicker(
    marketProducts.map((item) => item.productId),
    (tick) => {
      setQuotes((items) => ({ ...items, [tick.productId]: { price: tick.price, open24h: tick.open24h, volume24h: tick.volume24h } }));
      if (tick.productId !== episodeId) return;
      setMarketData((candles) => {
        const next = applyMarketTick(candles, tick, interval);
        if (playingRef.current) setPlaybackIndex(Math.max(0, next.length - 1));
        return next;
      });
    },
    setFeedStatus,
  ), [episodeId, interval]);

  useEffect(() => {
    const query = new URLSearchParams({ episode: episode.id, seed, v: String(scene.version) });
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
  }, [episode.id, seed, scene.version]);

  const switchEpisode = (id: string) => {
    setEpisodeId(id);
    const cached = readCachedCandles(id, interval);
    setMarketData(cached);
    setPlaybackIndex(Math.max(0, cached.length - 1));
    setPlaying(true);
    setPosition(0);
    setAveragePrice(0);
    setDrawings([]);
  };

  const feedLabel = feedStatus === 'live' ? 'LIVE STREAM' : marketFresh ? 'REAL DATA / POLLING' : feedStatus.toUpperCase();

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    try {
      const imported = await importFiles(files);
      setAssets((items) => [...imported, ...items]);
      const estimate = await estimateStorage();
      if (estimate) setStorageLabel(`${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`);
      notify(`${imported.length} ASSET${imported.length === 1 ? '' : 'S'} ADDED TO THE RITUAL`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Asset import failed');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const deleteArtistAsset = async (asset: ArtistAsset) => {
    try {
      await removeAsset(asset.id);
      URL.revokeObjectURL(asset.objectUrl);
      setAssets((items) => items.filter((item) => item.id !== asset.id));
      notify(`${asset.name} REMOVED`);
    } catch {
      notify('Asset could not be removed');
    }
  };

  const syncArtistAsset = async (asset: ArtistAsset) => {
    if (!cloud.available) { notify('CLOUD READY / CONNECT SITES STORAGE TO SYNC'); return; }
    setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, syncState: 'syncing' } : item));
    try {
      await syncAsset(asset);
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, syncState: 'synced' } : item));
      notify(`${asset.name} SYNCED`);
    } catch (reason) {
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, syncState: 'error' } : item));
      notify(reason instanceof Error ? reason.message : 'Cloud sync failed');
    }
  };

  const publishCinematicScene = async () => {
    if (!cloud.available) { notify('PUBLISH READY / SITES REGISTRATION IS NOT AVAILABLE IN THIS CLIENT'); return; }
    try {
      const result = await publishScene(cinematicScene);
      await navigator.clipboard.writeText(new URL(result.url, window.location.origin).href);
      notify('PUBLIC SCENE LINK COPIED');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Scene publication failed');
    }
  };

  const enterCinema = async () => {
    setImmersive(true);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* fullscreen remains optional */ }
  };

  const exitCinema = async () => {
    setImmersive(false);
    setSound(false);
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore browser exit errors */ }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && immersive) exitCinema(); };
    const fullscreen = () => { if (!document.fullscreenElement) setImmersive(false); };
    window.addEventListener('keydown', keydown);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => { window.removeEventListener('keydown', keydown); document.removeEventListener('fullscreenchange', fullscreen); };
  }, [immersive]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Seed link copied to clipboard');
    } catch {
      notify('Copy the URL to share this scene');
    }
  };

  const trade = (direction: 1 | -1) => {
    if (!current) return;
    const nextPosition = position + direction * 10;
    if (position === 0 || Math.sign(nextPosition) === Math.sign(position)) {
      const weightedCost = averagePrice * Math.abs(position) + current.close * 10;
      setAveragePrice(weightedCost / (Math.abs(position) + 10));
    } else if (nextPosition === 0 || Math.sign(nextPosition) !== Math.sign(position)) {
      setAveragePrice(nextPosition === 0 ? 0 : current.close);
    }
    setPosition(nextPosition);
    notify(`${direction > 0 ? 'BOUGHT' : 'SOLD'} 10 ${episode.symbol} @ ${formatMoney(current.close)}`);
  };

  const onDrawingClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool === 'cursor') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    if (tool === 'horizontal') {
      setDrawings((items) => [...items, { id: crypto.randomUUID(), tool, x1: 0, y1: point.y, x2: bounds.width, y2: point.y }]);
      setTool('cursor');
      return;
    }
    if (!drawingStart) setDrawingStart(point);
    else {
      setDrawings((items) => [...items, { id: crypto.randomUUID(), tool, x1: drawingStart.x, y1: drawingStart.y, x2: point.x, y2: point.y }]);
      setDrawingStart(null);
      setTool('cursor');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => notify('MARKET RITUAL / VERSION 01')}>
          <span className="logo-mark">MR</span>
          <span>MARKET RITUAL</span>
          <small>A SPECULATIVE TERMINAL</small>
        </button>
        <div className="ticker-tape" aria-label="Artistic market ticker">
          <span>DESIRE <b className="up">+4.12%</b></span>
          <span>CONFIDENCE <b className="down">−8.03%</b></span>
          <span>ATTENTION <b className="up">+24.7%</b></span>
          <span>MEMORY <b>0.00%</b></span>
        </div>
        <div className="header-actions">
          <button className="cinema-button" onClick={enterCinema}>ENTER CINEMA</button>
          <button className="icon-button" onClick={copyShare} aria-label="Copy share link">↗</button>
          <button className="about-button" onClick={() => (document.getElementById('statement') as HTMLDialogElement | null)?.showModal()}>ABOUT</button>
          <span className={`live-dot feed-${feedStatus}`}>{feedLabel}</span>
        </div>
      </header>

      <main className="terminal">
        <aside className="watchlist-panel">
          <div className="panel-heading"><span>CRYPTO MARKET</span><span>PUBLIC FEED</span></div>
          <div className="watchlist">
            {marketProducts.map((item, index) => {
              const quote = quotes[item.productId];
              const pct = quote?.open24h ? ((quote.price - quote.open24h) / quote.open24h) * 100 : 0;
              return (
                <button key={item.id} className={`watch-row ${episode.id === item.id ? 'active' : ''}`} onClick={() => switchEpisode(item.id)}>
                  <span className="watch-index">0{index + 1}</span>
                  <span><strong>{item.symbol}</strong><small>{quote ? formatMoney(quote.price) : 'CONNECTING'}</small></span>
                  <span className={pct >= 0 ? 'up' : 'down'}>{quote?.open24h ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}</span>
                </button>
              );
            })}
          </div>
          <div className="archive-note">
            <span>MARKET FEED / {feedLabel}</span>
            <p>{marketError || 'Real public-exchange candles with live ticker updates and resilient polling. Artwork and paper trades remain simulations.'}</p>
          </div>
          <div className="position-card">
            <div className="panel-heading"><span>PAPER POSITION</span><span>{position === 0 ? 'FLAT' : `${position} UNITS`}</span></div>
            <div className="position-value" data-positive={pnl >= 0}>{formatMoney(pnl)}</div>
            <div className="position-meta"><span>AVG {averagePrice ? formatMoney(averagePrice) : '—'}</span><span>UNREALIZED</span></div>
          </div>
        </aside>

        <section className="workspace">
          <div className="instrument-bar">
            <div className="instrument-id">
              <span className="episode-number">{String(marketProducts.indexOf(product) + 1).padStart(2, '0')}</span>
              <div><h1>{episode.symbol}</h1><p>{episode.title} · {feedLabel}</p></div>
            </div>
            <div className="quote">
              <strong>{formatMoney(current?.close ?? 0)}</strong>
              <span className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '+' : ''}{change.toFixed(2)} / {changePct.toFixed(2)}%</span>
            </div>
            <div className="intervals" aria-label="Chart interval">
              {(Object.keys(marketIntervals) as MarketInterval[]).map((key) => (
                <button key={key} className={interval === key ? 'active' : ''} title={marketIntervals[key].label} onClick={() => { setIntervalKey(key); setPlaying(true); }}>{key}</button>
              ))}
            </div>
            <div className="trade-buttons">
              <button className="sell" onClick={() => trade(-1)}><small>SIMULATE</small>SELL</button>
              <button className="buy" onClick={() => trade(1)}><small>SIMULATE</small>BUY</button>
            </div>
          </div>

          <div className="chart-toolbar">
            <div className="tools" aria-label="Drawing tools">
              <button className={tool === 'cursor' ? 'active' : ''} onClick={() => setTool('cursor')} title="Cursor">↖</button>
              <button className={tool === 'trend' ? 'active' : ''} onClick={() => setTool('trend')} title="Trend line">╱</button>
              <button className={tool === 'horizontal' ? 'active' : ''} onClick={() => setTool('horizontal')} title="Horizontal line">—</button>
              <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => setTool('rectangle')} title="Rectangle">□</button>
              <button onClick={() => setDrawings([])} title="Clear drawings">×</button>
            </div>
            <div className="indicator-toggles">
              <button className={showSMA ? 'active' : ''} onClick={() => setShowSMA((value) => !value)}>SMA 12</button>
              <button className={showEMA ? 'active' : ''} onClick={() => setShowEMA((value) => !value)}>EMA 9</button>
              <button className={showRSI ? 'active' : ''} onClick={() => setShowRSI((value) => !value)}>RSI 14</button>
            </div>
            <div className="ohlc">
              <span>O {current?.open.toFixed(2)}</span><span>H {current?.high.toFixed(2)}</span><span>L {current?.low.toFixed(2)}</span><span>C {current?.close.toFixed(2)}</span>
            </div>
          </div>

          <div className={`chart-stage tool-${tool}`}>
            <CinematicStage
              assets={assets}
              scene={cinematicScene}
              signal={marketSignal}
              immersive={false}
              sound={false}
              onToggleSound={() => undefined}
              onPreset={setCinematicPreset}
            />
            <div className="media-plane behind" aria-hidden="true">
              {scene.traits.filter((trait) => trait.zPlane === 'behind').map((trait) => (
                <MediaTrait key={trait.id} trait={trait} episode={episode} playbackIndex={Math.min(playbackIndex, episode.data.length - 1)} visibleBars={viewportBars.length ? viewportBars : visibleData} />
              ))}
            </div>
            <NativeChart bars={visibleData} showSMA={showSMA} showEMA={showEMA} onViewportChange={setViewportBars} />
            <div className="media-plane front">
              {scene.traits.filter((trait) => trait.zPlane === 'front').map((trait) => (
                <MediaTrait key={trait.id} trait={trait} episode={episode} playbackIndex={Math.min(playbackIndex, episode.data.length - 1)} visibleBars={viewportBars.length ? viewportBars : visibleData} />
              ))}
            </div>
            <svg className="drawing-plane" onClick={onDrawingClick} aria-label={tool === 'cursor' ? 'Chart drawings' : `Place ${tool} drawing`}>
              {drawings.map((drawing) => drawing.tool === 'rectangle' ? (
                <rect key={drawing.id} x={Math.min(drawing.x1, drawing.x2)} y={Math.min(drawing.y1, drawing.y2)} width={Math.abs(drawing.x2 - drawing.x1)} height={Math.abs(drawing.y2 - drawing.y1)} />
              ) : (
                <line key={drawing.id} x1={drawing.x1} y1={drawing.y1} x2={drawing.x2} y2={drawing.y2} />
              ))}
              {drawingStart && <circle cx={drawingStart.x} cy={drawingStart.y} r="5" />}
            </svg>
            <PhoneView />
            <div className="scene-caption"><span>SCENE / {scene.seed}</span><b>{episode.thesis}</b></div>
          </div>

          {showRSI && <RSIPane values={rsiValues} color={episode.color} />}

          <div className="transport">
            <button className="play-button" onClick={() => {
              if (!playing) setPlaybackIndex(Math.max(0, data.length - 1));
              setPlaying((value) => !value);
            }}>{playing ? 'Ⅱ' : '▶'}</button>
            <span className="transport-label">{playing ? 'LIVE FOLLOW' : 'HISTORY PAUSED'}</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, data.length - 1)}
              value={visibleIndex}
              onChange={(event) => { setPlaying(false); setPlaybackIndex(Number(event.target.value)); }}
              disabled={!data.length}
              aria-label="Market history position"
            />
            <span>{String(visibleIndex + 1).padStart(3, '0')} / {String(data.length).padStart(3, '0')}</span>
          </div>
        </section>

        <aside className="generator-panel">
          <div className="generator-heading"><span>COMPOSITION ENGINE</span><b>LIVE</b></div>
          <div className="seed-block">
            <label htmlFor="seed">SEED</label>
            <div><input id="seed" value={seed} onChange={(event) => setSeed(event.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))} /><button onClick={() => setSeed(randomSeed())}>↻</button></div>
            <small>Deterministic / shareable / version {scene.version}</small>
          </div>
          <div className="asset-library">
            <div className="panel-heading"><span>ARTIST LIBRARY</span><span>{assets.length} ASSETS</span></div>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.obj,.glb,.gltf"
              onChange={(event) => handleFiles(Array.from(event.target.files || []))}
            />
            <button
              className={`upload-drop ${draggingAsset ? 'dragging' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDraggingAsset(true); }}
              onDragLeave={() => setDraggingAsset(false)}
              onDrop={(event) => { event.preventDefault(); setDraggingAsset(false); handleFiles(Array.from(event.dataTransfer.files)); }}
            >
              <b>{importing ? 'PROCESSING MEDIA…' : '+ DROP IMAGES / FILMS / 3D'}</b>
              <small>JPG · PNG · WEBP · MP4 · WEBM · OBJ · GLB</small>
            </button>
            <div className="asset-storage"><span>LOCAL {storageLabel}</span><span>{cloud.available ? (cloud.authenticated ? 'CLOUD CONNECTED' : 'SIGN IN TO SYNC') : 'CLOUD READY'}</span></div>
            <div className="asset-list">
              {assets.map((asset) => (
                <article className="asset-row" key={asset.id}>
                  <div className={`asset-preview kind-${asset.kind}`}>
                    {asset.kind === 'image' && <img src={asset.objectUrl} alt="" />}
                    {asset.kind === 'video' && <video src={asset.objectUrl} muted preload="metadata" />}
                    {asset.kind === 'model' && <span>3D</span>}
                  </div>
                  <div className="asset-meta"><strong title={asset.name}>{asset.name}</strong><small>{asset.kind.toUpperCase()} · {formatBytes(asset.size)}{asset.vertexCount ? ` · ${asset.vertexCount.toLocaleString()} VTX` : ''}</small></div>
                  <div className="asset-actions">
                    <button onClick={() => syncArtistAsset(asset)} title="Sync to cloud">{asset.syncState === 'syncing' ? '…' : asset.syncState === 'synced' ? '✓' : '↑'}</button>
                    <button onClick={() => deleteArtistAsset(asset)} title="Delete asset">×</button>
                  </div>
                </article>
              ))}
              {!assets.length && <p className="asset-empty">Your uploads stay private in this browser until cloud sync is connected.</p>}
            </div>
          </div>
          <div className="trait-list">
            <div className="panel-heading"><span>RESOLVED TRAITS</span><span>{scene.traits.length}</span></div>
            {scene.traits.map((trait, index) => (
              <div className="trait-row" key={trait.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{trait.layerId.toUpperCase()}</strong><small>{trait.asset.id} / {trait.anchor}</small></div>
                <i style={{ background: index % 2 ? '#4057ff' : episode.color }} />
              </div>
            ))}
          </div>
          <div className="reaction-map">
            <div className="panel-heading"><span>MARKET → IMAGE</span><span>MAP</span></div>
            {scene.traits.slice(0, 4).map((trait) => {
              const metric = metricFor(trait, episode.data, Math.min(playbackIndex, episode.data.length - 1));
              return <div className="meter" key={trait.id}><span>{trait.reaction}</span><i><b style={{ width: `${metric * 100}%` }} /></i><em>{Math.round(metric * 100)}</em></div>;
            })}
          </div>
          <button className="generate-button" onClick={() => setSeed(randomSeed())}><span>GENERATE NEW RITUAL</span><small>Randomize weighted media traits</small></button>
          <button className="cinematic-launch" onClick={enterCinema}><span>ENTER CINEMATIC MODE</span><small>Full-screen film + 3D composition</small></button>
          <button className="publish-button" onClick={publishCinematicScene}>PUBLISH SCENE {cloud.available ? '↗' : '○'}</button>
          <button className="share-button" onClick={copyShare}>COPY SEED LINK ↗</button>
          <p className="disclaimer">REAL PUBLIC MARKET DATA · PAPER ORDERS ONLY · NOT FINANCIAL ADVICE</p>
        </aside>
      </main>

      {immersive && (
        <CinematicStage
          assets={assets}
          scene={cinematicScene}
          signal={marketSignal}
          immersive
          sound={sound}
          onToggleSound={() => setSound((value) => !value)}
          onPreset={setCinematicPreset}
          onExit={exitCinema}
        >
          <NativeChart bars={visibleData} showSMA={showSMA} showEMA={showEMA} onViewportChange={() => undefined} />
        </CinematicStage>
      )}

      <dialog id="statement" className="statement-dialog">
        <form method="dialog"><button aria-label="Close">×</button></form>
        <span>ARTIST STATEMENT / 01</span>
        <h2>What if a price chart could remember what it erased?</h2>
        <p>Market Ritual borrows the visual authority of financial software and contaminates real cryptocurrency market data with bodies, monuments, receipts, and symbols. The prices are real; the orders and artwork are simulations.</p>
        <p>Every seed resolves a weighted collection of media traits. Price, volume, and volatility then disturb the composition in real time. The result is reproducible, but never neutral.</p>
        <small>Built as an artwork. It cannot connect to a broker or execute a trade.</small>
      </dialog>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default App;
