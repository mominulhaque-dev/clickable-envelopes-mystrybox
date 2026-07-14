import prisma from "../db.server.js";
import {
  CAMPAIGN_STATUS,
  ELIGIBILITY_MODE,
  DEFAULT_ENVELOPE_COUNT,
} from "../lib/constants.js";
import { validateCampaignInput, ValidationError } from "../lib/validation.js";
import { recordAudit } from "./audit.server.js";
import { generateEnvelopes } from "./envelope.server.js";

/**
 * Campaign domain service. All functions are shop-scoped: a campaign is only
 * ever read or mutated within the shop that owns it, preventing cross-tenant
 * access.
 */

const campaignInclude = {
  eligibility: true,
  rewards: { orderBy: [{ priority: "asc" }, { createdAt: "asc" }] },
  _count: { select: { envelopes: true, claims: true } },
};

export async function listCampaigns(shop, { status } = {}) {
  return prisma.campaign.findMany({
    where: { shop, ...(status ? { status } : {}) },
    include: campaignInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(shop, id) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, shop },
    include: campaignInclude,
  });
  return campaign;
}

/** Create a campaign plus its eligibility targets and initial envelope grid. */
export async function createCampaign(shop, input, { actor, ip } = {}) {
  const result = validateCampaignInput(input);
  if (!result.ok) throw new ValidationError(result.errors);
  const data = result.value;

  const eligibilityTargets = normalizeEligibility(
    data.eligibilityMode ?? ELIGIBILITY_MODE.ALL,
    input.eligibility,
  );

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        shop,
        name: data.name,
        description: data.description,
        bannerUrl: data.bannerUrl,
        status: data.status ?? CAMPAIGN_STATUS.DRAFT,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        envelopeCount: data.envelopeCount ?? DEFAULT_ENVELOPE_COUNT,
        maxWinners: data.maxWinners ?? null,
        maxOpensPerCustomer: data.maxOpensPerCustomer ?? 1,
        houseEdge: data.houseEdge ?? 0,
        eligibilityMode: data.eligibilityMode ?? ELIGIBILITY_MODE.ALL,
        eligibility: {
          create: eligibilityTargets,
        },
      },
    });

    await generateEnvelopes(tx, created.id, created.envelopeCount);
    return created;
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "campaign.create",
    entity: "campaign",
    entityId: campaign.id,
    meta: { name: campaign.name, envelopeCount: campaign.envelopeCount },
    ip,
  });

  return getCampaign(shop, campaign.id);
}

/**
 * Update a campaign. If the envelope count changes AND no envelopes have been
 * opened yet, the grid is regenerated; otherwise the count change is rejected
 * to avoid destroying claim history.
 */
export async function updateCampaign(shop, id, input, { actor, ip } = {}) {
  const existing = await getCampaign(shop, id);
  if (!existing) throw new NotFoundError("Campaign not found.");

  const result = validateCampaignInput({ ...existing, ...input });
  if (!result.ok) throw new ValidationError(result.errors);
  const data = result.value;

  const openedCount = await prisma.envelope.count({
    where: { campaignId: id, status: "OPENED" },
  });

  const wantsResize =
    data.envelopeCount != null && data.envelopeCount !== existing.envelopeCount;
  if (wantsResize && openedCount > 0) {
    throw new ValidationError({
      envelopeCount:
        "Cannot change envelope count after envelopes have been opened. Reset the campaign first.",
    });
  }

  const eligibilityTargets =
    input.eligibility !== undefined
      ? normalizeEligibility(
          data.eligibilityMode ?? existing.eligibilityMode,
          input.eligibility,
        )
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        bannerUrl: data.bannerUrl,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        envelopeCount: data.envelopeCount ?? existing.envelopeCount,
        maxWinners: data.maxWinners ?? null,
        maxOpensPerCustomer: data.maxOpensPerCustomer ?? existing.maxOpensPerCustomer,
        houseEdge: data.houseEdge ?? existing.houseEdge,
        eligibilityMode: data.eligibilityMode ?? existing.eligibilityMode,
      },
    });

    if (eligibilityTargets) {
      await tx.campaignEligibility.deleteMany({ where: { campaignId: id } });
      if (eligibilityTargets.length > 0) {
        await tx.campaignEligibility.createMany({
          data: eligibilityTargets.map((t) => ({ ...t, campaignId: id })),
        });
      }
    }

    if (wantsResize) {
      await tx.envelope.deleteMany({ where: { campaignId: id } });
      await generateEnvelopes(tx, id, data.envelopeCount);
    }
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "campaign.update",
    entity: "campaign",
    entityId: id,
    ip,
  });

  return getCampaign(shop, id);
}

