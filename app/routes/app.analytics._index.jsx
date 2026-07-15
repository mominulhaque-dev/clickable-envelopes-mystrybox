import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getShopOverview, getTopCampaigns } from "../services/analytics.server.js";
import { CAMPAIGN_STATUS } from "../lib/constants.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [overview, topCampaigns] = await Promise.all([
    getShopOverview(shop),
    getTopCampaigns(shop, 10),
  ]);
  return { overview, topCampaigns };
};

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

const STATUS_TONE = {
  [CAMPAIGN_STATUS.ACTIVE]: "success",
  [CAMPAIGN_STATUS.DRAFT]: "neutral",
  [CAMPAIGN_STATUS.PAUSED]: "warning",
  [CAMPAIGN_STATUS.ARCHIVED]: "neutral",
};

export default function Analytics() {
  const { overview, topCampaigns } = useLoaderData();

  return (
    <s-page heading="Analytics">
      <s-section heading="Shop performance">
        <s-stack direction="inline" gap="base" wrap="wrap">
          <Metric label="Total campaigns" value={overview.campaignsTotal} />
          <Metric label="Active campaigns" value={overview.campaignsActive} />
          <Metric label="Total envelopes" value={overview.totalEnvelopes} />
          <Metric label="Opened" value={overview.openedEnvelopes} />
          <Metric label="Remaining" value={overview.remainingEnvelopes} />
          <Metric label="Rewards claimed" value={overview.claimedRewards} />
          <Metric label="Participation rate" value={pct(overview.participationRate)} />
          <Metric label="Win rate" value={pct(overview.winRate)} />
          <Metric label="Unique participants" value={overview.uniqueParticipants} />
        </s-stack>
      </s-section>

      <s-section heading="Campaigns by winners">
        {topCampaigns.length === 0 ? (
          <s-paragraph>No campaign data yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Campaign</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Winners</s-table-header>
              <s-table-header>Claims</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {topCampaigns.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/campaigns/${c.id}`}>{c.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[c.status] ?? "neutral"}>
                      {c.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{c.winners}</s-table-cell>
                  <s-table-cell>{c.claims}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" minInlineSize="150px">
      <s-stack direction="block" gap="tight">
        <s-text tone="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
