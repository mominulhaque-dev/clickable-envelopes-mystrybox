import prisma from "../db.server.js";
import { generateEnvelopes } from "./envelope.server.js";
import { recordAudit } from "./audit.server.js";
import { NotFoundError } from "./campaign.server.js";

/**
 * Reset operations. These are destructive and must be gated behind explicit
 * merchant confirmation at the route layer. Each reset is scoped to a single
 * campaign owned by the shop, and every reset is audited.
 *
 * Scopes:
 *   - "envelopes": wipe & regenerate the grid (also clears claims, since claims
 *     reference envelopes).
 *   - "claims": delete claims and reset envelopes to UNOPENED (keeps grid size),
 *     restore reward inventory, reset winnersCount.
 *   - "rewards": restore each reward's remaining inventory to its total.
 *   - "stats": reset winnersCount to reflect current real wins.
 *   - "all": full reset — claims cleared, envelopes regenerated, inventory
 *     restored, winnersCount zeroed.
 */

export const RESET_SCOPE = Object.freeze({
  ENVELOPES: "envelopes",
  CLAIMS: "claims",
  REWARDS: "rewards",
  STATS: "stats",
  ALL: "all",
});

export async function resetCampaign(shop, campaignId, scope, { actor, ip } = {}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
  });
  if (!campaign) throw new NotFoundError("Campaign not found.");

  await prisma.$transaction(async (tx) => {
    if (scope === RESET_SCOPE.ALL || scope === RESET_SCOPE.ENVELOPES) {
      await tx.claim.deleteMany({ where: { campaignId } });
      await tx.envelope.deleteMany({ where: { campaignId } });
      await generateEnvelopes(tx, campaignId, campaign.envelopeCount);
    }

    if (scope === RESET_SCOPE.CLAIMS) {
      await tx.claim.deleteMany({ where: { campaignId } });
      await tx.envelope.updateMany({
        where: { campaignId },
        data: { status: "UNOPENED", rewardId: null, customerGid: null, orderGid: null, openedAt: null },
      });
    }

    if (
      scope === RESET_SCOPE.ALL ||
      scope === RESET_SCOPE.REWARDS ||
      scope === RESET_SCOPE.CLAIMS
    ) {
      // Restore each finite-inventory reward's remaining = total.
      const rewards = await tx.reward.findMany({
        where: { campaignId, inventoryTotal: { not: null } },
        select: { id: true, inventoryTotal: true },
      });
      for (const r of rewards) {
        await tx.reward.update({
          where: { id: r.id },
          data: { inventoryRemaining: r.inventoryTotal },
        });
      }
    }

    if (
      scope === RESET_SCOPE.ALL ||
      scope === RESET_SCOPE.CLAIMS ||
      scope === RESET_SCOPE.ENVELOPES
    ) {
      // These scopes clear claims, so no winners remain.
      await tx.campaign.update({
        where: { id: campaignId },
        data: { winnersCount: 0 },
      });
    } else if (scope === RESET_SCOPE.STATS) {
      // Stats-only reset must stay consistent with real winning claims to keep
      // the winner cap accurate. Recompute rather than zero.
      const wins = await tx.claim.count({
        where: { campaignId, rewardId: { not: null } },
      });
      await tx.campaign.update({
        where: { id: campaignId },
        data: { winnersCount: wins },
      });
    }
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "campaign.reset",
    entity: "campaign",
    entityId: campaignId,
    meta: { scope },
    ip,
  });

  return { campaignId, scope };
}
