/**
 * Helpers for working with Shopify Global IDs (GIDs).
 * A GID looks like: gid://shopify/Product/1234567890
 */

/** Build a GID from a resource type and numeric/string id. */
export function toGid(resource, id) {
  if (id == null) return null;
  const raw = String(id);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/${resource}/${raw}`;
}

/** Extract the trailing numeric id from a GID. Returns null if not a GID. */
export function parseGidId(gid) {
  if (!gid || typeof gid !== "string") return null;
  const match = gid.match(/gid:\/\/shopify\/[^/]+\/([^?]+)/);
  return match ? match[1] : null;
}

/** Extract the resource type (e.g. "Product") from a GID. */
export function parseGidType(gid) {
  if (!gid || typeof gid !== "string") return null;
  const match = gid.match(/gid:\/\/shopify\/([^/]+)\//);
  return match ? match[1] : null;
}

export const productGid = (id) => toGid("Product", id);
export const collectionGid = (id) => toGid("Collection", id);
export const customerGid = (id) => toGid("Customer", id);
export const orderGid = (id) => toGid("Order", id);
