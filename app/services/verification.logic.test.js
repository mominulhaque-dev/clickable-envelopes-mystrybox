import { describe, it, expect } from "vitest";
import { orderQualifies } from "./verification.server.js";
import { ELIGIBILITY_MODE } from "../lib/constants.js";

const order = (over = {}) => ({
  financialStatus: "paid",
  cancelled: false,
  productGids: JSON.stringify(["gid://shopify/Product/1"]),
  collectionGids: JSON.stringify(["gid://shopify/Collection/9"]),
  ...over,
});

describe("orderQualifies", () => {
  it("qualifies a paid, non-cancelled order for ALL mode", () => {
    const campaign = { eligibilityMode: ELIGIBILITY_MODE.ALL };
    expect(orderQualifies(order(), campaign, new Set())).toBe(true);
  });

  it("rejects cancelled orders", () => {
    const campaign = { eligibilityMode: ELIGIBILITY_MODE.ALL };
    expect(orderQualifies(order({ cancelled: true }), campaign, new Set())).toBe(false);
  });

  it("rejects refunded and unpaid orders", () => {
    const campaign = { eligibilityMode: ELIGIBILITY_MODE.ALL };
    expect(orderQualifies(order({ financialStatus: "refunded" }), campaign, new Set())).toBe(false);
    expect(orderQualifies(order({ financialStatus: "pending" }), campaign, new Set())).toBe(false);
    expect(orderQualifies(order({ financialStatus: "voided" }), campaign, new Set())).toBe(false);
  });

  it("matches product-scoped eligibility", () => {
    const campaign = { eligibilityMode: ELIGIBILITY_MODE.PRODUCTS };
    const eligible = new Set(["gid://shopify/Product/1"]);
    expect(orderQualifies(order(), campaign, eligible)).toBe(true);

    const notEligible = new Set(["gid://shopify/Product/999"]);
    expect(orderQualifies(order(), campaign, notEligible)).toBe(false);
  });

  it("matches collection-scoped eligibility", () => {
    const campaign = { eligibilityMode: ELIGIBILITY_MODE.COLLECTIONS };
    const eligible = new Set(["gid://shopify/Collection/9"]);
    expect(orderQualifies(order(), campaign, eligible)).toBe(true);

    const notEligible = new Set(["gid://shopify/Collection/8"]);
    expect(orderQualifies(order(), campaign, notEligible)).toBe(false);
  });
});
