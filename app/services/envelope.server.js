import prisma from "../db.server.js";
import { ENVELOPE_STATUS } from "../lib/constants.js";

/**
 * Envelope service. Envelopes are the clickable grid cells. Rewards are NOT
 * pre-assigned to envelopes — the reward is drawn at open time (see
 * openEngine.server.js) so inventory and probability stay accurate up to the
 * moment of opening. An envelope's rewardId is populated only once opened.
 */

const ENVELOPE_CHUNK = 500;

/**
 * Bulk-create `count` unopened envelopes for a campaign inside a transaction.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function generateEnvelopes(tx, campaignId, count) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({ campaignId, index, status: ENVELOPE_STATUS.UNOPENED });
  }
  // createMany in chunks to stay well within SQLite variable limits.
  for (let i = 0; i < rows.length; i += ENVELOPE_CHUNK) {
    await tx.envelope.createMany({ data: rows.slice(i, i + ENVELOPE_CHUNK) });
  }
}

/** Count envelopes by status for a campaign. */
export async function getEnvelopeStats(campaignId) {
  const [total, opened] = await Promise.all([
    prisma.envelope.count({ where: { campaignId } }),
    prisma.envelope.count({ where: { campaignId, status: ENVELOPE_STATUS.OPENED } }),
  ]);
  return { total, opened, remaining: total - opened };
}

/**
 * List envelopes for the admin table with reward + claim context.
 * Supports status filter and pagination.
 */
export async function listEnvelopes(
  shop,
  campaignId,
  { status, take = 50, skip = 0 } = {},
) {
  // Ensure the campaign belongs to the shop before exposing envelopes.
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
    select: { id: true },
  });
  if (!campaign) return { items: [], total: 0 };

  const where = {
    campaignId,
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.envelope.findMany({
      where,
      include: { reward: true, claim: true },
      orderBy: { index: "asc" },
      take,
      skip,
    }),
    prisma.envelope.count({ where }),
  ]);

  return { items, total };
}

/**
 * The customer-facing grid view: only status + index are exposed so customers
 * cannot infer which envelopes hold prizes. Never leak reward data here.
 */
export async function getVaultGrid(campaignId) {
  const envelopes = await prisma.envelope.findMany({
    where: { campaignId },
    select: { id: true, index: true, status: true, customerGid: true },
    orderBy: { index: "asc" },
  });
  return envelopes.map((e) => ({
    id: e.id,
    index: e.index,
    opened: e.status === ENVELOPE_STATUS.OPENED,
    ownedByCustomer: null, // filled per-request by the proxy loader
    _customerGid: e.customerGid,
  }));
}
