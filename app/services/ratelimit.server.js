import prisma from "../db.server.js";
import { RATE_LIMIT } from "../lib/constants.js";

/**
 * Fixed-window rate limiter backed by the RateLimit table. Simple, race-safe
 * enough for our abuse-prevention needs, and portable across SQLite/Postgres.
 *
 * A single row per (shop, bucket) tracks the count within the current window;
 * when the window rolls over the count resets.
 */

/**
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.bucket - stable identity, e.g. "open:customer:<gid>"
 * @param {number} [params.windowMs]
 * @param {number} [params.max]
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export async function consumeRateLimit({
  shop,
  bucket,
  windowMs = RATE_LIMIT.WINDOW_MS,
  max = RATE_LIMIT.MAX_OPENS_PER_WINDOW,
}) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimit.findUnique({
      where: { shop_bucket: { shop, bucket } },
    });

    const windowExpired =
      !existing || now.getTime() - existing.windowStart.getTime() >= windowMs;

    if (windowExpired) {
      await tx.rateLimit.upsert({
        where: { shop_bucket: { shop, bucket } },
        create: { shop, bucket, windowStart: now, count: 1 },
        update: { windowStart: now, count: 1 },
      });
      return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
    }

    if (existing.count >= max) {
      const retryAfterMs =
        windowMs - (now.getTime() - existing.windowStart.getTime());
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    const updated = await tx.rateLimit.update({
      where: { shop_bucket: { shop, bucket } },
      data: { count: { increment: 1 } },
    });
    return { allowed: true, remaining: Math.max(0, max - updated.count), retryAfterMs: 0 };
  });
}
