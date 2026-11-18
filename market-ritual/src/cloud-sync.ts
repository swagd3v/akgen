import type { ArtistAsset, CinematicScene } from './types';
import { getAssetBlob } from './asset-library';

export type CloudCapability = { available: boolean; authenticated: boolean; user?: string };

export async function getCloudCapability(): Promise<CloudCapability> {
  try {
    const response = await fetch('/api/studio/capability', { headers: { accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { available: false, authenticated: false };
    return response.json();
  } catch {
    return { available: false, authenticated: false };
  }
}

export async function syncAsset(asset: ArtistAsset, onProgress?: (progress: number) => void) {
  const blob = await getAssetBlob(asset.id);
  if (!blob) throw new Error('Local asset data is missing.');
  const init = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: asset.id, name: asset.name, kind: asset.kind, format: asset.format, mime: asset.mime, size: asset.size }),
  });
  if (!init.ok) throw new Error('Cloud upload could not be initialized.');
  const session = await init.json();
  const partSize = 8 * 1024 * 1024;
  const parts: { partNumber: number; etag: string }[] = [];
  for (let offset = 0, partNumber = 1; offset < blob.size; offset += partSize, partNumber += 1) {
    const response = await fetch(`/api/assets/${asset.id}/parts/${partNumber}?upload=${encodeURIComponent(session.uploadId)}`, {
      method: 'PUT', body: blob.slice(offset, Math.min(offset + partSize, blob.size)),
    });
    if (!response.ok) throw new Error(`Cloud upload failed on part ${partNumber}.`);
    parts.push({ partNumber, etag: response.headers.get('etag') || '' });
    onProgress?.(Math.min(1, (offset + partSize) / blob.size));
  }
  const complete = await fetch(`/api/assets/${asset.id}/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId: session.uploadId, parts }),
  });
  if (!complete.ok) throw new Error('Cloud upload could not be finalized.');
}

export async function publishScene(scene: CinematicScene) {
  const response = await fetch('/api/scenes/publish', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scene),
  });
  if (!response.ok) throw new Error('Publishing is unavailable until Sites cloud storage is connected.');
  return response.json() as Promise<{ url: string; slug: string }>;
}
