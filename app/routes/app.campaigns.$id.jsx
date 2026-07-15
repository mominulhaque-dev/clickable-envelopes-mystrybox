import { useEffect } from "react";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  useFetcher,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getCampaign,
  updateCampaign,
  setStatus,
  NotFoundError,
} from "../services/campaign.server.js";
import { getCampaignStats } from "../services/analytics.server.js";
import { resetCampaign, RESET_SCOPE } from "../services/reset.server.js";
import { ValidationError } from "../lib/validation.js";
import { parseCampaignForm } from "../lib/campaignForm.js";
import { CampaignFormFields } from "../components/CampaignFormFields.jsx";
import { CAMPAIGN_STATUS } from "../lib/constants.js";

/** Format a Date (or ISO string) for a datetime-local input. */
function toLocalInput(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const campaign = await getCampaign(shop, params.id);
  if (!campaign) throw new Response("Campaign not found", { status: 404 });
  const stats = await getCampaignStats(shop, params.id);

  return {
    values: {
      name: campaign.name,
      description: campaign.description ?? "",
      bannerUrl: campaign.bannerUrl ?? "",
      status: campaign.status,
      startAt: toLocalInput(campaign.startAt),
      endAt: toLocalInput(campaign.endAt),
      envelopeCount: campaign.envelopeCount,
      maxWinners: campaign.maxWinners ?? "",
      maxOpensPerCustomer: campaign.maxOpensPerCustomer,
      houseEdge: campaign.houseEdge,
      eligibilityMode: campaign.eligibilityMode,
      eligibility: campaign.eligibility.map((e) => e.gid).join("\n"),
    },
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    stats,
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const ctx = { actor: shop, ip: request.headers.get("x-forwarded-for") ?? null };

  try {
    if (intent === "status") {
      await setStatus(shop, params.id, form.get("status"), ctx);
      return { ok: true, intent };
    }
    if (intent === "reset") {
      const scope = form.get("scope");
      if (!Object.values(RESET_SCOPE).includes(scope)) {
        return { ok: false, errors: { _form: "Invalid reset scope." } };
      }
      await resetCampaign(shop, params.id, scope, ctx);
      return { ok: true, intent };
    }

    // Default: save form edits.
    const input = parseCampaignForm(form);
    await updateCampaign(shop, params.id, input, ctx);
    return { ok: true, intent: "save" };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, errors: err.errors };
    }
    if (err instanceof NotFoundError) {
      throw new Response("Campaign not found", { status: 404 });
    }
    return { ok: false, errors: { _form: err.message ?? "Update failed." } };
  }
};

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

export default function EditCampaign() {
  const { values, campaign, stats } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const statusFetcher = useFetcher();
  const resetFetcher = useFetcher();
  const shopify = useAppBridge();
  const isSaving =
    navigation.state === "submitting" && navigation.formData?.get("intent") == null;

  useEffect(() => {
    if (actionData?.ok && actionData.intent === "save") {
      shopify.toast.show("Campaign saved");
    } else if (actionData?.errors?._form) {
      shopify.toast.show(actionData.errors._form, { isError: true });
    }
  }, [actionData, shopify]);

  useEffect(() => {
    if (statusFetcher.data?.ok) shopify.toast.show("Status updated");
  }, [statusFetcher.data, shopify]);

  useEffect(() => {
    if (resetFetcher.data?.ok) shopify.toast.show("Campaign reset");
  }, [resetFetcher.data, shopify]);

  const onSubmit = (event) => {
    event.preventDefault();
    submit(event.target, { method: "POST" });
  };

  const changeStatus = (status) =>
    statusFetcher.submit({ intent: "status", status }, { method: "POST" });

  // Scope values mirror RESET_SCOPE (server-side). Kept as literals here so the
  // server-only reset module is not pulled into the client bundle.
  const doReset = (scope) => {
    if (confirm(`Reset "${scope}" for this campaign? This cannot be undone.`)) {
      resetFetcher.submit({ intent: "reset", scope }, { method: "POST" });
    }
  };

  const errors = actionData?.errors ?? {};

  return (
    <s-page heading={campaign.name}>
      <s-button slot="primary-action" href="/app/campaigns" variant="tertiary">
        Back to campaigns
      </s-button>
      <s-button
        slot="secondary-actions"
        href={`/app/campaigns/${campaign.id}/rewards`}
      >
        Manage rewards
      </s-button>

      <s-section heading="Status">
        <s-stack direction="inline" gap="tight" wrap="wrap">
          <s-badge>{campaign.status}</s-badge>
          {campaign.status !== CAMPAIGN_STATUS.ACTIVE && (
            <s-button variant="tertiary" onClick={() => changeStatus(CAMPAIGN_STATUS.ACTIVE)}>
              Activate
            </s-button>
          )}
          {campaign.status === CAMPAIGN_STATUS.ACTIVE && (
            <s-button variant="tertiary" onClick={() => changeStatus(CAMPAIGN_STATUS.PAUSED)}>
              Pause
            </s-button>
          )}
          {campaign.status !== CAMPAIGN_STATUS.ARCHIVED && (
            <s-button variant="tertiary" onClick={() => changeStatus(CAMPAIGN_STATUS.ARCHIVED)}>
              Archive
            </s-button>
          )}
        </s-stack>
      </s-section>

      {stats && (
        <s-section heading="Performance">
          <s-stack direction="inline" gap="base" wrap="wrap">
            <Metric label="Opened" value={`${stats.opened} / ${stats.envelopeCount}`} />
            <Metric label="Remaining" value={stats.remaining} />
            <Metric label="Winners" value={stats.winners} />
            <Metric label="Participation" value={pct(stats.participationRate)} />
            <Metric label="Win rate" value={pct(stats.winRate)} />
            <Metric label="Participants" value={stats.uniqueParticipants} />
            <Metric label="Fulfilled" value={stats.fulfilledClaims} />
            <Metric label="Failed" value={stats.failedClaims} />
          </s-stack>
        </s-section>
      )}

      <form onSubmit={onSubmit}>
        <CampaignFormFields errors={errors} values={values} />
        <s-section>
          <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
            Save changes
          </s-button>
        </s-section>
      </form>

      <s-section heading="Reset campaign">
        <s-paragraph>
          Destructive actions. Resetting clears data for this campaign and cannot
          be undone.
        </s-paragraph>
        <s-stack direction="inline" gap="tight" wrap="wrap">
          <s-button tone="critical" variant="tertiary" onClick={() => doReset("claims")}>
            Reset claims
          </s-button>
          <s-button tone="critical" variant="tertiary" onClick={() => doReset("rewards")}>
            Restore inventory
          </s-button>
          <s-button tone="critical" variant="tertiary" onClick={() => doReset("envelopes")}>
            Regenerate envelopes
          </s-button>
          <s-button tone="critical" variant="tertiary" onClick={() => doReset("all")}>
            Full reset
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" minInlineSize="130px">
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
