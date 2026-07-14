/**
 * Application-level enums. SQLite has no native enum type, so these string
 * constants are the single source of truth and are enforced by validation
 * (see app/lib/validation.js) rather than the database.
 */

export const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
});

export const CAMPAIGN_STATUSES = Object.values(CAMPAIGN_STATUS);

export const ELIGIBILITY_MODE = Object.freeze({
  ALL: "ALL",
  PRODUCTS: "PRODUCTS",
  COLLECTIONS: "COLLECTIONS",
});

export const ELIGIBILITY_MODES = Object.values(ELIGIBILITY_MODE);

export const ELIGIBILITY_TARGET = Object.freeze({
  PRODUCT: "PRODUCT",
  COLLECTION: "COLLECTION",
});

export const REWARD_TYPE = Object.freeze({
  FREE_PRODUCT: "FREE_PRODUCT",
  DISCOUNT: "DISCOUNT",
  GIFT_CARD: "GIFT_CARD",
  FREE_SHIPPING: "FREE_SHIPPING",
  COUPON: "COUPON",
  NO_PRIZE: "NO_PRIZE",
  CUSTOM: "CUSTOM",
});

export const REWARD_TYPES = Object.values(REWARD_TYPE);

/** Reward types that result in a real Shopify resource being provisioned. */
export const PROVISIONED_REWARD_TYPES = Object.freeze([
  REWARD_TYPE.DISCOUNT,
  REWARD_TYPE.GIFT_CARD,
  REWARD_TYPE.FREE_SHIPPING,
]);

export const ENVELOPE_STATUS = Object.freeze({
  UNOPENED: "UNOPENED",
  OPENED: "OPENED",
});

export const CLAIM_STATUS = Object.freeze({
  PENDING: "PENDING",
  FULFILLED: "FULFILLED",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
});

/** Allowed envelope grid sizes a merchant can choose. */
export const ENVELOPE_COUNT_OPTIONS = Object.freeze([50, 100, 250, 500, 1000]);

export const DEFAULT_ENVELOPE_COUNT = 100;

/** Discount reward "kind" values stored inside Reward.config. */
export const DISCOUNT_KIND = Object.freeze({
  PERCENTAGE: "percentage",
  FIXED_AMOUNT: "fixed_amount",
});

/** Sliding-window rate limit defaults for the customer open endpoint. */
export const RATE_LIMIT = Object.freeze({
  WINDOW_MS: 60_000,
  MAX_OPENS_PER_WINDOW: 5,
});

/** How long an idempotency record is honored. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
