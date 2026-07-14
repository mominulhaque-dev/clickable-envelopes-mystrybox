import prisma from "../db.server.js";
import { ENVELOPE_STATUS, CLAIM_STATUS, CAMPAIGN_STATUS } from "../lib/constants.js";
import { parseJson } from "../lib/json.js";

/**
 * Analytics service. Metrics are computed from the operational tables on read.
 * Given the row volumes involved (envelopes/claims per shop), this is cheap and
 * always accurate. Cached aggregates can be layered in later if needed.
 */

/** Dashboard-level rollup across all of a shop's campaigns. */
export async function getShopOverview(shop) {
  const [campaigns, envelopeAgg, claims] = await Promise.all([
    prisma.campaign.findMany({
      where: { shop },
      select: { id: true, status: true },
    }),
    prisma.envelope.groupBy({
      by: ["status"],
      where: { campaign: { shop } },
      _count: { _all: true },
    }),
    prisma.claim.findMany({
      where: { shop },
      select: { status: true, rewardId: true, customerGid: true },
    }),
  ]);

  const totalEnvelopes = envelopeAgg.reduce((s, r) => s + r._count._all, 0);
  const openedEnvelopes =
    envelopeAgg.find((r) => r.status === ENVELOPE_STATUS.OPENED)?._count._all ?? 0;
  const claimedRewards = claims.filter(
    (c) => c.status === CLAIM_STATUS.FULFILLED && c.rewardId,
  ).length;
  const wins = claims.filter((c) => c.rewardId).length;

  return {
    campaignsTotal: campaigns.length,
    campaignsActive: campaigns.filter((c) => c.status === CAMPAIGN_STATUS.ACTIVE).length,
    totalEnvelopes,
    openedEnvelopes,
    remainingEnvelopes: totalEnvelopes - openedEnvelopes,
    claimedRewards,
    participationRate: totalEnvelopes ? openedEnvelopes / totalEnvelopes : 0,
    winRate: openedEnvelopes ? wins / openedEnvelopes : 0,
    uniqueParticipants: new Set(claims.map((c) => c.customerGid)).size,
  };
}

/** Detailed stats for one campaign. */
export async function getCampaignStats(shop, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
    include: { rewards: true },
  });
  if (!campaign) return null;

  const [opened, claims] = await Promise.all([
    prisma.envelope.count({
      where: { campaignId, status: ENVELOPE_STATUS.OPENED },
    }),
    prisma.claim.findMany({
      where: { campaignId },
      select: { status: true, rewardId: true, customerGid: true },
    }),
  ]);

  const wins = claims.filter((c) => c.rewardId).length;
  const rewardDistribution = campaign.rewards.map((r) => ({
    rewardId: r.id,
    label: r.label,
    type: r.type,
    config: parseJson(r.config, {}),
    won: claims.filter((c) => c.rewardId === r.id).length,
    inventoryTotal: r.inventoryTotal,
    inventoryRemaining: r.inventoryRemaining,
  }));

  return {
    campaignId,
    name: campaign.name,
    status: campaign.status,
    envelopeCount: campaign.envelopeCount,
    opened,
    remaining: campaign.envelopeCount - opened,
    winners: campaign.winnersCount,
    maxWinners: campaign.maxWinners,
    participationRate: campaign.envelopeCount ? opened / campaign.envelopeCount : 0,
    winRate: opened ? wins / opened : 0,
    uniqueParticipants: new Set(claims.map((c) => c.customerGid)).size,
    fulfilledClaims: claims.filter((c) => c.status === CLAIM_STATUS.FULFILLED).length,
    failedClaims: claims.filter((c) => c.status === CLAIM_STATUS.FAILED).length,
    rewardDistribution,
  };
}

/** Top campaigns by participation for the analytics page. */
export async function getTopCampaigns(shop, limit = 5) {
  const campaigns = await prisma.campaign.findMany({
    where: { shop },
    include: { _count: { select: { claims: true } } },
    orderBy: { winnersCount: "desc" },
    take: limit,
  });
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    winners: c.winnersCount,
    claims: c._count.claims,
  }));
}
