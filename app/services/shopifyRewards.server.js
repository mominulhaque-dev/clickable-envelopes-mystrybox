import { DISCOUNT_KIND } from "../lib/constants.js";
import crypto from "node:crypto";

/**
 * Provision real Shopify resources for won rewards via the Admin GraphQL API.
 *
 * Discount rewards are handled at the CAMPAIGN level: a campaign owns exactly
 * one shared Shopify discount code (see ensureCampaignDiscount). Every winner of
 * a discount-type reward in that campaign receives the same code, so we never
 * create one code per reward or per envelope. This keeps the merchant's Shopify
 * Admin clean and reduces API calls.
 *
 * Gift cards remain per-claim: a gift card is a unique stored-value instrument
 * that can only be redeemed once, so it cannot be shared like a discount code.
 *
 * Every function returns { ok, ... , error? } and never throws, so the caller
 * can mark a claim FAILED and surface a graceful message instead of breaking the
 * customer experience.
 *
 * `admin` is the authenticated Admin GraphQL client.
 */

function makeCode(prefix = "MV") {
  // 8 unambiguous chars (no 0/O/1/I) for a human-friendly code.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${code}`;
}

const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation MvDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const DISCOUNT_CODE_BASIC_UPDATE = `#graphql
  mutation MvDiscountUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const GIFT_CARD_CREATE = `#graphql
  mutation MvGiftCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard { id maskedCode }
      giftCardCode
      userErrors { field message }
    }
  }`;

/**
 * Build the `customerGets` / value block for a campaign's shared discount code
 * from its discount configuration.
 */
function buildDiscountValue(discountKind, discountAmount) {
  if (discountKind === "free_shipping") {
    // Represented as a 100%-off code applying to all items. Kept as a single
    // shared code so it still counts as one code per campaign.
    return { percentage: 1.0 };
  }
  if (discountKind === DISCOUNT_KIND.PERCENTAGE) {
    return { percentage: Number(discountAmount) / 100 };
  }
  return {
    discountAmount: {
      amount: Number(discountAmount).toFixed(2),
      appliesOnEachItem: false,
    },
  };
}

/**
 * Create the single shared discount code for a campaign in Shopify.
 *
 * @param {object} admin - Admin GraphQL client
 * @param {object} campaign - must have discountKind, discountAmount,
 *   discountUsageLimit?, discountOncePerCustomer, name, startAt?, endAt?
 * @returns {Promise<{ ok: true, code: string, gid: string } | { ok: false, error: string }>}
 */
export async function createCampaignDiscount(admin, campaign) {
  if (!campaign.discountKind) {
    return { ok: false, error: "No discount configured for this campaign." };
  }

  const code = makeCode("MV");
  const value = buildDiscountValue(campaign.discountKind, campaign.discountAmount);
  const startsAt = (campaign.startAt ? new Date(campaign.startAt) : new Date()).toISOString();
  const endsAt = campaign.endAt ? new Date(campaign.endAt).toISOString() : null;

  const basicCodeDiscount = {
    title: `Mystery Vault: ${campaign.name}`,
    code,
    startsAt,
    ...(endsAt ? { endsAt } : {}),
    customerSelection: { all: true },
    customerGets: { items: { all: true }, value },
    appliesOncePerCustomer: campaign.discountOncePerCustomer !== false,
    ...(campaign.discountUsageLimit != null
      ? { usageLimit: campaign.discountUsageLimit }
      : {}),
  };

  try {
    const res = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
      variables: { basicCodeDiscount },
    });
    const json = await res.json();
    const payload = json?.data?.discountCodeBasicCreate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }
    const gid = payload?.codeDiscountNode?.id ?? null;
    if (!gid) return { ok: false, error: "Discount code was not created." };
    return { ok: true, code, gid };
  } catch (error) {
    console.error("[shopifyRewards] campaign discount create failed", error);
    return { ok: false, error: "Discount code creation failed." };
  }
}

/**
 * Update the usage limit (and optionally window) of an existing campaign
 * discount code. Used to keep the shared code's cap in sync with the number of
 * winning envelopes.
 */
export async function updateCampaignDiscountUsageLimit(admin, campaign) {
  if (!campaign.discountGid) {
    return { ok: false, error: "Campaign has no discount code to update." };
  }
  const basicCodeDiscount = {
    ...(campaign.discountUsageLimit != null
      ? { usageLimit: campaign.discountUsageLimit }
      : {}),
  };
  try {
    const res = await admin.graphql(DISCOUNT_CODE_BASIC_UPDATE, {
      variables: { id: campaign.discountGid, basicCodeDiscount },
    });
    const json = await res.json();
    const payload = json?.data?.discountCodeBasicUpdate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }
    return { ok: true };
  } catch (error) {
    console.error("[shopifyRewards] campaign discount update failed", error);
    return { ok: false, error: "Discount code update failed." };
  }
}

/** Create a gift card for a fixed amount. Requires the store to support gift cards. */
export async function provisionGiftCard(admin, { reward }) {
  const config = reward.config || {};
  const now = new Date();
  const expiresOn =
    reward.expiresInDays != null
      ? new Date(now.getTime() + reward.expiresInDays * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;

  const input = {
    initialValue: Number(config.amount).toFixed(2),
    note: `Mystery Vault reward: ${reward.label}`,
    ...(expiresOn ? { expiresOn } : {}),
  };

  try {
    const res = await admin.graphql(GIFT_CARD_CREATE, { variables: { input } });
    const json = await res.json();
    const payload = json?.data?.giftCardCreate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }
    return {
      ok: true,
      code: payload?.giftCardCode ?? payload?.giftCard?.maskedCode ?? null,
      gid: payload?.giftCard?.id ?? null,
    };
  } catch (error) {
    console.error("[shopifyRewards] gift card provisioning failed", error);
    return { ok: false, error: "Gift card provisioning failed." };
  }
}
