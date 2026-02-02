-- DropTable (if exists)
DROP TABLE IF EXISTS "FikenToken";

-- AlterTable User - Add new columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeProvider" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;

-- CreateIndex (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateTable AccountingConnection
CREATE TABLE IF NOT EXISTS "AccountingConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "employeeToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,
    "companyName" TEXT,
    "organizationNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountingConnection_userId_idx" ON "AccountingConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountingConnection_userId_provider_key" ON "AccountingConnection"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AccountingConnection" ADD CONSTRAINT "AccountingConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
