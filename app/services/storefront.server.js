import prisma from "../db.server.js";
import { CAMPAIGN_STATUS, ENVELOPE_STATUS } from "../lib/constants.js";

/**
 * Storefront (customer-facing) read helpers. These back the app-proxy endpoints
 * that the theme app extension calls. They intentionally expose only
 * non-sensitive fields — never reward assignments for envelopes the customer
 * has not opened, since the reward is drawn server-side at open time.
 */

/**
 * Resolve the campaign a storefront visitor should see. If `campaignId` is
 * given it must be ACTIVE and owned by the shop; otherwise the most recently
 * created ACTIVE campaign is returned.
 * @returns {Promise<object|null>}
 */
export async function getActiveCampaign(shop, campaignId) {
  const now = new Date();
  const where = {
    shop,
    status: CAMPAIGN_STATUS.ACTIVE,
    ...(campaignId ? { id: campaignId } : {}),
    // Respect the optional schedule window when set.
    AND: [
      { OR: [{ startAt: null }, { startAt: { lte: now } }] },
      { OR: [{ endAt: null }, { endAt: { gte: now } }] },
    ],
  };
  return prisma.campaign.findFirst({
    where,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Build the vault grid state for a visitor. Returns which envelope indices are
 * opened (so the grid can render them as spent) without revealing rewards, plus
 * the visitor's own open count against the per-customer cap.
 *
 * @param {object} campaign - a campaign row (already ownership-checked)
 * @param {string|null} customerGid
 */
export async function getVaultState(campaign, customerGid) {
  const [openedEnvelopes, customerOpens, winnersCount] = await Promise.all([
    prisma.envelope.findMany({
      where: { campaignId: campaign.id, status: ENVELOPE_STATUS.OPENED },
      select: { index: true },
    }),
    customerGid
      ? prisma.envelope.count({
          where: { campaignId: campaign.id, customerGid },
        })
      : Promise.resolve(0),
    Promise.resolve(campaign.winnersCount),
  ]);

  const openedIndices = openedEnvelopes.map((e) => e.index);
  const remaining = campaign.envelopeCount - openedIndices.length;
  const capReached =
    campaign.maxWinners != null && winnersCount >= campaign.maxWinners;
  const customerOpensLeft = Math.max(
    0,
    campaign.maxOpensPerCustomer - customerOpens,
  );

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      bannerUrl: campaign.bannerUrl,
      envelopeCount: campaign.envelopeCount,
      maxOpensPerCustomer: campaign.maxOpensPerCustomer,
    },
    openedIndices,
    remaining,
    capReached,
    customerOpens,
    customerOpensLeft,
    soldOut: remaining <= 0,
  };
}

/**
 * Look up the envelope at a given grid index for opening. Returns null if the
 * index is out of range or the envelope is already opened.
 */
export async function getOpenableEnvelope(campaignId, index) {
  return prisma.envelope.findFirst({
    where: { campaignId, index, status: ENVELOPE_STATUS.UNOPENED },
    select: { id: true, index: true },
  });
}

/** Count how many envelopes a customer has already opened in a campaign. */
export async function countCustomerOpens(campaignId, customerGid) {
  return prisma.envelope.count({ where: { campaignId, customerGid } });
}
