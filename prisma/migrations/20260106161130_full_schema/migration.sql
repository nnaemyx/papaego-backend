-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "accountNo" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "FxMargin" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "margin" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "FxMargin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxMargin_countryId_key" ON "FxMargin"("countryId");
