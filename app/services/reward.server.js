import prisma from "../db.server.js";
import { validateRewardInput, ValidationError } from "../lib/validation.js";
import { stringifyJson, parseJson } from "../lib/json.js";
import { recordAudit } from "./audit.server.js";
import { NotFoundError } from "./campaign.server.js";

/**
 * Reward service — manages the prize pool for a campaign. Rewards carry a
 * probability weight, optional inventory, priority, and type-specific config.
 */

/** Verify the campaign belongs to the shop; throws if not. */
async function assertCampaignOwned(shop, campaignId) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, shop },
    select: { id: true },
  });
  if (!campaign) throw new NotFoundError("Campaign not found.");
}

export async function listRewards(shop, campaignId) {
  await assertCampaignOwned(shop, campaignId);
  const rewards = await prisma.reward.findMany({
    where: { campaignId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rewards.map(hydrateReward);
}

export async function createReward(shop, campaignId, input, { actor, ip } = {}) {
  await assertCampaignOwned(shop, campaignId);
  const result = validateRewardInput(input);
  if (!result.ok) throw new ValidationError(result.errors);
  const data = result.value;

  const reward = await prisma.reward.create({
    data: {
      campaignId,
      type: data.type,
      label: data.label,
      config: stringifyJson(data.config),
      inventoryTotal: data.inventoryTotal,
      inventoryRemaining: data.inventoryTotal, // seed remaining = total
      probabilityWeight: data.probabilityWeight,
      priority: data.priority,
      expiresInDays: data.expiresInDays,
      claimInstructions: data.claimInstructions,
    },
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "reward.create",
    entity: "reward",
    entityId: reward.id,
    meta: { campaignId, type: reward.type, label: reward.label },
    ip,
  });

  return hydrateReward(reward);
}

export async function updateReward(shop, campaignId, rewardId, input, { actor, ip } = {}) {
  await assertCampaignOwned(shop, campaignId);
  const existing = await prisma.reward.findFirst({
    where: { id: rewardId, campaignId },
  });
  if (!existing) throw new NotFoundError("Reward not found.");

  const result = validateRewardInput({ ...hydrateReward(existing), ...input });
  if (!result.ok) throw new ValidationError(result.errors);
  const data = result.value;

  // When total inventory changes, adjust remaining by the same delta so
  // already-consumed inventory is preserved.
  let inventoryRemaining = existing.inventoryRemaining;
  if (data.inventoryTotal == null) {
    inventoryRemaining = null;
  } else if (existing.inventoryTotal == null) {
    inventoryRemaining = data.inventoryTotal;
  } else {
    const consumed = existing.inventoryTotal - (existing.inventoryRemaining ?? 0);
    inventoryRemaining = Math.max(0, data.inventoryTotal - consumed);
  }

  const reward = await prisma.reward.update({
    where: { id: rewardId },
    data: {
      type: data.type,
      label: data.label,
      config: stringifyJson(data.config),
      inventoryTotal: data.inventoryTotal,
      inventoryRemaining,
      probabilityWeight: data.probabilityWeight,
      priority: data.priority,
      expiresInDays: data.expiresInDays,
      claimInstructions: data.claimInstructions,
    },
  });

  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "reward.update",
    entity: "reward",
    entityId: rewardId,
    ip,
  });

  return hydrateReward(reward);
}

export async function deleteReward(shop, campaignId, rewardId, { actor, ip } = {}) {
  await assertCampaignOwned(shop, campaignId);
  const existing = await prisma.reward.findFirst({
    where: { id: rewardId, campaignId },
  });
  if (!existing) throw new NotFoundError("Reward not found.");

  // If any claim references this reward, block hard delete to preserve history.
  const claimCount = await prisma.claim.count({ where: { rewardId } });
  if (claimCount > 0) {
    throw new ValidationError({
      reward: "Cannot delete a reward that has already been won. Set its weight to 0 instead.",
    });
  }

  await prisma.reward.delete({ where: { id: rewardId } });
  await recordAudit({
    shop,
    actor: actor ?? "system",
    action: "reward.delete",
    entity: "reward",
    entityId: rewardId,
    ip,
  });
  return { id: rewardId };
}

/** Parse the stored JSON config into an object for callers. */
export function hydrateReward(reward) {
  return { ...reward, config: parseJson(reward.config, {}) };
}
