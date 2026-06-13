-- Sprint 2: referral attribution, negotiation fields, audit metadata, NegotiationLog

-- Customer referral fields
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referringAgentId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "referralType" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_referringAgentId_idx" ON "Customer"("referringAgentId");

-- Trade negotiation fields
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "originalFxRate" DECIMAL(65,30);
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "negotiatedRate" DECIMAL(65,30);
ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "negotiationUsed" BOOLEAN NOT NULL DEFAULT false;

-- AuditLog metadata for before/after compliance records
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Immutable negotiation audit trail
CREATE TABLE IF NOT EXISTS "NegotiationLog" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalRate" DECIMAL(65,30) NOT NULL,
    "newRate" DECIMAL(65,30) NOT NULL,
    "discount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NegotiationLog_tradeId_idx" ON "NegotiationLog"("tradeId");
CREATE INDEX IF NOT EXISTS "NegotiationLog_userId_idx" ON "NegotiationLog"("userId");

-- Default negotiation config (₦10M daily turnover threshold, 0.05% discount)
INSERT INTO "SystemConfig" ("key", "value")
VALUES (
    'negotiation_config',
    '{"threshold": 10000000, "enabled": true, "discountBps": 5}'::jsonb
)
ON CONFLICT ("key") DO NOTHING;
