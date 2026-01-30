-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "dexCacheTtlMs" INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN     "dexChain" TEXT NOT NULL DEFAULT 'ethereum',
ADD COLUMN     "dexDeviationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dexDeviationPolicy" TEXT NOT NULL DEFAULT 'alertOnly',
ADD COLUMN     "dexMaxDeviationBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dexNotifyCooldownSec" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "dexPriceFeedEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dexStaleAfterMs" INTEGER NOT NULL DEFAULT 15000,
ADD COLUMN     "dexTokenAddress" TEXT,
ADD COLUMN     "priceSourceMode" TEXT NOT NULL DEFAULT 'CEX';

-- AlterTable
ALTER TABLE "BotRuntime" ADD COLUMN     "dexDiffBps" DOUBLE PRECISION,
ADD COLUMN     "dexLastUpdate" TIMESTAMP(3),
ADD COLUMN     "dexStatus" TEXT,
ADD COLUMN     "midCex" DOUBLE PRECISION,
ADD COLUMN     "midDex" DOUBLE PRECISION;
