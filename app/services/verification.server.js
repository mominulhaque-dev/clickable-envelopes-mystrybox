import prisma from "../db.server.js";
import { CAMPAIGN_STATUS, ELIGIBILITY_MODE } from "../lib/constants.js";
import { parseArray } from "../lib/json.js";

/**
 * Purchase verification — the trust boundary of the app. This runs entirely on
 * the server and never trusts any client-supplied eligibility claim.
 *
 * A customer may open an envelope only if ALL hold:
 *   1. The campaign is ACTIVE and within its date window.
 *   2. The customer has at least one qualifying order in the eligibility ledger
 *      that is paid, not cancelled, and not (fully) refunded.
 *   3. For product/collection-scoped campaigns, a qualifying order contains an
 *      eligible product/collection.
 *   4. The customer has not exceeded maxOpensPerCustomer for the campaign.
 *   5. The campaign has envelopes remaining and (if capped) winners remaining.
 */

/** Reasons a verification can fail — stable codes for the UI to localize. */
export const VERIFY_REASON = Object.freeze({
  OK: "OK",
  NOT_LOGGED_IN: "NOT_LOGGED_IN",
  CAMPAIGN_INACTIVE: "CAMPAIGN_INACTIVE",
  CAMPAIGN_NOT_STARTED: "CAMPAIGN_NOT_STARTED",
  CAMPAIGN_ENDED: "CAMPAIGN_ENDED",
  NO_ELIGIBLE_ORDER: "NO_ELIGIBLE_ORDER",
  LIMIT_REACHED: "LIMIT_REACHED",
  NO_ENVELOPES_LEFT: "NO_ENVELOPES_LEFT",
  WINNERS_CAP_REACHED: "WINNERS_CAP_REACHED",
});

const NON_ELIGIBLE_FINANCIAL_STATUSES = new Set([
  "refunded",
  "voided",
]);

function isCampaignLive(campaign, now = new Date()) {
  if (campaign.status !== CAMPAIGN_STATUS.ACTIVE) {
    return { live: false, reason: VERIFY_REASON.CAMPAIGN_INACTIVE };
  }
  if (campaign.startAt && now < campaign.startAt) {
    return { live: false, reason: VERIFY_REASON.CAMPAIGN_NOT_STARTED };
  }
  if (campaign.endAt && now > campaign.endAt) {
    return { live: false, reason: VERIFY_REASON.CAMPAIGN_ENDED };
  }
  return { live: true };
}

/** Does a single ledger order satisfy the campaign's eligibility rules? */
export function orderQualifies(order, campaign, eligibilityGids) {
  if (order.cancelled) return false;
  if (NON_ELIGIBLE_FINANCIAL_STATUSES.has((order.financialStatus || "").toLowerCase())) {
    return false;
  }
  // Only fully-paid orders qualify.
  if ((order.financialStatus || "").toLowerCase() !== "paid") return false;

  if (campaign.eligibilityMode === ELIGIBILITY_MODE.ALL) return true;

  const target =
    campaign.eligibilityMode === ELIGIBILITY_MODE.PRODUCTS
      ? parseArray(order.productGids)
      : parseArray(order.collectionGids);
  return target.some((gid) => eligibilityGids.has(gid));
}

/**
 * @param {object} params
 * @param {string} params.shop
 * @param {object} params.campaign - full campaign with eligibility relation.
 * @param {string|null} params.customerGid
 * @returns {Promise<{ eligible: boolean, reason: string, opensUsed: number, opensAllowed: number, qualifyingOrderGid: string|null }>}
 */
export async function verifyEligibility({ shop, campaign, customerGid }) {
  if (!customerGid) {
    return fail(VERIFY_REASON.NOT_LOGGED_IN, campaign);
  }

  const liveCheck = isCampaignLive(campaign);
  if (!liveCheck.live) return fail(liveCheck.reason, campaign);

  // Global caps first (cheap counts).
  const [openedCount, opensUsed] = await Promise.all([
    prisma.envelope.count({ where: { campaignId: campaign.id, status: "OPENED" } }),
    prisma.envelope.count({
      where: { campaignId: campaign.id, status: "OPENED", customerGid },
    }),
  ]);

  if (openedCount >= campaign.envelopeCount) {
    return fail(VERIFY_REASON.NO_ENVELOPES_LEFT, campaign, { opensUsed });
  }
  if (campaign.maxWinners != null && campaign.winnersCount >= campaign.maxWinners) {
    return fail(VERIFY_REASON.WINNERS_CAP_REACHED, campaign, { opensUsed });
  }
  if (opensUsed >= campaign.maxOpensPerCustomer) {
    return fail(VERIFY_REASON.LIMIT_REACHED, campaign, { opensUsed });
  }

  // Ledger check — find a qualifying order for this customer.
  const eligibilityGids = new Set((campaign.eligibility || []).map((e) => e.gid));
  const orders = await prisma.eligibilityLedger.findMany({
    where: { shop, customerGid },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const qualifying = orders.find((o) => orderQualifies(o, campaign, eligibilityGids));
  if (!qualifying) return fail(VERIFY_REASON.NO_ELIGIBLE_ORDER, campaign, { opensUsed });

  return {
    eligible: true,
    reason: VERIFY_REASON.OK,
    opensUsed,
    opensAllowed: campaign.maxOpensPerCustomer,
    qualifyingOrderGid: qualifying.orderGid,
  };
}

function fail(reason, campaign, extra = {}) {
  return {
    eligible: false,
    reason,
    opensUsed: extra.opensUsed ?? 0,
    opensAllowed: campaign?.maxOpensPerCustomer ?? 0,
    qualifyingOrderGid: null,
  };
}
