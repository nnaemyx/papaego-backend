/*
  Warnings:

  - You are about to drop the column `businessName` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the column `sector` on the `Supplier` table. All the data in the column will be lost.
  - You are about to drop the `SupplierCustomer` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `beneficiaryName` to the `Supplier` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerId` to the `Supplier` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_tradeId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierCustomer" DROP CONSTRAINT "SupplierCustomer_customerId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierCustomer" DROP CONSTRAINT "SupplierCustomer_supplierId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "fileUrl" TEXT,
ADD COLUMN     "tradeRequestId" TEXT,
ALTER COLUMN "tradeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" DROP COLUMN "businessName",
DROP COLUMN "sector",
ADD COLUMN     "beneficiaryName" TEXT NOT NULL,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "customerId" TEXT NOT NULL,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "routingCode" TEXT,
ADD COLUMN     "swiftBic" TEXT,
ALTER COLUMN "bankName" DROP NOT NULL,
ALTER COLUMN "accountNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TradeRequest" ADD COLUMN     "invoiceUrl" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- DropTable
DROP TABLE "SupplierCustomer";

-- CreateTable
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

-- CreateTable
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

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSupplierCustomer" ADD CONSTRAINT "AdminSupplierCustomer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "AdminSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSupplierCustomer" ADD CONSTRAINT "AdminSupplierCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
