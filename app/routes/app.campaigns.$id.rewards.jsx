import { useEffect, useState } from "react";
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
import { getCampaign } from "../services/campaign.server.js";
import {
  listRewards,
  createReward,
  updateReward,
  deleteReward,
} from "../services/reward.server.js";
import { ValidationError } from "../lib/validation.js";
import { REWARD_TYPE, REWARD_TYPES, DISCOUNT_KIND } from "../lib/constants.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const campaign = await getCampaign(shop, params.id);
  if (!campaign) throw new Response("Campaign not found", { status: 404 });
  const rewards = await listRewards(shop, params.id);
  return {
    campaign: { id: campaign.id, name: campaign.name, houseEdge: campaign.houseEdge },
    rewards,
  };
};

/** Build a reward input object from the submitted form. */
function parseRewardForm(form) {
  const type = form.get("type");
  const config = {};
  if (type === REWARD_TYPE.DISCOUNT) {
    config.kind = form.get("config.kind");
    config.amount = form.get("config.amount");
  } else if (type === REWARD_TYPE.GIFT_CARD) {
    config.amount = form.get("config.amount");
  } else if (type === REWARD_TYPE.FREE_PRODUCT) {
    config.productGid = form.get("config.productGid");
    config.productTitle = form.get("config.productTitle") || null;
  }
  return {
    type,
    label: form.get("label"),
    probabilityWeight: form.get("probabilityWeight"),
    priority: form.get("priority"),
    inventoryTotal: form.get("inventoryTotal"),
    expiresInDays: form.get("expiresInDays"),
    claimInstructions: form.get("claimInstructions"),
    config,
  };
}

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");
  const ctx = { actor: shop, ip: request.headers.get("x-forwarded-for") ?? null };

  try {
    if (intent === "delete") {
      await deleteReward(shop, params.id, form.get("rewardId"), ctx);
      return { ok: true, intent: "delete" };
    }
    const input = parseRewardForm(form);
    if (intent === "update") {
      await updateReward(shop, params.id, form.get("rewardId"), input, ctx);
      return { ok: true, intent: "update" };
    }
    await createReward(shop, params.id, input, ctx);
    return { ok: true, intent: "create" };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, errors: err.errors, intent };
    }
    return { ok: false, errors: { _form: err.message ?? "Reward action failed." } };
  }
};

export default function RewardsManager() {
  const { campaign, rewards } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const [type, setType] = useState(REWARD_TYPE.DISCOUNT);
  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(`Reward ${actionData.intent}d`);
    } else if (actionData?.errors?._form) {
      shopify.toast.show(actionData.errors._form, { isError: true });
    }
  }, [actionData, shopify]);

  useEffect(() => {
    if (deleteFetcher.data?.errors?.reward) {
      shopify.toast.show(deleteFetcher.data.errors.reward, { isError: true });
    }
  }, [deleteFetcher.data, shopify]);

  const onSubmit = (event) => {
    event.preventDefault();
    submit(event.target, { method: "POST" });
  };

  const removeReward = (rewardId, label) => {
    if (confirm(`Delete reward "${label}"?`)) {
      deleteFetcher.submit({ intent: "delete", rewardId }, { method: "POST" });
    }
  };

  const errors = actionData?.errors ?? {};
  const totalWeight = rewards.reduce((s, r) => s + (r.probabilityWeight || 0), 0);

  return (
    <s-page heading={`Rewards — ${campaign.name}`}>
      <s-button
        slot="primary-action"
        href={`/app/campaigns/${campaign.id}`}
        variant="tertiary"
      >
        Back to campaign
      </s-button>

      <s-section heading="Prize pool">
        <s-paragraph>
          House edge is {campaign.houseEdge}% (implicit no-prize chance). Draw
          odds are each reward&apos;s weight over the total weight plus house
          edge.
        </s-paragraph>
        {rewards.length === 0 ? (
          <s-paragraph>No rewards yet. Add one below.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Label</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Weight</s-table-header>
              <s-table-header>Approx. odds</s-table-header>
              <s-table-header>Inventory</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rewards.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.label}</s-table-cell>
                  <s-table-cell>{r.type}</s-table-cell>
                  <s-table-cell>{r.probabilityWeight}</s-table-cell>
                  <s-table-cell>
                    {totalWeight
                      ? `${Math.round((r.probabilityWeight / totalWeight) * 100)}%`
                      : "—"}
                  </s-table-cell>
                  <s-table-cell>
                    {r.inventoryTotal == null
                      ? "∞"
                      : `${r.inventoryRemaining} / ${r.inventoryTotal}`}
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => removeReward(r.id, r.label)}
                    >
                      Delete
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Add reward">
        <form onSubmit={onSubmit}>
          <input type="hidden" name="intent" value="create" />
          <s-stack direction="block" gap="base">
            <s-select
              label="Reward type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              error={errors.type}
            >
              {REWARD_TYPES.map((t) => (
                <s-option key={t} value={t}>
                  {t}
                </s-option>
              ))}
            </s-select>

            <s-text-field label="Label" name="label" error={errors.label} required />

            {type === REWARD_TYPE.DISCOUNT && (
              <s-stack direction="inline" gap="base" wrap="wrap">
                <s-select label="Discount kind" name="config.kind" error={errors.config}>
                  <s-option value={DISCOUNT_KIND.PERCENTAGE}>Percentage</s-option>
                  <s-option value={DISCOUNT_KIND.FIXED_AMOUNT}>Fixed amount</s-option>
                </s-select>
                <s-text-field label="Amount" name="config.amount" type="number" />
              </s-stack>
            )}
            {type === REWARD_TYPE.GIFT_CARD && (
              <s-text-field
                label="Gift card amount"
                name="config.amount"
                type="number"
                error={errors.config}
              />
            )}
            {type === REWARD_TYPE.FREE_PRODUCT && (
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Product GID"
                  name="config.productGid"
                  placeholder="gid://shopify/Product/123..."
                  error={errors.config}
                />
                <s-text-field label="Product title (optional)" name="config.productTitle" />
              </s-stack>
            )}

            <s-stack direction="inline" gap="base" wrap="wrap">
              <s-text-field
                label="Probability weight"
                name="probabilityWeight"
                type="number"
                value="1"
                error={errors.probabilityWeight}
              />
              <s-text-field label="Priority" name="priority" type="number" value="0" />
              <s-text-field
                label="Inventory (blank = unlimited)"
                name="inventoryTotal"
                type="number"
                error={errors.inventoryTotal}
              />
              <s-text-field
                label="Expires in days"
                name="expiresInDays"
                type="number"
                error={errors.expiresInDays}
              />
            </s-stack>

            <s-text-area label="Claim instructions" name="claimInstructions" />

            <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
              Add reward
            </s-button>
          </s-stack>
        </form>
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
