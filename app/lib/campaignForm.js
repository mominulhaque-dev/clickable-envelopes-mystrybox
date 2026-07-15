/**
 * Parse a submitted campaign form (FormData) into the shape expected by
 * createCampaign/updateCampaign. Shared by the new and edit routes so the two
 * stay in sync. Validation itself lives in app/lib/validation.js — this only
 * shapes the raw form fields.
 */
export function parseCampaignForm(form) {
  const str = (k) => {
    const v = form.get(k);
    return v == null ? undefined : String(v);
  };

  // Eligibility GIDs come from a newline/comma separated textarea.
  const rawEligibility = form.get("eligibility");
  const eligibility =
    rawEligibility != null
      ? String(rawEligibility)
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

  return {
    name: str("name"),
    description: str("description"),
    bannerUrl: str("bannerUrl"),
    status: str("status"),
    startAt: str("startAt"),
    endAt: str("endAt"),
    envelopeCount: str("envelopeCount"),
    maxWinners: str("maxWinners"),
    maxOpensPerCustomer: str("maxOpensPerCustomer"),
    houseEdge: str("houseEdge"),
    eligibilityMode: str("eligibilityMode"),
    eligibility,
    // Campaign-level shared discount configuration.
    discountKind: str("discountKind"),
    discountAmount: str("discountAmount"),
    discountOncePerCustomer: form.get("discountOncePerCustomer") != null,
  };
}
