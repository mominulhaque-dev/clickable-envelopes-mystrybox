import {
  ELIGIBILITY_MODE,
  ELIGIBILITY_MODES,
  ENVELOPE_COUNT_OPTIONS,
} from "../lib/constants.js";

/**
 * Shared campaign form fields used by both the create and edit routes.
 * `values` seeds the inputs (echoed back on validation error or loaded from an
 * existing campaign); `errors` is the field->message map from ValidationError.
 */
export function CampaignFormFields({ errors = {}, values = {} }) {
  const v = (k, fallback = "") => values[k] ?? fallback;

  return (
    <>
      <s-section heading="Details">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Campaign name"
            name="name"
            value={v("name")}
            error={errors.name}
            required
          />
          <s-text-area
            label="Description"
            name="description"
            value={v("description")}
            error={errors.description}
          />
          <s-text-field
            label="Banner image URL"
            name="bannerUrl"
            value={v("bannerUrl")}
            error={errors.bannerUrl}
            placeholder="https://..."
          />
        </s-stack>
      </s-section>

      <s-section heading="Mechanics">
        <s-stack direction="block" gap="base">
          <s-select
            label="Envelope count"
            name="envelopeCount"
            value={String(v("envelopeCount", ENVELOPE_COUNT_OPTIONS[1]))}
            error={errors.envelopeCount}
          >
            {ENVELOPE_COUNT_OPTIONS.map((n) => (
              <s-option key={n} value={String(n)}>
                {n}
              </s-option>
            ))}
          </s-select>
          <s-text-field
            label="Max winners (blank = unlimited)"
            name="maxWinners"
            type="number"
            value={v("maxWinners")}
            error={errors.maxWinners}
          />
          <s-text-field
            label="Max opens per customer"
            name="maxOpensPerCustomer"
            type="number"
            value={String(v("maxOpensPerCustomer", 1))}
            error={errors.maxOpensPerCustomer}
          />
          <s-text-field
            label="House edge (%) — chance of no prize"
            name="houseEdge"
            type="number"
            value={String(v("houseEdge", 0))}
            error={errors.houseEdge}
          />
        </s-stack>
      </s-section>

      <s-section heading="Schedule">
        <s-stack direction="inline" gap="base" wrap="wrap">
          <s-text-field
            label="Start date"
            name="startAt"
            type="datetime-local"
            value={v("startAt")}
            error={errors.startAt}
          />
          <s-text-field
            label="End date"
            name="endAt"
            type="datetime-local"
            value={v("endAt")}
            error={errors.endAt}
          />
        </s-stack>
      </s-section>

      <s-section heading="Eligibility">
        <s-stack direction="block" gap="base">
          <s-select
            label="Who can participate"
            name="eligibilityMode"
            value={v("eligibilityMode", ELIGIBILITY_MODE.ALL)}
            error={errors.eligibilityMode}
          >
            {ELIGIBILITY_MODES.map((m) => (
              <s-option key={m} value={m}>
                {m}
              </s-option>
            ))}
          </s-select>
          <s-text-area
            label="Product / collection GIDs (one per line)"
            name="eligibility"
            value={v("eligibility")}
            error={errors.eligibility}
            placeholder="gid://shopify/Product/123..."
            details="Only used when eligibility is limited to products or collections."
          />
        </s-stack>
      </s-section>
    </>
  );
}
