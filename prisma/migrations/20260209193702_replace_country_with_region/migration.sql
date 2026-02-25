/*
  Warnings:

  - You are about to drop the column `countryId` on the `AgentProfile` table. All the data in the column will be lost.
  - Added the required column `region` to the `AgentProfile` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "AgentProfile" DROP CONSTRAINT "AgentProfile_countryId_fkey";

-- AlterTable
ALTER TABLE "AgentProfile" DROP COLUMN "countryId",
ADD COLUMN     "region" TEXT NOT NULL;
