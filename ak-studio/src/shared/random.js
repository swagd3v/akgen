// Deterministic helpers shared by the weapon and phone generators.

/** Returns a seeded generator of floats in [0, 1). The same seed always yields the same stream. */
export function randomFromSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let t = Math.imul(hash ^ (hash >>> 15), hash | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

/** Fisher-Yates on a copy, so callers keep their original order. */
export function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A fresh, human-typable seed such as "edition-1x9k2f". Browser only. */
export function newSeed(prefix) {
  return `${prefix}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}
