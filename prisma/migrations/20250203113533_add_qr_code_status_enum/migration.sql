/*
  Warnings:

  - The `status` column on the `QrCode` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "QrCodeStatus" AS ENUM ('pending', 'scanned', 'confirmed', 'expired', 'cancelled');

-- AlterTable
ALTER TABLE "QrCode" DROP COLUMN "status",
ADD COLUMN     "status" "QrCodeStatus" NOT NULL DEFAULT 'pending';
