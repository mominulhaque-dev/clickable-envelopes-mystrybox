-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "defaultEnvelopeCount" INTEGER NOT NULL DEFAULT 100,
    "brandColor" TEXT NOT NULL DEFAULT '#5C6AC4',
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "loginPromptText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bannerUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startAt" DATETIME,
    "endAt" DATETIME,
    "envelopeCount" INTEGER NOT NULL DEFAULT 100,
    "maxWinners" INTEGER,
    "maxOpensPerCustomer" INTEGER NOT NULL DEFAULT 1,
    "houseEdge" INTEGER NOT NULL DEFAULT 0,
    "eligibilityMode" TEXT NOT NULL DEFAULT 'ALL',
    "winnersCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CampaignEligibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "gid" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignEligibility_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "inventoryTotal" INTEGER,
    "inventoryRemaining" INTEGER,
    "probabilityWeight" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "expiresInDays" INTEGER,
    "claimInstructions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reward_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNOPENED',
    "rewardId" TEXT,
    "customerGid" TEXT,
    "orderGid" TEXT,
    "openedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Envelope_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Envelope_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
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
    CONSTRAINT "Claim_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Claim_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EligibilityLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "customerGid" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "orderName" TEXT,
    "financialStatus" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "productGids" TEXT NOT NULL DEFAULT '[]',
    "collectionGids" TEXT NOT NULL DEFAULT '[]',
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shop_key" ON "AppSettings"("shop");

-- CreateIndex
CREATE INDEX "Campaign_shop_status_idx" ON "Campaign"("shop", "status");

-- CreateIndex
CREATE INDEX "Campaign_shop_createdAt_idx" ON "Campaign"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignEligibility_campaignId_idx" ON "CampaignEligibility"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEligibility_campaignId_targetType_gid_key" ON "CampaignEligibility"("campaignId", "targetType", "gid");

-- CreateIndex
CREATE INDEX "Reward_campaignId_idx" ON "Reward"("campaignId");

-- CreateIndex
CREATE INDEX "Envelope_campaignId_status_idx" ON "Envelope"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Envelope_customerGid_idx" ON "Envelope"("customerGid");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_campaignId_index_key" ON "Envelope"("campaignId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_envelopeId_key" ON "Claim"("envelopeId");

-- CreateIndex
CREATE INDEX "Claim_shop_customerGid_idx" ON "Claim"("shop", "customerGid");

-- CreateIndex
CREATE INDEX "Claim_campaignId_idx" ON "Claim"("campaignId");

-- CreateIndex
CREATE INDEX "EligibilityLedger_shop_customerGid_idx" ON "EligibilityLedger"("shop", "customerGid");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityLedger_shop_orderGid_key" ON "EligibilityLedger"("shop", "orderGid");

-- CreateIndex
CREATE INDEX "AuditLog_shop_createdAt_idx" ON "AuditLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_shop_entity_entityId_idx" ON "AuditLog"("shop", "entity", "entityId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_shop_scope_key_key" ON "IdempotencyKey"("shop", "scope", "key");

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_shop_bucket_key" ON "RateLimit"("shop", "bucket");
