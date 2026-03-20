-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "companySector" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "governmentIdUrl" TEXT,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "nin" TEXT,
ADD COLUMN     "proofOfAddressUrl" TEXT;
