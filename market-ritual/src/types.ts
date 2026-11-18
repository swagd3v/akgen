export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketEpisode = {
  id: string;
  symbol: string;
  title: string;
  year: string;
  thesis: string;
  color: string;
  data: Candle[];
};

export type AnchorType = 'time-price' | 'candle' | 'viewport';
export type MediaKind = 'image' | 'video' | 'model';

export type AssetSyncState = 'local' | 'queued' | 'syncing' | 'synced' | 'error';

export type ArtistAsset = {
  id: string;
  name: string;
  kind: MediaKind;
  format: string;
  mime: string;
  size: number;
  createdAt: number;
  width?: number;
  height?: number;
  duration?: number;
  vertexCount?: number;
  objectUrl: string;
  syncState: AssetSyncState;
};

export type ReactionMetric = 'volatility' | 'volume' | 'return' | 'playback';

export type ReactionBinding = {
  metric: ReactionMetric;
  target: 'opacity' | 'scale' | 'rotation' | 'speed' | 'light' | 'distortion';
  range: [number, number];
};

export type CinematicLayer = {
  id: string;
  assetId: string;
  kind: MediaKind;
  enabled: boolean;
  opacity: number;
  blendMode: string;
  motion: 'float' | 'orbit' | 'rotate' | 'pulse' | 'still';
  reaction: ReactionBinding;
};

export type CinematicScene = {
  seed: string;
  episodeId: string;
  preset: 'archive' | 'liquid' | 'crash';
  layers: CinematicLayer[];
  audioAssetId?: string;
  masterVolume: number;
};

export type MediaAsset = {
  id: string;
  kind: MediaKind;
  src: string;
  label: string;
  weight: number;
  blendMode: string;
};

export type TraitLayer = {
  id: string;
  optional: boolean;
  zPlane: 'behind' | 'front';
  assets: MediaAsset[];
  anchorTypes: AnchorType[];
  scale: [number, number];
  opacity: [number, number];
};

export type GeneratedTrait = {
  id: string;
  layerId: string;
  asset: MediaAsset;
  zPlane: TraitLayer['zPlane'];
  anchor: AnchorType;
  timeIndex: number;
  priceFactor: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  reaction: Exclude<ReactionMetric, 'playback'>;
};

export type GeneratedScene = {
  seed: string;
  episodeId: string;
  version: number;
  traits: GeneratedTrait[];
};
