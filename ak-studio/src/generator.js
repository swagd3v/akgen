// Zone definitions follow skingen's AK-47 component names, including source typos.
export const ZONES = {
  Body: ['UPPER_RECIEVER', 'LOWER_RECIEVER'],
  Barrel: ['BARREL', 'GASTUBE', 'GAS_LOCK', 'FRONT_HARDWARE', 'CLEANING_ROD'],
  Stock: ['STOCK', 'STOCK_PLATE', 'STOCK_HARDWARE'],
  Magazine: ['MAGAZINE', 'BULLETS'],
  Grip: ['PISTOL_GRIP', 'TRIGGER', 'TRIGGER_GAURD', 'MAG_RELEASE'],
  Foregrip: ['FOREGRIP_LOWER', 'FOREGRIP_TOP'],
  Details: ['BOLT', 'SIGHT_REAR', 'SCOPE_MOUNT', 'SPRING_COVER', 'BATTERY', 'BLOCK_&_BATTERY', 'BITS_N_THANGS', 'SAFE'],
};
export const DENSITIES = {
  sparse: {count: 2, coverage: .48, label: 'Sparse'},
  medium: {count: 4, coverage: .8, label: 'Balanced'},
  dense: {count: 8, coverage: 1.35, label: 'Layered'},
};
export const DEFAULT_SEED = 'edition-001';
export const SIZE = 2048;

export function randomFromSeed(seed) {
  let hash = 2166136261;
  for (const c of String(seed)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return () => {
    hash += 0x6d2b79f5;
    let t = Math.imul(hash ^ (hash >>> 15), hash | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initialParts(zones = Object.keys(ZONES)) {
  return Object.fromEntries(zones.map(zone => [zone, {
    locked: false, allowed: [], seed: null, density: 'medium', revision: 0,
  }]));
}

// Each part has its own random stream. A locked part is independent of other rolls.
export function generateParts(parts, seed, density, onlyZone = null) {
  return Object.fromEntries(Object.entries(parts).map(([zone, part]) => {
    if ((onlyZone && zone !== onlyZone) || part.locked) return [zone, {...part, allowed: [...part.allowed]}];
    return [zone, {...part, seed, density, revision: 0, allowed: [...part.allowed]}];
  }));
}

export function chooseImages(ids, seed, count) {
  if (!ids.length) return [];
  const sorted = [...ids].sort();
  const random = randomFromSeed(seed);
  return Array.from({length: count}, () => sorted[Math.floor(random() * sorted.length)]);
}

export function zoneForName(name) {
  return Object.keys(ZONES).find(zone => ZONES[zone].includes(name.toUpperCase())) || null;
}
