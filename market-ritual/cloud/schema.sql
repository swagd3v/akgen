CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'uploading',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_owner_created ON assets(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  asset_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS publications_slug ON publications(slug);
