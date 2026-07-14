import { describe, it, expect } from "vitest";
import { validateCampaignInput, validateRewardInput } from "./validation.js";

describe("validateCampaignInput", () => {
  it("requires a name", () => {
    const r = validateCampaignInput({ name: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeTruthy();
  });

  it("accepts a minimal valid campaign", () => {
    const r = validateCampaignInput({ name: "Holiday Vault", envelopeCount: 100 });
    expect(r.ok).toBe(true);
    expect(r.value.name).toBe("Holiday Vault");
    expect(r.value.envelopeCount).toBe(100);
  });

  it("rejects non-allowed envelope counts", () => {
    const r = validateCampaignInput({ name: "X", envelopeCount: 77 });
    expect(r.ok).toBe(false);
    expect(r.errors.envelopeCount).toBeTruthy();
  });

  it("rejects end date before start date", () => {
    const r = validateCampaignInput({
      name: "X",
      startAt: "2026-02-01",
      endAt: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.endAt).toBeTruthy();
  });

  it("rejects house edge outside 0-100", () => {
    expect(validateCampaignInput({ name: "X", houseEdge: 150 }).ok).toBe(false);
    expect(validateCampaignInput({ name: "X", houseEdge: -1 }).ok).toBe(false);
  });
});

describe("validateRewardInput", () => {
  it("validates a percentage discount", () => {
    const r = validateRewardInput({
      type: "DISCOUNT",
      label: "15% off",
      probabilityWeight: 5,
      config: { kind: "percentage", amount: 15 },
    });
    expect(r.ok).toBe(true);
    expect(r.value.config).toEqual({ kind: "percentage", amount: 15 });
  });

  it("rejects percentage discounts over 100", () => {
    const r = validateRewardInput({
      type: "DISCOUNT",
      label: "bad",
      config: { kind: "percentage", amount: 150 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.config).toBeTruthy();
  });

  it("rejects negative probability weight", () => {
    const r = validateRewardInput({
      type: "NO_PRIZE",
      label: "Try again",
      probabilityWeight: -3,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.probabilityWeight).toBeTruthy();
  });

  it("requires a product for FREE_PRODUCT rewards", () => {
    const r = validateRewardInput({
      type: "FREE_PRODUCT",
      label: "Free mug",
      config: {},
    });
    expect(r.ok).toBe(false);
    expect(r.errors.config).toBeTruthy();
  });

  it("requires a gift card amount", () => {
    const r = validateRewardInput({
      type: "GIFT_CARD",
      label: "Gift card",
      config: { amount: 0 },
    });
    expect(r.ok).toBe(false);
  });
});
