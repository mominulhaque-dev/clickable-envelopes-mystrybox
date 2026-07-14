import {
  CAMPAIGN_STATUSES,
  ELIGIBILITY_MODES,
  REWARD_TYPES,
  ENVELOPE_COUNT_OPTIONS,
  DISCOUNT_KIND,
} from "./constants.js";

/**
 * Lightweight, dependency-free validation. Each validator returns
 * { ok: true, value } or { ok: false, errors: { field: message } }.
 * All merchant and customer input is validated on the server before use.
 */

export class ValidationError extends Error {
  constructor(errors) {
    super("Validation failed");
    this.name = "ValidationError";
    this.errors = errors;
  }
}

function isBlank(v) {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function toInt(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

function parseDate(v) {
  if (isBlank(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? NaN : d;
}

/** Validate the campaign create/update payload. */
export function validateCampaignInput(input) {
  const errors = {};
  const value = {};

  if (isBlank(input.name)) {
    errors.name = "Campaign name is required.";
  } else if (input.name.length > 255) {
    errors.name = "Campaign name must be 255 characters or fewer.";
  } else {
    value.name = String(input.name).trim();
  }

  value.description = isBlank(input.description)
    ? null
    : String(input.description).trim();
  value.bannerUrl = isBlank(input.bannerUrl)
    ? null
    : String(input.bannerUrl).trim();

  if (value.bannerUrl && !/^https?:\/\//i.test(value.bannerUrl)) {
    errors.bannerUrl = "Banner URL must start with http:// or https://";
  }

  if (input.status !== undefined) {
    if (!CAMPAIGN_STATUSES.includes(input.status)) {
      errors.status = "Invalid campaign status.";
    } else {
      value.status = input.status;
    }
  }

  const startAt = parseDate(input.startAt);
  const endAt = parseDate(input.endAt);
  if (Number.isNaN(startAt)) errors.startAt = "Invalid start date.";
  else value.startAt = startAt;
  if (Number.isNaN(endAt)) errors.endAt = "Invalid end date.";
  else value.endAt = endAt;
  if (
    value.startAt instanceof Date &&
    value.endAt instanceof Date &&
    value.endAt <= value.startAt
  ) {
    errors.endAt = "End date must be after the start date.";
  }

  const envelopeCount = toInt(input.envelopeCount);
  if (input.envelopeCount !== undefined) {
    if (!ENVELOPE_COUNT_OPTIONS.includes(envelopeCount)) {
      errors.envelopeCount = `Envelope count must be one of: ${ENVELOPE_COUNT_OPTIONS.join(
        ", ",
      )}.`;
    } else {
      value.envelopeCount = envelopeCount;
    }
  }

  if (input.maxWinners !== undefined && !isBlank(input.maxWinners)) {
    const maxWinners = toInt(input.maxWinners);
    if (Number.isNaN(maxWinners) || maxWinners < 0) {
      errors.maxWinners = "Max winners must be a non-negative whole number.";
    } else {
      value.maxWinners = maxWinners;
    }
  } else {
    value.maxWinners = null;
  }

  const maxOpens = toInt(input.maxOpensPerCustomer);
  if (input.maxOpensPerCustomer !== undefined) {
    if (Number.isNaN(maxOpens) || maxOpens < 1) {
      errors.maxOpensPerCustomer = "Max opens per customer must be at least 1.";
    } else {
      value.maxOpensPerCustomer = maxOpens;
    }
  }

  const houseEdge = toInt(input.houseEdge);
  if (input.houseEdge !== undefined && !isBlank(input.houseEdge)) {
    if (Number.isNaN(houseEdge) || houseEdge < 0 || houseEdge > 100) {
      errors.houseEdge = "House edge must be between 0 and 100.";
    } else {
      value.houseEdge = houseEdge;
    }
  }

  if (input.eligibilityMode !== undefined) {
    if (!ELIGIBILITY_MODES.includes(input.eligibilityMode)) {
      errors.eligibilityMode = "Invalid eligibility mode.";
    } else {
      value.eligibilityMode = input.eligibilityMode;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/** Validate a single reward rule. */
export function validateRewardInput(input) {
  const errors = {};
  const value = {};

  if (!REWARD_TYPES.includes(input.type)) {
    errors.type = "Invalid reward type.";
  } else {
    value.type = input.type;
  }

  if (isBlank(input.label)) {
    errors.label = "Reward label is required.";
  } else {
    value.label = String(input.label).trim();
  }

  const weight = toInt(input.probabilityWeight);
  if (Number.isNaN(weight) || weight < 0) {
    errors.probabilityWeight = "Probability weight must be 0 or greater.";
  } else {
    value.probabilityWeight = weight ?? 1;
  }

  const priority = toInt(input.priority);
  value.priority = Number.isNaN(priority) || priority == null ? 0 : priority;

  if (!isBlank(input.inventoryTotal)) {
    const inv = toInt(input.inventoryTotal);
    if (Number.isNaN(inv) || inv < 0) {
      errors.inventoryTotal = "Inventory must be 0 or greater.";
    } else {
      value.inventoryTotal = inv;
    }
  } else {
    value.inventoryTotal = null;
  }

  if (!isBlank(input.expiresInDays)) {
    const days = toInt(input.expiresInDays);
    if (Number.isNaN(days) || days < 1) {
      errors.expiresInDays = "Expiry must be at least 1 day.";
    } else {
      value.expiresInDays = days;
    }
  } else {
    value.expiresInDays = null;
  }

  value.claimInstructions = isBlank(input.claimInstructions)
    ? null
    : String(input.claimInstructions).trim();

  // Type-specific config validation.
  const config = input.config || {};
  if (value.type === "DISCOUNT") {
    if (![DISCOUNT_KIND.PERCENTAGE, DISCOUNT_KIND.FIXED_AMOUNT].includes(config.kind)) {
      errors.config = "Discount kind must be percentage or fixed_amount.";
    } else {
      const amount = Number(config.amount);
      if (Number.isNaN(amount) || amount <= 0) {
        errors.config = "Discount amount must be greater than 0.";
      } else if (config.kind === DISCOUNT_KIND.PERCENTAGE && amount > 100) {
        errors.config = "Percentage discount cannot exceed 100.";
      } else {
        value.config = { kind: config.kind, amount };
      }
    }
  } else if (value.type === "GIFT_CARD") {
    const amount = Number(config.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      errors.config = "Gift card amount must be greater than 0.";
    } else {
      value.config = { amount };
    }
  } else if (value.type === "FREE_PRODUCT") {
    if (isBlank(config.productGid)) {
      errors.config = "Select a product for the free product reward.";
    } else {
      value.config = { productGid: config.productGid, productTitle: config.productTitle || null };
    }
  } else {
    value.config = config && typeof config === "object" ? config : {};
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}
