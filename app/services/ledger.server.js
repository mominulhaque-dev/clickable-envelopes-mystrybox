import prisma from "../db.server.js";
import { stringifyJson } from "../lib/json.js";
import { customerGid as toCustomerGid, orderGid as toOrderGid } from "../lib/gid.js";

/**
 * Eligibility ledger service. Order webhooks feed this table so the customer
 * verification hot path is a fast local lookup rather than a live Admin API
 * call. One row per (shop, order).
 */

/**
 * Upsert an order into the ledger from a webhook payload (REST-shaped order).
 * @param {string} shop
 * @param {object} order - Shopify order payload
 */
export async function upsertOrderFromWebhook(shop, order) {
  const orderGid = order.admin_graphql_api_id || toOrderGid(order.id);
  const custId = order.customer?.id ?? order.customer?.admin_graphql_api_id;
  const customerGid = custId ? toCustomerGid(custId) : null;

  // Without a customer we cannot attribute eligibility.
  if (!customerGid) return null;

  const productGids = Array.from(
    new Set(
      (order.line_items || [])
        .map((li) => li.product_id)
        .filter(Boolean)
        .map((id) => toProductGid(id)),
    ),
  );

  const financialStatus = (order.financial_status || "").toLowerCase();
  const cancelled = Boolean(order.cancelled_at);
  const eligible = financialStatus === "paid" && !cancelled;

  return prisma.eligibilityLedger.upsert({
    where: { shop_orderGid: { shop, orderGid } },
    create: {
      shop,
      customerGid,
      orderGid,
      orderName: order.name ?? null,
      financialStatus,
      cancelled,
      productGids: stringifyJson(productGids),
      collectionGids: stringifyJson([]),
      eligible,
    },
    update: {
      financialStatus,
      cancelled,
      productGids: stringifyJson(productGids),
      eligible,
    },
  });
}

/** Mark an order cancelled (orders/cancelled webhook). */
export async function markOrderCancelled(shop, order) {
  const orderGid = order.admin_graphql_api_id || toOrderGid(order.id);
  await prisma.eligibilityLedger.updateMany({
    where: { shop, orderGid },
    data: { cancelled: true, eligible: false },
  });
}

/** Apply a refund (refunds/create webhook) — a fully refunded order loses eligibility. */
export async function applyRefund(shop, refund) {
  const orderGid =
    refund.order_id != null ? toOrderGid(refund.order_id) : null;
  if (!orderGid) return;
  // Conservative: any refund marks the order refunded and ineligible. Merchants
  // can tune partial-refund policy later; this errs toward not over-rewarding.
  await prisma.eligibilityLedger.updateMany({
    where: { shop, orderGid },
    data: { financialStatus: "refunded", eligible: false },
  });
}

/** Persist the collection GIDs for a ledger order (enriched via Admin API). */
export async function setOrderCollections(shop, orderGid, collectionGids) {
  await prisma.eligibilityLedger.updateMany({
    where: { shop, orderGid },
    data: { collectionGids: stringifyJson(collectionGids) },
  });
}

function toProductGid(id) {
  const raw = String(id);
  return raw.startsWith("gid://") ? raw : `gid://shopify/Product/${raw}`;
}
