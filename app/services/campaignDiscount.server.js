import prisma from "../db.server.js";
import {
  createCampaignDiscount,
  updateCampaignDiscountUsageLimit,
} from "./shopifyRewards.server.js";
import { recordAudit } from "./audit.server.js";

/**
 * Campaign-level discount code management.
 *
 * A campaign owns exactly ONE shared Shopify discount code. This service is the
 * single place that creates and maintains it, so the rest of the app never
 * creates a code per reward or per envelope.
 *
 * Creation is lazy and idempotent: the code is created the first time it is
 * needed (campaign activation, or the first discount win as a safety net) and
 * reused forever after. A DB-level guard (updateMany on a null discountGid)
 * ensures that under concurrent wins, only ONE caller performs the Shopify
 * create; the rest reuse the stored code.
 */

/**
 * Ensure the campaign has a shared Shopify discount code, creating it once if
 * needed. Safe to call repeatedly and concurrently.
 *
 * @param {object} admin - Admin GraphQL client
 * @param {string} shop
 * @param {string} campaignId
 * @returns {Promise<{ ok: true, code: string, gid: string } | { ok: false, error: string }>}
 */
export async function ensureCampaignDiscount(admin, shop, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (!campaign.discountKind) {
    return { ok: false, error: "No discount configured for this campaign." };
  }

  // Fast path: already provisioned.
  if (campaign.discountGid && campaign.discountCode) {
    return { ok: true, code: campaign.discountCode, gid: campaign.discountGid };
  }

  // Concurrency guard: atomically "reserve" creation by flipping a sentinel.
  // Only the caller whose updateMany matches (discountGid still null) proceeds
  // to hit Shopify; concurrent callers fall through and re-read the stored code.
  const reserved = await prisma.campaign.updateMany({
    where: { id: campaignId, shop, discountGid: null, discountCode: null },
    data: { discountCode: "__provisioning__" },
  });

  if (reserved.count !== 1) {
    // Someone else is creating (or already created) it. Re-read and return.
    return waitForProvisionedCode(shop, campaignId);
  }

  // We own creation. Compute the usage limit from winning envelopes if set.
  const usageLimit = await resolveUsageLimit(campaign);

  const result = await createCampaignDiscount(admin, {
    ...campaign,
    discountUsageLimit: usageLimit,
  });

  if (!result.ok) {
    // Release the sentinel so a later attempt can retry.
    await prisma.campaign.updateMany({
      where: { id: campaignId, discountCode: "__provisioning__" },
      data: { discountCode: null },
    });
    return result;
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      discountCode: result.code,
      discountGid: result.gid,
      discountUsageLimit: usageLimit,
    },
  });

  await recordAudit({
    shop,
    actor: "system",
    action: "campaign.discount_created",
    entity: "campaign",
    entityId: campaignId,
    meta: { code: result.code, usageLimit },
  });

  return { ok: true, code: result.code, gid: result.gid };
}

/**
 * Resolve the usage limit for the shared code. Defaults to the campaign's
 * configured limit; if null, falls back to maxWinners (the natural ceiling on
 * winning envelopes). null => unlimited.
 */
async function resolveUsageLimit(campaign) {
  if (campaign.discountUsageLimit != null) return campaign.discountUsageLimit;
  if (campaign.maxWinners != null) return campaign.maxWinners;
  return null;
}

/**
 * Poll briefly for a concurrently-created code. Because creation is a single
 * fast Shopify call, a short bounded wait resolves the race without locking.
 */
async function waitForProvisionedCode(shop, campaignId, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    const c = await prisma.campaign.findFirst({
      where: { id: campaignId, shop },
      select: { discountCode: true, discountGid: true },
    });
    if (c?.discountGid && c.discountCode && c.discountCode !== "__provisioning__") {
      return { ok: true, code: c.discountCode, gid: c.discountGid };
    }
    await sleep(150);
  }
  return { ok: false, error: "Discount code is still being created. Try again." };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keep the shared code's Shopify usage limit in sync with the campaign's
 * winner ceiling. Called opportunistically; failures are non-fatal.
 */
export async function syncCampaignDiscountUsageLimit(admin, shop, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
  });
  if (!campaign?.discountGid) return { ok: false, error: "No code to sync." };

  const usageLimit = await resolveUsageLimit(campaign);
  if (usageLimit === campaign.discountUsageLimit) return { ok: true };

  const result = await updateCampaignDiscountUsageLimit(admin, {
    ...campaign,
    discountUsageLimit: usageLimit,
  });
  if (result.ok) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { discountUsageLimit: usageLimit },
    });
  }
  return result;
}
