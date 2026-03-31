-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_tradeId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierCustomer" DROP CONSTRAINT "SupplierCustomer_customerId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierCustomer" DROP CONSTRAINT "SupplierCustomer_supplierId_fkey";

-- AlterTable (ChatMessage)
ALTER TABLE "ChatMessage" ADD COLUMN "fileUrl" TEXT,
ADD COLUMN "tradeRequestId" TEXT,
ALTER COLUMN "tradeId" DROP NOT NULL;

-- AlterTable (Supplier - Safe Migration)
-- 1. Add new columns as NULLABLE first
ALTER TABLE "Supplier" 
ADD COLUMN "beneficiaryName" TEXT,
ADD COLUMN "currency" TEXT,
ADD COLUMN "customerId" TEXT,
ADD COLUMN "iban" TEXT,
ADD COLUMN "routingCode" TEXT,
ADD COLUMN "swiftBic" TEXT;

-- 2. Data Migration: Populate beneficiaryName from old businessName
UPDATE "Supplier" SET "beneficiaryName" = "businessName" WHERE "beneficiaryName" IS NULL;

-- 3. Data Migration: Populate customerId from the SupplierCustomer join table
-- (This links the supplier to its correct customer before the join table is dropped)
UPDATE "Supplier" s
SET "customerId" = sc."customerId"
FROM "SupplierCustomer" sc
WHERE sc."supplierId" = s.id;

-- 4. Finalize Supplier table: Set NOT NULL and drop old columns
-- We set customerId to NOT NULL only after the migration above
ALTER TABLE "Supplier" 
ALTER COLUMN "beneficiaryName" SET NOT NULL,
ALTER COLUMN "customerId" SET NOT NULL,
ALTER COLUMN "bankName" DROP NOT NULL,
ALTER COLUMN "accountNumber" DROP NOT NULL,
DROP COLUMN "businessName",
DROP COLUMN "sector";

-- AlterTable (TradeRequest)
ALTER TABLE "TradeRequest" ADD COLUMN "invoiceUrl" TEXT,
ADD COLUMN "supplierId" TEXT;

-- DropTable (Old join table)
DROP TABLE "SupplierCustomer";

-- CreateTable (New Admin tables)
CREATE TABLE "AdminSupplier" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable (New Join table for Admin Suppliers)
CREATE TABLE "AdminSupplierCustomer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSupplierCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminSupplierCustomer_supplierId_customerId_key" ON "AdminSupplierCustomer"("supplierId", "customerId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tradeRequestId_fkey" FOREIGN KEY ("tradeRequestId") REFERENCES "TradeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (New direct relation for Supplier)
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (New direct relation for AdminSupplierCustomer)
ALTER TABLE "AdminSupplierCustomer" ADD CONSTRAINT "AdminSupplierCustomer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "AdminSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (New direct relation for AdminSupplierCustomer)
ALTER TABLE "AdminSupplierCustomer" ADD CONSTRAINT "AdminSupplierCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
