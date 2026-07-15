import { useEffect } from "react";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, updateSettings } from "../services/settings.server.js";
import { ENVELOPE_COUNT_OPTIONS } from "../lib/constants.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return {
    settings: {
      defaultEnvelopeCount: settings.defaultEnvelopeCount,
      brandColor: settings.brandColor ?? "",
      reducedMotion: settings.reducedMotion ?? false,
      loginPromptText: settings.loginPromptText ?? "",
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    await updateSettings(session.shop, {
      defaultEnvelopeCount: form.get("defaultEnvelopeCount"),
      brandColor: form.get("brandColor"),
      reducedMotion: form.get("reducedMotion") === "on",
      loginPromptText: form.get("loginPromptText"),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message ?? "Could not save settings." };
  }
};

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("Settings saved");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const onSubmit = (event) => {
    event.preventDefault();
    submit(event.target, { method: "POST" });
  };

  return (
    <s-page heading="Settings">
      <form onSubmit={onSubmit}>
        <s-section heading="Defaults">
          <s-stack direction="block" gap="base">
            <s-select
              label="Default envelope count"
              name="defaultEnvelopeCount"
              value={String(settings.defaultEnvelopeCount)}
            >
              {ENVELOPE_COUNT_OPTIONS.map((n) => (
                <s-option key={n} value={String(n)}>
                  {n}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="Storefront appearance">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Brand color"
              name="brandColor"
              value={settings.brandColor}
              placeholder="#5C6AC4"
            />
            <s-checkbox
              label="Reduced motion (disable open animation)"
              name="reducedMotion"
              {...(settings.reducedMotion ? { checked: true } : {})}
            />
            <s-text-area
              label="Login prompt text"
              name="loginPromptText"
              value={settings.loginPromptText}
              placeholder="Log in to open your mystery envelope"
            />
          </s-stack>
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary" {...(isSaving ? { loading: true } : {})}>
            Save settings
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
