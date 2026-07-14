import { DISCOUNT_KIND, REWARD_TYPE } from "../lib/constants.js";
import crypto from "node:crypto";

/**
 * Provision real Shopify resources for a won reward via the Admin GraphQL API.
 * Each function returns { ok, code?, gid?, error? } and never throws so the
 * caller can mark the claim FAILED and surface a graceful message instead of
 * breaking the customer experience.
 *
 * `admin` is the authenticated Admin GraphQL client
 * (from unauthenticated.admin(shop) or authenticate.admin).
 */

function makeCode(prefix = "MV") {
  // 8 unambiguous chars (no 0/O/1/I) for a human-friendly single-use code.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) code += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${code}`;
}

const DISCOUNT_CODE_BASIC = `#graphql
  mutation MvDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
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

/** Create a single-use basic discount code (percentage / fixed / free shipping). */
export async function provisionDiscount(admin, { reward }) {
  const code = makeCode("MV");
  const config = reward.config || {};
  const now = new Date();
  const endsAt =
    reward.expiresInDays != null
      ? new Date(now.getTime() + reward.expiresInDays * 86_400_000).toISOString()
      : null;

  // Build the value object per reward type.
  let value;
  if (reward.type === REWARD_TYPE.FREE_SHIPPING) {
    // Free shipping uses a shipping discount class.
    value = null;
  } else if (config.kind === DISCOUNT_KIND.PERCENTAGE) {
    value = { percentage: Number(config.amount) / 100 };
  } else {
    value = {
      discountAmount: {
        amount: Number(config.amount).toFixed(2),
        appliesOnEachItem: false,
      },
    };
  }

  const basicCodeDiscount =
    reward.type === REWARD_TYPE.FREE_SHIPPING
      ? {
          title: `Mystery Vault: ${reward.label}`,
          code,
          startsAt: now.toISOString(),
          ...(endsAt ? { endsAt } : {}),
          customerSelection: { all: true },
          customerGets: {
            items: { all: true },
            value: { percentage: 1.0 },
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
        }
      : {
          title: `Mystery Vault: ${reward.label}`,
          code,
          startsAt: now.toISOString(),
          ...(endsAt ? { endsAt } : {}),
          customerSelection: { all: true },
          customerGets: {
            items: { all: true },
            value,
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
        };

  try {
    const res = await admin.graphql(DISCOUNT_CODE_BASIC, {
      variables: { basicCodeDiscount },
    });
    const json = await res.json();
    const payload = json?.data?.discountCodeBasicCreate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { ok: false, error: userErrors.map((e) => e.message).join("; ") };
    }
    return { ok: true, code, gid: payload?.codeDiscountNode?.id ?? null };
  } catch (error) {
    console.error("[shopifyRewards] discount provisioning failed", error);
    return { ok: false, error: "Discount provisioning failed." };
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
