import { describe, it, expect } from "vitest";
import { toRewardView } from "./rewardView.js";
import { REWARD_TYPE, CLAIM_STATUS, DISCOUNT_KIND } from "./constants.js";

describe("toRewardView", () => {
  it("returns a no-win view when there is no reward", () => {
    const view = toRewardView({ status: CLAIM_STATUS.FULFILLED }, null);
    expect(view.won).toBe(false);
    expect(view.title).toMatch(/no luck/i);
  });

  it("treats NO_PRIZE as a loss", () => {
    const view = toRewardView(
      { status: CLAIM_STATUS.FULFILLED },
      { type: REWARD_TYPE.NO_PRIZE, label: "x", config: {} },
    );
    expect(view.won).toBe(false);
  });

  it("surfaces a percentage discount code and detail", () => {
    const claim = { status: CLAIM_STATUS.FULFILLED, code: "SAVE20", expiresAt: null };
    const reward = {
      type: REWARD_TYPE.DISCOUNT,
      label: "20% off",
      config: { kind: DISCOUNT_KIND.PERCENTAGE, amount: 20 },
    };
    const view = toRewardView(claim, reward);
    expect(view.won).toBe(true);
    expect(view.code).toBe("SAVE20");
    expect(view.detail).toBe("20% off");
  });

  it("labels a gift card by amount", () => {
    const view = toRewardView(
      { status: CLAIM_STATUS.FULFILLED, code: "GC-1" },
      { type: REWARD_TYPE.GIFT_CARD, label: "Gift card", config: { amount: 50 } },
    );
    expect(view.detail).toBe("50 gift card");
  });

  it("does not leak a code while the claim is still pending", () => {
    const view = toRewardView(
      { status: CLAIM_STATUS.PENDING, code: null },
      { type: REWARD_TYPE.DISCOUNT, label: "x", config: {} },
    );
    expect(view.won).toBe(true);
    expect(view.status).toBe(CLAIM_STATUS.PENDING);
    expect(view.code).toBeNull();
  });

  it("gives a graceful message on a failed claim", () => {
    const view = toRewardView(
      { status: CLAIM_STATUS.FAILED },
      { type: REWARD_TYPE.GIFT_CARD, label: "x", config: {} },
    );
    expect(view.status).toBe(CLAIM_STATUS.FAILED);
    expect(view.message).toMatch(/snag|contact/i);
  });
});