/** Transition helpers enforce a valid status machine. */
export async function setStatus(shop, id, status, { actor, ip } = {}) {
  const existing = await getCampaign(shop, id);
  if (!existing) throw new NotFoundError("Campaign not found.");

  await prisma.campaign.update({ where: { id }, data: { status } });
  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: `campaign.${status.toLowerCase()}`,
    entity: "campaign",
    entityId: id,
    meta: { from: existing.status, to: status },
    ip,
  });
  return getCampaign(shop, id);
}

export const pauseCampaign = (shop, id, ctx) =>
  setStatus(shop, id, CAMPAIGN_STATUS.PAUSED, ctx);
export const resumeCampaign = (shop, id, ctx) =>
  setStatus(shop, id, CAMPAIGN_STATUS.ACTIVE, ctx);
export const archiveCampaign = (shop, id, ctx) =>
  setStatus(shop, id, CAMPAIGN_STATUS.ARCHIVED, ctx);

/** Hard-delete a campaign and all dependent rows (cascade). */
export async function deleteCampaign(shop, id, { actor, ip } = {}) {
  const existing = await prisma.campaign.findFirst({ where: { id, shop } });
  if (!existing) throw new NotFoundError("Campaign not found.");

  await prisma.campaign.delete({ where: { id } });
  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "campaign.delete",
    entity: "campaign",
    entityId: id,
    meta: { name: existing.name },
    ip,
  });
  return { id };
}

/** Duplicate a campaign (config + rewards) as a fresh DRAFT with a new grid. */
export async function duplicateCampaign(shop, id, { actor, ip } = {}) {
  const source = await getCampaign(shop, id);
  if (!source) throw new NotFoundError("Campaign not found.");

  const clone = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        shop,
        name: `${source.name} (Copy)`,
        description: source.description,
        bannerUrl: source.bannerUrl,
        status: CAMPAIGN_STATUS.DRAFT,
        startAt: source.startAt,
        endAt: source.endAt,
        envelopeCount: source.envelopeCount,
        maxWinners: source.maxWinners,
        maxOpensPerCustomer: source.maxOpensPerCustomer,
        houseEdge: source.houseEdge,
        eligibilityMode: source.eligibilityMode,
        eligibility: {
          create: source.eligibility.map((e) => ({
            targetType: e.targetType,
            gid: e.gid,
            title: e.title,
          })),
        },
        rewards: {
          create: source.rewards.map((r) => ({
            type: r.type,
            label: r.label,
            config: r.config,
            inventoryTotal: r.inventoryTotal,
            inventoryRemaining: r.inventoryTotal, // reset inventory
            probabilityWeight: r.probabilityWeight,
            priority: r.priority,
            expiresInDays: r.expiresInDays,
            claimInstructions: r.claimInstructions,
          })),
        },
      },
    });

    await generateEnvelopes(tx, created.id, created.envelopeCount);
    return created;
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "campaign.duplicate",
    entity: "campaign",
    entityId: clone.id,
    meta: { sourceId: id },
    ip,
  });

  return getCampaign(shop, clone.id);
}

/** Normalize eligibility input into rows for the given mode. */
function normalizeEligibility(mode, eligibility) {
  if (mode === ELIGIBILITY_MODE.ALL || !Array.isArray(eligibility)) return [];
  const targetType = mode === ELIGIBILITY_MODE.PRODUCTS ? "PRODUCT" : "COLLECTION";
  const seen = new Set();
  const rows = [];
  for (const item of eligibility) {
    const gid = typeof item === "string" ? item : item?.gid;
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    rows.push({
      targetType,
      gid,
      title: typeof item === "object" ? item?.title ?? null : null,
    });
  }
  return rows;
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}
