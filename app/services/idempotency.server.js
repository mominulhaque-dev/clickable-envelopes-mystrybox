import prisma from "../db.server.js";
import { IDEMPOTENCY_TTL_MS } from "../lib/constants.js";
import { parseJson, stringifyJson } from "../lib/json.js";

/**
 * Idempotency guard for non-safe operations (envelope open). A client sends a
 * stable key; the first request executes and stores its response, and repeats
 * of the same key return the stored response instead of re-executing.
 *
 * This defeats double-clicks, network retries, and replay attempts.
 */

/**
 * Try to claim an idempotency key.
 * @returns {{ status: "fresh" } | { status: "duplicate", response: any }}
 */
export async function claimIdempotencyKey({ shop, scope, key }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);

  // Purge expired keys opportunistically (cheap, bounded).
  await prisma.idempotencyKey
    .deleteMany({ where: { shop, scope, expiresAt: { lt: now } } })
    .catch(() => {});

  try {
    await prisma.idempotencyKey.create({
      data: { shop, scope, key, expiresAt },
    });
    return { status: "fresh" };
  } catch (error) {
    // Unique constraint violation => key already exists.
    if (error?.code === "P2002") {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { shop_scope_key: { shop, scope, key } },
      });
      return {
        status: "duplicate",
        response: existing?.response ? parseJson(existing.response, null) : null,
      };
    }
    throw error;
  }
}

/** Persist the response body against a previously-claimed key. */
export async function storeIdempotentResponse({ shop, scope, key }, response) {
  await prisma.idempotencyKey
    .update({
      where: { shop_scope_key: { shop, scope, key } },
      data: { response: stringifyJson(response) },
    })
    .catch((error) => {
      console.error("[idempotency] failed to store response", error);
    });
}

/** Release a claimed key so the operation can be retried (e.g. after failure). */
export async function releaseIdempotencyKey({ shop, scope, key }) {
  await prisma.idempotencyKey
    .deleteMany({ where: { shop, scope, key } })
    .catch(() => {});
}
