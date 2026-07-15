import prisma from "../db.server.js";
import { CLAIM_STATUS, REWARD_TYPE } from "../lib/constants.js";
import { parseJson } from "../lib/json.js";
import { provisionGiftCard } from "./shopifyRewards.server.js";
import { ensureCampaignDiscount } from "./campaignDiscount.server.js";
import { recordAudit } from "./audit.server.js";

/**
 * Claim service. After the open transaction commits with a PENDING claim, this
 * grants the real reward and promotes the claim to FULFILLED (or marks it FAILED
 * with a graceful message).
 *
 * Reward types:
 *   - DISCOUNT / FREE_SHIPPING -> the campaign's SINGLE shared discount code.
 *       We never create a code per claim; every discount winner in a campaign
 *       receives the same campaign code (created once, lazily).
 *   - GIFT_CARD                -> a unique per-claim gift card (stored value can
 *       only be redeemed once, so it cannot be shared).
 *   - FREE_PRODUCT / COUPON / CUSTOM -> informational; claim instructions only.
 *
 * Kept outside the DB transaction so a slow external API call never holds a
 * lock. Idempotency at the route layer prevents duplicate provisioning.
 */

const DISCOUNT_TYPES = [REWARD_TYPE.DISCOUNT, REWARD_TYPE.FREE_SHIPPING];

/**
 * @param {object} params
 * @param {object} params.admin - authenticated Admin GraphQL client
 * @param {string} params.shop
 * @param {string} params.campaignId
 * @param {object} params.claim - the PENDING claim row
 * @param {object|null} params.reward - hydrated reward (config parsed)
 */
export async function fulfillClaim({ admin, shop, campaignId, claim, reward }) {
  // Discount / free shipping: attach the campaign's shared code.
  if (reward && DISCOUNT_TYPES.includes(reward.type)) {
    const result = await ensureCampaignDiscount(admin, shop, campaignId);
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
      meta: { rewardType: reward.type, shared: true },
    });

    return finalizeClaim(claim.id, {
      status: CLAIM_STATUS.FULFILLED,
      code: result.code,
      discountGid: result.gid,
      claimInstructions: reward.claimInstructions ?? claim.claimInstructions,
    });
  }

  // Gift card: unique per claim.
  if (reward && reward.type === REWARD_TYPE.GIFT_CARD) {
    const result = await provisionGiftCard(admin, { reward });
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
      giftCardGid: result.gid,
      claimInstructions: reward.claimInstructions ?? claim.claimInstructions,
    });
  }

  // Informational rewards (FREE_PRODUCT / COUPON / CUSTOM / NO_PRIZE): nothing
  // to provision — just finalize with instructions.
  return finalizeClaim(claim.id, {
    status: CLAIM_STATUS.FULFILLED,
    claimInstructions: reward?.claimInstructions ?? claim.claimInstructions,
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
