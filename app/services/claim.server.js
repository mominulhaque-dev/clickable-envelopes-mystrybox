import prisma from "../db.server.js";
import { CLAIM_STATUS, REWARD_TYPE, PROVISIONED_REWARD_TYPES } from "../lib/constants.js";
import { parseJson } from "../lib/json.js";
import { provisionDiscount, provisionGiftCard } from "./shopifyRewards.server.js";
import { recordAudit } from "./audit.server.js";

/**
 * Claim service. After the open transaction commits with a PENDING claim, this
 * provisions the real Shopify resource (discount / gift card) and promotes the
 * claim to FULFILLED, or marks it FAILED with a graceful message.
 *
 * Kept outside the DB transaction so a slow external API call never holds a
 * lock. Idempotency at the route layer prevents duplicate provisioning.
 */

/**
 * @param {object} params
 * @param {object} params.admin - authenticated Admin GraphQL client
 * @param {string} params.shop
 * @param {object} params.claim - the PENDING claim row
 * @param {object|null} params.reward - hydrated reward (config parsed)
 */
export async function fulfillClaim({ admin, shop, claim, reward }) {
  // Nothing to provision: NO_PRIZE, CUSTOM, COUPON, FREE_PRODUCT are informational.
  if (!reward || !PROVISIONED_REWARD_TYPES.includes(reward.type)) {
    return finalizeClaim(claim.id, {
      status: CLAIM_STATUS.FULFILLED,
      claimInstructions: reward?.claimInstructions ?? claim.claimInstructions,
    });
  }

  let result;
  if (reward.type === REWARD_TYPE.GIFT_CARD) {
    result = await provisionGiftCard(admin, { reward });
  } else {
    // DISCOUNT or FREE_SHIPPING
    result = await provisionDiscount(admin, { reward });
  }

  if (!result.ok) {
    await recordAudit({
      shop,
      actor: "system",
      action: "claim.provision_failed",
      entity: "claim",
      entityId: claim.id,
      meta: { rewardType: reward.type, error: result.error },
    });
    return finalizeClaim(claim.id, {
      status: CLAIM_STATUS.FAILED,
      claimInstructions:
        "We hit a snag issuing your reward. Please contact the store and reference your order.",
    });
  }

  await recordAudit({
    shop,
    actor: "system",
    action: "claim.fulfilled",
    entity: "claim",
    entityId: claim.id,
    meta: { rewardType: reward.type },
  });

  return finalizeClaim(claim.id, {
    status: CLAIM_STATUS.FULFILLED,
    code: result.code ?? null,
    discountGid: reward.type === REWARD_TYPE.GIFT_CARD ? null : result.gid,
    giftCardGid: reward.type === REWARD_TYPE.GIFT_CARD ? result.gid : null,
    claimInstructions: reward.claimInstructions ?? claim.claimInstructions,
  });
}

async function finalizeClaim(claimId, data) {
  return prisma.claim.update({
    where: { id: claimId },
    data: { ...data, fulfilledAt: new Date() },
  });
}

/** List a customer's claims for a campaign (for the "your rewards" view). */
export async function listCustomerClaims(shop, campaignId, customerGid) {
  const claims = await prisma.claim.findMany({
    where: { shop, campaignId, customerGid },
    include: { reward: true, envelope: true },
    orderBy: { createdAt: "desc" },
  });
  return claims.map((c) => ({
    ...c,
    reward: c.reward ? { ...c.reward, config: parseJson(c.reward.config, {}) } : null,
  }));
}
