import { useEffect } from "react";
import { useActionData, useNavigation, useSubmit, redirect, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createCampaign } from "../services/campaign.server.js";
import { ValidationError } from "../lib/validation.js";
import { parseCampaignForm } from "../lib/campaignForm.js";
import { CampaignFormFields } from "../components/CampaignFormFields.jsx";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const input = parseCampaignForm(form);

  try {
    const campaign = await createCampaign(shop, input, {
      actor: shop,
      ip: request.headers.get("x-forwarded-for") ?? null,
    });
    return redirect(`/app/campaigns/${campaign.id}`);
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, errors: err.errors, values: input };
    }
    return { ok: false, errors: { _form: err.message ?? "Could not create campaign." } };
  }
};

export default function NewCampaign() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.errors?._form) {
      shopify.toast.show(actionData.errors._form, { isError: true });
    }
  }, [actionData, shopify]);

  const onSubmit = (event) => {
    event.preventDefault();
    submit(event.target, { method: "POST" });
  };

  return (
    <s-page heading="Create campaign">
      <s-button slot="primary-action" href="/app/campaigns" variant="tertiary">
        Cancel
      </s-button>

      <form onSubmit={onSubmit}>
        <CampaignFormFields
          errors={actionData?.errors ?? {}}
          values={actionData?.values ?? {}}
        />
        <s-section>
          <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
            Create campaign
          </s-button>
        </s-section>
      </form>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
