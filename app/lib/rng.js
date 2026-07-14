import crypto from "node:crypto";

/**
 * Random number generation for the reward draw.
 *
 * By default we use crypto.randomInt for a cryptographically strong,
 * unbiased integer. For tests we accept an injectable RNG that returns a
 * float in [0, 1) so draws are deterministic and verifiable.
 */

/** Cryptographically strong float in [0, 1). */
export function secureRandom() {
  // 53 bits of randomness mapped into [0, 1).
  const buf = crypto.randomBytes(6); // 48 bits
  let value = 0;
  for (let i = 0; i < buf.length; i += 1) {
    value = value * 256 + buf[i];
  }
  return value / 2 ** 48;
}

/**
 * Deterministic mulberry32 PRNG — used only in tests via dependency injection.
 * Never used for production draws.
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted pick from a list of items.
 *
 * @param {Array<{ weight: number }>} items - candidates, each with a numeric weight.
 * @param {() => number} rand - RNG returning a float in [0, 1). Defaults to secureRandom.
 * @returns {*|null} the chosen item, or null if no positive-weight items exist.
 */
export function weightedPick(items, rand = secureRandom) {
  const pool = items.filter((it) => Number(it.weight) > 0);
  const total = pool.reduce((sum, it) => sum + Number(it.weight), 0);
  if (total <= 0) return null;

  let roll = rand() * total;
  for (const item of pool) {
    roll -= Number(item.weight);
    if (roll < 0) return item;
  }
  // Floating-point guard: return the last positive-weight item.
  return pool[pool.length - 1];
}
