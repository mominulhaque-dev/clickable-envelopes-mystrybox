import prisma from "../db.server.js";
import { DEFAULT_ENVELOPE_COUNT } from "../lib/constants.js";

/**
 * Per-shop settings. A row is lazily created on first read so callers always
 * get a usable settings object.
 */

export async function getSettings(shop) {
  const existing = await prisma.appSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return prisma.appSettings.create({
    data: { shop, defaultEnvelopeCount: DEFAULT_ENVELOPE_COUNT },
  });
}

export async function updateSettings(shop, input) {
  const data = {};
  if (input.defaultEnvelopeCount !== undefined) {
    data.defaultEnvelopeCount = Number(input.defaultEnvelopeCount);
  }
  if (input.brandColor !== undefined) data.brandColor = String(input.brandColor);
  if (input.reducedMotion !== undefined) {
    data.reducedMotion = Boolean(input.reducedMotion);
  }
  if (input.loginPromptText !== undefined) {
    data.loginPromptText = input.loginPromptText
      ? String(input.loginPromptText)
      : null;
  }

  return prisma.appSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}
