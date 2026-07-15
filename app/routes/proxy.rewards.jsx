import { authenticate } from "../shopify.server";
import { getActiveCampaign } from "../services/storefront.server.js";
import { listCustomerClaims } from "../services/claim.server.js";
import { toRewardView } from "../lib/rewardView.js";

/**
 * GET /apps/mystery-vault/rewards?campaign=<id>
 *
 * Returns the logged-in customer's claim history for the campaign, shaped for
 * display. Requires login; only the customer's own claims are ever returned.
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ ok: false, error: "Shop not available" }, { status: 401 });
  }
  const shop = session.shop;

  const url = new URL(request.url);
  const customerId = url.searchParams.get("logged_in_customer_id");
  if (!customerId) {
    return Response.json({ ok: false, error: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const customerGid = `gid://shopify/Customer/${customerId}`;

  const campaign = await getActiveCampaign(shop, url.searchParams.get("campaign") || undefined);
  if (!campaign) {
    return Response.json({ ok: true, rewards: [] });
  }

  const claims = await listCustomerClaims(shop, campaign.id, customerGid);
  const rewards = claims
    .map((c) => toRewardView(c, c.reward))
    .filter((r) => r.won);

  return Response.json({ ok: true, rewards });
};
