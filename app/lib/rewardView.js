import { REWARD_TYPE, CLAIM_STATUS, DISCOUNT_KIND } from "./constants.js";

/**
 * Shape a claim + reward into a customer-safe display object for the storefront.
 * This is the single place that decides *what the customer sees and how they
 * claim it*:
 *
 *   - DISCOUNT / FREE_SHIPPING  -> a discount code to apply at checkout
 *   - GIFT_CARD                 -> a gift card code
 *   - FREE_PRODUCT / COUPON     -> instructions to redeem (no auto-provision)
 *   - NO_PRIZE                  -> a friendly "no win" message
 *
 * It never leaks internal fields (weights, inventory, gids beyond the issued
 * code). PENDING/FAILED claims are surfaced with an appropriate status so the
 * UI can show "issuing…" or an error path.
 */
export function toRewardView(claim, reward) {
  const won = !!reward && reward.type !== REWARD_TYPE.NO_PRIZE;

  if (!won) {
    return {
      won: false,
      status: CLAIM_STATUS.FULFILLED,
      title: "No luck this time",
      message: "Better luck on your next envelope!",
    };
  }

  const base = {
    won: true,
    status: claim.status,
    type: reward.type,
    title: reward.label,
    message: claim.claimInstructions ?? reward.claimInstructions ?? null,
    code: claim.code ?? null,
    expiresAt: claim.expiresAt ?? null,
  };

  // Provisioning still in flight or failed: tell the UI so it can poll/retry.
  if (claim.status === CLAIM_STATUS.PENDING) {
    return { ...base, message: base.message ?? "We're issuing your reward…" };
  }
  if (claim.status === CLAIM_STATUS.FAILED) {
    return {
      ...base,
      message:
        base.message ??
        "We hit a snag issuing your reward. Please contact the store.",
    };
  }

  // FULFILLED: attach a human-friendly value line per reward type.
  const cfg = reward.config ?? {};
  let detail = null;
  switch (reward.type) {
    case REWARD_TYPE.DISCOUNT:
      detail =
        cfg.kind === DISCOUNT_KIND.PERCENTAGE
          ? `${cfg.amount}% off`
          : `${cfg.amount} off`;
      break;
    case REWARD_TYPE.GIFT_CARD:
      detail = `${cfg.amount} gift card`;
      break;
    case REWARD_TYPE.FREE_SHIPPING:
      detail = "Free shipping";
      break;
    case REWARD_TYPE.FREE_PRODUCT:
      detail = cfg.productTitle ? `Free: ${cfg.productTitle}` : "Free product";
      break;
    default:
      detail = null;
  }

  return { ...base, detail };
}
