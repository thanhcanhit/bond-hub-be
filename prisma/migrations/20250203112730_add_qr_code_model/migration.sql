-- CreateTable
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "userId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_qrToken_key" ON "QrCode"("qrToken");

-- CreateIndex
CREATE INDEX "QrCode_userId_idx" ON "QrCode"("userId");

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
