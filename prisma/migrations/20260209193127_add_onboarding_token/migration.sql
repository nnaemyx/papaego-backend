/*
  Warnings:

  - A unique constraint covering the columns `[onboardingToken]` on the table `AgentProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "governmentIdUrl" TEXT,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "onboardingStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "onboardingToken" TEXT,
ADD COLUMN     "onboardingTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "proofOfAddressUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_onboardingToken_key" ON "AgentProfile"("onboardingToken");
