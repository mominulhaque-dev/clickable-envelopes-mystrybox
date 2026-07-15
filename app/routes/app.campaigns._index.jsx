import { useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listCampaigns,
  setStatus,
  duplicateCampaign,
  deleteCampaign,
} from "../services/campaign.server.js";
import { CAMPAIGN_STATUS } from "../lib/constants.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await listCampaigns(session.shop);
  return {
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      envelopeCount: c.envelopeCount,
      opened: c._count?.envelopes ?? 0,
      claims: c._count?.claims ?? 0,
      winnersCount: c.winnersCount,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const id = form.get("id");
  const ctx = { actor: shop, ip: request.headers.get("x-forwarded-for") ?? null };

  try {
    switch (intent) {
      case "pause":
        await setStatus(shop, id, CAMPAIGN_STATUS.PAUSED, ctx);
        break;
      case "resume":
        await setStatus(shop, id, CAMPAIGN_STATUS.ACTIVE, ctx);
        break;
      case "archive":
        await setStatus(shop, id, CAMPAIGN_STATUS.ARCHIVED, ctx);
        break;
      case "activate":
        await setStatus(shop, id, CAMPAIGN_STATUS.ACTIVE, ctx);
        break;
      case "duplicate":
        await duplicateCampaign(shop, id, ctx);
        break;
      case "delete":
        await deleteCampaign(shop, id, ctx);
        break;
      default:
        return { ok: false, error: "Unknown action." };
    }
    return { ok: true, intent };
  } catch (err) {
    return { ok: false, error: err.message ?? "Action failed." };
  }
};

const STATUS_TONE = {
  [CAMPAIGN_STATUS.ACTIVE]: "success",
  [CAMPAIGN_STATUS.DRAFT]: "neutral",
  [CAMPAIGN_STATUS.PAUSED]: "warning",
  [CAMPAIGN_STATUS.ARCHIVED]: "neutral",
};

export default function CampaignsList() {
  const { campaigns } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(`Campaign ${fetcher.data.intent}d`);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const submit = (intent, id) =>
    fetcher.submit({ intent, id }, { method: "POST" });

  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" href="/app/campaigns/new" variant="primary">
        Create campaign
      </s-button>

      <s-section>
        {campaigns.length === 0 ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>No campaigns yet.</s-paragraph>
            <s-button href="/app/campaigns/new" variant="primary">
              Create your first campaign
            </s-button>
          </s-stack>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Envelopes</s-table-header>
              <s-table-header>Opened</s-table-header>
              <s-table-header>Winners</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/campaigns/${c.id}`}>{c.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[c.status] ?? "neutral"}>
                      {c.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{c.envelopeCount}</s-table-cell>
                  <s-table-cell>{c.opened}</s-table-cell>
                  <s-table-cell>{c.winnersCount}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="tight" wrap="wrap">
                      {c.status === CAMPAIGN_STATUS.ACTIVE && (
                        <s-button
                          variant="tertiary"
                          onClick={() => submit("pause", c.id)}
                        >
                          Pause
                        </s-button>
                      )}
                      {c.status === CAMPAIGN_STATUS.PAUSED && (
                        <s-button
                          variant="tertiary"
                          onClick={() => submit("resume", c.id)}
                        >
                          Resume
                        </s-button>
                      )}
                      {c.status === CAMPAIGN_STATUS.DRAFT && (
                        <s-button
                          variant="tertiary"
                          onClick={() => submit("activate", c.id)}
                        >
                          Activate
                        </s-button>
                      )}
                      <s-button
                        variant="tertiary"
                        onClick={() => submit("duplicate", c.id)}
                      >
                        Duplicate
                      </s-button>
                      {c.status !== CAMPAIGN_STATUS.ARCHIVED && (
                        <s-button
                          variant="tertiary"
                          onClick={() => submit("archive", c.id)}
                        >
                          Archive
                        </s-button>
                      )}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => {
                          if (confirm(`Delete "${c.name}"? This cannot be undone.`)) {
                            submit("delete", c.id);
                          }
                        }}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
