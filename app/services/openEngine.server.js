import prisma from "../db.server.js";
import {
  ENVELOPE_STATUS,
  CLAIM_STATUS,
  REWARD_TYPE,
} from "../lib/constants.js";
import { parseJson } from "../lib/json.js";
import { weightedPick, secureRandom } from "../lib/rng.js";

/**
 * The open engine grants a reward for an envelope. It is the single most
 * security-sensitive path in the app, so it is designed to be:
 *
 *   - Server-authoritative: the reward is decided here, never by the client.
 *   - Race-safe: envelope claiming uses a conditional updateMany that only
 *     succeeds for exactly one caller, so concurrent opens of the same
 *     envelope cannot both win.
 *   - Inventory-correct: reward inventory is decremented with a conditional
 *     update so it can never go negative under concurrency.
 *   - Winner-cap-correct: the campaign winnersCount is incremented atomically
 *     and re-checked inside the transaction.
 *
 * Reward provisioning (creating a real discount/gift card in Shopify) happens
 * AFTER the transaction commits, in claim.server.js, so a slow external API
 * call never holds a DB transaction open. The claim is created in PENDING and
 * promoted to FULFILLED once provisioning succeeds.
 */

export class OpenError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "OpenError";
    this.code = code;
  }
}

export const OPEN_ERROR = Object.freeze({
  ENVELOPE_TAKEN: "ENVELOPE_TAKEN",
  ENVELOPE_NOT_FOUND: "ENVELOPE_NOT_FOUND",
  WINNERS_CAP_REACHED: "WINNERS_CAP_REACHED",
  NO_ENVELOPES_LEFT: "NO_ENVELOPES_LEFT",
});

/**
 * Build the weighted candidate pool from a campaign's rewards + the configured
 * house edge. The house edge is modelled as an implicit NO_PRIZE weight added
 * proportionally so merchants can tune payout rate without a real reward row.
 *
 * Rewards with finite inventory that is exhausted are excluded.
 * @returns {Array<{ reward: object|null, weight: number }>}
 */
export function buildRewardPool(rewards, houseEdge = 0) {
  const available = rewards.filter((r) => {
    if (r.probabilityWeight <= 0) return false;
    if (r.inventoryTotal == null) return true; // unlimited
    return (r.inventoryRemaining ?? 0) > 0;
  });

  const pool = available.map((r) => ({ reward: r, weight: r.probabilityWeight }));

  const totalRewardWeight = pool.reduce((s, p) => s + p.weight, 0);
  if (houseEdge > 0 && totalRewardWeight > 0) {
    // houseEdge is a percentage of the FINAL distribution that should be "no prize".
    // Solve: noPrize / (total + noPrize) = houseEdge/100
    const edge = Math.min(99, Math.max(0, houseEdge));
    const noPrizeWeight = Math.round((totalRewardWeight * edge) / (100 - edge));
    if (noPrizeWeight > 0) {
      pool.push({ reward: null, weight: noPrizeWeight });
    }
  }

  return pool;
}

/**
 * Open one envelope for a customer.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.campaignId
 * @param {string} params.envelopeId
 * @param {string} params.customerGid
 * @param {string|null} params.orderGid
 * @param {() => number} [params.rand] - injectable RNG for tests.
 * @returns {Promise<{ envelope, claim, reward: object|null }>}
 */
export async function openEnvelope({
  shop,
  campaignId,
  envelopeId,
  customerGid,
  orderGid,
  rand = secureRandom,
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, shop },
      include: { rewards: true },
    });
    if (!campaign) throw new OpenError(OPEN_ERROR.ENVELOPE_NOT_FOUND);

    // Re-check winner cap inside the transaction.
    if (campaign.maxWinners != null && campaign.winnersCount >= campaign.maxWinners) {
      throw new OpenError(OPEN_ERROR.WINNERS_CAP_REACHED);
    }

    // Atomically claim the envelope: only flips if still UNOPENED. This is the
    // race guard — exactly one concurrent caller gets count === 1.
    const claimed = await tx.envelope.updateMany({
      where: { id: envelopeId, campaignId, status: ENVELOPE_STATUS.UNOPENED },
      data: {
        status: ENVELOPE_STATUS.OPENED,
        customerGid,
        orderGid: orderGid ?? null,
        openedAt: now,
      },
    });
    if (claimed.count !== 1) {
      // Either taken by someone else or does not exist.
      const exists = await tx.envelope.findFirst({
        where: { id: envelopeId, campaignId },
        select: { id: true },
      });
      throw new OpenError(
        exists ? OPEN_ERROR.ENVELOPE_TAKEN : OPEN_ERROR.ENVELOPE_NOT_FOUND,
      );
    }

    // Draw a reward from the weighted pool.
    const pool = buildRewardPool(campaign.rewards, campaign.houseEdge);
    const pick = weightedPick(pool, rand);
    const drawnReward = pick?.reward ?? null;

    let finalReward = drawnReward;

    // If a finite-inventory reward was drawn, decrement atomically. If the
    // decrement fails (raced to zero), fall back to NO_PRIZE rather than
    // over-granting.
    if (drawnReward && drawnReward.inventoryTotal != null) {
      const dec = await tx.reward.updateMany({
        where: { id: drawnReward.id, inventoryRemaining: { gt: 0 } },
        data: { inventoryRemaining: { decrement: 1 } },
      });
      if (dec.count !== 1) {
        finalReward = null;
      }
    }

    const isWin = finalReward != null && finalReward.type !== REWARD_TYPE.NO_PRIZE;

    // Link the reward to the envelope.
    const envelope = await tx.envelope.update({
      where: { id: envelopeId },
      data: { rewardId: finalReward?.id ?? null },
    });

    // Increment winners count only on a real win.
    if (isWin) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { winnersCount: { increment: 1 } },
      });
    }

    // Create the claim (PENDING until provisioned; NO_PRIZE is immediately FULFILLED).
    const expiresAt =
      finalReward?.expiresInDays != null
        ? new Date(now.getTime() + finalReward.expiresInDays * 86_400_000)
        : null;

    const claim = await tx.claim.create({
      data: {
        shop,
        campaignId,
        envelopeId,
        rewardId: finalReward?.id ?? null,
        customerGid,
        orderGid: orderGid ?? null,
        status: isWin ? CLAIM_STATUS.PENDING : CLAIM_STATUS.FULFILLED,
        claimInstructions: finalReward?.claimInstructions ?? null,
        expiresAt,
      },
    });

    return {
      envelope,
      claim,
      reward: finalReward
        ? { ...finalReward, config: parseJson(finalReward.config, {}) }
        : null,
      isWin,
    };
  });
}
