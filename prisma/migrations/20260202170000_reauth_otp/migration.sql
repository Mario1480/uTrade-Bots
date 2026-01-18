CREATE TABLE "ReauthOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReauthOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReauthOtp_userId_expiresAt_idx" ON "ReauthOtp"("userId", "expiresAt");

ALTER TABLE "ReauthOtp" ADD CONSTRAINT "ReauthOtp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
