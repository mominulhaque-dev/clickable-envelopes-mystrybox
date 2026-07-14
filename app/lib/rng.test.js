import { describe, it, expect } from "vitest";
import { weightedPick, seededRandom, secureRandom } from "./rng.js";

describe("weightedPick", () => {
  it("returns null when no positive-weight items exist", () => {
    expect(weightedPick([])).toBeNull();
    expect(weightedPick([{ weight: 0 }, { weight: 0 }])).toBeNull();
    expect(weightedPick([{ weight: -5 }])).toBeNull();
  });

  it("always returns the only positive-weight item", () => {
    const items = [{ id: "a", weight: 0 }, { id: "b", weight: 10 }];
    for (let i = 0; i < 50; i += 1) {
      expect(weightedPick(items, secureRandom).id).toBe("b");
    }
  });

  it("respects weights over many draws (roughly proportional)", () => {
    const items = [
      { id: "common", weight: 90 },
      { id: "rare", weight: 10 },
    ];
    const rand = seededRandom(12345);
    const counts = { common: 0, rare: 0 };
    const N = 20000;
    for (let i = 0; i < N; i += 1) counts[weightedPick(items, rand).id] += 1;
    const commonRatio = counts.common / N;
    // Expect ~0.9; allow generous tolerance for randomness.
    expect(commonRatio).toBeGreaterThan(0.85);
    expect(commonRatio).toBeLessThan(0.95);
  });

  it("is deterministic under a seeded RNG", () => {
    const items = [{ id: "a", weight: 3 }, { id: "b", weight: 7 }];
    const seq1 = [];
    const seq2 = [];
    const r1 = seededRandom(999);
    const r2 = seededRandom(999);
    for (let i = 0; i < 20; i += 1) {
      seq1.push(weightedPick(items, r1).id);
      seq2.push(weightedPick(items, r2).id);
    }
    expect(seq1).toEqual(seq2);
  });
});

describe("secureRandom", () => {
  it("stays within [0, 1)", () => {
    for (let i = 0; i < 1000; i += 1) {
      const v = secureRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
