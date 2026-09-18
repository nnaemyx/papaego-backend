-- AlterTable: add flexible metadata JSON column to Customer
ALTER TABLE "Customer" ADD COLUMN "metadata" JSONB;
