import type { ArtistAsset, MediaKind } from './types';
import { parseModel } from './model-loader';

const DB_NAME = 'market-ritual-studio';
const DB_VERSION = 1;
const STORE = 'assets';

export type StoredAsset = Omit<ArtistAsset, 'objectUrl'> & { blob: Blob };

const accepted: Record<string, MediaKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image',
  mp4: 'video', webm: 'video',
  obj: 'model', glb: 'model', gltf: 'model',
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted.'));
  });
}

function extension(name: string) {
  return name.toLowerCase().split('.').pop() || '';
}

function mediaMetadata(blob: Blob, kind: MediaKind) {
  if (kind === 'model') return Promise.resolve({});
  return new Promise<{ width?: number; height?: number; duration?: number }>((resolve) => {
    const url = URL.createObjectURL(blob);
    if (kind === 'image') {
      const image = new Image();
      image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); };
      image.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
      image.src = url;
    } else {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }); URL.revokeObjectURL(url); };
      video.onerror = () => { resolve({}); URL.revokeObjectURL(url); };
      video.src = url;
    }
  });
}

export async function validateFile(file: File) {
  const format = extension(file.name);
  const kind = accepted[format];
  if (!kind) throw new Error(`${file.name}: unsupported format. Use JPG, PNG, WebP, MP4, WebM, OBJ, GLB, or embedded GLTF.`);
  const limits = { image: 25, video: 500, model: 250 };
  if (file.size > limits[kind] * 1024 * 1024) throw new Error(`${file.name}: exceeds the ${limits[kind]} MB ${kind} limit.`);
  if (!file.size) throw new Error(`${file.name}: the file is empty.`);
  if (kind === 'model') await parseModel(file, format);
  return { kind, format };
}

export async function importFiles(files: File[]): Promise<ArtistAsset[]> {
  if (!('indexedDB' in window)) throw new Error('This browser does not provide IndexedDB storage.');
  const database = await openDatabase();
  const imported: ArtistAsset[] = [];
  for (const file of files) {
    const { kind, format } = await validateFile(file);
    const metadata = await mediaMetadata(file, kind);
    const model = kind === 'model' ? await parseModel(file, format) : undefined;
    const record: StoredAsset = {
      id: crypto.randomUUID(),
      name: file.name,
      kind,
      format,
      mime: file.type || `application/${format}`,
      size: file.size,
      createdAt: Date.now(),
      syncState: 'local',
      vertexCount: model?.vertexCount,
      ...metadata,
      blob: file,
    };
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    await complete(transaction);
    imported.push({ ...record, objectUrl: URL.createObjectURL(file) });
  }
  database.close();
  return imported;
}

export async function listAssets(): Promise<ArtistAsset[]> {
  if (!('indexedDB' in window)) return [];
  const database = await openDatabase();
  const records = await new Promise<StoredAsset[]>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return records.sort((a, b) => b.createdAt - a.createdAt).map((record) => ({ ...record, objectUrl: URL.createObjectURL(record.blob) }));
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const record = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return record?.blob;
}

export async function removeAsset(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).delete(id);
  await complete(transaction);
  database.close();
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return undefined;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
