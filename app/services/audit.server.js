import prisma from "../db.server.js";
import { stringifyJson } from "../lib/json.js";

/**
 * Append-only audit trail for security-sensitive and merchant actions.
 * Never throws into the caller's critical path — a failed audit write is
 * logged but does not roll back the action it describes.
 *
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.actor - "merchant:<id>" | "customer:<gid>" | "system"
 * @param {string} params.action - dot.namespaced action, e.g. "campaign.create"
 * @param {string} [params.entity]
 * @param {string} [params.entityId]
 * @param {object} [params.meta]
 * @param {string} [params.ip]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export async function recordAudit(
  { shop, actor, action, entity = null, entityId = null, meta = {}, ip = null },
  tx = prisma,
) {
  try {
    await tx.auditLog.create({
      data: {
        shop,
        actor,
        action,
        entity,
        entityId,
        meta: stringifyJson(meta),
        ip,
      },
    });
  } catch (error) {
    // Auditing must never break the primary operation.
    console.error("[audit] failed to write audit log", action, error);
  }
}

/** Read recent audit entries for a shop (most recent first). */
export async function listAudit(shop, { limit = 50, entity, entityId } = {}) {
  return prisma.auditLog.findMany({
    where: { shop, ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
