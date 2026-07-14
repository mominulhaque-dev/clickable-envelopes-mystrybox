-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "rewardId" TEXT,
    "customerGid" TEXT NOT NULL,
    "orderGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "discountGid" TEXT,
    "giftCardGid" TEXT,
    "code" TEXT,
    "claimInstructions" TEXT,
    "expiresAt" DATETIME,
    "fulfilledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("campaignId", "claimInstructions", "code", "createdAt", "customerGid", "discountGid", "envelopeId", "expiresAt", "fulfilledAt", "giftCardGid", "id", "orderGid", "rewardId", "shop", "status", "updatedAt") SELECT "campaignId", "claimInstructions", "code", "createdAt", "customerGid", "discountGid", "envelopeId", "expiresAt", "fulfilledAt", "giftCardGid", "id", "orderGid", "rewardId", "shop", "status", "updatedAt" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE UNIQUE INDEX "Claim_envelopeId_key" ON "Claim"("envelopeId");
CREATE INDEX "Claim_shop_customerGid_idx" ON "Claim"("shop", "customerGid");
CREATE INDEX "Claim_campaignId_idx" ON "Claim"("campaignId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
