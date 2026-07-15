import { authenticate } from "../shopify.server";
import { getActiveCampaign, getVaultState } from "../services/storefront.server.js";
import { getSettings } from "../services/settings.server.js";

/**
 * GET /apps/mystery-vault/state?campaign=<id>
 *
 * Returns the vault grid state for the theme app extension: which envelopes are
 * opened, how many opens the logged-in customer has left, and storefront
 * appearance settings. No reward data is leaked here.
 *
 * App-proxy requests are signature-verified by authenticate.public.appProxy;
 * an invalid signature throws before any data is read.
 */
export const loader = async ({ request }) => {
  const { session, liquid } = await authenticate.public.appProxy(request);
  if (!session) {
    // No offline session for this shop — app not properly installed.
    return liquid("", { layout: false });
  }
  const shop = session.shop;

  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaign") || undefined;
  // Shopify forwards the authenticated customer id on proxied requests.
  const customerId = url.searchParams.get("logged_in_customer_id") || null;
  const customerGid = customerId
    ? `gid://shopify/Customer/${customerId}`
    : null;

  const [campaign, settings] = await Promise.all([
    getActiveCampaign(shop, campaignId),
    getSettings(shop),
  ]);

  if (!campaign) {
    return Response.json({
      ok: true,
      campaign: null,
      loggedIn: !!customerGid,
    });
  }

  const state = await getVaultState(campaign, customerGid);

  return Response.json({
    ok: true,
    loggedIn: !!customerGid,
    loginPromptText: settings.loginPromptText,
    appearance: {
      brandColor: settings.brandColor,
      reducedMotion: settings.reducedMotion,
    },
    ...state,
  });
};
