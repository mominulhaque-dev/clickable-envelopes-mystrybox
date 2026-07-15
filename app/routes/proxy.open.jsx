import { authenticate } from "../shopify.server";
import {
  getActiveCampaign,
  getOpenableEnvelope,
  countCustomerOpens,
} from "../services/storefront.server.js";
import { openEnvelope, OpenError, OPEN_ERROR } from "../services/openEngine.server.js";
import { fulfillClaim } from "../services/claim.server.js";
import { consumeRateLimit } from "../services/ratelimit.server.js";
import {
  claimIdempotencyKey,
  storeIdempotentResponse,
  releaseIdempotencyKey,
} from "../services/idempotency.server.js";
import { toRewardView } from "../lib/rewardView.js";

/**
 * POST /apps/mystery-vault/open
 * body: { campaign?: string, index: number, key: string }
 *
 * The single customer-facing write path. Layered defenses, in order:
 *   1. App-proxy signature verification (authenticate.public.appProxy).
 *   2. Login required — customerGid is taken from Shopify's forwarded
 *      logged_in_customer_id, never from the client body, so a customer cannot
 *      open or claim as someone else.
 *   3. Rate limit per customer (abuse / scripting guard).
 *   4. Idempotency key — double-clicks and retries return the first result
 *      instead of opening a second envelope.
 *   5. Per-customer open cap enforced against the campaign.
 *
 * The reward is drawn server-side inside openEnvelope(); the client only ever
 * learns the outcome, never influences it.
 */
export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ ok: false, error: "Shop not available" }, { status: 401 });
  }
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return Response.json(
      { ok: false, error: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }
  const customerGid = `gid://shopify/Customer/${customerId}`;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  const index = Number(body?.index);
  const idempotencyKey = String(body?.key ?? "").trim();
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ ok: false, error: "Invalid envelope" }, { status: 400 });
  }
  if (!idempotencyKey) {
    return Response.json({ ok: false, error: "Missing key" }, { status: 400 });
  }

  const campaign = await getActiveCampaign(shop, body?.campaign || undefined);
  if (!campaign) {
    return Response.json({ ok: false, error: "NO_ACTIVE_CAMPAIGN" }, { status: 404 });
  }

  // 3. Rate limit per customer.
  const limit = await consumeRateLimit({
    shop,
    bucket: `open:${campaign.id}:${customerGid}`,
  });
  if (!limit.allowed) {
    return Response.json(
      { ok: false, error: "RATE_LIMITED", retryAfterMs: limit.retryAfterMs },
      { status: 429 },
    );
  }

  // 4. Idempotency: replay the stored response for a repeated key.
  const scope = `open:${campaign.id}`;
  const claimed = await claimIdempotencyKey({ shop, scope, key: idempotencyKey });
  if (claimed.status === "duplicate") {
    return Response.json(
      claimed.response ?? { ok: false, error: "IN_PROGRESS" },
    );
  }

  try {
    // 5. Per-customer open cap.
    const opens = await countCustomerOpens(campaign.id, customerGid);
    if (opens >= campaign.maxOpensPerCustomer) {
      const payload = { ok: false, error: "OPEN_LIMIT_REACHED" };
      await storeIdempotentResponse({ shop, scope, key: idempotencyKey }, payload);
      return Response.json(payload, { status: 403 });
    }

    const envelope = await getOpenableEnvelope(campaign.id, index);
    if (!envelope) {
      // Already taken or out of range: release key so the customer can retry
      // a different cell, and report it.
      await releaseIdempotencyKey({ shop, scope, key: idempotencyKey });
      return Response.json({ ok: false, error: "ENVELOPE_TAKEN" }, { status: 409 });
    }

    // Server-authoritative draw + claim creation.
    const result = await openEnvelope({
      shop,
      campaignId: campaign.id,
      envelopeId: envelope.id,
      customerGid,
      orderGid: null,
    });

    // Provision the real Shopify resource (discount / gift card) if the reward
    // needs one. Uses the offline admin client from the proxy session.
    let claim = result.claim;
    if (result.isWin) {
      const { admin } = await authenticate.public.appProxy(request);
      if (admin) {
        claim = await fulfillClaim({
          admin,
          shop,
          claim: result.claim,
          reward: result.reward,
        });
      }
    }

    const view = toRewardView(claim, result.reward);
    const payload = { ok: true, index: envelope.index, reward: view };
    await storeIdempotentResponse({ shop, scope, key: idempotencyKey }, payload);
    return Response.json(payload);
  } catch (err) {
    // Release the key on unexpected failure so a genuine retry can proceed.
    await releaseIdempotencyKey({ shop, scope, key: idempotencyKey });

    if (err instanceof OpenError) {
      const status = err.code === OPEN_ERROR.ENVELOPE_TAKEN ? 409 : 400;
      return Response.json({ ok: false, error: err.code }, { status });
    }
    console.error("[proxy.open] unexpected error", err);
    return Response.json({ ok: false, error: "OPEN_FAILED" }, { status: 500 });
  }
};
