import { describe, it, expect } from "vitest";
import { buildRewardPool } from "./openEngine.server.js";

const reward = (over = {}) => ({
  id: "r",
  type: "DISCOUNT",
  probabilityWeight: 1,
  inventoryTotal: null,
  inventoryRemaining: null,
  config: "{}",
  ...over,
});

describe("buildRewardPool", () => {
  it("excludes zero/negative weight rewards", () => {
    const pool = buildRewardPool([
      reward({ id: "a", probabilityWeight: 0 }),
      reward({ id: "b", probabilityWeight: 5 }),
    ]);
    expect(pool.map((p) => p.reward.id)).toEqual(["b"]);
  });

  it("excludes rewards with exhausted finite inventory", () => {
    const pool = buildRewardPool([
      reward({ id: "a", inventoryTotal: 10, inventoryRemaining: 0 }),
      reward({ id: "b", inventoryTotal: 10, inventoryRemaining: 3 }),
      reward({ id: "c", inventoryTotal: null }),
    ]);
    expect(pool.map((p) => p.reward.id).sort()).toEqual(["b", "c"]);
  });

  it("adds a NO_PRIZE weight matching the house edge", () => {
    // 50% house edge with total reward weight 100 => noPrize weight 100.
    const pool = buildRewardPool([reward({ probabilityWeight: 100 })], 50);
    const noPrize = pool.find((p) => p.reward === null);
    expect(noPrize).toBeTruthy();
    expect(noPrize.weight).toBe(100);
  });

  it("adds no house-edge weight when houseEdge is 0", () => {
    const pool = buildRewardPool([reward({ probabilityWeight: 10 })], 0);
    expect(pool.some((p) => p.reward === null)).toBe(false);
  });

  it("caps house edge below 100 to keep some payout possible", () => {
    const pool = buildRewardPool([reward({ probabilityWeight: 10 })], 100);
    // edge clamped to 99 => finite noPrize weight, real reward still present.
    expect(pool.some((p) => p.reward !== null)).toBe(true);
  });

  it("produces an empty pool when nothing is available", () => {
    const pool = buildRewardPool([reward({ probabilityWeight: 0 })], 50);
    expect(pool).toEqual([]);
  });
});
